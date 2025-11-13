/**
 * Process Manager Tests
 * Tests for process lifecycle management, output capture, and termination
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import {
  ProcessManager,
  ProcessStatus,
  createProcessManager,
  type ProcessInfo,
} from '../../src/spawn/process-manager.js';

describe('ProcessManager', () => {
  let manager: ProcessManager;
  let mockProcess: MockChildProcess;

  beforeEach(() => {
    manager = createProcessManager();
    mockProcess = createMockProcess();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('registerProcess()', () => {
    it('should register process successfully', () => {
      mockProcess.pid = 12345;

      const info = manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);

      expect(info.agentId).toBe('agent_001');
      expect(info.pid).toBe(12345);
      expect(info.status).toBe(ProcessStatus.Running);
      expect(info.spawnedAt).toBeInstanceOf(Date);
    });

    it('should emit process-spawned event', async () => {
      mockProcess.pid = 12345;

      const promise = new Promise<void>((resolve) => {
        manager.on('process-spawned', (agentId, pid) => {
          expect(agentId).toBe('agent_001');
          expect(pid).toBe(12345);
          resolve();
        });
      });

      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);

      await promise;
    });

    it('should throw error if agentId already registered', () => {
      mockProcess.pid = 12345;
      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);

      const newProcess = createMockProcess();
      newProcess.pid = 67890;

      expect(() => {
        manager.registerProcess('agent_001', newProcess as unknown as ChildProcess);
      }).toThrow('already registered');
    });

    it('should throw error if process has no PID', () => {
      mockProcess.pid = undefined;

      expect(() => {
        manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);
      }).toThrow('does not have a PID');
    });

    it('should attach stdout handler', () => {
      mockProcess.pid = 12345;
      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);

      const outputSpy = vi.fn();
      manager.on('process-output', outputSpy);

      // Emit stdout data
      mockProcess.stdout.emit('data', Buffer.from('Test output\n'));

      expect(outputSpy).toHaveBeenCalledWith('agent_001', 'stdout', 'Test output\n');
    });

    it('should attach stderr handler', () => {
      mockProcess.pid = 12345;
      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);

      const outputSpy = vi.fn();
      manager.on('process-output', outputSpy);

      // Emit stderr data
      mockProcess.stderr.emit('data', Buffer.from('Error output\n'));

      expect(outputSpy).toHaveBeenCalledWith('agent_001', 'stderr', 'Error output\n');
    });

    it('should attach error handler', () => {
      mockProcess.pid = 12345;
      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);

      const errorSpy = vi.fn();
      manager.on('process-error', errorSpy);

      const error = new Error('Process error');
      mockProcess.emit('error', error);

      expect(errorSpy).toHaveBeenCalledWith('agent_001', error);
    });

    it('should attach exit handler', () => {
      mockProcess.pid = 12345;
      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);

      const exitSpy = vi.fn();
      manager.on('process-exit', exitSpy);

      mockProcess.emit('exit', 0, null);

      expect(exitSpy).toHaveBeenCalledWith('agent_001', 0, null);
    });
  });

  describe('captureOutput()', () => {
    beforeEach(() => {
      mockProcess.pid = 12345;
      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);
    });

    it('should buffer stdout output', () => {
      manager.captureOutput('agent_001', 'stdout', 'Line 1\nLine 2\nLine 3\n');

      const output = manager.getOutput('agent_001');
      expect(output?.stdout).toEqual(['Line 1', 'Line 2', 'Line 3']);
    });

    it('should buffer stderr output', () => {
      manager.captureOutput('agent_001', 'stderr', 'Error 1\nError 2\n');

      const output = manager.getOutput('agent_001');
      expect(output?.stderr).toEqual(['Error 1', 'Error 2']);
    });

    it('should ignore empty lines', () => {
      manager.captureOutput('agent_001', 'stdout', 'Line 1\n\n\nLine 2\n');

      const output = manager.getOutput('agent_001');
      expect(output?.stdout).toEqual(['Line 1', 'Line 2']);
    });

    it('should enforce 1000 line buffer limit (FIFO)', () => {
      // Add 1200 lines
      for (let i = 1; i <= 1200; i++) {
        manager.captureOutput('agent_001', 'stdout', `Line ${i}\n`);
      }

      const output = manager.getOutput('agent_001');
      expect(output?.stdout).toHaveLength(1000);
      // First 200 lines should be dropped (FIFO)
      expect(output?.stdout[0]).toBe('Line 201');
      expect(output?.stdout[999]).toBe('Line 1200');
    });

    it('should parse READY status marker', async () => {
      const promise = new Promise<void>((resolve) => {
        manager.on('status-marker', (agentId, marker, line) => {
          expect(agentId).toBe('agent_001');
          expect(marker).toBe('READY');
          expect(line).toContain('[APM_STATUS:READY]');
          resolve();
        });
      });

      manager.captureOutput('agent_001', 'stdout', 'Agent ready [APM_STATUS:READY]\n');

      await promise;
    });

    it('should parse ERROR status marker', async () => {
      const promise = new Promise<void>((resolve) => {
        manager.on('status-marker', (agentId, marker, line) => {
          expect(agentId).toBe('agent_001');
          expect(marker).toBe('ERROR');
          expect(line).toContain('[APM_STATUS:ERROR]');
          resolve();
        });
      });

      manager.captureOutput('agent_001', 'stderr', 'Error occurred [APM_STATUS:ERROR]\n');

      await promise;
    });

    it('should parse COMPLETE status marker', async () => {
      const promise = new Promise<void>((resolve) => {
        manager.on('status-marker', (agentId, marker, line) => {
          expect(agentId).toBe('agent_001');
          expect(marker).toBe('COMPLETE');
          resolve();
        });
      });

      manager.captureOutput('agent_001', 'stdout', 'Task complete [APM_STATUS:COMPLETE]\n');

      await promise;
    });

    it('should parse BLOCKED status marker', async () => {
      const promise = new Promise<void>((resolve) => {
        manager.on('status-marker', (agentId, marker, line) => {
          expect(agentId).toBe('agent_001');
          expect(marker).toBe('BLOCKED');
          resolve();
        });
      });

      manager.captureOutput('agent_001', 'stdout', 'Task blocked [APM_STATUS:BLOCKED]\n');

      await promise;
    });

    it('should emit process-output event', () => {
      const outputSpy = vi.fn();
      manager.on('process-output', outputSpy);

      manager.captureOutput('agent_001', 'stdout', 'Test output\n');

      expect(outputSpy).toHaveBeenCalledWith('agent_001', 'stdout', 'Test output\n');
    });

    it('should handle non-existent agentId gracefully', () => {
      expect(() => {
        manager.captureOutput('nonexistent', 'stdout', 'Test\n');
      }).not.toThrow();
    });
  });

  describe('getOutput()', () => {
    beforeEach(() => {
      mockProcess.pid = 12345;
      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);
    });

    it('should return buffered output', () => {
      manager.captureOutput('agent_001', 'stdout', 'stdout line 1\n');
      manager.captureOutput('agent_001', 'stderr', 'stderr line 1\n');

      const output = manager.getOutput('agent_001');

      expect(output?.stdout).toEqual(['stdout line 1']);
      expect(output?.stderr).toEqual(['stderr line 1']);
    });

    it('should return copy of buffered arrays', () => {
      manager.captureOutput('agent_001', 'stdout', 'Line 1\n');

      const output1 = manager.getOutput('agent_001');
      const output2 = manager.getOutput('agent_001');

      // Should be equal but not same reference
      expect(output1?.stdout).toEqual(output2?.stdout);
      expect(output1?.stdout).not.toBe(output2?.stdout);
    });

    it('should return undefined for non-existent agentId', () => {
      const output = manager.getOutput('nonexistent');
      expect(output).toBeUndefined();
    });
  });

  describe('terminateProcess()', () => {
    beforeEach(() => {
      mockProcess.pid = 12345;
      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);
    });

    it('should send SIGTERM to process', async () => {
      const killSpy = vi.spyOn(mockProcess, 'kill');

      // Simulate immediate exit
      setTimeout(() => mockProcess.emit('exit', 0, 'SIGTERM'), 10);

      await manager.terminateProcess('agent_001', 1000);

      expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    });

    it('should wait for graceful exit', async () => {
      const killSpy = vi.spyOn(mockProcess, 'kill');

      // Simulate delayed exit
      setTimeout(() => mockProcess.emit('exit', 0, 'SIGTERM'), 100);

      const startTime = Date.now();
      await manager.terminateProcess('agent_001', 1000);
      const duration = Date.now() - startTime;

      expect(duration).toBeGreaterThanOrEqual(90);
      expect(killSpy).toHaveBeenCalledWith('SIGTERM');
      expect(killSpy).not.toHaveBeenCalledWith('SIGKILL');
    });

    it('should send SIGKILL if timeout exceeded', async () => {
      const killSpy = vi.spyOn(mockProcess, 'kill');
      mockProcess.killed = false;

      // Don't emit exit event (simulate hanging process)
      const terminatePromise = manager.terminateProcess('agent_001', 100);

      // Wait for timeout and force kill
      await new Promise(resolve => setTimeout(resolve, 150));
      mockProcess.emit('exit', null, 'SIGKILL');

      await terminatePromise;

      expect(killSpy).toHaveBeenCalledWith('SIGTERM');
      expect(killSpy).toHaveBeenCalledWith('SIGKILL');
    });

    it('should resolve immediately if process already exited', async () => {
      // Simulate already exited process
      mockProcess.exitCode = 0;

      await manager.terminateProcess('agent_001', 1000);

      // Should complete without hanging
      expect(mockProcess.kill).not.toHaveBeenCalled();
    });

    it('should resolve immediately if process already killed', async () => {
      mockProcess.killed = true;

      await manager.terminateProcess('agent_001', 1000);

      expect(mockProcess.kill).not.toHaveBeenCalled();
    });

    it('should throw error for non-existent agentId', async () => {
      await expect(manager.terminateProcess('nonexistent')).rejects.toThrow('not found');
    });

    it('should handle kill failure gracefully', async () => {
      vi.spyOn(mockProcess, 'kill').mockReturnValue(false);

      // Should not throw
      await manager.terminateProcess('agent_001', 1000);
    });
  });

  describe('isRunning()', () => {
    it('should return true for running process', () => {
      mockProcess.pid = 12345;
      mockProcess.killed = false;
      mockProcess.exitCode = null;

      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);

      expect(manager.isRunning('agent_001')).toBe(true);
    });

    it('should return false for killed process', () => {
      mockProcess.pid = 12345;
      mockProcess.killed = true;

      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);

      expect(manager.isRunning('agent_001')).toBe(false);
    });

    it('should return false for exited process', () => {
      mockProcess.pid = 12345;
      mockProcess.exitCode = 0;

      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);

      expect(manager.isRunning('agent_001')).toBe(false);
    });

    it('should return false for non-existent agentId', () => {
      expect(manager.isRunning('nonexistent')).toBe(false);
    });

    it('should return false after process exits', () => {
      mockProcess.pid = 12345;
      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);

      expect(manager.isRunning('agent_001')).toBe(true);

      // Simulate process exit
      mockProcess.exitCode = 0;
      mockProcess.emit('exit', 0, null);

      expect(manager.isRunning('agent_001')).toBe(false);
    });
  });

  describe('getActiveProcesses()', () => {
    it('should return empty array when no processes registered', () => {
      const active = manager.getActiveProcesses();
      expect(active).toEqual([]);
    });

    it('should return all active processes', () => {
      const proc1 = createMockProcess();
      proc1.pid = 111;
      const proc2 = createMockProcess();
      proc2.pid = 222;
      const proc3 = createMockProcess();
      proc3.pid = 333;

      manager.registerProcess('agent_001', proc1 as unknown as ChildProcess);
      manager.registerProcess('agent_002', proc2 as unknown as ChildProcess);
      manager.registerProcess('agent_003', proc3 as unknown as ChildProcess);

      const active = manager.getActiveProcesses();

      expect(active).toHaveLength(3);
      expect(active.map(p => p.agentId)).toContain('agent_001');
      expect(active.map(p => p.agentId)).toContain('agent_002');
      expect(active.map(p => p.agentId)).toContain('agent_003');
    });

    it('should exclude exited processes', () => {
      const proc1 = createMockProcess();
      proc1.pid = 111;
      const proc2 = createMockProcess();
      proc2.pid = 222;
      proc2.exitCode = 0;

      manager.registerProcess('agent_001', proc1 as unknown as ChildProcess);
      manager.registerProcess('agent_002', proc2 as unknown as ChildProcess);

      const active = manager.getActiveProcesses();

      expect(active).toHaveLength(1);
      expect(active[0].agentId).toBe('agent_001');
    });

    it('should exclude killed processes', () => {
      const proc1 = createMockProcess();
      proc1.pid = 111;
      const proc2 = createMockProcess();
      proc2.pid = 222;
      proc2.killed = true;

      manager.registerProcess('agent_001', proc1 as unknown as ChildProcess);
      manager.registerProcess('agent_002', proc2 as unknown as ChildProcess);

      const active = manager.getActiveProcesses();

      expect(active).toHaveLength(1);
      expect(active[0].agentId).toBe('agent_001');
    });
  });

  describe('getProcessInfo()', () => {
    it('should return process info for registered process', () => {
      mockProcess.pid = 12345;
      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);

      const info = manager.getProcessInfo('agent_001');

      expect(info).toBeDefined();
      expect(info?.agentId).toBe('agent_001');
      expect(info?.pid).toBe(12345);
      expect(info?.status).toBe(ProcessStatus.Running);
    });

    it('should return undefined for non-existent agentId', () => {
      const info = manager.getProcessInfo('nonexistent');
      expect(info).toBeUndefined();
    });

    it('should return copy of process info', () => {
      mockProcess.pid = 12345;
      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);

      const info1 = manager.getProcessInfo('agent_001');
      const info2 = manager.getProcessInfo('agent_001');

      expect(info1).toEqual(info2);
      expect(info1).not.toBe(info2);
    });
  });

  describe('exit handling', () => {
    beforeEach(() => {
      mockProcess.pid = 12345;
      manager.registerProcess('agent_001', mockProcess as unknown as ChildProcess);
    });

    it('should update status to Exited on successful exit', () => {
      mockProcess.emit('exit', 0, null);

      const info = manager.getProcessInfo('agent_001');
      expect(info?.status).toBe(ProcessStatus.Exited);
      expect(info?.exitCode).toBe(0);
    });

    it('should update status to Failed on non-zero exit', () => {
      mockProcess.emit('exit', 1, null);

      const info = manager.getProcessInfo('agent_001');
      expect(info?.status).toBe(ProcessStatus.Failed);
      expect(info?.exitCode).toBe(1);
    });

    it('should record exit signal', () => {
      mockProcess.emit('exit', null, 'SIGTERM');

      const info = manager.getProcessInfo('agent_001');
      expect(info?.exitSignal).toBe('SIGTERM');
    });

    it('should cleanup process after delay', async () => {
      mockProcess.emit('exit', 0, null);

      // Should still exist immediately
      expect(manager.getProcessInfo('agent_001')).toBeDefined();

      // Wait for cleanup delay
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be cleaned up
      expect(manager.getProcessInfo('agent_001')).toBeUndefined();
    });
  });
});

/**
 * Mock ChildProcess
 */
interface MockChildProcess extends EventEmitter {
  pid?: number;
  killed: boolean;
  exitCode: number | null;
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
  proc.exitCode = null;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = new EventEmitter();
  proc.kill = vi.fn().mockReturnValue(true);
  return proc;
}
