const Config = require('./Config');
const YouTubeNotifier = require('./YouTubeNotifier');

const config = new Config();
const youtubeNotifier = new YouTubeNotifier(
    process.env.YOUTUBE_API_KEYS.split(','),
    config
);

module.exports = {
    config,
    youtubeNotifier
}; 