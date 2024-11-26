require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { config, youtubeNotifier } = require('./instances');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const cron = require('node-cron');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    commands.push(command);
}

client.once('ready', async () => {
    try {
        logger.info('Rejestrowanie komend slash...');
        await client.application.commands.set(commands);
        logger.info('Komendy slash zostały zarejestrowane!');
        logger.info('Bot jest gotowy!');
        
        // Initialize cron jobs for all guilds
        Object.keys(config.config.channels || {}).forEach(guildId => {
            youtubeNotifier.setupCronJob(guildId);
        });
        
        // Perform initial check
        await youtubeNotifier.performInitialCheck();
    } catch (error) {
        logger.error(`Błąd podczas rejestrowania komend: ${error}`);
    }
});

// Add command interaction handler
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = commands.find(cmd => cmd.name === interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        logger.error(`Błąd podczas wykonywania komendy ${interaction.commandName}: ${error}`);
        await interaction.reply({
            content: '❌ Wystąpił błąd podczas wykonywania komendy!',
            ephemeral: true
        });
    }
});

// Handle updates from YouTubeNotifier
youtubeNotifier.on('update', async ({ update, channelId, guildId, discordChannelId }) => {
    const channel = client.channels.cache.get(discordChannelId);
    if (!channel) {
        logger.error(`Nie znaleziono kanału Discord ${discordChannelId}`);
        return;
    }

    try {
        const template = config.getTemplate(guildId, update.type);
        let message = template
            .replace('{nazwaKanalu}', update.channelTitle)
            .replace('{tytul}', update.title)
            .replace('{link}', update.url);

        const embed = {
            color: {
                'live': 0xFF0000,
                'video': 0x0099ff
            }[update.type],
            author: {
                name: update.channelTitle,
                url: `https://youtube.com/channel/${channelId}`
            },
            title: update.title,
            url: update.url,
            thumbnail: {
                url: update.thumbnail
            },
            timestamp: new Date(update.publishedAt)
        };

        await channel.send({
            content: message,
            embeds: [embed]
        });

        logger.info(`Wysłano powiadomienie o ${update.type} do kanału ${discordChannelId}`);
    } catch (error) {
        logger.error(`Błąd podczas wysyłania powiadomienia: ${error}`);
    }
});

// Schedule log rotation at midnight
cron.schedule('0 0 * * *', () => {
    logger.info('Wykonywanie codziennej rotacji logów');
    logger.rotateLogFile();
});

// Schedule quota reset at midnight PT (8 AM UTC)
cron.schedule('0 8 * * *', () => {
    youtubeNotifier.resetQuota();
    logger.info('Wykonano codzienny reset limitu API');
}, {
    timezone: "America/Los_Angeles"
});

async function startBot() {
    try {
        logger.info('Uruchamianie bota...');
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        logger.error(`Błąd podczas uruchamiania bota: ${error}`);
        process.exit(1);
    }
}

startBot(); 