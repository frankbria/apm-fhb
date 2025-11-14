/**
 * Completion Poller
 *
 * System-wide memory file polling monitoring task memory logs for completion updates.
 * Integrates with MemoryFileWatcher for file change events and implements adaptive polling
 * intervals based on task state (active, queued, completed).
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import matter from 'gray-matter';
import { MemoryFileWatcher, FileEvent, FileEventType } from '../monitoring/file-watcher';

/**
 * Polling state for tasks
 */
export enum PollingState {
  Active = 'active',
  Queued = 'queued',
  Completed = 'completed',
}

/**
 * Polling configuration
 */
export interface PollingConfig {
  /** Polling interval for active tasks (ms) */
  activeTaskInterval?: number;
  /** Polling interval for queued tasks (ms) */
  queuedTaskInterval?: number;
  /** Polling interval for completed tasks (ms) */
  completedTaskInterval?: number;
  /** Maximum retry attempts for errors */
  maxRetries?: number;
  /** Retry delay sequence (exponential backoff) */
  retryDelays?: number[];
}

/**
 * Task polling state tracking
 */
export interface TaskPollingState {
  /** Task ID */
  taskId: string;
  /** Memory log path */
  memoryLogPath: string;
  /** Last poll timestamp */
  lastPollTime?: Date;
  /** Last detected state */
  lastDetectedState?: string;
  /** Total poll count */
  pollCount: number;
  /** Consecutive unchanged polls */
  consecutiveUnchangedPolls: number;
  /** Polling interval (ms) */
  pollingInterval: number;
  /** Is paused */
  isPaused: boolean;
  /** Current retry attempt */
  retryAttempt: number;
}

/**
 * Completion Poller
 * Polls memory files for completion markers and integrates with MemoryFileWatcher
 */
export class CompletionPoller extends EventEmitter {
  private readonly config: Required<PollingConfig>;
  private readonly watcher: MemoryFileWatcher;
  private readonly pollingStates: Map<string, TaskPollingState>;
  private readonly pollingTimers: Map<string, NodeJS.Timeout>;
  private isGloballyPaused: boolean = false;

  constructor(watcher: MemoryFileWatcher, config: PollingConfig = {}) {
    super();

    this.watcher = watcher;
    this.config = {
      activeTaskInterval: config.activeTaskInterval ?? 1000,
      queuedTaskInterval: config.queuedTaskInterval ?? 5000,
      completedTaskInterval: config.completedTaskInterval ?? 30000,
      maxRetries: config.maxRetries ?? 3,
      retryDelays: config.retryDelays ?? [1000, 2000, 4000],
    };

    this.pollingStates = new Map();
    this.pollingTimers = new Map();

    // Subscribe to file-event from MemoryFileWatcher
    this.setupWatcherIntegration();
  }

  /**
   * Setup integration with MemoryFileWatcher
   */
  private setupWatcherIntegration(): void {
    this.watcher.on('file-event', (event: FileEvent) => {
      // Only process .md files (memory logs)
      if (!event.filePath.endsWith('.md')) {
        return;
      }

      // Emit file_detected event
      this.emit('file_detected', {
        eventType: event.eventType,
        filePath: event.filePath,
        timestamp: event.timestamp,
      });

      // If task is being tracked, reset consecutive unchanged polls
      const taskId = this.findTaskIdByPath(event.filePath);
      if (taskId) {
        const state = this.pollingStates.get(taskId);
        if (state && event.eventType === FileEventType.CHANGE) {
          state.consecutiveUnchangedPolls = 0;
        }
      }
    });
  }

  /**
   * Find task ID by memory log path
   */
  private findTaskIdByPath(filePath: string): string | undefined {
    for (const [taskId, state] of this.pollingStates.entries()) {
      if (state.memoryLogPath === filePath) {
        return taskId;
      }
    }
    return undefined;
  }

  /**
   * Start polling for a task
   *
   * @param taskId - Task ID
   * @param memoryLogPath - Memory log path
   * @param pollingState - Polling state (active, queued, completed)
   */
  startPolling(taskId: string, memoryLogPath: string, pollingState: PollingState): void {
    // Stop existing polling if present
    this.stopPolling(taskId);

    // Determine polling interval based on state
    let pollingInterval: number;
    switch (pollingState) {
      case PollingState.Active:
        pollingInterval = this.config.activeTaskInterval;
        break;
      case PollingState.Queued:
        pollingInterval = this.config.queuedTaskInterval;
        break;
      case PollingState.Completed:
        pollingInterval = this.config.completedTaskInterval;
        break;
      default:
        pollingInterval = this.config.activeTaskInterval;
    }

    // Initialize polling state
    const state: TaskPollingState = {
      taskId,
      memoryLogPath,
      pollCount: 0,
      consecutiveUnchangedPolls: 0,
      pollingInterval,
      isPaused: false,
      retryAttempt: 0,
    };

    this.pollingStates.set(taskId, state);

    // Start polling timer
    this.scheduleNextPoll(taskId);
  }

  /**
   * Schedule next poll for task
   */
  private scheduleNextPoll(taskId: string): void {
    const state = this.pollingStates.get(taskId);
    if (!state) {
      return;
    }

    // Clear existing timer
    const existingTimer = this.pollingTimers.get(taskId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule next poll
    const timer = setTimeout(async () => {
      await this.performPoll(taskId);
    }, state.pollingInterval);

    this.pollingTimers.set(taskId, timer);
  }

  /**
   * Perform poll for task
   */
  private async performPoll(taskId: string): Promise<void> {
    const state = this.pollingStates.get(taskId);
    if (!state) {
      return;
    }

    // Skip if paused
    if (state.isPaused || this.isGloballyPaused) {
      this.scheduleNextPoll(taskId);
      return;
    }

    // Emit poll_started event
    this.emit('poll_started', {
      taskId,
      memoryLogPath: state.memoryLogPath,
      timestamp: new Date(),
    });

    try {
      // Read and parse memory log
      const content = await fs.readFile(state.memoryLogPath, 'utf-8');
      const parsed = matter(content);
      const currentState = parsed.data.status as string;

      // Update last poll time
      state.lastPollTime = new Date();
      state.pollCount++;

      // Check if state changed
      if (state.lastDetectedState && state.lastDetectedState !== currentState) {
        // State changed
        this.emit('state_detected', {
          taskId,
          state: currentState,
          changedFrom: state.lastDetectedState,
          timestamp: new Date(),
        });

        // Reset consecutive unchanged polls
        state.consecutiveUnchangedPolls = 0;

        // Adapt polling interval if needed
        if (currentState === 'Completed') {
          state.pollingInterval = this.config.completedTaskInterval;
        }
      } else if (state.lastDetectedState === currentState) {
        // State unchanged
        state.consecutiveUnchangedPolls++;
      }

      // Update last detected state
      state.lastDetectedState = currentState;

      // Reset retry attempt on success
      state.retryAttempt = 0;

      // If first poll and state is InProgress, emit state_detected
      if (state.pollCount === 1 && currentState) {
        this.emit('state_detected', {
          taskId,
          state: currentState,
          changedFrom: null,
          timestamp: new Date(),
        });
      }

      // Schedule next poll
      this.scheduleNextPoll(taskId);
    } catch (error) {
      // Handle error with retry logic
      await this.handlePollError(taskId, error);
    }
  }

  /**
   * Handle poll error with retry logic
   */
  private async handlePollError(taskId: string, error: unknown): Promise<void> {
    const state = this.pollingStates.get(taskId);
    if (!state) {
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    state.retryAttempt++;

    // Emit poll_error event
    this.emit('poll_error', {
      taskId,
      error: errorMessage,
      retryAttempt: state.retryAttempt,
      timestamp: new Date(),
    });

    // Check if we should retry
    if (state.retryAttempt <= this.config.maxRetries) {
      // Get retry delay (exponential backoff)
      const delayIndex = Math.min(state.retryAttempt - 1, this.config.retryDelays.length - 1);
      const retryDelay = this.config.retryDelays[delayIndex];

      // Schedule retry
      const timer = setTimeout(async () => {
        await this.performPoll(taskId);
      }, retryDelay);

      this.pollingTimers.set(taskId, timer);
    } else {
      // Max retries exceeded, continue polling at normal interval
      state.retryAttempt = 0;
      this.scheduleNextPoll(taskId);
    }
  }

  /**
   * Stop polling for specific task
   *
   * @param taskId - Task ID
   */
  stopPolling(taskId: string): void {
    // Clear timer
    const timer = this.pollingTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.pollingTimers.delete(taskId);
    }

    // Remove state
    this.pollingStates.delete(taskId);
  }

  /**
   * Stop all polling
   */
  stopAllPolling(): void {
    // Clear all timers
    for (const timer of this.pollingTimers.values()) {
      clearTimeout(timer);
    }
    this.pollingTimers.clear();

    // Clear all states
    this.pollingStates.clear();

    // Reset global pause
    this.isGloballyPaused = false;
  }

  /**
   * Pause polling for specific task
   *
   * @param taskId - Task ID
   */
  pausePolling(taskId: string): void {
    const state = this.pollingStates.get(taskId);
    if (state) {
      state.isPaused = true;
    }
  }

  /**
   * Resume polling for specific task
   *
   * @param taskId - Task ID
   */
  resumePolling(taskId: string): void {
    const state = this.pollingStates.get(taskId);
    if (state) {
      state.isPaused = false;
    }
  }

  /**
   * Pause all polling
   */
  pauseAllPolling(): void {
    this.isGloballyPaused = true;
  }

  /**
   * Resume all polling
   */
  resumeAllPolling(): void {
    this.isGloballyPaused = false;
  }

  /**
   * Get polling state for task
   *
   * @param taskId - Task ID
   * @returns Task polling state or undefined
   */
  getPollingState(taskId: string): TaskPollingState | undefined {
    return this.pollingStates.get(taskId);
  }

  /**
   * Get all polling states
   *
   * @returns Map of task IDs to polling states
   */
  getAllPollingStates(): Map<string, TaskPollingState> {
    return new Map(this.pollingStates);
  }
}

/**
 * Create a CompletionPoller instance
 *
 * @param watcher - MemoryFileWatcher instance
 * @param config - Polling configuration
 * @returns CompletionPoller instance
 */
export function createCompletionPoller(
  watcher: MemoryFileWatcher,
  config?: PollingConfig
): CompletionPoller {
  return new CompletionPoller(watcher, config);
}
