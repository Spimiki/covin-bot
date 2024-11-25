const { config } = require('../instances');
const youtubeNotifier = require('../YouTubeNotifier');
module.exports = {
    name: 'dodaj',
    description: 'Dodaje kanał YouTube do listy śledzonych',
    options: [
        {
            name: 'kanal',
            description: 'ID lub link do kanału YouTube',
            type: 3,
            required: true
        },
        {
            name: 'filmy',
            description: 'Kanał Discord dla filmów',
            type: 7,
            required: false
        },
        {
            name: 'live',
            description: 'Kanał Discord dla transmisji na żywo',
            type: 7,
            required: false
        },
        {
            name: 'zaplanowane',
            description: 'Kanał Discord dla zaplanowanych transmisji',
            type: 7,
            required: false
        }
    ],
    async execute(interaction) {
        try {
            const youtubeChannel = interaction.options.getString('kanal');
            const videoChannel = interaction.options.getChannel('filmy');
            const liveChannel = interaction.options.getChannel('live');
            const upcomingChannel = interaction.options.getChannel('zaplanowane');

            if (!videoChannel && !liveChannel && !upcomingChannel) {
                return interaction.reply({ 
                    content: '❌ Musisz podać przynajmniej jeden kanał Discord!', 
                    ephemeral: true 
                });
            }

            // Validate channel types
            for (const channel of [videoChannel, liveChannel, upcomingChannel]) {
                if (channel && !channel.isTextBased()) {
                    return interaction.reply({ 
                        content: '❌ Wszystkie kanały muszą być kanałami tekstowymi!', 
                        ephemeral: true 
                    });
                }
            }

            const channelId = youtubeChannel.match(/youtube\.com\/channel\/(UC[\w-]+)/) 
                ? youtubeChannel.match(/youtube\.com\/channel\/(UC[\w-]+)/)[1] 
                : youtubeChannel;

            if (!channelId.startsWith('UC')) {
                return interaction.reply({ 
                    content: '❌ Nieprawidłowe ID kanału YouTube! ID musi zaczynać się od "UC"', 
                    ephemeral: true 
                });
            }

            config.addChannel(interaction.guildId, channelId, {
                video: videoChannel?.id,
                live: liveChannel?.id,
                upcoming: upcomingChannel?.id
            });

            const response = ['✅ Dodano kanał YouTube do listy śledzonych!'];
            if (videoChannel) response.push(`📹 Filmy: ${videoChannel}`);
            if (liveChannel) response.push(`🔴 Transmisje na żywo: ${liveChannel}`);
            if (upcomingChannel) response.push(`⏰ Zaplanowane transmisje: ${upcomingChannel}`);
            
            await interaction.reply(response.join('\n'));
        } catch (error) {
            console.error('Błąd podczas dodawania kanału:', error);
            await interaction.reply({ 
                content: '❌ Wystąpił błąd podczas dodawania kanału!', 
                ephemeral: true 
            });
        }
    }
}; 