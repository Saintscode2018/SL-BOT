export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error: unknown, context?: LogContext): void;
}

interface ConsoleSink {
  debug(value: unknown): void;
  info(value: unknown): void;
  warn(value: unknown): void;
  error(value: unknown): void;
}

const levelPriority: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 4,
};

export class ConsoleLogger implements Logger {
  public constructor(
    private readonly minimumLevel: LogLevel,
    private readonly sink: ConsoleSink = console,
  ) {}

  public debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  public info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  public warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  public error(message: string, error: unknown, context?: LogContext): void {
    if (!this.enabled('error')) return;
    this.sink.error({ ...context, level: 'error', message, error });
  }

  private enabled(level: LogLevel): boolean {
    return levelPriority[level] >= levelPriority[this.minimumLevel];
  }

  private write(level: 'debug' | 'info' | 'warn', message: string, context?: LogContext): void {
    if (!this.enabled(level)) return;
    this.sink[level]({ ...context, level, message });
  }
}
