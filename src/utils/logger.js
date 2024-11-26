const fs = require('fs');
const path = require('path');

class Logger {
    constructor(daysToKeep = 7) {
        this.logDir = path.join(process.cwd(), 'logs');
        this.currentLogFile = null;
        this.daysToKeep = daysToKeep;
        this.initializeLogDirectory();
    }

    initializeLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
        this.rotateLogFile();
    }

    cleanOldLogs() {
        const now = Date.now();
        const maxAge = this.daysToKeep * 24 * 60 * 60 * 1000;

        fs.readdir(this.logDir, (err, files) => {
            if (err) {
                console.error('Error reading logs directory:', err);
                return;
            }

            files.forEach(file => {
                const filePath = path.join(this.logDir, file);
                fs.stat(filePath, (err, stats) => {
                    if (err) {
                        console.error(`Error getting stats for ${file}:`, err);
                        return;
                    }

                    if (now - stats.mtime.getTime() > maxAge) {
                        fs.unlink(filePath, err => {
                            if (err) {
                                console.error(`Error deleting old log file ${file}:`, err);
                            } else {
                                this.info(`Usunięto stary plik logów: ${file}`);
                            }
                        });
                    }
                });
            });
        });
    }

    rotateLogFile() {
        const date = new Date().toISOString().split('T')[0];
        this.currentLogFile = path.join(this.logDir, `${date}.log`);
        this.cleanOldLogs();
    }

    log(message, level = 'INFO') {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${level}] ${message}\n`;
        
        // Write to console
        console.log(logMessage.trim());
        
        // Write to file
        fs.appendFileSync(this.currentLogFile, logMessage);
    }

    error(message) {
        this.log(message, 'ERROR');
    }

    info(message) {
        this.log(message, 'INFO');
    }

    debug(message) {
        this.log(message, 'DEBUG');
    }
}

const logger = new Logger(7);
module.exports = logger; 