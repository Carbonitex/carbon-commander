/**
 * Global logger implementation for Carbon Commander
 */
export const ccLogger = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
    group: console.group.bind(console),
    groupEnd: console.groupEnd.bind(console),
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