const Config = require('./config.js');
const YouTubeNotifier = require('./YouTubeNotifier');
const { Client, GatewayIntentBits } = require('discord.js');

const config = new Config();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});
const youtubeNotifier = new YouTubeNotifier(
    config,
    process.env.YOUTUBE_API_KEYS.split(',')
);

module.exports = {
    config,
    youtubeNotifier,
    client
}; 