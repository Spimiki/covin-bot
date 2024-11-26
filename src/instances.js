const Config = require('./Config');
const YouTubeNotifier = require('./YouTubeNotifier');

const config = new Config();
const youtubeNotifier = new YouTubeNotifier(
    config,
    process.env.YOUTUBE_API_KEYS.split(',')
);

module.exports = {
    config,
    youtubeNotifier
}; 