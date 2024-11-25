const fs = require('fs').promises;
const path = require('path');

class CacheManager {
    constructor() {
        this.cacheDir = path.join(process.cwd(), 'cache');
        this.cacheFiles = {
            lastChecked: 'lastChecked.json',
            statistics: 'statistics.json',
            retryQueue: 'retryQueue.json'
        };
    }

    async initialize() {
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
        } catch (error) {
            console.error('Błąd podczas tworzenia katalogu cache:', error);
        }
    }

    async load(type) {
        try {
            const filePath = path.join(this.cacheDir, this.cacheFiles[type]);
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error(`Błąd podczas wczytywania cache ${type}:`, error);
            }
            return null;
        }
    }

    async save(type, data) {
        try {
            const filePath = path.join(this.cacheDir, this.cacheFiles[type]);
            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error(`Błąd podczas zapisywania cache ${type}:`, error);
        }
    }

    async clearCache(type = null) {
        try {
            if (type) {
                const filePath = path.join(this.cacheDir, this.cacheFiles[type]);
                await fs.unlink(filePath);
            } else {
                const files = await fs.readdir(this.cacheDir);
                await Promise.all(
                    files.map(file => fs.unlink(path.join(this.cacheDir, file)))
                );
            }
        } catch (error) {
            console.error('Błąd podczas czyszczenia cache:', error);
        }
    }
} 