import { describe, it, expect, afterEach, vi } from 'vitest';
import winston from 'winston';
import { createLogger, initLogger, getLogger } from '../../src/cli/logger.js';

describe('CLI logger', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('creates logger with debug level when verbose', () => {
    const logger = createLogger({ verbose: true, noColor: true });
    expect(logger.level).toBe('debug');
    expect(logger.transports).toHaveLength(1);
    expect(logger.transports[0]).toBeInstanceOf(winston.transports.Console);
  });

  it('respects provided log level and color settings', () => {
    const logger = createLogger({ level: 'warn', noColor: true });
    expect(logger.level).toBe('warn');
    const transport = logger.transports[0] as winston.transports.ConsoleTransportInstance;
    const formatted = transport.format?.transform({
      level: 'warn',
      message: 'test',
      timestamp: '00:00:00',
    } as winston.Logform.TransformableInfo);

    const output = formatted ? (formatted as Record<symbol, string>)[Symbol.for('message')] : '';
    expect(String(output)).toContain('WARN');
  });

  it('initializes and reuses global logger', () => {
    const first = initLogger({ level: 'error' });
    const retrieved = getLogger();
    expect(retrieved).toBe(first);
  });
});
