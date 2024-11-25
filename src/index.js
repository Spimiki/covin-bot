require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { config, youtubeNotifier } = require('./instances');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

const commands = [
    require('./commands/dodaj'),
    require('./commands/usun'),
    require('./commands/lista'),
    require('./commands/status')
];

client.once('ready', async () => {
    try {
        console.log('Rejestrowanie komend slash...');
        await client.application.commands.set(commands);
        console.log('Komendy slash zostały zarejestrowane!');
        console.log('Bot jest gotowy!');
    } catch (error) {
        console.error('Błąd podczas rejestrowania komend:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = commands.find(cmd => cmd.name === interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(`Błąd podczas wykonywania komendy ${interaction.commandName}:`, error);
        await interaction.reply({
            content: '❌ Wystąpił błąd podczas wykonywania komendy!',
            ephemeral: true
        });
    }
});

async function checkChannels() {
    const channels = config.getAllYouTubeChannels();
    
    for (const youtubeChannelId of channels) {
        try {
            const update = await youtubeNotifier.checkChannel(youtubeChannelId);
            if (update) {
                console.log(`[${new Date().toLocaleTimeString()}] Próba przetworzenia aktualizacji dla kanału ${youtubeChannelId}`);
                await processUpdate(update, youtubeChannelId);
                console.log(`[${new Date().toLocaleTimeString()}] Zakończono przetwarzanie aktualizacji`);
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error(`[${new Date().toLocaleTimeString()}] Błąd podczas sprawdzania kanału ${youtubeChannelId}:`, error);
        }
    }
}

async function startBot() {
    try {
        await client.login(process.env.DISCORD_TOKEN);
        
        setInterval(async () => {
            await checkChannels();
        }, parseInt(process.env.CHECK_INTERVAL) || 60000);
        
    } catch (error) {
        console.error('Błąd podczas uruchamiania bota:', error);
    }
}

async function processUpdate(update, youtubeChannelId) {
    // Loop through all guilds
    for (const [guildId, guildChannels] of Object.entries(config.config.channels)) {
        // Get channel configuration for this YouTube channel
        const channelConfig = guildChannels[youtubeChannelId];
        if (!channelConfig) continue;

        // Get the appropriate Discord channel ID based on content type
        const discordChannelId = channelConfig[update.type];
        if (!discordChannelId) {
            console.log(`[${new Date().toLocaleTimeString()}] Brak skonfigurowanego kanału dla typu ${update.type} w gildii ${guildId}`);
            continue;
        }

        const channel = client.channels.cache.get(discordChannelId);
        if (!channel) {
            console.error(`[${new Date().toLocaleTimeString()}] Nie znaleziono kanału Discord ${discordChannelId}`);
            continue;
        }

        try {
            const template = config.getTemplate(guildId, update.type);
            let message = template
                .replace('{nazwaKanalu}', update.channelTitle)
                .replace('{tytul}', update.title)
                .replace('{link}', update.url);

            if (update.type === 'upcoming' && update.scheduledStartTime) {
                message = message.replace('{startTime}', 
                    `<t:${Math.floor(new Date(update.scheduledStartTime).getTime() / 1000)}:F>`);
            }

            const embed = {
                color: {
                    'live': 0xFF0000,
                    'upcoming': 0xFFA500,
                    'video': 0x0099ff
                }[update.type],
                author: {
                    name: update.channelTitle,
                    url: `https://youtube.com/channel/${youtubeChannelId}`
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

            console.log(`[${new Date().toLocaleTimeString()}] Wysłano powiadomienie o ${update.type} do kanału ${discordChannelId}`);
        } catch (error) {
            console.error(`[${new Date().toLocaleTimeString()}] Błąd podczas wysyłania powiadomienia:`, error);
        }
    }
}

startBot(); 