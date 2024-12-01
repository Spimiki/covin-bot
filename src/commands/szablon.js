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
                { name: 'Transmisje na żywo', value: 'live' },
                { name: 'Zaplanowane transmisje', value: 'scheduled' }
            ]
        },
        {
            name: 'szablon',
            description: 'Nowy szablon (użyj \\n dla nowej linii, zostaw puste aby zobaczyć obecny)',
            type: 3, // STRING
            required: false
        }
    ],
    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });
            
            if (!interaction.member.permissions.has('Administrator')) {
                return interaction.editReply('❌ Ta komenda wymaga uprawnień administratora!');
            }

            const type = interaction.options.getString('typ');
            let template = interaction.options.getString('szablon');

            if (!template) {
                // Show current template
                const currentTemplate = config.getTemplate(interaction.guildId, type);
                const typeNames = {
                    video: '📹 Filmy',
                    live: '🔴 Transmisje na żywo',
                    scheduled: '📅 Zaplanowane transmisje'
                };

                const response = [
                    '📝 **Obecny szablon powiadomień**',
                    '',
                    'Dostępne zmienne:',
                    '`{nazwaKanalu}` - nazwa kanału',
                    '`{tytul}` - tytuł filmu/transmisji',
                    '`{link}` - link do filmu/transmisji',
                    type === 'scheduled' ? '`{startTime}` - zaplanowany czas rozpoczęcia' : '',
                    '',
                    'Aby dodać nową linię, użyj `\\n` w szablonie.',
                    '',
                    `**Typ:** ${typeNames[type]}`,
                    '',
                    '**Szablon (surowy):**',
                    '```',
                    currentTemplate,
                    '```',
                    '',
                    '**Podgląd:**',
                    currentTemplate.replace(/\\n/g, '\n')
                ].filter(Boolean).join('\n');

                return interaction.editReply(response);
            }

            // Process the template
            // Replace literal newlines with \n
            template = template.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n');

            // Validate required variables
            const requiredVars = ['{nazwaKanalu}', '{tytul}', '{link}'];
            if (type === 'scheduled') {
                requiredVars.push('{startTime}');
            }

            const missingVars = requiredVars.filter(v => !template.includes(v));
            if (missingVars.length > 0) {
                return interaction.editReply(
                    `❌ Szablon musi zawierać następujące zmienne:\n${missingVars.map(v => `\`${v}\``).join(', ')}`
                );
            }

            // Save new template
            config.setTemplate(interaction.guildId, type, template);

            // Show preview
            const response = [
                '✅ **Szablon został zaktualizowany!**',
                '',
                '**Szablon (surowy):**',
                '```',
                template,
                '```',
                '',
                '**Podgląd:**',
                template.replace(/\\n/g, '\n')
            ].join('\n');

            await interaction.editReply(response);

        } catch (error) {
            console.error('Błąd podczas ustawiania szablonu:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply('❌ Wystąpił błąd podczas ustawiania szablonu!');
            } else {
                await interaction.editReply('❌ Wystąpił błąd podczas ustawiania szablonu!');
            }
        }
    }
}; 