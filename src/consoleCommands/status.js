const { config, youtubeNotifier, client } = require('../instances');
const logger = require('../utils/logger');

function formatStatus() {
    try {
        const allKeys = youtubeNotifier.apiKeys.length;
        const activeKeys = youtubeNotifier.apiKeys.filter(key => 
            !youtubeNotifier.keyStatus.get(key).exceeded
        ).length;

        // Get detailed key status
        const keyDetails = youtubeNotifier.apiKeys.map((key, index) => {
            const status = youtubeNotifier.keyStatus.get(key);
            return {
                index: index + 1,
                quotaUsed: status.quotaUsed,
                remaining: 10000 - status.quotaUsed,
                exceeded: status.exceeded,
                resetTime: status.resetTime
            };
        });

        // Format key status
        const keyStatus = [
            '📊 Klucze API:',
            `Aktywne: ${activeKeys}/${allKeys}`,
            `Obecny klucz: #${youtubeNotifier.currentKeyIndex + 1}`,
            activeKeys === 0 ? '⚠️ Używam RSS jako zapasowego źródła' : '',
            '',
            'Szczegóły kluczy:',
            ...keyDetails.map(key => 
                `Klucz #${key.index}: ${key.exceeded ? '❌' : '✅'} ` +
                `(${key.quotaUsed}/10000 jednostek użyte)` +
                (key.exceeded ? `\nReset: ${key.resetTime.toLocaleTimeString()}` : '')
            )
        ].filter(Boolean);

        // Format guild statistics
        const guilds = client.isReady() ? client.guilds.cache.size : 'Bot nie jest gotowy';
        const monitoredChannels = youtubeNotifier.getAllYouTubeChannels();
        
        const guildConfigs = Object.entries(config.config.channels || {}).map(([guildId, channels]) => {
            const guild = client.isReady() ? client.guilds.cache.get(guildId) : null;
            const interval = config.getCheckInterval(guildId);
            return {
                name: guild?.name || `Serwer ${guildId}`,
                channels: Object.keys(channels).length,
                interval
            };
        });

        const globalStats = [
            '🌐 Statystyki globalne:',
            `Serwery: ${guilds}`,
            `Monitorowane kanały: ${monitoredChannels.length}`,
            `Użycie RSS: ${youtubeNotifier.getRssUsage()} razy`,
            '',
            'Konfiguracje serwerów:',
            ...guildConfigs.map(g => 
                `${g.name}: ${g.channels} ${g.channels === 1 ? 'kanał' : 'kanały'} (interwał: ${g.interval}min)`
            )
        ];

        // Combine all sections
        return [
            '🤖 Status Bota',
            '='.repeat(50),
            ...keyStatus,
            '-'.repeat(50),
            ...globalStats,
            '='.repeat(50),
            `Ostatnie sprawdzenie: ${new Date().toLocaleTimeString()}`
        ].join('\n');

    } catch (error) {
        logger.error('Błąd podczas generowania statusu:', error);
        return 'Błąd podczas generowania statusu!';
    }
}

module.exports = {
    name: 'status',
    description: 'Wyświetla status bota',
    execute() {
        console.log(formatStatus());
    }
}; 