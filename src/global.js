/**
 * Global logger implementation for Carbon Commander
 */
let ccLoggerPrefix = '';
let ccLoggerIgnorePrefixes = [];//['[CARBONBAR-SECURE]'];

export const ccDefaultKeybind = {
    key: 'k',
    ctrl: true,
    meta: false
};


export const ccOneTimeMessageHandler = async (requestId) => {
    return new Promise((resolve) => {
        const messageHandler = (event) => {
            window.removeEventListener('message', messageHandler);
            resolve(event);
        };
        window.addEventListener(`${requestId}_RESPONSE`, messageHandler);
    });
}


export const ccLoggerEmpty = {
    log: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    group: () => {},
    groupEnd: () => {},
    time: () => {},
    timeEnd: () => {},
    setPrefix: () => {
        // Do nothing
    }
};  


export const ccLoggerFull = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    group: console.group,
    groupEnd: console.groupEnd,
    time: console.time,
    timeEnd: console.timeEnd,
    setPrefix: (prefix) => {
        ccLoggerPrefix = prefix;
        // Wrap console methods to include prefix
        ccLogger.log = (...args) => {
            if (!ccLoggerIgnorePrefixes.some(prefix => args[0].startsWith(prefix))) {
                console.log(ccLoggerPrefix, ...args);
            }
        };
        ccLogger.info = (...args) => {
            if (!ccLoggerIgnorePrefixes.some(prefix => args[0].startsWith(prefix))) {
                console.info(ccLoggerPrefix, ...args);
            }
        };
        ccLogger.warn = (...args) => {
            if (!ccLoggerIgnorePrefixes.some(prefix => args[0].startsWith(prefix))) {
                console.warn(ccLoggerPrefix, ...args);
            }
        };
        ccLogger.error = (...args) => {
            if (!ccLoggerIgnorePrefixes.some(prefix => args[0].startsWith(prefix))) {
                console.error(ccLoggerPrefix, ...args);
            }
        };
        ccLogger.debug = (...args) => {
            if (!ccLoggerIgnorePrefixes.some(prefix => args[0].startsWith(prefix))) {
                console.debug(ccLoggerPrefix, ...args);
            }
        };
    }
};

export const ccLogger = ccLoggerEmpty;

export const AICallerModels = {
    ['FAST']: {
        ollama: 'mistral-small3.1',
        openrouter: 'openai/gpt-4o-mini'
    },
    ['REASON']: {
        ollama: 'mistral-small3.1',
        openrouter: 'anthropic/claude-sonnet-4'
    },
    ['VISION']: {
        ollama: 'mistral-small3.1',
        openrouter: 'openai/gpt-4o'
    },
    ['AUTOCOMPLETE']: {
        ollama: 'gemma3:1b',
        openrouter: 'openai/gpt-4o-mini'
    }
}