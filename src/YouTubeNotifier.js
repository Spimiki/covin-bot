const RssParser = require('rss-parser');
const fetch = require('node-fetch');
const cron = require('node-cron');
const EventEmitter = require('events');
const logger = require('./utils/logger');

const QUOTA_COSTS = {
    PLAYLIST_ITEMS: 1,  // playlistItems.list
    VIDEO_DETAILS: 1,   // videos.list
    CHANNEL_DETAILS: 1  // channels.list
};

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
        this.lastCheckTime = {};
        this.cronJobs = new Map();
        this.rssParser = new RssParser();
        this.rssUsageCount = 0;
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

        // Only proceed if there are actual YouTube channels configured
        const hasConfiguredChannels = Object.values(guildChannels).some(channel => 
            Object.keys(channel).length > 0
        );

        if (!hasConfiguredChannels) {
            logger.info(`Pomijanie ustawienia harmonogramu dla serwera ${guildId} - brak aktywnych kanałów YouTube`);
            return;
        }

        const interval = this.config.getCheckInterval(guildId);
        const cronExpression = `*/${interval} * * * *`; // Run every X minutes

        logger.info(`Ustawianie harmonogramu dla serwera ${guildId} z interwałem ${interval} minut`);
        
        const job = cron.schedule(cronExpression, async () => {
            logger.info(`Uruchamianie zaplanowanego sprawdzenia dla serwera ${guildId}`);
            await this.checkServer(guildId);
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
        logger.info('API quotas have been reset');
        
        // Log next reset time
        const now = new Date();
        const nextReset = new Date(now);
        nextReset.setDate(nextReset.getDate() + 1);
        nextReset.setHours(0, 0, 0, 0);
        logger.info(`Next API quota reset: ${nextReset.toLocaleString("pl-PL", {timeZone: "America/Los_Angeles"})} PT`);
    }

    markKeyAsExceeded(keyIndex) {
        const key = this.apiKeys[keyIndex];
        const resetTime = new Date();
        resetTime.setHours(24, 0, 0, 0); // Next midnight

        this.keyStatus.set(key, {
            exceeded: true,
            resetTime: resetTime,
            quotaUsed: 10000 // Max quota
        });

        logger.warn(`API key ${keyIndex + 1} marked as exceeded until ${resetTime.toLocaleTimeString()}`);
        this.currentKeyIndex = (keyIndex + 1) % this.apiKeys.length;
    }

    updateQuotaUsage(key, quotaUsed) {
        const status = this.keyStatus.get(key);
        if (status) {
            status.quotaUsed += quotaUsed;
            logger.debug(`API key #${this.apiKeys.indexOf(key) + 1} quota usage: ${status.quotaUsed}/10000`);
            
            if (status.quotaUsed >= 10000) {
                status.exceeded = true;
                status.resetTime = new Date(new Date().setHours(24, 0, 0, 0));
                logger.warn(`API key #${this.apiKeys.indexOf(key) + 1} has exceeded daily quota`);
                // Move to next key immediately
                this.currentKeyIndex = (this.apiKeys.indexOf(key) + 1) % this.apiKeys.length;
            }
            this.keyStatus.set(key, status);
        }
    }

    async getNextValidKey() {
        const startIndex = this.currentKeyIndex;
        do {
            const key = this.apiKeys[this.currentKeyIndex];
            const status = this.keyStatus.get(key);
            
            // Check if key is valid before returning
            if (!status.exceeded) {
                logger.debug(`Using API key #${this.currentKeyIndex + 1}`);
                return key;
            }

            // Check if it's time to reset this key
            if (status.resetTime && new Date() >= status.resetTime) {
                this.keyStatus.set(key, {
                    exceeded: false,
                    resetTime: null,
                    quotaUsed: 0
                });
                logger.info(`API key ${this.currentKeyIndex + 1} has been reset`);
                return key;
            }

            this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
        } while (this.currentKeyIndex !== startIndex);

        logger.warn('No valid API keys available');
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
            activeKeys
        };
    }

    // Update the checkWithAPI method to track quota usage
    async checkWithAPI(channelId) {
        try {
            const apiKey = await this.getNextValidKey();
            if (!apiKey) {
                logger.error('No valid API keys available');
                throw new Error('No valid API keys available');
            }

            const uploadsPlaylistId = channelId.startsWith('UC') ? 'UU' + channelId.slice(2) : channelId;
            
            logger.debug(`Making API request for channel ${channelId} with key #${this.apiKeys.indexOf(apiKey) + 1}`);

            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/playlistItems?key=${apiKey}&playlistId=${uploadsPlaylistId}&part=snippet,status&maxResults=10&order=date`
            );

            if (!response.ok) {
                if (response.status === 403) {
                    logger.warn(`API key ${this.apiKeys.indexOf(apiKey) + 1} quota exceeded`);
                    this.markKeyAsExceeded(this.apiKeys.indexOf(apiKey));
                    return this.checkWithAPI(channelId);
                }
                if (response.status === 404) {
                    logger.error(`Uploads playlist not available for channel ${channelId}`);
                    return { videos: { items: [] }, streams: { items: [] }, scheduled: { items: [] } };
                }
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            this.updateQuotaUsage(apiKey, QUOTA_COSTS.PLAYLIST_ITEMS);

            const items = data.items || [];

            // First filter out old content
            const oneHour = 60 * 60 * 1000;
            const recentItems = items.filter(item => {
                const publishTime = new Date(item.snippet.publishedAt);
                const age = Date.now() - publishTime.getTime();
                return age <= oneHour;
            });

            // Then identify potential streams only from recent items
            const potentialStreams = recentItems.filter(item => 
                item.snippet.title?.toLowerCase().includes('nadaje na żywo') || 
                item.snippet.title?.toLowerCase().includes('live') ||
                item.snippet.thumbnails?.high?.url?.includes('_live.jpg') ||
                item.snippet.liveBroadcastContent === 'live' ||
                item.snippet.liveBroadcastContent === 'upcoming'
            );

            // Only fetch additional details for recent potential streams
            for (const item of potentialStreams) {
                try {
                    const currentKey = await this.getNextValidKey();
                    if (!currentKey) {
                        logger.error('No valid API keys available for stream details');
                        break;
                    }

                    const videoResponse = await fetch(
                        `https://www.googleapis.com/youtube/v3/videos?key=${currentKey}&id=${item.snippet.resourceId.videoId}&part=liveStreamingDetails,snippet`
                    );

                    if (!videoResponse.ok) {
                        if (videoResponse.status === 403) {
                            this.markKeyAsExceeded(this.currentKeyIndex);
                            continue;
                        }
                        throw new Error(`Error fetching stream details: ${videoResponse.status}`);
                    }

                    const videoData = await videoResponse.json();
                    this.updateQuotaUsage(currentKey, QUOTA_COSTS.VIDEO_DETAILS);

                    if (videoData.items?.[0]) {
                        const details = videoData.items[0];
                        item.snippet.scheduledStartTime = details.liveStreamingDetails?.scheduledStartTime;
                        item.snippet.actualStartTime = details.liveStreamingDetails?.actualStartTime;
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    logger.error(`Stream details error for ${item.snippet.resourceId.videoId}: ${error}`);
                }
            }

            // Filter items into appropriate categories
            const videos = recentItems.filter(item => {
                const isLiveOrScheduled = 
                    item.snippet.liveBroadcastContent === 'live' ||
                    item.snippet.liveBroadcastContent === 'upcoming' ||
                    item.snippet.scheduledStartTime ||
                    item.snippet.actualStartTime;
                return !isLiveOrScheduled;
            });

            const streams = recentItems.filter(item => 
                item.snippet.liveBroadcastContent === 'live' ||
                item.snippet.actualStartTime
            );

            const scheduled = recentItems.filter(item => 
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
            logger.error(`API check failed for ${channelId}: ${error.message}`);
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
            // First try with API
            try {
                const response = await this.checkWithAPI(channelId);
                return this.processChannelResponse(response, channelId);
            } catch (error) {
                if (error.message === 'No valid API keys available') {
                    logger.warn(`Wszystkie klucze API wyczerpane, próba użycia RSS dla ${channelId}`);
                    // If all API keys are exhausted, try RSS as fallback
                    const rssResponse = await this.checkWithRSS(channelId);
                    if (rssResponse) {
                        return [rssResponse];
                    }
                }
                throw error;
            }
        } catch (error) {
            logger.error(`Błąd podczas sprawdzania kanału ${channelId}: ${error}`);
            throw error;
        }
    }

    async checkWithRSS(channelId) {
        try {
            this.rssUsageCount++;
            logger.info(`Trying RSS fallback for channel ${channelId}`);
            
            const feed = await this.rssParser.parseURL(
                `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
            ).catch(error => {
                logger.error(`RSS feed fetch failed: ${error.message}`);
                return null;
            });
            
            if (!feed || !feed.items?.length) {
                logger.debug(`No items found in RSS feed for ${channelId}`);
                return null;
            }

            const latestItem = feed.items[0];
            const videoId = latestItem.id.split(':').pop();

            if (this.config.isVideoNotified(videoId)) {
                logger.debug(`Video ${videoId} already notified (RSS)`);
                return null;
            }

            const publishTime = new Date(latestItem.pubDate);
            const videoAge = Date.now() - publishTime.getTime();
            if (videoAge > 60 * 60 * 1000) {
                logger.debug(`Skipping old video from RSS: ${latestItem.title} (${Math.floor(videoAge / (60 * 60 * 1000))}h old)`);
                return null;
            }

            logger.info(`Found new video via RSS: ${latestItem.title}`);
            this.config.addNotifiedVideo(videoId);

            return {
                type: 'video',
                title: latestItem.title,
                url: latestItem.link,
                thumbnail: latestItem.media?.thumbnail?.[0]?.$.url || null,
                channelTitle: feed.title,
                publishedAt: latestItem.pubDate
            };
        } catch (error) {
            logger.error(`RSS check failed for ${channelId}: ${error.message}`);
            return null;
        }
    }

    processChannelResponse(response, channelId) {
        const updates = [];
        const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds

        // Process regular videos
        for (const video of response.videos.items) {
            const videoId = video.snippet?.resourceId?.videoId;
            if (videoId && !this.config.isVideoNotified(videoId)) {
                const publishTime = new Date(video.snippet.publishedAt);
                const videoAge = Date.now() - publishTime.getTime();

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
            if (videoId && !this.config.isVideoNotified(videoId, true)) {
                const startTime = new Date(stream.snippet.actualStartTime || stream.snippet.publishedAt);
                const streamAge = Date.now() - startTime.getTime();

                if (streamAge > oneHour) {
                    logger.debug(`Pomijanie starej transmisji (${Math.floor(streamAge / oneHour)}h): ${stream.snippet.title}`);
                    continue;
                }

                logger.info(`Znaleziono nową transmisję: ${stream.snippet.title}`);
                updates.push(this.createUpdateObject(stream, 'live'));
                this.config.addNotifiedVideo(videoId, true);
            }
        }

        // Process scheduled streams
        for (const scheduled of response.scheduled.items) {
            const videoId = scheduled.snippet?.resourceId?.videoId;
            if (videoId && !this.config.isVideoNotified(videoId)) {
                const scheduledTime = new Date(scheduled.snippet.scheduledStartTime);
                
                // Skip if the scheduled time is more than 24 hours in the past
                if (scheduledTime < new Date(Date.now() - 24 * oneHour)) {
                    logger.debug(`Pomijanie starej zaplanowanej transmisji (>24h): ${scheduled.snippet.title}`);
                    continue;
                }

                logger.info(`Znaleziono zaplanowaną transmisję: ${scheduled.snippet.title}`);
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

    getAllYouTubeChannels() {
        const uniqueChannels = new Set();
        Object.values(this.config.config.channels || {}).forEach(guildChannels => {
            Object.keys(guildChannels).forEach(channelId => {
                uniqueChannels.add(channelId);
            });
        });
        return Array.from(uniqueChannels);
    }

    getRssUsage() {
        return this.rssUsageCount;
    }
}

module.exports = YouTubeNotifier; 