const RssParser = require('rss-parser');
const fetch = require('node-fetch');
const cron = require('node-cron');
const EventEmitter = require('events');
const logger = require('./utils/logger');

class YouTubeNotifier extends EventEmitter {
    constructor(config, apiKeys) {
        super();
        this.config = config;
        this.apiKeys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
        this.currentKeyIndex = 0;
        this.keyStatus = new Map(this.apiKeys.map(key => [key, {
            exceeded: false,
            resetTime: null,
            quotaUsed: 0
        }]));
        this.statistics = {
            apiCalls: 0,
            rssCalls: 0,
            notifications: 0,
            errors: 0
        };
        this.lastCheckTime = {};
        this.rssParser = new RssParser();
        this.cronJobs = new Map();
    }

    setupCronJob(guildId) {
        // Cancel existing cron job for this guild if it exists
        if (this.cronJobs.has(guildId)) {
            this.cronJobs.get(guildId).stop();
            this.cronJobs.delete(guildId);
        }

        const guildChannels = this.config.getChannels(guildId);
        
        // Check if there are any channels configured for this guild
        if (!guildChannels || Object.keys(guildChannels).length === 0) {
            logger.info(`Pomijanie ustawienia harmonogramu dla serwera ${guildId} - brak skonfigurowanych kanałów`);
            return;
        }

        const interval = this.config.getCheckInterval(guildId);
        const cronExpression = `*/${interval} * * * *`; // Run every X minutes

        logger.info(`Ustawianie harmonogramu dla serwera ${guildId} z interwałem ${interval} minut`);
        
        const job = cron.schedule(cronExpression, async () => {
            logger.info(`Uruchamianie zaplanowanego sprawdzenia dla serwera ${guildId}`);
            const guildChannels = this.config.getChannels(guildId);
            
            for (const channelId of Object.keys(guildChannels)) {
                try {
                    const updates = await this.checkChannel(channelId);
                    if (Array.isArray(updates) && updates.length > 0) {
                        // Get all guilds that have this channel configured
                        const allGuildChannels = this.config.config.channels;
                        
                        // Process updates for each guild that has this channel
                        for (const update of updates) {
                            for (const [targetGuildId, targetGuildConfig] of Object.entries(allGuildChannels)) {
                                if (targetGuildConfig[channelId]) {
                                    logger.info(`Przetwarzanie aktualizacji dla serwera ${targetGuildId} (kanał: ${channelId})`);
                                    await this.processUpdate(update, channelId, targetGuildId);
                                }
                            }
                        }
                    }
                    // Add small delay between channel checks
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (error) {
                    logger.error(`Błąd podczas sprawdzania kanału ${channelId} dla serwera ${guildId}:`, error);
                }
            }
        });

        // Add hourly cleanup of notified videos
        cron.schedule('0 * * * *', () => {
            logger.info('Rozpoczęcie czyszczenia starych powiadomień...');
            this.config.cleanupNotifiedVideos();
        });

        this.cronJobs.set(guildId, job);
    }

    async processUpdate(update, channelId, guildId) {
        const guildChannels = this.config.getChannels(guildId);
        const channelConfig = guildChannels[channelId];
        
        if (!channelConfig) return;

        const typeMapping = {
            'video': 'videos',
            'live': 'live',
            'scheduled': 'scheduled'
        };

        const notificationType = typeMapping[update.type];
        const discordChannelId = channelConfig.notificationChannels?.[notificationType];
        
        if (!discordChannelId) {
            logger.error(`Brak kanału dla typu ${update.type} na serwerze ${guildId}`);
            return;
        }

        logger.info(`Wysyłanie ${update.type}: "${update.title}" na kanał ${discordChannelId}`);
        
        this.statistics.notifications++;
        this.emit('update', {
            update,
            channelId,
            guildId,
            discordChannelId
        });
    }

    resetQuota() {
        for (const key of this.apiKeys) {
            this.keyStatus.set(key, {
                exceeded: false,
                resetTime: null,
                quotaUsed: 0
            });
        }
        this.currentKeyIndex = 0;
        console.log(`[${new Date().toLocaleTimeString()}] Zresetowano limity API`);
        
        // Log next reset time
        const now = new Date();
        const nextReset = new Date(now);
        nextReset.setDate(nextReset.getDate() + 1);
        nextReset.setHours(0, 0, 0, 0);
        console.log(`[${new Date().toLocaleTimeString()}] Następny reset limitu API: ${nextReset.toLocaleString("pl-PL", {timeZone: "America/Los_Angeles"})} PT`);
    }

    markKeyAsExceeded(keyIndex) {
        const key = this.apiKeys[keyIndex];
        this.keyStatus.set(key, {
            exceeded: true,
            resetTime: new Date(new Date().setHours(24, 0, 0, 0)), // Next midnight
            quotaUsed: 10000 // Assuming max quota
        });
        console.log(`[${new Date().toLocaleTimeString()}] Klucz API ${keyIndex + 1} oznaczony jako przekroczony do ${this.keyStatus.get(key).resetTime.toLocaleTimeString()}`);
    }

    updateQuotaUsage(key, quotaUsed) {
        const status = this.keyStatus.get(key);
        if (status) {
            status.quotaUsed += quotaUsed;
            if (status.quotaUsed >= 10000) { // YouTube's daily quota limit
                status.exceeded = true;
                status.resetTime = new Date(new Date().setHours(24, 0, 0, 0));
                console.log(`[${new Date().toLocaleTimeString()}] Klucz API przekroczył dzienny limit (${status.quotaUsed}/10000)`);
            }
            this.keyStatus.set(key, status);
        }
    }

    getNextValidKey() {
        const startIndex = this.currentKeyIndex;
        do {
            const key = this.apiKeys[this.currentKeyIndex];
            const status = this.keyStatus.get(key);
            
            if (!status.exceeded) {
                return key;
            }

            // Check if it's time to reset this key
            if (status.resetTime && new Date() >= status.resetTime) {
                this.keyStatus.set(key, {
                    exceeded: false,
                    resetTime: null,
                    quotaUsed: 0
                });
                console.log(`[${new Date().toLocaleTimeString()}] Klucz API ${this.currentKeyIndex + 1} został zresetowany`);
                return key;
            }

            this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
        } while (this.currentKeyIndex !== startIndex);

        return null;
    }

    async getUploadsPlaylistId(channelId, apiKey) {
        try {
            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${apiKey}`
            );

            if (!response.ok) {
                throw new Error(`Błąd API: ${response.status}`);
            }

            const data = await response.json();
            if (!data.items || data.items.length === 0) {
                throw new Error('Nie znaleziono kanału');
            }

            return data.items[0].contentDetails.relatedPlaylists.uploads;
        } catch (error) {
            console.error(`Błąd podczas pobierania ID playlisty dla ${channelId}:`, error);
            throw error;
        }
    }

    getStatistics() {
        const activeKeys = this.apiKeys.filter(key => !this.keyStatus.get(key).exceeded).length;
        return {
            ...this.statistics,
            activeKeys
        };
    }

    // Update the checkWithAPI method to track quota usage
    async checkWithAPI(channelId) {
        try {
            const apiKey = this.getNextValidKey();
            const uploadsPlaylistId = channelId.startsWith('UC') ? 'UU' + channelId.slice(2) : channelId;
            
            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/playlistItems?key=${apiKey}&playlistId=${uploadsPlaylistId}&part=snippet,status&maxResults=10&order=date`
            );

            if (!response.ok) {
                if (response.status === 404) {
                    logger.error(`Playlista uploads niedostępna dla kanału ${channelId}`);
                    return { videos: { items: [] }, streams: { items: [] }, scheduled: { items: [] } };
                }
                throw new Error(`Błąd API: ${response.status}`);
            }

            const data = await response.json();
            const items = data.items || [];

            // Get additional details for potential livestreams
            const potentialStreams = items.filter(item => 
                item.snippet.title?.toLowerCase().includes('nadaje na żywo') || 
                item.snippet.title?.toLowerCase().includes('live') ||
                item.snippet.thumbnails?.high?.url?.includes('_live.jpg') ||
                item.snippet.liveBroadcastContent === 'live' ||
                item.snippet.liveBroadcastContent === 'upcoming'
            );

            // Fetch additional details for potential streams
            for (const item of potentialStreams) {
                try {
                    const videoResponse = await fetch(
                        `https://www.googleapis.com/youtube/v3/videos?key=${apiKey}&id=${item.snippet.resourceId.videoId}&part=liveStreamingDetails,snippet`
                    );
                    if (videoResponse.ok) {
                        const videoData = await videoResponse.json();
                        if (videoData.items?.[0]) {
                            const details = videoData.items[0];
                            item.snippet.scheduledStartTime = details.liveStreamingDetails?.scheduledStartTime;
                            item.snippet.actualStartTime = details.liveStreamingDetails?.actualStartTime;
                        }
                        this.updateQuotaUsage(apiKey, 2);
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    logger.error(`Błąd szczegółów transmisji ${item.snippet.resourceId.videoId}: ${error}`);
                }
            }

            // Filtering logic
            const videos = items.filter(item => {
                const isLiveOrScheduled = 
                    item.snippet.liveBroadcastContent === 'live' ||
                    item.snippet.liveBroadcastContent === 'upcoming' ||
                    item.snippet.scheduledStartTime ||
                    item.snippet.actualStartTime;
                return !isLiveOrScheduled;
            });

            const streams = items.filter(item => 
                item.snippet.liveBroadcastContent === 'live' ||
                item.snippet.actualStartTime
            );

            const scheduled = items.filter(item => 
                (item.snippet.liveBroadcastContent === 'upcoming' || item.snippet.scheduledStartTime) &&
                !item.snippet.actualStartTime
            );

            if (videos.length > 0 || streams.length > 0 || scheduled.length > 0) {
                logger.info(`Kanał ${channelId}: ${videos.length} filmów, ${streams.length} transmisji, ${scheduled.length} zaplanowanych`);
            }

            return {
                videos: { items: videos },
                streams: { items: streams },
                scheduled: { items: scheduled }
            };
        } catch (error) {
            logger.error(`Błąd API dla ${channelId}: ${error}`);
            throw error;
        }
    }

    async checkChannel(channelId) {
        const now = Date.now();
        const lastCheck = this.lastCheckTime[channelId] || 0;
        
        if (now - lastCheck < 45000) {
            logger.debug(`Pomijanie kanału ${channelId} - za wcześnie na kolejne sprawdzenie (ostatnie: ${new Date(lastCheck).toLocaleTimeString()})`);
            return null;
        }
        
        this.lastCheckTime[channelId] = now;
        logger.info(`Rozpoczęcie sprawdzania kanału ${channelId}`);

        try {
            const response = await this.checkWithAPI(channelId);
            const updates = [];

            // Process regular videos
            for (const video of response.videos.items) {
                const videoId = video.snippet?.resourceId?.videoId;
                if (videoId && !this.config.isVideoNotified(videoId)) {
                    const publishTime = new Date(video.snippet.publishedAt);
                    const videoAge = Date.now() - publishTime.getTime();
                    const oneHour = 60 * 60 * 1000;

                    if (videoAge > oneHour) {
                        logger.debug(`Pomijanie starego filmu (${Math.floor(videoAge / oneHour)}h): ${video.snippet.title}`);
                        continue;
                    }

                    logger.info(`Wykryto nowy film: "${video.snippet.title}" (ID: ${videoId})`);
                    updates.push(this.createUpdateObject(video, 'video'));
                    this.config.addNotifiedVideo(videoId);
                }
            }

            // Process live streams
            for (const stream of response.streams.items) {
                const videoId = stream.snippet?.resourceId?.videoId;
                if (videoId && !this.config.isVideoNotified(videoId)) {
                    console.log(`[${new Date().toLocaleTimeString()}] Znaleziono nową transmisję: ${stream.snippet.title}`);
                    updates.push(this.createUpdateObject(stream, 'live'));
                    this.config.addNotifiedVideo(videoId);
                }
            }

            // Process scheduled streams
            for (const scheduled of response.scheduled.items) {
                const videoId = scheduled.snippet?.resourceId?.videoId;
                if (videoId && !this.config.isVideoNotified(videoId)) {
                    console.log(`[${new Date().toLocaleTimeString()}] Znaleziono zaplanowaną transmisję: ${scheduled.snippet.title}`);
                    updates.push(this.createUpdateObject(scheduled, 'scheduled'));
                    this.config.addNotifiedVideo(videoId);
                }
            }

            if (updates.length > 0) {
                logger.info(`Znaleziono ${updates.length} nowych aktualizacji dla kanału ${channelId}`);
                logger.debug(`Szczegóły aktualizacji: ${updates.map(u => `${u.type}: ${u.title}`).join(', ')}`);
            } else {
                logger.debug(`Brak nowych aktualizacji dla kanału ${channelId}`);
            }

            return updates.length > 0 ? updates : null;
        } catch (error) {
            logger.error(`Błąd podczas sprawdzania kanału ${channelId}: ${error}`);
            throw error;
        }
    }

    async checkWithRSS(channelId) {
        const lastVideoId = this.config.getLastChecked(channelId);
        const isFirstCheck = !lastVideoId;

        this.statistics.rssCalls++;
        console.log(`[${new Date().toLocaleTimeString()}] Próba sprawdzenia RSS dla kanału ${channelId}`);
        
        try {
            const feed = await this.rssParser.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
            
            if (!feed.items?.length) return null;

            const latestItem = feed.items[0];
            const videoId = latestItem.id.split(':').pop();

            if (lastVideoId !== videoId) {
                // For first check, skip old videos
                if (isFirstCheck) {
                    const publishTime = new Date(latestItem.pubDate);
                    const videoAge = Date.now() - publishTime.getTime();
                    if (videoAge > 60 * 60 * 1000) { // 1 hour
                        console.log(`[${new Date().toLocaleTimeString()}] Pomijanie starego filmu przy pierwszym sprawdzeniu (RSS): ${latestItem.title}`);
                        this.config.setLastChecked(channelId, videoId);
                        return null;
                    }
                }

                this.config.setLastChecked(channelId, videoId);
                return {
                    type: 'video',
                    title: latestItem.title,
                    url: latestItem.link,
                    thumbnail: latestItem.media?.thumbnail?.[0]?.$.url || null,
                    channelTitle: feed.title,
                    publishedAt: latestItem.pubDate
                };
            }

            return null;
        } catch (error) {
            console.error(`[${new Date().toLocaleTimeString()}] Błąd podczas pobierania RSS ${channelId}:`, error);
            return null;
        }
    }

    createUpdateObject(item, type) {
        logger.info(`Tworzenie obiektu aktualizacji dla filmu: ${item.snippet.title}`);
        return {
            type: type,
            title: item.snippet.title,
            url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
            thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
            channelTitle: item.snippet.channelTitle,
            publishedAt: item.snippet.publishedAt,
            scheduledStartTime: item.snippet.scheduledStartTime || null
        };
    }

    async performInitialCheck() {
        logger.info('Wykonywanie początkowego sprawdzenia kanałów...');
        try {
            const allChannels = new Set();
            const guildChannels = this.config.config.channels;
            
            // First, collect all unique YouTube channel IDs
            Object.values(guildChannels).forEach(channels => {
                Object.keys(channels).forEach(channelId => {
                    allChannels.add(channelId);
                });
            });

            // Then check each YouTube channel
            for (const channelId of allChannels) {
                const updates = await this.checkChannel(channelId);
                if (Array.isArray(updates) && updates.length > 0) {
                    for (const update of updates) {
                        // Track which Discord channels we've sent to for this update
                        const notifiedDiscordChannels = new Set();
                        
                        for (const [guildId, guildConfig] of Object.entries(guildChannels)) {
                            if (guildConfig[channelId]) {
                                const discordChannelId = guildConfig[channelId].notificationChannels?.[
                                    update.type === 'video' ? 'videos' : update.type
                                ];
                                
                                // Skip if we've already sent to this Discord channel
                                if (discordChannelId && !notifiedDiscordChannels.has(discordChannelId)) {
                                    await this.processUpdate(update, channelId, guildId);
                                    notifiedDiscordChannels.add(discordChannelId);
                                }
                            }
                        }
                    }
                }
            }
            logger.info('Początkowe sprawdzenie zakończone');
        } catch (error) {
            logger.error(`Błąd podczas początkowego sprawdzenia: ${error}`);
        }
    }

    async checkServer(serverId) {
        const serverConfig = this.config.getChannels(serverId);
        
        if (!serverConfig || Object.keys(serverConfig).length === 0) {
            logger.info(`Pomijanie sprawdzenia dla serwera ${serverId} - brak skonfigurowanych kanałów`);
            return;
        }

        logger.info(`Uruchamianie zaplanowanego sprawdzenia dla serwera ${serverId}`);
        
        for (const channelId of Object.keys(serverConfig)) {
            try {
                const updates = await this.checkChannel(channelId);
                if (Array.isArray(updates) && updates.length > 0) {
                    // Get all guilds that have this channel configured
                    const allGuildChannels = this.config.config.channels;
                    
                    // Process updates for each guild that has this channel
                    for (const update of updates) {
                        // Track which Discord channels we've sent to for this update
                        const notifiedDiscordChannels = new Set();
                        
                        for (const [guildId, guildConfig] of Object.entries(allGuildChannels)) {
                            if (guildConfig[channelId]) {
                                const discordChannelId = guildConfig[channelId].notificationChannels?.[
                                    update.type === 'video' ? 'videos' : update.type
                                ];
                                
                                // Skip if we've already sent to this Discord channel
                                if (discordChannelId && !notifiedDiscordChannels.has(discordChannelId)) {
                                    logger.info(`Przetwarzanie aktualizacji dla serwera ${guildId} (kanał: ${channelId})`);
                                    await this.processUpdate(update, channelId, guildId);
                                    notifiedDiscordChannels.add(discordChannelId);
                                }
                            }
                        }
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                logger.error(`Błąd podczas sprawdzania kanału ${channelId} dla serwera ${serverId}:`, error);
            }
        }
    }

    getCheckInterval(serverId) {
        return this.config.checkIntervals[serverId] || this.config.checkIntervals.default || 1;
    }
}

module.exports = YouTubeNotifier; 