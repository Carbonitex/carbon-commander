/**
 * Small levelled logger. Default level is `warn` in development builds and `silent` in
 * production builds; `Settings.debugLogging` switches to `debug` at runtime (`setLogLevel`).
 * Never log secrets, API keys or full page contents.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

let currentLevel: LogLevel = __DEV__ ? 'warn' : 'silent';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** `createLogger('mcp')` prefixes output with `[cc:mcp]`. */
export function createLogger(scope: string): Logger {
  const prefix = `[cc:${scope}]`;
  const at =
    (level: Exclude<LogLevel, 'silent'>) =>
    (...args: unknown[]): void => {
      if (ORDER[level] < ORDER[currentLevel]) return;
      console[level](prefix, ...args);
    };
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}
