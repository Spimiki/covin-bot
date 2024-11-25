const { config } = require('../instances');
const youtubeNotifier = require('../YouTubeNotifier');
module.exports = {
    name: 'usun',
    description: 'Usuwa kanał YouTube z listy śledzonych',
    options: [
        {
            name: 'kanal',
            description: 'ID kanału YouTube do usunięcia',
            type: 3, // STRING
            required: true
        }
    ],
    async execute(interaction) {
        try {
            const channelId = interaction.options.getString('kanal');
            
            if (config.removeChannel(interaction.guildId, channelId)) {
                await interaction.reply('✅ Kanał został usunięty z listy śledzonych!');
            } else {
                await interaction.reply({ 
                    content: '❌ Nie znaleziono takiego kanału na liście!', 
                    ephemeral: true 
                });
            }
        } catch (error) {
            console.error('Błąd podczas usuwania kanału:', error);
            await interaction.reply({ 
                content: '❌ Wystąpił błąd podczas usuwania kanału!', 
                ephemeral: true 
            });
        }
    },
}; 