import type { LogContext, Logger } from '../../src/logging/logger.js';

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: LogContext;
  error?: unknown;
}

export class MemoryLogger implements Logger {
  public readonly entries: LogEntry[] = [];

  public debug(message: string, context?: LogContext): void {
    this.entries.push({ level: 'debug', message, ...(context === undefined ? {} : { context }) });
  }

  public info(message: string, context?: LogContext): void {
    this.entries.push({ level: 'info', message, ...(context === undefined ? {} : { context }) });
  }

  public warn(message: string, context?: LogContext): void {
    this.entries.push({ level: 'warn', message, ...(context === undefined ? {} : { context }) });
  }

  public error(message: string, error: unknown, context?: LogContext): void {
    this.entries.push({
      level: 'error',
      message,
      error,
      ...(context === undefined ? {} : { context }),
    });
  }
}
