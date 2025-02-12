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