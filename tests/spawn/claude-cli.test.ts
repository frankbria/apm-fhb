/**
 * Claude CLI Wrapper Tests
 * Tests for Claude CLI availability checking, spawning, and retry logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import {
  ClaudeCLI,
  SpawnErrorCode,
  type ClaudeSpawnOptions,
  type SpawnResult,
  type AvailabilityResult,
} from '../../src/spawn/claude-cli.js';

// Mock child_process
vi.mock('child_process', () => {
  return {
    spawn: vi.fn(),
    exec: vi.fn(),
  };
});

// Import mocked modules
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

describe('ClaudeCLI', () => {
  let claudeCLI: ClaudeCLI;
  let mockProcess: MockChildProcess;

  beforeEach(() => {
    claudeCLI = new ClaudeCLI();
    mockProcess = createMockProcess();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkAvailability()', () => {
    it('should return available:true when Claude CLI is found on Linux/macOS', async () => {
      // Mock platform to return linux
      vi.spyOn(require('os'), 'platform').mockReturnValue('linux');

      // Mock exec to return success
      vi.mocked(exec).mockImplementation((command: string, callback: any) => {
        callback(null, { stdout: '/usr/local/bin/claude\n', stderr: '' });
        return {} as any;
      });

      const result = await claudeCLI.checkAvailability();

      expect(result.available).toBe(true);
      expect(result.path).toBe('/usr/local/bin/claude');
      expect(result.error).toBeUndefined();
    });

    it('should return available:true when Claude CLI is found on Windows', async () => {
      // Mock platform to return win32
      vi.spyOn(require('os'), 'platform').mockReturnValue('win32');

      // Mock exec to return success
      vi.mocked(exec).mockImplementation((command: string, callback: any) => {
        callback(null, { stdout: 'C:\\Program Files\\Claude\\claude.exe\n', stderr: '' });
        return {} as any;
      });

      const result = await claudeCLI.checkAvailability();

      expect(result.available).toBe(true);
      expect(result.path).toBe('C:\\Program Files\\Claude\\claude.exe');
    });

    it('should return available:false when Claude CLI is not found', async () => {
      vi.spyOn(require('os'), 'platform').mockReturnValue('linux');

      // Mock exec to return error
      vi.mocked(exec).mockImplementation((command: string, callback: any) => {
        callback(new Error('Command not found'), { stdout: '', stderr: 'not found' });
        return {} as any;
      });

      const result = await claudeCLI.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.path).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it('should return available:false when stdout is empty', async () => {
      vi.spyOn(require('os'), 'platform').mockReturnValue('linux');

      // Mock exec to return empty stdout
      vi.mocked(exec).mockImplementation((command: string, callback: any) => {
        callback(null, { stdout: '', stderr: '' });
        return {} as any;
      });

      const result = await claudeCLI.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toBe('Claude CLI not found on PATH');
    });

    it('should handle exceptions gracefully', async () => {
      vi.spyOn(require('os'), 'platform').mockReturnValue('linux');

      // Mock exec to throw exception
      vi.mocked(exec).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const result = await claudeCLI.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toContain('Unexpected error');
    });
  });

  describe('spawnAgent()', () => {
    it('should spawn Claude agent process successfully', () => {
      mockProcess.pid = 12345;
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      const result = claudeCLI.spawnAgent('Test prompt');

      expect(result.success).toBe(true);
      expect(result.process).toBeDefined();
      expect(result.pid).toBe(12345);
      expect(result.error).toBeUndefined();
      expect(spawn).toHaveBeenCalledWith('claude', ['Test prompt'], expect.objectContaining({
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }));
    });

    it('should use default options when none provided', () => {
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      claudeCLI.spawnAgent('Test prompt');

      expect(spawn).toHaveBeenCalledWith('claude', ['Test prompt'], expect.objectContaining({
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 300000, // 5 minutes default
      }));
    });

    it('should merge environment variables with process.env', () => {
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      const options: ClaudeSpawnOptions = {
        env: {
          CUSTOM_VAR: 'value',
          ANOTHER_VAR: 'test',
        },
      };

      claudeCLI.spawnAgent('Test prompt', options);

      expect(spawn).toHaveBeenCalledWith('claude', ['Test prompt'], expect.objectContaining({
        env: expect.objectContaining({
          CUSTOM_VAR: 'value',
          ANOTHER_VAR: 'test',
        }),
      }));
    });

    it('should configure stdio as inherit when specified', () => {
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      claudeCLI.spawnAgent('Test prompt', { stdio: 'inherit' });

      expect(spawn).toHaveBeenCalledWith('claude', ['Test prompt'], expect.objectContaining({
        stdio: 'inherit',
      }));
    });

    it('should configure custom stdio array when provided', () => {
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      claudeCLI.spawnAgent('Test prompt', { stdio: ['ignore', 'pipe', 'pipe'] });

      expect(spawn).toHaveBeenCalledWith('claude', ['Test prompt'], expect.objectContaining({
        stdio: ['ignore', 'pipe', 'pipe'],
      }));
    });

    it('should set custom timeout when provided', () => {
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      claudeCLI.spawnAgent('Test prompt', { timeout: 60000 });

      expect(spawn).toHaveBeenCalledWith('claude', ['Test prompt'], expect.objectContaining({
        timeout: 60000,
      }));
    });

    it('should set custom working directory when provided', () => {
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      claudeCLI.spawnAgent('Test prompt', { cwd: '/custom/path' });

      expect(spawn).toHaveBeenCalledWith('claude', ['Test prompt'], expect.objectContaining({
        cwd: '/custom/path',
      }));
    });

    it('should handle ENOENT error (CLI not found)', () => {
      const error = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
      error.code = SpawnErrorCode.CLI_NOT_FOUND;

      vi.mocked(spawn).mockImplementation(() => {
        throw error;
      });

      const result = claudeCLI.spawnAgent('Test prompt');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(SpawnErrorCode.CLI_NOT_FOUND);
      expect(result.error?.message).toContain('ENOENT');
    });

    it('should handle EACCES error (insufficient permissions)', () => {
      const error = new Error('spawn claude EACCES') as NodeJS.ErrnoException;
      error.code = SpawnErrorCode.INSUFFICIENT_PERMISSIONS;

      vi.mocked(spawn).mockImplementation(() => {
        throw error;
      });

      const result = claudeCLI.spawnAgent('Test prompt');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(SpawnErrorCode.INSUFFICIENT_PERMISSIONS);
    });

    it('should handle EAGAIN error (resource unavailable)', () => {
      const error = new Error('spawn claude EAGAIN') as NodeJS.ErrnoException;
      error.code = SpawnErrorCode.RESOURCE_UNAVAILABLE;

      vi.mocked(spawn).mockImplementation(() => {
        throw error;
      });

      const result = claudeCLI.spawnAgent('Test prompt');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(SpawnErrorCode.RESOURCE_UNAVAILABLE);
    });

    it('should handle EMFILE error (too many files)', () => {
      const error = new Error('spawn claude EMFILE') as NodeJS.ErrnoException;
      error.code = SpawnErrorCode.TOO_MANY_FILES;

      vi.mocked(spawn).mockImplementation(() => {
        throw error;
      });

      const result = claudeCLI.spawnAgent('Test prompt');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(SpawnErrorCode.TOO_MANY_FILES);
    });

    it('should handle timeout by killing process', async () => {
      const mockProc = createMockProcess();
      mockProc.killed = false;
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      claudeCLI.spawnAgent('Test prompt', { timeout: 100 });

      // Wait for timeout to trigger
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should clear timeout on process exit', () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      claudeCLI.spawnAgent('Test prompt', { timeout: 5000 });

      // Trigger exit event
      mockProc.emit('exit', 0, null);

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('spawnWithRetry()', () => {
    it('should succeed on first attempt', async () => {
      mockProcess.pid = 12345;
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      const result = await claudeCLI.spawnWithRetry('Test prompt');

      expect(result.success).toBe(true);
      expect(result.pid).toBe(12345);
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('should retry transient errors (EAGAIN)', async () => {
      const error = new Error('EAGAIN') as NodeJS.ErrnoException;
      error.code = SpawnErrorCode.RESOURCE_UNAVAILABLE;

      // Fail twice, then succeed
      vi.mocked(spawn)
        .mockImplementationOnce(() => { throw error; })
        .mockImplementationOnce(() => { throw error; })
        .mockReturnValueOnce(mockProcess as unknown as ChildProcess);

      const result = await claudeCLI.spawnWithRetry('Test prompt', {}, 3, 10);

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(3);
    });

    it('should retry transient errors (EMFILE)', async () => {
      const error = new Error('EMFILE') as NodeJS.ErrnoException;
      error.code = SpawnErrorCode.TOO_MANY_FILES;

      // Fail once, then succeed
      vi.mocked(spawn)
        .mockImplementationOnce(() => { throw error; })
        .mockReturnValueOnce(mockProcess as unknown as ChildProcess);

      const result = await claudeCLI.spawnWithRetry('Test prompt', {}, 3, 10);

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(2);
    });

    it('should NOT retry permanent errors (ENOENT)', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = SpawnErrorCode.CLI_NOT_FOUND;

      vi.mocked(spawn).mockImplementation(() => { throw error; });

      const result = await claudeCLI.spawnWithRetry('Test prompt', {}, 3, 10);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(SpawnErrorCode.CLI_NOT_FOUND);
      expect(spawn).toHaveBeenCalledTimes(1); // No retries
    });

    it('should NOT retry permanent errors (EACCES)', async () => {
      const error = new Error('EACCES') as NodeJS.ErrnoException;
      error.code = SpawnErrorCode.INSUFFICIENT_PERMISSIONS;

      vi.mocked(spawn).mockImplementation(() => { throw error; });

      const result = await claudeCLI.spawnWithRetry('Test prompt', {}, 3, 10);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(SpawnErrorCode.INSUFFICIENT_PERMISSIONS);
      expect(spawn).toHaveBeenCalledTimes(1); // No retries
    });

    it('should use exponential backoff for retries', async () => {
      const error = new Error('EAGAIN') as NodeJS.ErrnoException;
      error.code = SpawnErrorCode.RESOURCE_UNAVAILABLE;

      vi.mocked(spawn).mockImplementation(() => { throw error; });

      const startTime = Date.now();
      await claudeCLI.spawnWithRetry('Test prompt', {}, 3, 100);
      const duration = Date.now() - startTime;

      // Expected delays: 100ms, 200ms, 400ms = 700ms total (with some tolerance)
      expect(duration).toBeGreaterThanOrEqual(650);
      expect(spawn).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it('should fail after max retries exceeded', async () => {
      const error = new Error('EAGAIN') as NodeJS.ErrnoException;
      error.code = SpawnErrorCode.RESOURCE_UNAVAILABLE;

      vi.mocked(spawn).mockImplementation(() => { throw error; });

      const result = await claudeCLI.spawnWithRetry('Test prompt', {}, 2, 10);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('failed after 2 retries');
      expect(spawn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should NOT retry non-transient, non-permanent errors', async () => {
      const error = new Error('UNKNOWN') as NodeJS.ErrnoException;
      error.code = 'EUNKNOWN';

      vi.mocked(spawn).mockImplementation(() => { throw error; });

      const result = await claudeCLI.spawnWithRetry('Test prompt', {}, 3, 10);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EUNKNOWN');
      expect(spawn).toHaveBeenCalledTimes(1); // No retries
    });
  });
});

/**
 * Mock ChildProcess
 */
interface MockChildProcess extends EventEmitter {
  pid?: number;
  killed: boolean;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

/**
 * Create mock child process
 */
function createMockProcess(): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.pid = undefined;
  proc.killed = false;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = new EventEmitter();
  proc.kill = vi.fn().mockReturnValue(true);
  return proc;
}
