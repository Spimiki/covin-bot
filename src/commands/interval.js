const { config, youtubeNotifier } = require('../instances');

module.exports = {
    name: 'interval',
    description: 'Ustaw częstotliwość sprawdzania kanałów (w minutach)',
    options: [
        {
            name: 'minuty',
            description: 'Co ile minut sprawdzać kanały (minimum 1)',
            type: 4, // INTEGER
            required: true,
            min_value: 1,
            max_value: 1440 // 24 hours
        }
    ],
    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });
            
            if (!interaction.member.permissions.has('Administrator')) {
                return interaction.editReply({
                    content: '❌ Ta komenda wymaga uprawnień administratora!'
                });
            }

            const minutes = interaction.options.getInteger('minuty');
            config.setCheckInterval(interaction.guildId, minutes);
            
            // Update the cron job for this guild
            youtubeNotifier.setupCronJob(interaction.guildId);

            await interaction.editReply({
                content: `✅ Ustawiono sprawdzanie kanałów co ${minutes} minut!`
            });
        } catch (error) {
            console.error('Błąd podczas ustawiania interwału:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Wystąpił błąd podczas ustawiania interwału!',
                    ephemeral: true
                });
            } else {
                await interaction.editReply({
                    content: '❌ Wystąpił błąd podczas ustawiania interwału!'
                });
            }
        }
    }
}; 