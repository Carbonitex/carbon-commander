/**
 * Global logger implementation for Carbon Commander
 */
let ccLoggerPrefix = '';

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
    prefix: ccLoggerPrefix,
    setPrefix: (prefix) => {
        ccLoggerPrefix = prefix;
    },
    log: (...args) => {
        console.log(ccLoggerPrefix, ...args);
    },
    info: (...args) => {
        console.info(ccLoggerPrefix, ...args);
    },
    warn: (...args) => {
        console.warn(ccLoggerPrefix, ...args);
    },
    error: (...args) => {
        console.error(ccLoggerPrefix, ...args);
    },
    debug: (...args) => {
        console.debug(ccLoggerPrefix, ...args);
    },
    group: (...args) => {
        console.group(ccLoggerPrefix, ...args);
    },
    groupEnd: (...args) => {
        console.groupEnd(ccLoggerPrefix, ...args);
    },
    time: console.time.bind(console),
    timeEnd: console.timeEnd.bind(console)
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