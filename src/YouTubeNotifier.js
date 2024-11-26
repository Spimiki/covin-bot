const RssParser = require('rss-parser');
const fetch = require('node-fetch');
const cron = require('node-cron');
const EventEmitter = require('events');

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
        }

        const interval = this.config.getCheckInterval(guildId);
        const cronExpression = `*/${interval} * * * *`; // Run every X minutes

        console.log(`[${new Date().toLocaleTimeString()}] Ustawianie harmonogramu dla serwera ${guildId} z interwałem ${interval} minut`);
        
        const job = cron.schedule(cronExpression, async () => {
            console.log(`[${new Date().toLocaleTimeString()}] Uruchamianie zaplanowanego sprawdzenia dla serwera ${guildId}`);
            const guildChannels = this.config.getChannels(guildId);
            
            for (const channelId of Object.keys(guildChannels)) {
                try {
                    const updates = await this.checkChannel(channelId);
                    if (Array.isArray(updates) && updates.length > 0) {
                        for (const update of updates) {
                            await this.processUpdate(update, channelId, guildId);
                        }
                    }
                    // Add small delay between channel checks
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (error) {
                    console.error(`[${new Date().toLocaleTimeString()}] Błąd podczas sprawdzania kanału ${channelId} dla serwera ${guildId}:`, error);
                }
            }
        });

        // Add hourly cleanup of notified videos
        cron.schedule('0 * * * *', () => {
            this.config.cleanupNotifiedVideos();
        });

        this.cronJobs.set(guildId, job);
    }

    async processUpdate(update, channelId, guildId) {
        const guildChannels = this.config.getChannels(guildId);
        const channelConfig = guildChannels[channelId];
        if (!channelConfig) return;

        const discordChannelId = channelConfig[update.type];
        if (!discordChannelId) {
            console.log(`[${new Date().toLocaleTimeString()}] Brak skonfigurowanego kanału dla typu ${update.type} na serwerze ${guildId}`);
            return;
        }

        // Emit an event for the main application to handle the update
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
            const lastVideoId = this.config.getLastChecked(channelId);
            const updates = [];

            console.log(`[${new Date().toLocaleTimeString()}] Wysyłanie zapytań API dla kanału ${channelId}`);
            
            const [videoResponse, liveResponse] = await Promise.all([
                fetch(`https://www.googleapis.com/youtube/v3/playlistItems?key=${apiKey}&playlistId=${uploadsPlaylistId}&part=snippet&maxResults=5&order=date`),
                fetch(`https://www.googleapis.com/youtube/v3/search?key=${apiKey}&channelId=${channelId}&part=snippet&eventType=live&type=video&maxResults=1`)
            ]);

            console.log(`[${new Date().toLocaleTimeString()}] Status odpowiedzi API - Filmy: ${videoResponse.status}, Transmisje: ${liveResponse.status}`);

            if (!videoResponse.ok || !liveResponse.ok) {
                const videoError = await videoResponse.text().catch(() => 'Brak szczegółów błędu');
                const liveError = await liveResponse.text().catch(() => 'Brak szczegółów błędu');
                throw new Error(`Błąd API - Filmy: ${videoError}, Transmisje: ${liveError}`);
            }

            const [videoData, liveData] = await Promise.all([
                videoResponse.json(),
                liveResponse.json()
            ]);

            // Log quota usage if available in response headers
            const quotaUsage = videoResponse.headers.get('x-quota-usage');
            if (quotaUsage) {
                console.log(`[${new Date().toLocaleTimeString()}] Użycie limitu API: ${quotaUsage}`);
            }

            // Log live stream check results
            if (liveData.items?.length > 0) {
                console.log(`[${new Date().toLocaleTimeString()}] Znaleziono ${liveData.items.length} transmisje dla ${channelId}`);
            }

            // Check livestreams first
            if (liveData.items?.[0]) {
                const liveItem = liveData.items[0];
                if (liveItem.snippet.liveBroadcastContent === 'live' && 
                    lastVideoId !== liveItem.id.videoId) {
                    
                    console.log(`[${new Date().toLocaleTimeString()}] Znaleziono nową transmisję: ${liveItem.snippet.title}`);
                    updates.push(this.createUpdateObject(liveItem, 'live'));
                }
            }

            // Log video check results
            if (videoData.items?.length > 0) {
                console.log(`[${new Date().toLocaleTimeString()}] Znaleziono ${videoData.items.length} filmów dla ${channelId}`);
                
                // Process videos
                for (const item of videoData.items) {
                    const videoId = item.snippet?.resourceId?.videoId;
                    if (videoId && videoId !== lastVideoId && !this.config.isVideoNotified(videoId)) {
                        // Check if video is less than an hour old
                        const publishTime = new Date(item.snippet.publishedAt);
                        const videoAge = Date.now() - publishTime.getTime();
                        const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds

                        if (videoAge > oneHour) {
                            console.log(`[${new Date().toLocaleTimeString()}] Pomijanie starego filmu (${Math.floor(videoAge / oneHour)}h): ${item.snippet.title}`);
                            this.config.setLastChecked(channelId, videoId);
                            continue;
                        }

                        console.log(`[${new Date().toLocaleTimeString()}] Znaleziono nowy film: ${item.snippet.title}`);
                        updates.push({
                            type: 'video',
                            title: item.snippet.title,
                            url: `https://www.youtube.com/watch?v=${videoId}`,
                            thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
                            channelTitle: item.snippet.channelTitle,
                            publishedAt: item.snippet.publishedAt
                        });
                        this.config.addNotifiedVideo(videoId);
                        this.config.setLastChecked(channelId, videoId);
                        break; // Only process the most recent video
                    }
                }
            }

            // Update quota usage (each request costs different amounts)
            // playlistItems.list = 1 unit
            // search.list = 100 units
            this.updateQuotaUsage(apiKey, 101);

            return updates.length > 0 ? updates : null;
        } catch (error) {
            console.error(`[${new Date().toLocaleTimeString()}] Błąd podczas sprawdzania API dla ${channelId}:`, error);
            throw error;
        }
    }

    async checkChannel(channelId) {
        const now = Date.now();
        const lastCheck = this.lastCheckTime[channelId] || 0;
        
        if (now - lastCheck < 45000) { // 45 seconds cooldown
            console.log(`[${new Date().toLocaleTimeString()}] Pomijanie kanału ${channelId} - za wcześnie na kolejne sprawdzenie`);
            return null;
        }
        
        this.lastCheckTime[channelId] = now;

        try {
            // Always try API first
            const apiResult = await this.checkWithAPI(channelId);
            if (apiResult) return apiResult;

            // Only use RSS if all API keys are exceeded
            const allKeysExceeded = Array.from(this.keyStatus.values()).every(status => status.exceeded);
            if (allKeysExceeded) {
                console.log(`[${new Date().toLocaleTimeString()}] Wszystkie klucze API wyczerpane, używam RSS dla ${channelId}`);
                return this.checkWithRSS(channelId);
            }

            return null;
        } catch (error) {
            if (error.message === 'Przekroczono limit zapytań API') {
                console.log(`[${new Date().toLocaleTimeString()}] Limit API przekroczony, używam RSS dla ${channelId}`);
                return this.checkWithRSS(channelId);
            }
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
        return {
            type: type,
            title: item.snippet.title,
            url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
            thumbnail: item.snippet.thumbnails.high.url,
            channelTitle: item.snippet.channelTitle,
            publishedAt: item.snippet.publishedAt,
            scheduledStartTime: item.snippet.scheduledStartTime || null
        };
    }

    cleanupNotifiedVideos() {
        this.notifiedVideos.clear();
        console.log(`[${new Date().toLocaleTimeString()}] Wyczyszczono listę powiadomionych filmów`);
    }

    async performInitialCheck() {
        console.log(`[${new Date().toLocaleTimeString()}] Wykonywanie początkowego sprawdzenia kanałów...`);
        try {
            const allChannels = new Set();
            const guildChannels = this.config.config.channels;
            
            // Collect unique channel IDs from all guilds
            Object.values(guildChannels).forEach(channels => {
                Object.keys(channels).forEach(channelId => {
                    allChannels.add(channelId);
                });
            });

            for (const channelId of allChannels) {
                await this.checkChannel(channelId);
            }
            console.log(`[${new Date().toLocaleTimeString()}] Początkowe sprawdzenie zakończone`);
        } catch (error) {
            console.error(`[${new Date().toLocaleTimeString()}] Błąd podczas początkowego sprawdzenia:`, error);
        }
    }
}

module.exports = YouTubeNotifier; 