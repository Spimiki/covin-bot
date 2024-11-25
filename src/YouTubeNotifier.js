const RssParser = require('rss-parser');
const fetch = require('node-fetch');

class YouTubeNotifier {
    constructor(apiKeys, config) {
        this.apiKeys = apiKeys;
        this.currentKeyIndex = 0;
        this.quotaExceeded = new Map();
        this.config = config;
        this.lastCheckTime = {};
        this.statistics = {
            apiCalls: 0,
            rssCalls: 0,
            errors: 0,
            notifications: 0
        };
        this.keyUsageStats = new Map();
        this.rssParser = new RssParser();
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
            if (this.quotaExceeded.size === this.apiKeys.length) {
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

    async checkWithAPI(channelId) {
        const apiKey = this.getNextValidKey();
        if (!apiKey) {
            throw new Error('Przekroczono limit zapytań API');
        }

        const lastVideoId = this.config.getLastChecked(channelId);
        const isFirstCheck = !lastVideoId;

        this.statistics.apiCalls++;
        console.log(`[${new Date().toLocaleTimeString()}] Sprawdzanie API dla kanału ${channelId} (Klucz ${this.currentKeyIndex + 1}/${this.apiKeys.length})`);
        
        try {
            const [videoResponse, liveResponse] = await Promise.all([
                fetch(`https://www.googleapis.com/youtube/v3/search?key=${apiKey}&channelId=${channelId}&part=snippet,id&order=date&maxResults=1&type=video`),
                fetch(`https://www.googleapis.com/youtube/v3/search?key=${apiKey}&channelId=${channelId}&part=snippet,id&type=video&eventType=live,upcoming`)
            ]);

            if (videoResponse.status === 403 || liveResponse.status === 403) {
                this.markKeyAsExceeded(this.currentKeyIndex);
                throw new Error('Przekroczono limit zapytań API');
            }

            const [videoData, liveData] = await Promise.all([
                videoResponse.json(),
                liveResponse.json()
            ]);

            // Check livestreams first
            if (liveData.items?.[0]) {
                const liveItem = liveData.items[0];
                if ((liveItem.snippet.liveBroadcastContent === 'live' || 
                     liveItem.snippet.liveBroadcastContent === 'upcoming') && 
                    lastVideoId !== liveItem.id.videoId) {
                    
                    this.config.setLastChecked(channelId, liveItem.id.videoId);
                    return this.createUpdateObject(liveItem, liveItem.snippet.liveBroadcastContent);
                }
            }

            // Then check regular videos
            if (videoData.items?.[0]) {
                const videoItem = videoData.items[0];
                if (lastVideoId !== videoItem.id.videoId) {
                    // For first check, skip old videos
                    if (isFirstCheck) {
                        const publishTime = new Date(videoItem.snippet.publishedAt);
                        const videoAge = Date.now() - publishTime.getTime();
                        if (videoAge > 60 * 60 * 1000) { // 1 hour
                            console.log(`[${new Date().toLocaleTimeString()}] Pomijanie starego filmu przy pierwszym sprawdzeniu: ${videoItem.snippet.title}`);
                            this.config.setLastChecked(channelId, videoItem.id.videoId);
                            return null;
                        }
                    }

                    this.config.setLastChecked(channelId, videoItem.id.videoId);
                    return this.createUpdateObject(videoItem, 'video');
                }
            }

            return null;
        } catch (error) {
            console.error(`[${new Date().toLocaleTimeString()}] Błąd podczas sprawdzania API:`, error);
            throw error;
        }
    }

    getNextValidKey() {
        const now = Date.now();
        // Clear expired quota exceeded markers
        for (const [index, timestamp] of this.quotaExceeded.entries()) {
            if (now - timestamp > 24 * 60 * 60 * 1000) { // 24 hours
                this.quotaExceeded.delete(index);
                console.log(`[${new Date().toLocaleTimeString()}] Odnowiono limit dla klucza API ${index + 1}`);
            }
        }

        const startIndex = this.currentKeyIndex;
        do {
            if (!this.quotaExceeded.has(this.currentKeyIndex)) {
                const key = this.apiKeys[this.currentKeyIndex];
                const currentUsage = this.keyUsageStats.get(this.currentKeyIndex) || 0;
                this.keyUsageStats.set(this.currentKeyIndex, currentUsage + 1);
                
                if (currentUsage % 100 === 0) {
                    console.log(`[${new Date().toLocaleTimeString()}] Klucz API ${this.currentKeyIndex + 1} został użyty ${currentUsage} razy`);
                }
                
                this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
                return key;
            }
            this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
        } while (this.currentKeyIndex !== startIndex);

        return null;
    }

    markKeyAsExceeded(keyIndex) {
        this.quotaExceeded.set(keyIndex, Date.now());
        console.log(`[${new Date().toLocaleTimeString()}] Klucz API ${keyIndex + 1} przekroczył limit`);
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
        const oneHourAgo = Date.now() - 3600000;
        for (const [identifier, timestamp] of this.lastNotifiedVideos.entries()) {
            if (timestamp < oneHourAgo) {
                this.lastNotifiedVideos.delete(identifier);
            }
        }
        if (this.lastNotifiedVideos.size > 100) {
            const entries = Array.from(this.lastNotifiedVideos.entries());
            const sortedEntries = entries.sort((a, b) => b[1] - a[1]).slice(0, 50);
            this.lastNotifiedVideos = new Map(sortedEntries);
        }
    }

    getStatistics() {
        return {
            apiCalls: this.statistics.apiCalls,
            rssCalls: this.statistics.rssCalls,
            notifications: this.statistics.notifications,
            errors: this.statistics.errors,
            activeKeys: this.apiKeys.length - this.quotaExceeded.size,
            keyUsage: Object.fromEntries(this.keyUsageStats)
        };
    }
}

module.exports = YouTubeNotifier; 