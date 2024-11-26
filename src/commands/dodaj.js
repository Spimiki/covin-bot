const { config } = require('../instances');

module.exports = {
    name: 'dodaj',
    description: 'Dodaje kanał YouTube do listy śledzonych',
    options: [
        {
            name: 'kanal',
            description: 'ID kanału YouTube do śledzenia',
            type: 3, // STRING
            required: true
        },
        {
            name: 'filmy',
            description: 'Kanał do powiadomień o nowych filmach',
            type: 7, // CHANNEL
            required: false
        },
        {
            name: 'transmisje',
            description: 'Kanał do powiadomień o transmisjach na żywo',
            type: 7, // CHANNEL
            required: false
        },
        {
            name: 'zaplanowane',
            description: 'Kanał do powiadomień o zaplanowanych transmisjach',
            type: 7, // CHANNEL
            required: false
        }
    ],
    async execute(interaction) {
        const guildId = interaction.guildId;
        
        // Initialize the guild's configuration if it doesn't exist
        if (!config.config.channels[guildId]) {
            config.config.channels[guildId] = {};
        }

        try {
            const youtubeChannel = interaction.options.getString('kanal');
            const videoChannel = interaction.options.getChannel('filmy');
            const liveChannel = interaction.options.getChannel('transmisje');
            const scheduledChannel = interaction.options.getChannel('zaplanowane');

            if (!videoChannel && !liveChannel && !scheduledChannel) {
                return interaction.reply({ 
                    content: '❌ Musisz podać przynajmniej jeden kanał Discord!', 
                    ephemeral: true 
                });
            }

            // Validate channel types
            for (const channel of [videoChannel, liveChannel, scheduledChannel]) {
                if (channel && !channel.isTextBased()) {
                    return interaction.reply({ 
                        content: '❌ Wszystkie kanały muszą być kanałami tekstowymi!', 
                        ephemeral: true 
                    });
                }
            }

            // Create channel configuration
            const channelConfig = {
                id: youtubeChannel,
                notificationChannels: {}
            };

            if (videoChannel) {
                channelConfig.notificationChannels.videos = videoChannel.id;
            }
            if (liveChannel) {
                channelConfig.notificationChannels.live = liveChannel.id;
            }
            if (scheduledChannel) {
                channelConfig.notificationChannels.scheduled = scheduledChannel.id;
            }

            // Add channel to configuration
            config.config.channels[guildId][youtubeChannel] = channelConfig;
            config.saveConfig();

            await interaction.reply('✅ Kanał został dodany do listy śledzonych!');
        } catch (error) {
            console.error('Błąd podczas dodawania kanału:', error);
            await interaction.reply({ 
                content: '❌ Wystąpił błąd podczas dodawania kanału!', 
                ephemeral: true 
            });
        }
    }
}; 