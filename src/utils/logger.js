const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logDir = path.join(process.cwd(), 'logs');
        this.currentLogFile = null;
        this.initializeLogDirectory();
    }

    initializeLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
        this.rotateLogFile();
    }

    rotateLogFile() {
        const date = new Date().toISOString().split('T')[0];
        this.currentLogFile = path.join(this.logDir, `${date}.log`);
    }

    log(message, level = 'INFO') {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${level}] ${message}\n`;
        
        // Write to console only if it's not DEBUG level
        if (level !== 'DEBUG') {
            console.log(logMessage.trim());
        }
        
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

const logger = new Logger();
module.exports = logger; 