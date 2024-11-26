const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

class Config {
    constructor(configPath = 'config.json') {
        this.configPath = path.join(__dirname, '..', configPath);
        this.config = this.loadConfig();
        
        if (!this.config.notifiedVideos) {
            this.config.notifiedVideos = {};
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
            logger.error('Błąd podczas ładowania konfiguracji:', error);
            return { channels: {}, templates: {}, lastChecked: {} };
        }
    }

    saveConfig() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        } catch (error) {
            logger.error('Błąd podczas zapisywania konfiguracji:', error);
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
        logger.info(`Aktualizacja ostatnio sprawdzonego filmu dla ${channelId}: ${videoId}`);
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

    addNotifiedVideo(videoId) {
        if (!this.config.notifiedVideos) {
            this.config.notifiedVideos = {};
        }
        this.config.notifiedVideos[videoId] = Date.now();
        this.saveConfig();
    }

    isVideoNotified(videoId) {
        return this.config.notifiedVideos && videoId in this.config.notifiedVideos;
    }

    cleanupNotifiedVideos() {
        if (!this.config.notifiedVideos) return;

        const fortyMinutesAgo = Date.now() - (40 * 60 * 1000);
        let cleaned = false;
        const initialCount = Object.keys(this.config.notifiedVideos).length;

        Object.entries(this.config.notifiedVideos).forEach(([videoId, timestamp]) => {
            if (timestamp < fortyMinutesAgo) {
                delete this.config.notifiedVideos[videoId];
                cleaned = true;
            }
        });

        if (cleaned) {
            const finalCount = Object.keys(this.config.notifiedVideos).length;
            const removedCount = initialCount - finalCount;
            if (removedCount > 0) {
                logger.info(`Wyczyszczono ${removedCount} starych powiadomień`);
                this.saveConfig();
            }
        }
    }
}

module.exports = Config; 