const { config } = require('../instances');

module.exports = {
    name: 'szablon',
    description: 'Zarządzaj szablonami powiadomień',
    options: [
        {
            name: 'typ',
            description: 'Typ powiadomienia',
            type: 3, // STRING
            required: true,
            choices: [
                { name: 'Filmy', value: 'video' },
                { name: 'Transmisje na żywo', value: 'live' }
            ]
        },
        {
            name: 'szablon',
            description: 'Nowy szablon (zostaw puste aby zobaczyć obecny)',
            type: 3, // STRING
            required: false
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

            const type = interaction.options.getString('typ');
            const template = interaction.options.getString('szablon');

            if (!template) {
                // Show current template
                const currentTemplate = config.getTemplate(interaction.guildId, type);
                const embed = {
                    title: '📝 Obecny szablon powiadomień',
                    description: 'Dostępne zmienne:\n' +
                        '`{nazwaKanalu}` - nazwa kanału\n' +
                        '`{tytul}` - tytuł filmu/transmisji\n' +
                        '`{link}` - link do filmu/transmisji',
                    fields: [
                        {
                            name: 'Typ',
                            value: {
                                video: '📹 Filmy',
                                live: '🔴 Transmisje na żywo'
                            }[type],
                            inline: true
                        },
                        {
                            name: 'Szablon',
                            value: `\`\`\`\n${currentTemplate}\n\`\`\``,
                            inline: false
                        }
                    ],
                    color: 0x0099ff
                };

                return interaction.editReply({ embeds: [embed] });
            }

            // Validate template
            if (!template.includes('{nazwaKanalu}') || 
                !template.includes('{tytul}') || 
                !template.includes('{link}')) {
                return interaction.editReply({
                    content: '❌ Szablon musi zawierać wszystkie wymagane zmienne: {nazwaKanalu}, {tytul}, {link}',
                    ephemeral: true
                });
            }

            // Save new template
            config.setTemplate(interaction.guildId, type, template);

            await interaction.editReply({
                content: '✅ Szablon został zaktualizowany!'
            });

        } catch (error) {
            console.error('Błąd podczas ustawiania szablonu:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Wystąpił błąd podczas ustawiania szablonu!',
                    ephemeral: true
                });
            } else {
                await interaction.editReply({
                    content: '❌ Wystąpił błąd podczas ustawiania szablonu!'
                });
            }
        }
    }
}; 