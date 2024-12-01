const Config = require('./config.js');
const YouTubeNotifier = require('./YouTubeNotifier');
const { Client, GatewayIntentBits } = require('discord.js');

// Check for required environment variables
if (!process.env.YOUTUBE_API_KEYS) {
    throw new Error('YOUTUBE_API_KEYS environment variable is not set');
}

if (!process.env.DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN environment variable is not set');
}

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