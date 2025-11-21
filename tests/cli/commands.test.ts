import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import chalk from 'chalk';

vi.mock('../../src/cli/logger.js', () => {
  const mockLog = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };

  return {
    log: mockLog,
    initLogger: vi.fn(),
    createLogger: vi.fn(() => ({
      error: mockLog.error,
      warn: mockLog.warn,
      info: mockLog.info,
      debug: mockLog.debug,
      level: 'info',
    })),
    getLogger: vi.fn(() => ({
      error: mockLog.error,
      warn: mockLog.warn,
      info: mockLog.info,
      debug: mockLog.debug,
      level: 'info',
    })),
  };
});

import { startCommand } from '../../src/cli/commands/start.js';
import { stopCommand } from '../../src/cli/commands/stop.js';
import { statusCommand } from '../../src/cli/commands/status.js';
import { resumeCommand } from '../../src/cli/commands/resume.js';
import { log } from '../../src/cli/logger.js';

describe('apm-auto CLI commands', () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit: ${code}`);
  }) as never);
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  afterAll(() => {
    exitSpy.mockRestore();
  });

  describe('startCommand', () => {
    it('exits with error when no scopes are provided', async () => {
      await expect(startCommand([], { verbose: false })).rejects.toThrow(/process.exit: 2/);
      expect(log.error).toHaveBeenCalledWith('No scope specified');
    });

    it('runs dry-run flow and lists parsed scopes', async () => {
      await startCommand(['phase:1-2', 'agent:Orchestration*'], { dryRun: true });
      expect(log.info).toHaveBeenCalledWith('Validated scopes: phase:1-2, agent:Orchestration*');
      expect(log.info).toHaveBeenCalledWith('[DRY RUN] Would start automation with the following configuration:');
      expect(log.info).toHaveBeenCalledWith('  - phase: 1, 2');
      expect(log.info).toHaveBeenCalledWith('  - agent: Orchestration*');
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('handles validation errors gracefully', async () => {
      await expect(startCommand(['invalid'], {})).rejects.toThrow(/process.exit: 2/);
      expect(log.error).toHaveBeenCalledWith('Invalid scope format: "invalid"');
    });
  });

  describe('stopCommand', () => {
    it('describes graceful shutdown when force is false', async () => {
      await stopCommand({ force: false });
      expect(log.warn).toHaveBeenCalledWith(
        'Not yet implemented - Phase 4 will implement automation lifecycle management',
      );
      expect(log.info).toHaveBeenCalledWith('The stop command will gracefully terminate running automation:');
      expect(log.info).toHaveBeenCalledWith('  - Complete current operation');
      expect(log.info).toHaveBeenCalledWith('  - Save state for potential resume');
      expect(log.info).toHaveBeenCalledWith('  - Clean up resources');
      expect(log.info).toHaveBeenCalledWith('  - Exit cleanly');
    });

    it('warns about forceful termination', async () => {
      await stopCommand({ force: true });
      expect(log.info).toHaveBeenCalledWith('The stop command will immediately terminate running automation');
      expect(log.info).toHaveBeenCalledWith('Warning: Force stop may leave cleanup tasks incomplete');
    });
  });

  describe('statusCommand', () => {
    it('outputs JSON when requested', async () => {
      await statusCommand({ json: true });
      const printed = consoleSpy.mock.calls.map(([msg]) => msg).join(' ');
      expect(printed).toContain('"active": false');
      expect(printed).toContain('"message": "No active automation session"');
    });

    it('prints human-readable output otherwise', async () => {
      await statusCommand({ json: false });
      const output = consoleSpy.mock.calls.map(([msg]) => msg).join(' ');
      expect(output).toContain(chalk.bold('Automation Status'));
      expect(output).toContain('Inactive');
      expect(output).toContain('apm-auto start phase:1-2');
      expect(log.debug).toHaveBeenCalled();
    });
  });

  describe('resumeCommand', () => {
    it('logs placeholder and missing session guidance', async () => {
      await resumeCommand({ verbose: false });
      expect(log.warn).toHaveBeenCalledWith(
        'Not yet implemented - Phase 4 will implement session management',
      );
      expect(log.error).toHaveBeenCalledWith('No paused session found');
      expect(log.info).toHaveBeenCalledWith('Start a new session with: apm-auto start <scope>');
    });
  });
});
