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

export const ccLogger = {
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

export const AICallerModels = {
    ['FAST']: {
        ollama: 'qwen2.5:14b',
        openai: 'gpt-4o-mini'
    },
    ['REASON']: {
        ollama: "deepseek-r1:70b",
        openai: "o3-mini"
    },
    ['VISION']: {
        ollama: "llama3.2-vision",
        openai: "gpt-4o"
    },
    ['AUTOCOMPLETE']: {
        ollama: 'mistral-small',//"qwen2.5:1.5b",
        openai: "gpt-4o-mini"
    }
}