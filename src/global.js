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
        ollama: 'mistral-small3.1',//'qwen2.5:14b',
        openai: 'gpt-4o-mini',
        gemini: 'gemini-2.5-flash-preview-04-17'
    },
    ['REASON']: {
        ollama: 'mistral-small3.1',//"deepseek-r1:70b",
        openai: "o4-mini",
        gemini: 'gemini-2.5-pro-exp-03-25'
    },
    ['VISION']: {
        ollama: 'mistral-small3.1',//"llama3.2-vision",
        openai: "gpt-4.1",
        gemini: 'gemini-2.5-flash-preview-04-17'
    },
    ['AUTOCOMPLETE']: {
        ollama: 'gemma3:1b',//'mistral-small',//"qwen2.5:1.5b",
        openai: "gpt-4.1-nano",
        gemini: 'gemini-2.0-flash-lite'
    }
}