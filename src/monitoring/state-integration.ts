/**
 * APM State Integration Bridge
 *
 * Bridges file monitoring to state management:
 * - Subscribes to debounced file events
 * - Parses memory logs to extract task status
 * - Emits state update events for lifecycle manager
 * - Maps file changes to state transitions
 * - Implements event ordering guarantees
 * - Handles concurrent events from multiple agents
 * - Provides event replay buffer for debugging
 */

import { EventEmitter } from 'events';
import { FileChangeDebouncer, DebouncedEvent } from './debouncer';
import { MemoryLogParser, ParsedMemoryLog, ParseResult } from './log-parser';
import { TaskStatus } from '../protocol/types';
import { FileEventType } from './file-watcher';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * State update event types
 */
export enum StateUpdateEventType {
  TASK_STARTED = 'task-started',
  TASK_STATUS_CHANGED = 'task-status-changed',
  TASK_COMPLETED = 'task-completed',
  TASK_BLOCKED = 'task-blocked',
  TASK_FAILED = 'task-failed',
}

/**
 * State update event payload
 */
export interface StateUpdateEvent {
  /** Event type */
  type: StateUpdateEventType;
  /** Task ID */
  taskId: string;
  /** Agent ID */
  agentId: string;
  /** Previous status (for status-changed events) */
  previousStatus?: TaskStatus;
  /** New status */
  newStatus: TaskStatus;
  /** Event timestamp */
  timestamp: Date;
  /** Additional metadata */
  metadata: {
    /** Progress percentage */
    progressPercentage?: number;
    /** Blockers */
    blockers?: string[];
    /** Completion timestamp */
    completionTimestamp?: Date;
    /** Important findings flag */
    hasImportantFindings: boolean;
    /** Ad-hoc delegation flag */
    hasAdHocDelegation?: boolean;
    /** Compatibility issues flag */
    hasCompatibilityIssues?: boolean;
    /** File path that triggered update */
    filePath?: string;
  };
}

/**
 * Event queue entry
 */
interface QueuedEvent {
  /** Event */
  event: StateUpdateEvent;
  /** Queue timestamp */
  queuedAt: Date;
}

/**
 * Integration bridge configuration
 */
export interface IntegrationConfig {
  /** Enable event replay buffer */
  enableReplayBuffer?: boolean;
  /** Replay buffer size (default: 100) */
  replayBufferSize?: number;
  /** Enable concurrent agent processing */
  enableConcurrentProcessing?: boolean;
}

// ============================================================================
// StateIntegrationBridge Class
// ============================================================================

/**
 * Bridges file monitoring to state management
 *
 * Connects debounced file events to state update events with ordering guarantees.
 */
export class StateIntegrationBridge extends EventEmitter {
  private readonly config: Required<IntegrationConfig>;
  private readonly parser: MemoryLogParser;

  // Status cache (filePath → previous status)
  private statusCache = new Map<string, TaskStatus>();

  // Event queues per agent (agentId → event queue)
  private agentQueues = new Map<string, QueuedEvent[]>();

  // Processing flags per agent
  private processingFlags = new Map<string, boolean>();

  // Event replay buffer
  private replayBuffer: StateUpdateEvent[] = [];

  /**
   * Create a new state integration bridge
   */
  constructor(config: IntegrationConfig = {}) {
    super();

    this.config = {
      enableReplayBuffer: config.enableReplayBuffer ?? true,
      replayBufferSize: config.replayBufferSize ?? 100,
      enableConcurrentProcessing: config.enableConcurrentProcessing ?? true,
    };

    this.parser = new MemoryLogParser();
  }

  // ==========================================================================
  // Debouncer Integration
  // ==========================================================================

  /**
   * Connect to file change debouncer
   *
   * @param debouncer - File change debouncer instance
   */
  connectToDebouncer(debouncer: FileChangeDebouncer): void {
    debouncer.on('debounced-event', (event: DebouncedEvent) => {
      this.handleDebouncedEvent(event);
    });

    console.log('[StateIntegrationBridge] Connected to debouncer');
  }

  /**
   * Handle debounced file event
   */
  private handleDebouncedEvent(event: DebouncedEvent): void {
    const { eventType, filePath } = event;

    // Parse file
    const parseResult = this.parser.parse(filePath);

    // Handle parse error
    if ('error' in parseResult) {
      console.error(
        '[StateIntegrationBridge] Parse error:',
        parseResult.errorMessage,
        filePath
      );
      return;
    }

    // Map file event to state update
    this.mapFileEventToStateUpdate(eventType, filePath, parseResult);
  }

  // ==========================================================================
  // Event Mapping
  // ==========================================================================

  /**
   * Map file change event to state update event
   */
  private mapFileEventToStateUpdate(
    eventType: FileEventType,
    filePath: string,
    parsed: ParsedMemoryLog
  ): void {
    const { taskId, status, agentId, hasImportantFindings } = parsed;

    // Get previous status from cache
    const previousStatus = this.statusCache.get(filePath);

    // Determine event type
    let updateEventType: StateUpdateEventType;

    if (eventType === FileEventType.ADD) {
      // New memory log created
      updateEventType = StateUpdateEventType.TASK_STARTED;
    } else if (eventType === FileEventType.CHANGE) {
      // Log updated - check for status change
      if (!previousStatus || previousStatus !== status) {
        // Status changed
        if (status === TaskStatus.COMPLETED) {
          updateEventType = StateUpdateEventType.TASK_COMPLETED;
        } else if (status === TaskStatus.BLOCKED) {
          updateEventType = StateUpdateEventType.TASK_BLOCKED;
        } else if (status === TaskStatus.FAILED) {
          updateEventType = StateUpdateEventType.TASK_FAILED;
        } else {
          updateEventType = StateUpdateEventType.TASK_STATUS_CHANGED;
        }
      } else {
        // Status unchanged - don't emit event
        console.log(
          `[StateIntegrationBridge] Status unchanged for ${taskId}, skipping event`
        );
        return;
      }
    } else {
      // UNLINK - file deleted, ignore for state updates
      console.log(
        `[StateIntegrationBridge] File deleted: ${filePath}, ignoring for state updates`
      );
      this.statusCache.delete(filePath);
      return;
    }

    // Update status cache
    this.statusCache.set(filePath, status);

    // Create state update event
    const stateEvent: StateUpdateEvent = {
      type: updateEventType,
      taskId,
      agentId: agentId || 'unknown',
      previousStatus,
      newStatus: status,
      timestamp: new Date(),
      metadata: {
        progressPercentage: parsed.progressPercentage,
        blockers: parsed.blockers,
        completionTimestamp: parsed.completionTimestamp,
        hasImportantFindings,
        hasAdHocDelegation: parsed.hasAdHocDelegation,
        hasCompatibilityIssues: parsed.hasCompatibilityIssues,
        filePath,
      },
    };

    // Queue event for processing
    this.queueStateEvent(stateEvent);
  }

  // ==========================================================================
  // Event Queuing and Processing
  // ==========================================================================

  /**
   * Queue state event for ordered processing
   */
  private queueStateEvent(event: StateUpdateEvent): void {
    const { agentId } = event;

    // Get or create agent queue
    if (!this.agentQueues.has(agentId)) {
      this.agentQueues.set(agentId, []);
    }

    const queue = this.agentQueues.get(agentId)!;

    // Add to queue
    queue.push({
      event,
      queuedAt: new Date(),
    });

    // Process queue for this agent
    this.processAgentQueue(agentId);
  }

  /**
   * Process event queue for specific agent
   *
   * Ensures sequential ordering of events per agent
   */
  private async processAgentQueue(agentId: string): Promise<void> {
    // Check if already processing for this agent
    if (this.processingFlags.get(agentId)) {
      return; // Already processing, will be picked up
    }

    this.processingFlags.set(agentId, true);

    try {
      const queue = this.agentQueues.get(agentId);
      if (!queue) {
        return;
      }

      // Process all queued events in FIFO order
      while (queue.length > 0) {
        const queued = queue.shift()!;
        await this.emitStateEvent(queued.event);
      }
    } finally {
      this.processingFlags.set(agentId, false);
    }
  }

  /**
   * Emit state update event
   */
  private async emitStateEvent(event: StateUpdateEvent): Promise<void> {
    // Add to replay buffer
    if (this.config.enableReplayBuffer) {
      this.replayBuffer.push(event);
      if (this.replayBuffer.length > this.config.replayBufferSize) {
        this.replayBuffer.shift();
      }
    }

    // Log event
    console.log(
      `[StateIntegrationBridge] Event: ${event.type}`,
      `taskId=${event.taskId}`,
      `status=${event.previousStatus || 'NEW'} → ${event.newStatus}`
    );

    // Emit generic state-update event
    this.emit('state-update', event);

    // Emit specific event type
    this.emit(event.type, event);
  }

  // ==========================================================================
  // Concurrent Processing
  // ==========================================================================

  /**
   * Process all agent queues concurrently
   *
   * Maintains sequential ordering within each agent's queue
   */
  async flushAll(): Promise<void> {
    const agentIds = Array.from(this.agentQueues.keys());

    if (this.config.enableConcurrentProcessing) {
      // Process in parallel
      await Promise.all(
        agentIds.map((agentId) => this.processAgentQueue(agentId))
      );
    } else {
      // Process sequentially
      for (const agentId of agentIds) {
        await this.processAgentQueue(agentId);
      }
    }
  }

  // ==========================================================================
  // Replay Buffer
  // ==========================================================================

  /**
   * Get recent events from replay buffer
   *
   * @param count - Number of recent events to retrieve (default: all)
   * @returns Array of recent state update events
   */
  getRecentEvents(count?: number): StateUpdateEvent[] {
    if (count === undefined) {
      return [...this.replayBuffer];
    }

    return this.replayBuffer.slice(-count);
  }

  /**
   * Clear replay buffer
   */
  clearReplayBuffer(): void {
    this.replayBuffer = [];
  }

  // ==========================================================================
  // Status and Metrics
  // ==========================================================================

  /**
   * Get pending event counts per agent
   */
  getPendingEventCounts(): Map<string, number> {
    const counts = new Map<string, number>();

    for (const [agentId, queue] of this.agentQueues.entries()) {
      counts.set(agentId, queue.length);
    }

    return counts;
  }

  /**
   * Get total pending events across all agents
   */
  getTotalPendingEvents(): number {
    let total = 0;

    for (const queue of this.agentQueues.values()) {
      total += queue.length;
    }

    return total;
  }

  /**
   * Get status cache size
   */
  getStatusCacheSize(): number {
    return this.statusCache.size;
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Clear all queues and caches
   */
  clear(): void {
    this.agentQueues.clear();
    this.processingFlags.clear();
    this.statusCache.clear();
    this.replayBuffer = [];
  }
}
