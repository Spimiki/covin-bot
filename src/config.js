const fs = require('fs');
const path = require('path');

class Config {
    constructor(configPath = 'config.json') {
        this.configPath = path.join(__dirname, '..', configPath);
        this.config = this.loadConfig();
        
        if (!this.config.notifiedVideos) {
            this.config.notifiedVideos = {};
        }
        if (!this.config.activeStreams) {
            this.config.activeStreams = {};
        }
    }

    loadConfig() {
        try {
            if (!fs.existsSync(this.configPath)) {
                const defaultConfig = {
                    channels: {},
                    templates: {
                        video: "🎥 Nowy film od {nazwaKanalu}!\n📺 {tytul}\n🔗 {link}",
                        live: "🔴 {nazwaKanalu} rozpoczął transmisję na żywo!\n📺 {tytul}\n🔗 {link}",
                        upcoming: "⏰ {nazwaKanalu} zaplanował transmisję!\n📺 {tytul}\n🕒 Start: {startTime}\n🔗 {link}"
                    },
                    lastChecked: {}
                };
                this.saveConfig(defaultConfig);
                return defaultConfig;
            }
            return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        } catch (error) {
            console.error('Błąd podczas ładowania konfiguracji:', error);
            return { channels: {}, templates: {}, lastChecked: {} };
        }
    }

    saveConfig() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
            console.log(`[${new Date().toLocaleTimeString()}] Zapisano zmiany w konfiguracji`);
        } catch (error) {
            console.error('Błąd podczas zapisywania konfiguracji:', error);
        }
    }

    getTemplate(guildId, type) {
        const defaultTemplates = {
            video: "🎥 Nowy film od {nazwaKanalu}!\n📺 {tytul}\n🔗 {link}",
            live: "🔴 {nazwaKanalu} rozpoczął transmisję na żywo!\n📺 {tytul}\n🔗 {link}"
        };

        return this.config.serverTemplates?.[guildId]?.[type] || 
               this.config.templates?.[type] || 
               defaultTemplates[type];
    }

    getChannels(guildId) {
        return this.config.channels[guildId] || {};
    }

    getAllYouTubeChannels() {
        const uniqueChannels = new Set();
        
        Object.values(this.config.channels || {}).forEach(guildChannels => {
            Object.keys(guildChannels).forEach(youtubeId => {
                uniqueChannels.add(youtubeId);
            });
        });
        
        return Array.from(uniqueChannels);
    }

    addChannel(guildId, youtubeChannelId, channels) {
        if (!this.config.channels[guildId]) {
            this.config.channels[guildId] = {};
        }
        if (!this.config.channels[guildId][youtubeChannelId]) {
            this.config.channels[guildId][youtubeChannelId] = {};
        }
        
        if (channels.video) this.config.channels[guildId][youtubeChannelId].video = channels.video;
        if (channels.live) this.config.channels[guildId][youtubeChannelId].live = channels.live;
        
        this.saveConfig();
    }

    removeChannel(guildId, youtubeChannelId) {
        if (this.config.channels[guildId] && this.config.channels[guildId][youtubeChannelId]) {
            delete this.config.channels[guildId][youtubeChannelId];
            this.saveConfig();
            return true;
        }
        return false;
    }

    getLastChecked(channelId) {
        return this.config.lastChecked[channelId];
    }

    setLastChecked(channelId, videoId) {
        this.config.lastChecked[channelId] = videoId;
        console.log(`[${new Date().toLocaleTimeString()}] Aktualizacja ostatnio sprawdzonego filmu dla ${channelId}: ${videoId}`);
        this.saveConfig();
    }

    getChannelConfig(guildId, youtubeChannelId) {
        return this.config.channels[guildId]?.[youtubeChannelId] || null;
    }

    setTemplate(guildId, type, template) {
        if (!this.config.serverTemplates) {
            this.config.serverTemplates = {};
        }
        if (!this.config.serverTemplates[guildId]) {
            this.config.serverTemplates[guildId] = {};
        }
        this.config.serverTemplates[guildId][type] = template;
        this.saveConfig();
    }

    getCheckInterval(guildId) {
        if (!this.config.checkIntervals) {
            this.config.checkIntervals = {};
        }
        return this.config.checkIntervals[guildId] || 5; // Default: 5 minutes
    }

    setCheckInterval(guildId, minutes) {
        if (!this.config.checkIntervals) {
            this.config.checkIntervals = {};
        }
        this.config.checkIntervals[guildId] = minutes;
        this.saveConfig();
    }

    addNotifiedVideo(videoId, isLive = false) {
        if (!this.config.notifiedVideos) {
            this.config.notifiedVideos = {};
        }
        if (isLive) {
            if (!this.config.activeStreams) {
                this.config.activeStreams = {};
            }
            this.config.activeStreams[videoId] = Date.now();
        }
        this.config.notifiedVideos[videoId] = Date.now();
        this.saveConfig();
    }

    isVideoNotified(videoId, isLive = false) {
        if (isLive) {
            return this.config.activeStreams && videoId in this.config.activeStreams;
        }
        return this.config.notifiedVideos && videoId in this.config.notifiedVideos;
    }

    cleanupNotifiedVideos() {
        if (!this.config.notifiedVideos) return;

        const fortyMinutesAgo = Date.now() - (40 * 60 * 1000); // 40 minutes ago
        const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
        let cleaned = false;
        const initialCount = Object.keys(this.config.notifiedVideos).length;
        const initialStreamCount = Object.keys(this.config.activeStreams || {}).length;

        // Cleanup regular video notifications
        Object.entries(this.config.notifiedVideos).forEach(([videoId, timestamp]) => {
            if (timestamp < fortyMinutesAgo && !(videoId in (this.config.activeStreams || {}))) {
                delete this.config.notifiedVideos[videoId];
                cleaned = true;
            }
        });

        // Cleanup old stream notifications
        if (this.config.activeStreams) {
            Object.entries(this.config.activeStreams).forEach(([videoId, timestamp]) => {
                if (timestamp < twentyFourHoursAgo) {
                    delete this.config.activeStreams[videoId];
                    delete this.config.notifiedVideos[videoId];
                    cleaned = true;
                }
            });
        }

        if (cleaned) {
            const finalCount = Object.keys(this.config.notifiedVideos).length;
            const finalStreamCount = Object.keys(this.config.activeStreams || {}).length;
            console.log(`Wyczyszczono ${initialCount - finalCount} starych powiadomień i ${initialStreamCount - finalStreamCount} starych transmisji`);
            this.saveConfig();
        }
    }
}

module.exports = Config; 