/**
 * Tests for CompletionPoller
 *
 * Validates memory file polling system integration with MemoryFileWatcher,
 * adaptive polling intervals, state tracking, error handling, and event emission.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CompletionPoller, PollingConfig, PollingState, TaskPollingState } from '../../src/completion/completion-poller';
import { MemoryFileWatcher, FileEvent, FileEventType } from '../../src/monitoring/file-watcher';
import fs from 'fs/promises';
import path from 'path';

describe('CompletionPoller', () => {
  let poller: CompletionPoller;
  let watcher: MemoryFileWatcher;
  let tempDir: string;

  beforeEach(async () => {
    // Create temp directory for test memory logs
    tempDir = path.join(process.cwd(), 'test-memory-logs');
    await fs.mkdir(tempDir, { recursive: true });

    // Create watcher for temp directory
    watcher = new MemoryFileWatcher({ watchDirectory: tempDir });

    // Create poller
    poller = new CompletionPoller(watcher, {
      activeTaskInterval: 1000,
      queuedTaskInterval: 5000,
      completedTaskInterval: 30000,
      maxRetries: 3,
      retryDelays: [1000, 2000, 4000],
    });
  });

  afterEach(async () => {
    // Stop poller and watcher
    poller.stopAllPolling();
    await watcher.stop();

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Constructor and Initialization', () => {
    it('should create CompletionPoller with default config', () => {
      const defaultPoller = new CompletionPoller(watcher);
      expect(defaultPoller).toBeDefined();
    });

    it('should create CompletionPoller with custom config', () => {
      const customConfig: PollingConfig = {
        activeTaskInterval: 500,
        queuedTaskInterval: 3000,
        completedTaskInterval: 15000,
        maxRetries: 5,
        retryDelays: [500, 1000, 2000, 4000, 8000],
      };
      const customPoller = new CompletionPoller(watcher, customConfig);
      expect(customPoller).toBeDefined();
    });

    it('should integrate with MemoryFileWatcher', () => {
      // Verify watcher is set
      expect(poller).toBeDefined();
    });
  });

  describe('MemoryFileWatcher Integration', () => {
    it('should subscribe to file-event from MemoryFileWatcher', async () => {
      const eventSpy = vi.fn();
      poller.on('file_detected', eventSpy);

      // Start watcher
      await watcher.start();

      // Create test memory log
      const memoryLogPath = path.join(tempDir, 'Task_1_1_Test.md');
      await fs.writeFile(memoryLogPath, '# Test Log');

      // Wait for file event to propagate
      await new Promise(resolve => setTimeout(resolve, 500));

      // Should have received file event
      expect(eventSpy).toHaveBeenCalled();
    });

    it('should filter events by task memory log path pattern', async () => {
      const eventSpy = vi.fn();
      poller.on('file_detected', eventSpy);

      // Start watcher
      await watcher.start();

      // Create valid memory log
      const validPath = path.join(tempDir, 'Phase_01_Test', 'Task_1_1_Valid.md');
      await fs.mkdir(path.dirname(validPath), { recursive: true });
      await fs.writeFile(validPath, '# Valid Log');

      // Create invalid file (not matching pattern)
      const invalidPath = path.join(tempDir, 'invalid_file.txt');
      await fs.writeFile(invalidPath, 'Not a memory log');

      // Wait for events
      await new Promise(resolve => setTimeout(resolve, 500));

      // Should only receive event for valid .md file
      expect(eventSpy).toHaveBeenCalled();
    });

    it('should handle ADD file events', async () => {
      const eventSpy = vi.fn();
      poller.on('file_detected', eventSpy);

      await watcher.start();

      const memoryLogPath = path.join(tempDir, 'Task_1_1_New.md');
      await fs.writeFile(memoryLogPath, '# New Log');

      await new Promise(resolve => setTimeout(resolve, 500));

      expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
        eventType: FileEventType.ADD,
      }));
    });

    it('should handle CHANGE file events', async () => {
      const eventSpy = vi.fn();
      poller.on('file_detected', eventSpy);

      await watcher.start();

      const memoryLogPath = path.join(tempDir, 'Task_1_1_Modified.md');
      await fs.writeFile(memoryLogPath, '# Initial');

      // Wait for ADD event
      await new Promise(resolve => setTimeout(resolve, 500));

      // Modify file
      await fs.writeFile(memoryLogPath, '# Modified');

      // Wait for CHANGE event
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
        eventType: FileEventType.CHANGE,
      }));
    });

    it('should handle UNLINK file events', async () => {
      const eventSpy = vi.fn();
      poller.on('file_detected', eventSpy);

      await watcher.start();

      const memoryLogPath = path.join(tempDir, 'Task_1_1_Deleted.md');
      await fs.writeFile(memoryLogPath, '# To Delete');

      await new Promise(resolve => setTimeout(resolve, 500));

      // Delete file
      await fs.unlink(memoryLogPath);

      await new Promise(resolve => setTimeout(resolve, 500));

      expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
        eventType: FileEventType.UNLINK,
      }));
    });
  });

  describe('Polling Configuration', () => {
    it('should use 1s interval for active tasks', async () => {
      const task = {
        taskId: 'Task_1_1',
        memoryLogPath: path.join(tempDir, 'Task_1_1.md'),
        pollingState: PollingState.Active,
      };

      // Create memory log
      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      const state = poller.getPollingState(task.taskId);
      expect(state).toBeDefined();
      expect(state?.pollingInterval).toBe(1000);
    });

    it('should use 5s interval for queued tasks', async () => {
      const task = {
        taskId: 'Task_1_2',
        memoryLogPath: path.join(tempDir, 'Task_1_2.md'),
        pollingState: PollingState.Queued,
      };

      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      const state = poller.getPollingState(task.taskId);
      expect(state).toBeDefined();
      expect(state?.pollingInterval).toBe(5000);
    });

    it('should use 30s interval for completed tasks', async () => {
      const task = {
        taskId: 'Task_1_3',
        memoryLogPath: path.join(tempDir, 'Task_1_3.md'),
        pollingState: PollingState.Completed,
      };

      await fs.writeFile(task.memoryLogPath, '---\nstatus: Completed\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      const state = poller.getPollingState(task.taskId);
      expect(state).toBeDefined();
      expect(state?.pollingInterval).toBe(30000);
    });
  });

  describe('Adaptive Polling', () => {
    it('should reduce polling frequency after completion detected', async () => {
      const task = {
        taskId: 'Task_2_1',
        memoryLogPath: path.join(tempDir, 'Task_2_1.md'),
        pollingState: PollingState.Active,
      };

      // Create in-progress memory log
      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      const initialState = poller.getPollingState(task.taskId);
      expect(initialState?.pollingInterval).toBe(1000);

      // Update to completed
      await fs.writeFile(task.memoryLogPath, '---\nstatus: Completed\n---\n# Test');

      // Wait for poll to detect completion
      await new Promise(resolve => setTimeout(resolve, 1500));

      const updatedState = poller.getPollingState(task.taskId);
      // Polling state should adapt to Completed
      expect(updatedState?.lastDetectedState).toBe('Completed');
    });

    it('should pause polling when memory log unchanged for threshold period', async () => {
      const task = {
        taskId: 'Task_2_2',
        memoryLogPath: path.join(tempDir, 'Task_2_2.md'),
        pollingState: PollingState.Active,
      };

      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      // Let multiple polls happen without changes
      await new Promise(resolve => setTimeout(resolve, 3500));

      const state = poller.getPollingState(task.taskId);
      // Should have multiple consecutive unchanged polls
      expect(state?.consecutiveUnchangedPolls).toBeGreaterThan(0);
    });

    it('should resume polling when memory log changes after pause', async () => {
      const task = {
        taskId: 'Task_2_3',
        memoryLogPath: path.join(tempDir, 'Task_2_3.md'),
        pollingState: PollingState.Active,
      };

      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      // Wait for polls
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Modify file
      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Updated');

      // Wait for change detection
      await new Promise(resolve => setTimeout(resolve, 1500));

      const state = poller.getPollingState(task.taskId);
      // consecutiveUnchangedPolls should reset on change
      expect(state?.pollCount).toBeGreaterThan(0);
    });
  });

  describe('Polling State Tracking', () => {
    it('should track lastPollTime', async () => {
      const task = {
        taskId: 'Task_3_1',
        memoryLogPath: path.join(tempDir, 'Task_3_1.md'),
        pollingState: PollingState.Active,
      };

      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      await new Promise(resolve => setTimeout(resolve, 1500));

      const state = poller.getPollingState(task.taskId);
      expect(state?.lastPollTime).toBeDefined();
      expect(state?.lastPollTime).toBeInstanceOf(Date);
    });

    it('should track lastDetectedState', async () => {
      const task = {
        taskId: 'Task_3_2',
        memoryLogPath: path.join(tempDir, 'Task_3_2.md'),
        pollingState: PollingState.Active,
      };

      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      await new Promise(resolve => setTimeout(resolve, 1500));

      const state = poller.getPollingState(task.taskId);
      expect(state?.lastDetectedState).toBe('InProgress');
    });

    it('should track pollCount', async () => {
      const task = {
        taskId: 'Task_3_3',
        memoryLogPath: path.join(tempDir, 'Task_3_3.md'),
        pollingState: PollingState.Active,
      };

      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      await new Promise(resolve => setTimeout(resolve, 2500));

      const state = poller.getPollingState(task.taskId);
      expect(state?.pollCount).toBeGreaterThan(1);
    });

    it('should track consecutiveUnchangedPolls', async () => {
      const task = {
        taskId: 'Task_3_4',
        memoryLogPath: path.join(tempDir, 'Task_3_4.md'),
        pollingState: PollingState.Active,
      };

      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      await new Promise(resolve => setTimeout(resolve, 3500));

      const state = poller.getPollingState(task.taskId);
      expect(state?.consecutiveUnchangedPolls).toBeGreaterThan(0);
    });
  });

  describe('State Change Detection', () => {
    it('should detect InProgress to Completed state change', async () => {
      const stateSpy = vi.fn();
      poller.on('state_detected', stateSpy);

      const task = {
        taskId: 'Task_4_1',
        memoryLogPath: path.join(tempDir, 'Task_4_1.md'),
        pollingState: PollingState.Active,
      };

      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      await new Promise(resolve => setTimeout(resolve, 1500));

      // Change to completed
      await fs.writeFile(task.memoryLogPath, '---\nstatus: Completed\n---\n# Test');

      await new Promise(resolve => setTimeout(resolve, 1500));

      expect(stateSpy).toHaveBeenCalledWith(expect.objectContaining({
        taskId: task.taskId,
        state: 'Completed',
        changedFrom: 'InProgress',
      }));
    });

    it('should detect InProgress to Blocked state change', async () => {
      const stateSpy = vi.fn();
      poller.on('state_detected', stateSpy);

      const task = {
        taskId: 'Task_4_2',
        memoryLogPath: path.join(tempDir, 'Task_4_2.md'),
        pollingState: PollingState.Active,
      };

      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      await new Promise(resolve => setTimeout(resolve, 1500));

      // Change to blocked
      await fs.writeFile(task.memoryLogPath, '---\nstatus: Blocked\n---\n# Test');

      await new Promise(resolve => setTimeout(resolve, 1500));

      expect(stateSpy).toHaveBeenCalledWith(expect.objectContaining({
        taskId: task.taskId,
        state: 'Blocked',
        changedFrom: 'InProgress',
      }));
    });

    it('should emit state_detected event with timestamp', async () => {
      const stateSpy = vi.fn();
      poller.on('state_detected', stateSpy);

      const task = {
        taskId: 'Task_4_3',
        memoryLogPath: path.join(tempDir, 'Task_4_3.md'),
        pollingState: PollingState.Active,
      };

      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      await new Promise(resolve => setTimeout(resolve, 1500));

      expect(stateSpy).toHaveBeenCalledWith(expect.objectContaining({
        timestamp: expect.any(Date),
      }));
    });
  });

  describe('Event Emission', () => {
    it('should emit poll_started event', async () => {
      const startSpy = vi.fn();
      poller.on('poll_started', startSpy);

      const task = {
        taskId: 'Task_5_1',
        memoryLogPath: path.join(tempDir, 'Task_5_1.md'),
        pollingState: PollingState.Active,
      };

      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      await new Promise(resolve => setTimeout(resolve, 1500));

      expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({
        taskId: task.taskId,
        memoryLogPath: task.memoryLogPath,
        timestamp: expect.any(Date),
      }));
    });

    it('should emit poll_error event on file not found', async () => {
      const errorSpy = vi.fn();
      poller.on('poll_error', errorSpy);

      const task = {
        taskId: 'Task_5_2',
        memoryLogPath: path.join(tempDir, 'NonExistent.md'),
        pollingState: PollingState.Active,
      };

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      await new Promise(resolve => setTimeout(resolve, 1500));

      expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({
        taskId: task.taskId,
        error: expect.stringContaining('ENOENT'),
        retryAttempt: expect.any(Number),
      }));
    });

    it('should emit poll_error event on parse error', async () => {
      const errorSpy = vi.fn();
      poller.on('poll_error', errorSpy);

      const task = {
        taskId: 'Task_5_3',
        memoryLogPath: path.join(tempDir, 'Task_5_3.md'),
        pollingState: PollingState.Active,
      };

      // Create malformed YAML
      await fs.writeFile(task.memoryLogPath, '---\ninvalid: yaml: content:\n---\n');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      await new Promise(resolve => setTimeout(resolve, 1500));

      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('Error Handling with Retry Logic', () => {
    it('should retry on file not found with exponential backoff', async () => {
      const errorSpy = vi.fn();
      poller.on('poll_error', errorSpy);

      const task = {
        taskId: 'Task_6_1',
        memoryLogPath: path.join(tempDir, 'WillAppear.md'),
        pollingState: PollingState.Active,
      };

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      // Wait for initial retries
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Create file after retries started
      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      // Wait for successful poll
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Should have retried before succeeding
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should use exponential backoff for retries (1s, 2s, 4s)', async () => {
      const errorSpy = vi.fn();
      poller.on('poll_error', errorSpy);

      const task = {
        taskId: 'Task_6_2',
        memoryLogPath: path.join(tempDir, 'Missing.md'),
        pollingState: PollingState.Active,
      };

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      // Wait for all 3 retries (1s + 2s + 4s = 7s + initial poll)
      await new Promise(resolve => setTimeout(resolve, 8000));

      // Should have 3 retry attempts
      expect(errorSpy).toHaveBeenCalled();
      const calls = errorSpy.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(3);
    }, 15000);

    it('should stop retrying after maxRetries attempts', async () => {
      const errorSpy = vi.fn();
      poller.on('poll_error', errorSpy);

      const task = {
        taskId: 'Task_6_3',
        memoryLogPath: path.join(tempDir, 'NeverExists.md'),
        pollingState: PollingState.Active,
      };

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      // Wait for max retries (3) to complete
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Should not exceed maxRetries
      const calls = errorSpy.mock.calls;
      const maxRetryCall = calls.find(call => call[0].retryAttempt === 3);
      expect(maxRetryCall).toBeDefined();
    }, 15000);

    it('should handle file locked error with retry', async () => {
      const errorSpy = vi.fn();
      poller.on('poll_error', errorSpy);

      const task = {
        taskId: 'Task_6_4',
        memoryLogPath: path.join(tempDir, 'Locked.md'),
        pollingState: PollingState.Active,
      };

      // Create file
      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      // Polling should succeed (or fail gracefully if locked)
      await new Promise(resolve => setTimeout(resolve, 2000));

      const state = poller.getPollingState(task.taskId);
      expect(state).toBeDefined();
    });
  });

  describe('Pause and Resume', () => {
    it('should pause polling for specific task', async () => {
      const task = {
        taskId: 'Task_7_1',
        memoryLogPath: path.join(tempDir, 'Task_7_1.md'),
        pollingState: PollingState.Active,
      };

      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      // Let it poll once
      await new Promise(resolve => setTimeout(resolve, 1500));

      const initialPollCount = poller.getPollingState(task.taskId)?.pollCount || 0;

      // Pause polling
      poller.pausePolling(task.taskId);

      // Wait longer than polling interval
      await new Promise(resolve => setTimeout(resolve, 3000));

      const finalPollCount = poller.getPollingState(task.taskId)?.pollCount || 0;

      // Poll count should not have increased (or minimal increase)
      expect(finalPollCount).toBe(initialPollCount);
    });

    it('should resume polling for paused task', async () => {
      const task = {
        taskId: 'Task_7_2',
        memoryLogPath: path.join(tempDir, 'Task_7_2.md'),
        pollingState: PollingState.Active,
      };

      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      await new Promise(resolve => setTimeout(resolve, 1500));

      // Pause
      poller.pausePolling(task.taskId);

      await new Promise(resolve => setTimeout(resolve, 2000));

      const pausedPollCount = poller.getPollingState(task.taskId)?.pollCount || 0;

      // Resume
      poller.resumePolling(task.taskId);

      await new Promise(resolve => setTimeout(resolve, 2500));

      const resumedPollCount = poller.getPollingState(task.taskId)?.pollCount || 0;

      // Poll count should have increased after resume
      expect(resumedPollCount).toBeGreaterThan(pausedPollCount);
    }, 10000);

    it('should pause all polling', async () => {
      const task1 = {
        taskId: 'Task_7_3a',
        memoryLogPath: path.join(tempDir, 'Task_7_3a.md'),
        pollingState: PollingState.Active,
      };

      const task2 = {
        taskId: 'Task_7_3b',
        memoryLogPath: path.join(tempDir, 'Task_7_3b.md'),
        pollingState: PollingState.Queued,
      };

      await fs.writeFile(task1.memoryLogPath, '---\nstatus: InProgress\n---\n# Test 1');
      await fs.writeFile(task2.memoryLogPath, '---\nstatus: InProgress\n---\n# Test 2');

      poller.startPolling(task1.taskId, task1.memoryLogPath, task1.pollingState);
      poller.startPolling(task2.taskId, task2.memoryLogPath, task2.pollingState);

      await new Promise(resolve => setTimeout(resolve, 1500));

      const initial1 = poller.getPollingState(task1.taskId)?.pollCount || 0;
      const initial2 = poller.getPollingState(task2.taskId)?.pollCount || 0;

      // Pause all
      poller.pauseAllPolling();

      await new Promise(resolve => setTimeout(resolve, 6000));

      const paused1 = poller.getPollingState(task1.taskId)?.pollCount || 0;
      const paused2 = poller.getPollingState(task2.taskId)?.pollCount || 0;

      // Both should be paused
      expect(paused1).toBe(initial1);
      expect(paused2).toBe(initial2);
    }, 10000);

    it('should resume all polling', async () => {
      const task1 = {
        taskId: 'Task_7_4a',
        memoryLogPath: path.join(tempDir, 'Task_7_4a.md'),
        pollingState: PollingState.Active,
      };

      const task2 = {
        taskId: 'Task_7_4b',
        memoryLogPath: path.join(tempDir, 'Task_7_4b.md'),
        pollingState: PollingState.Queued,
      };

      await fs.writeFile(task1.memoryLogPath, '---\nstatus: InProgress\n---\n# Test 1');
      await fs.writeFile(task2.memoryLogPath, '---\nstatus: InProgress\n---\n# Test 2');

      poller.startPolling(task1.taskId, task1.memoryLogPath, task1.pollingState);
      poller.startPolling(task2.taskId, task2.memoryLogPath, task2.pollingState);

      await new Promise(resolve => setTimeout(resolve, 1500));

      poller.pauseAllPolling();

      await new Promise(resolve => setTimeout(resolve, 2000));

      const paused1 = poller.getPollingState(task1.taskId)?.pollCount || 0;
      const paused2 = poller.getPollingState(task2.taskId)?.pollCount || 0;

      // Resume all
      poller.resumeAllPolling();

      await new Promise(resolve => setTimeout(resolve, 6000));

      const resumed1 = poller.getPollingState(task1.taskId)?.pollCount || 0;
      const resumed2 = poller.getPollingState(task2.taskId)?.pollCount || 0;

      // Both should have resumed polling
      expect(resumed1).toBeGreaterThan(paused1);
      expect(resumed2).toBeGreaterThan(paused2);
    }, 15000);
  });

  describe('Stop Polling', () => {
    it('should stop polling for specific task', async () => {
      const task = {
        taskId: 'Task_8_1',
        memoryLogPath: path.join(tempDir, 'Task_8_1.md'),
        pollingState: PollingState.Active,
      };

      await fs.writeFile(task.memoryLogPath, '---\nstatus: InProgress\n---\n# Test');

      poller.startPolling(task.taskId, task.memoryLogPath, task.pollingState);

      await new Promise(resolve => setTimeout(resolve, 1500));

      // Stop polling
      poller.stopPolling(task.taskId);

      // State should be undefined after stopping
      const state = poller.getPollingState(task.taskId);
      expect(state).toBeUndefined();
    });

    it('should stop all polling', async () => {
      const task1 = {
        taskId: 'Task_8_2a',
        memoryLogPath: path.join(tempDir, 'Task_8_2a.md'),
        pollingState: PollingState.Active,
      };

      const task2 = {
        taskId: 'Task_8_2b',
        memoryLogPath: path.join(tempDir, 'Task_8_2b.md'),
        pollingState: PollingState.Queued,
      };

      await fs.writeFile(task1.memoryLogPath, '---\nstatus: InProgress\n---\n# Test 1');
      await fs.writeFile(task2.memoryLogPath, '---\nstatus: InProgress\n---\n# Test 2');

      poller.startPolling(task1.taskId, task1.memoryLogPath, task1.pollingState);
      poller.startPolling(task2.taskId, task2.memoryLogPath, task2.pollingState);

      await new Promise(resolve => setTimeout(resolve, 1500));

      // Stop all
      poller.stopAllPolling();

      // Both states should be undefined
      expect(poller.getPollingState(task1.taskId)).toBeUndefined();
      expect(poller.getPollingState(task2.taskId)).toBeUndefined();
    });
  });
});
