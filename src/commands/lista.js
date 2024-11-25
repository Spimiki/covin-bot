const { config } = require('../instances');

module.exports = {
    name: 'lista',
    description: 'Wyświetla listę śledzonych kanałów',
    async execute(interaction) {
        try {
            const channels = config.getChannels(interaction.guildId);
            
            if (Object.keys(channels).length === 0) {
                return interaction.reply('📝 Brak śledzonych kanałów na tym serwerze.');
            }

            const embed = {
                title: '📋 Lista śledzonych kanałów',
                description: 'Kanały YouTube aktualnie śledzone na tym serwerze:',
                fields: [],
                color: 0x0099ff
            };

            for (const [youtubeId, channelConfig] of Object.entries(channels)) {
                let channelInfo = [];
                
                if (channelConfig.video) {
                    const videoChannel = interaction.client.channels.cache.get(channelConfig.video);
                    channelInfo.push(`📹 Filmy: ${videoChannel ? `<#${channelConfig.video}>` : 'Kanał niedostępny'}`);
                }
                
                if (channelConfig.live) {
                    const liveChannel = interaction.client.channels.cache.get(channelConfig.live);
                    channelInfo.push(`🔴 Transmisje: ${liveChannel ? `<#${channelConfig.live}>` : 'Kanał niedostępny'}`);
                }
                
                if (channelConfig.upcoming) {
                    const upcomingChannel = interaction.client.channels.cache.get(channelConfig.upcoming);
                    channelInfo.push(`⏰ Zaplanowane: ${upcomingChannel ? `<#${channelConfig.upcoming}>` : 'Kanał niedostępny'}`);
                }

                embed.fields.push({
                    name: `YouTube ID: ${youtubeId}`,
                    value: channelInfo.join('\n') || 'Brak skonfigurowanych kanałów',
                    inline: false
                });
            }

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Błąd podczas wyświetlania listy:', error);
            await interaction.reply({ 
                content: '❌ Wystąpił błąd podczas pobierania listy kanałów!', 
                ephemeral: true 
            });
        }
    },
}; 