// Load environment variables first
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { config, youtubeNotifier, client } = require('../instances');
const logger = require('../utils/logger');

async function checkStatus() {
    try {
        // Wait for client to be ready
        await client.login(process.env.DISCORD_TOKEN);
        
        const statusCommand = require('../consoleCommands/status.js');
        statusCommand.execute();
        
        // Exit after showing status
        setTimeout(() => process.exit(0), 1000);
    } catch (error) {
        console.error('Error checking status:', error);
        process.exit(1);
    }
}

checkStatus(); 