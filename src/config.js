const fs = require('fs');
const path = require('path');

class Config {
    constructor(configPath = 'config.json') {
        this.configPath = path.join(__dirname, '..', configPath);
        this.config = this.loadConfig();
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
        } catch (error) {
            console.error('Błąd podczas zapisywania konfiguracji:', error);
        }
    }

    getTemplate(guildId, type) {
        const defaultTemplates = {
            video: "🎥 Nowy film od {nazwaKanalu}!\n📺 {tytul}\n🔗 {link}",
            live: "🔴 {nazwaKanalu} rozpoczął transmisję na żywo!\n📺 {tytul}\n🔗 {link}",
            upcoming: "⏰ {nazwaKanalu} zaplanował transmisję!\n📺 {tytul}\n🕒 Start: {startTime}\n🔗 {link}"
        };

        return this.config.templates?.[type] || defaultTemplates[type];
    }

    getChannels(guildId) {
        return this.config.channels[guildId] || {};
    }

    getAllYouTubeChannels() {
        const channels = new Set();
        Object.values(this.config.channels).forEach(guildChannels => {
            Object.keys(guildChannels).forEach(channelId => channels.add(channelId));
        });
        return Array.from(channels);
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
        if (channels.upcoming) this.config.channels[guildId][youtubeChannelId].upcoming = channels.upcoming;
        
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
        this.saveConfig();
    }

    getChannelConfig(guildId, youtubeChannelId) {
        return this.config.channels[guildId]?.[youtubeChannelId] || null;
    }
}

module.exports = Config; 