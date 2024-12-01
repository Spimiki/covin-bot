require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { config, youtubeNotifier } = require('./instances');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const cron = require('node-cron');
const readline = require('readline');

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
    logger.info(`Otrzymano wydarzenie aktualizacji dla kanału ${channelId}`);
    
    const channel = client.channels.cache.get(discordChannelId);
    if (!channel) {
        logger.error(`Nie znaleziono kanału Discord ${discordChannelId}`);
        return;
    }

    try {
        const template = config.getTemplate(guildId, update.type);
        logger.debug(`Używam szablonu dla typu ${update.type}: ${template}`);
        
        let message = template
            .replace('{nazwaKanalu}', update.channelTitle)
            .replace('{tytul}', update.title)
            .replace('{link}', update.url)
            .replace(/\\n/g, '\n');

        if (update.type === 'scheduled' && update.scheduledStartTime) {
            message = message.replace('{startTime}', new Date(update.scheduledStartTime).toLocaleString('pl-PL'));
        }

        logger.debug(`Wysyłanie wiadomości na kanał ${discordChannelId}: ${message}`);
        await channel.send({ content: message });

        logger.info(`Pomyślnie wysłano powiadomienie o ${update.type} do kanału ${discordChannelId}`);
    } catch (error) {
        logger.error(`Błąd podczas wysyłania powiadomienia: ${error}`);
    }
});

function setupConsoleCommands() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    // Create a simple command processor
    const processCommand = (command) => {
        switch (command) {
            case 'status':
                const statusCommand = consoleCommands.get('status');
                if (statusCommand) statusCommand.execute();
                console.log('\nWpisz komendę (status/help/exit):');
                break;
            case 'help':
                console.log('\nDostępne komendy:');
                console.log('  status - Wyświetla status bota');
                console.log('  help   - Wyświetla tę pomoc');
                console.log('  exit   - Zamyka bota');
                console.log('\nWpisz komendę (status/help/exit):');
                break;
            case 'exit':
                logger.info('Zamykanie bota...');
                process.exit(0);
                break;
            default:
                if (command) {
                    console.log('\nNieznana komenda. Wpisz "help" aby zobaczyć dostępne komendy.');
                    console.log('Wpisz komendę (status/help/exit):');
                }
        }
    };

    const consoleCommands = new Map();
    const commandsPath = path.join(__dirname, 'consoleCommands');
    
    if (fs.existsSync(commandsPath)) {
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const command = require(path.join(commandsPath, file));
            consoleCommands.set(command.name, command);
        }
    }

    console.log('\nWpisz komendę (status/help/exit):');

    rl.on('line', (input) => {
        const command = input.trim().toLowerCase();
        processCommand(command);
    });

    rl.on('SIGINT', () => {
        rl.question('\nNa pewno chcesz zamknąć bota? (t/N) ', (answer) => {
            if (answer.toLowerCase() === 't') {
                logger.info('Zamykanie bota...');
                process.exit(0);
            } else {
                console.log('\nWpisz komendę (status/help/exit):');
            }
        });
    });

    // Clean up on exit
    process.on('exit', () => {
        rl.close();
    });
}

async function startBot() {
    try {
        logger.info('Uruchamianie bota...');
        setupConsoleCommands();
        // Set up global cron jobs
        setupGlobalCronJobs();
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        logger.error(`Błąd podczas uruchamiania bota: ${error}`);
        process.exit(1);
    }
}

function setupGlobalCronJobs() {
    // Log rotation at midnight
    cron.schedule('0 0 * * *', () => {
        logger.info('Wykonywanie codziennej rotacji logów');
        logger.rotateLogFile();
    });

    // API quota reset at midnight PT (8 AM UTC)
    cron.schedule('0 8 * * *', () => {
        youtubeNotifier.resetQuota();
        logger.info('Wykonano codzienny reset limitu API');
    }, {
        timezone: "America/Los_Angeles"
    });

    // Cleanup old notifications every hour
    cron.schedule('0 * * * *', () => {
        logger.info('Rozpoczęcie czyszczenia starych powiadomień...');
        config.cleanupNotifiedVideos();
    });
}

startBot(); 