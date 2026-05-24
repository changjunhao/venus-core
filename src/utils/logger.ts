// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Logger
 *
 * Minimal logging utility. Users can inject their own logging via onEvent.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Create a simple console logger with a prefix */
export function createLogger(prefix: string = '@theogony/venus-core'): Logger {
  const format = (level: LogLevel, message: string) => `[${prefix}] [${level.toUpperCase()}] ${message}`;

  return {
    debug: (message, ...args) => console.debug(format('debug', message), ...args),
    info: (message, ...args) => console.info(format('info', message), ...args),
    warn: (message, ...args) => console.warn(format('warn', message), ...args),
    error: (message, ...args) => console.error(format('error', message), ...args),
  };
}
