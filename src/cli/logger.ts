/**
 * CLI Logging Infrastructure
 *
 * Provides configurable logging using Winston with support for:
 * - Multiple log levels (error, warn, info, debug)
 * - Colored console output (unless --no-color is specified)
 * - Optional file logging
 * - Environment variable configuration
 */

import winston from 'winston';
import chalk from 'chalk';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LoggerOptions {
  level?: LogLevel;
  noColor?: boolean;
  verbose?: boolean;
}

/**
 * Custom formatter for console output with chalk colors
 */
const consoleFormat = (noColor: boolean) => winston.format.printf(({ level, message, timestamp }) => {
  if (noColor) {
    return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  }

  const colorMap: Record<string, (text: string) => string> = {
    error: chalk.red,
    warn: chalk.yellow,
    info: chalk.blue,
    debug: chalk.gray,
  };

  const colorFn = colorMap[level] || ((text: string) => text);
  const levelText = colorFn(level.toUpperCase());
  const timeText = chalk.gray(`[${timestamp}]`);

  return `${timeText} ${levelText}: ${message}`;
});

/**
 * Create a configured logger instance
 */
export function createLogger(options: LoggerOptions = {}): winston.Logger {
  const {
    level = (process.env.APM_AUTO_LOG_LEVEL as LogLevel) || 'info',
    noColor = false,
    verbose = false,
  } = options;

  // Override level if verbose is enabled
  const effectiveLevel = verbose ? 'debug' : level;

  const logger = winston.createLogger({
    level: effectiveLevel,
    format: winston.format.combine(
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.errors({ stack: true }),
    ),
    transports: [
      new winston.transports.Console({
        format: consoleFormat(noColor),
      }),
    ],
  });

  return logger;
}

// Global logger instance (will be initialized by CLI entry point)
let globalLogger: winston.Logger | null = null;

/**
 * Initialize the global logger
 */
export function initLogger(options: LoggerOptions = {}): winston.Logger {
  globalLogger = createLogger(options);
  return globalLogger;
}

/**
 * Get the global logger instance
 * Creates a default logger if not initialized
 */
export function getLogger(): winston.Logger {
  if (!globalLogger) {
    globalLogger = createLogger();
  }
  return globalLogger;
}

/**
 * Convenience logging functions
 */
export const log = {
  error: (message: string, ...args: unknown[]) => getLogger().error(message, ...args),
  warn: (message: string, ...args: unknown[]) => getLogger().warn(message, ...args),
  info: (message: string, ...args: unknown[]) => getLogger().info(message, ...args),
  debug: (message: string, ...args: unknown[]) => getLogger().debug(message, ...args),
};
