const { config, youtubeNotifier } = require('../instances');

module.exports = {
    name: 'status',
    description: 'Wyświetla statystyki bota i kanałów',
    options: [
        {
            name: 'kanal',
            description: 'ID kanału YouTube (opcjonalne)',
            type: 3,
            required: false
        }
    ],
    async execute(interaction) {
        try {
            const channelId = interaction.options.getString('kanal');
            const stats = youtubeNotifier.getStatistics();
            
            if (channelId) {
                const channels = config.getChannels(interaction.guildId);
                if (!channels[channelId]) {
                    return interaction.reply({ 
                        content: '❌ Ten kanał nie jest śledzony na tym serwerze!', 
                        ephemeral: true 
                    });
                }

                const embed = {
                    title: `📊 Statystyki dla kanału ${channelId}`,
                    fields: [
                        {
                            name: 'Kanały Discord',
                            value: [
                                channels[channelId].video ? `📹 Filmy: <#${channels[channelId].video}>` : null,
                                channels[channelId].live ? `🔴 Transmisje: <#${channels[channelId].live}>` : null,
                                channels[channelId].upcoming ? `⏰ Zaplanowane: <#${channels[channelId].upcoming}>` : null
                            ].filter(Boolean).join('\n') || 'Brak skonfigurowanych kanałów',
                            inline: false
                        },
                        {
                            name: 'Ostatnie sprawdzenie',
                            value: youtubeNotifier.lastCheckTime[channelId] ? 
                                `<t:${Math.floor(youtubeNotifier.lastCheckTime[channelId]/1000)}:R>` : 
                                'Brak danych',
                            inline: true
                        }
                    ],
                    color: 0x0099ff
                };

                return interaction.reply({ embeds: [embed] });
            }

            // Ogólne statystyki
            const embed = {
                title: '📊 Statystyki bota',
                fields: [
                    {
                        name: 'API',
                        value: `Aktywne klucze: ${stats.activeKeys}/${youtubeNotifier.apiKeys.length}\nZapytania: ${stats.apiCalls}`,
                        inline: true
                    },
                    {
                        name: 'RSS',
                        value: `Zapytania: ${stats.rssCalls}`,
                        inline: true
                    },
                    {
                        name: 'Powiadomienia',
                        value: `Wysłane: ${stats.notifications}\nBłędy: ${stats.errors}`,
                        inline: true
                    }
                ],
                color: 0x0099ff,
                timestamp: new Date()
            };

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Błąd podczas wyświetlania statusu:', error);
            await interaction.reply({ 
                content: '❌ Wystąpił błąd podczas pobierania statusu!', 
                ephemeral: true 
            });
        }
    },
}; 