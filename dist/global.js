// Log levels enum
const LogLevel = {
    DEBUG: { name: 'DEBUG', color: '#7f8c8d', style: 'color: #7f8c8d' },
    INFO: { name: 'INFO', color: '#3498db', style: 'color: #3498db' },
    WARN: { name: 'WARN', color: '#f39c12', style: 'color: #f39c12' },
    ERROR: { name: 'ERROR', color: '#e74c3c', style: 'color: #e74c3c' },
    FATAL: { name: 'FATAL', color: '#c0392b', style: 'background: #c0392b; color: white; padding: 2px 4px; border-radius: 2px' }
};

class CCLogger {
    static #instance;
    #logLevel = LogLevel.FATAL;
    #logHistory = [];
    #maxHistorySize = 1000;
    #groupLevel = 0;
    #timers = new Map();
    #filters = new Set();

    constructor() {
        if (CCLogger.#instance) {
            return CCLogger.#instance;
        }
        CCLogger.#instance = this;
    }

    static getInstance() {
        if (!CCLogger.#instance) {
            CCLogger.#instance = new CCLogger();
        }
        return CCLogger.#instance;
    }

    disable() {
        this.#logLevel = LogLevel.FATAL;
    }

    enable() {
        this.#logLevel = LogLevel.DEBUG;
    }

    setLogLevel(level) {
        if (LogLevel[level]) {
            this.#logLevel = LogLevel[level];
        }
    }

    addFilter(pattern) {
        this.#filters.add(pattern);
    }

    removeFilter(pattern) {
        this.#filters.delete(pattern);
    }

    clearFilters() {
        this.#filters.clear();
    }

    #shouldLog(message) {
        if (this.#filters.size === 0) return true;
        return Array.from(this.#filters).some(pattern => 
            message.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    #formatMessage(level, args) {
        const timestamp = new Date().toISOString();
        const prefix = '│'.repeat(this.#groupLevel);
        const message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');

        return {
            formatted: `${prefix}[Carbon Commander][${level.name}] ${message}`,
            timestamp,
            level,
            raw: message
        };
    }

    #addToHistory(logEntry) {
        this.#logHistory.push(logEntry);
        if (this.#logHistory.length > this.#maxHistorySize) {
            this.#logHistory.shift();
        }
    }

    #log(level, ...args) {
        if (!this.#shouldLog(args.join(' '))) return;

        const logEntry = this.#formatMessage(level, args);
        this.#addToHistory(logEntry);

        const consoleArgs = [
            `%c${logEntry.timestamp} ${logEntry.formatted}`,
            level.style
        ];

        switch (level) {
            case LogLevel.DEBUG:
                console.debug(...consoleArgs);
                break;
            case LogLevel.INFO:
                console.info(...consoleArgs);
                break;
            case LogLevel.WARN:
                console.warn(...consoleArgs);
                break;
            case LogLevel.ERROR:
            case LogLevel.FATAL:
                console.error(...consoleArgs);
                if (args[0] instanceof Error) {
                    console.error(args[0].stack);
                }
                break;
        }
    }

    debug(...args) {
        this.#log(LogLevel.DEBUG, ...args);
    }

    info(...args) {
        this.#log(LogLevel.INFO, ...args);
    }

    warn(...args) {
        this.#log(LogLevel.WARN, ...args);
    }

    error(...args) {
        this.#log(LogLevel.ERROR, ...args);
    }

    fatal(...args) {
        this.#log(LogLevel.FATAL, ...args);
    }

    group(label) {
        if (this.#logLevel === LogLevel.DEBUG) {
            console.group(label);
        }
        this.#groupLevel++;
        this.debug(`Group Start: ${label}`);
    }

    groupEnd() {
        this.#groupLevel = Math.max(0, this.#groupLevel - 1);
        if (this.#logLevel === LogLevel.DEBUG) {
            console.groupEnd();
        }
        this.debug('Group End');
    }

    time(label) {
        this.#timers.set(label, performance.now());
        this.debug(`Timer Start: ${label}`);
    }

    timeEnd(label) {
        const startTime = this.#timers.get(label);
        if (startTime) {
            const duration = performance.now() - startTime;
            this.#timers.delete(label);
            this.debug(`Timer End: ${label} (${duration.toFixed(2)}ms)`);
            return duration;
        }
        this.warn(`Timer not found: ${label}`);
        return null;
    }

    getLogHistory() {
        return [...this.#logHistory];
    }

    clearHistory() {
        this.#logHistory = [];
    }

    exportLogs() {
        return {
            logs: this.#logHistory,
            timestamp: new Date().toISOString(),
            filters: Array.from(this.#filters),
            logLevel: this.#logLevel.name
        };
    }
}

// Create a singleton instance
const ccLogger = CCLogger.getInstance();


if(typeof window !== 'undefined') {
    window.ccLogger= ccLogger;
}

export { ccLogger };