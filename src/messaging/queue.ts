/**
 * APM Message Queue - Priority Queue with File Persistence
 *
 * Implements a three-level priority queue (HIGH, NORMAL, LOW) with:
 * - File-backed persistence for durability
 * - Size limits and overflow handling
 * - Queue metrics and monitoring
 * - Automatic compaction of processed messages
 */

import * as fs from 'fs';
import * as path from 'path';
import { MessageEnvelope, MessagePriority } from '../protocol/types';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Queue entry with metadata
 */
interface QueueEntry<T = unknown> {
  /** The actual message */
  message: MessageEnvelope<T>;
  /** When message was enqueued */
  queuedAt: string;
  /** Priority level */
  priority: MessagePriority;
  /** Entry ID for tracking */
  entryId: string;
  /** Whether entry has been processed (for persistence) */
  processed: boolean;
}

/**
 * Queue metrics for monitoring
 */
interface QueueMetrics {
  /** Total messages enqueued since start */
  enqueued: number;
  /** Total messages dequeued since start */
  dequeued: number;
  /** Current queue depth by priority */
  depthByPriority: {
    [MessagePriority.HIGH]: number;
    [MessagePriority.NORMAL]: number;
    [MessagePriority.LOW]: number;
  };
  /** Average wait time in milliseconds */
  averageWaitTime: number;
  /** Age of oldest message in milliseconds */
  oldestMessageAge: number;
}

/**
 * Queue configuration options
 */
interface QueueConfig {
  /** Agent ID for this queue */
  agentId: string;
  /** Maximum queue size (default: 10000) */
  maxSize?: number;
  /** Queue persistence directory (default: .apm-auto/queues) */
  queueDir?: string;
  /** Compaction interval in milliseconds (default: 60000 = 1 minute) */
  compactionInterval?: number;
}

/**
 * Persisted queue entry format (NDJSON line)
 */
interface PersistedEntry {
  entryId: string;
  message: MessageEnvelope;
  queuedAt: string;
  priority: MessagePriority;
  processed: boolean;
}

// ============================================================================
// MessageQueue Class
// ============================================================================

/**
 * Priority queue with file-backed persistence
 *
 * Messages are stored in three internal queues (HIGH, NORMAL, LOW) and
 * persisted to an append-only NDJSON log file. Dequeue operations process
 * HIGH priority first, then NORMAL, then LOW (FIFO within same priority).
 */
export class MessageQueue {
  private readonly config: Required<QueueConfig>;

  // Three priority queues (FIFO within each)
  private highQueue: QueueEntry[] = [];
  private normalQueue: QueueEntry[] = [];
  private lowQueue: QueueEntry[] = [];

  // Metrics tracking
  private metrics: QueueMetrics = {
    enqueued: 0,
    dequeued: 0,
    depthByPriority: {
      [MessagePriority.HIGH]: 0,
      [MessagePriority.NORMAL]: 0,
      [MessagePriority.LOW]: 0,
    },
    averageWaitTime: 0,
    oldestMessageAge: 0,
  };

  // Wait time tracking for average calculation
  private waitTimes: number[] = [];

  // Compaction timer
  private compactionTimer?: NodeJS.Timeout;

  // File paths
  private readonly queueFilePath: string;

  /**
   * Create a new message queue
   */
  constructor(config: QueueConfig) {
    this.config = {
      maxSize: config.maxSize ?? 10000,
      queueDir: config.queueDir ?? '.apm-auto/queues',
      compactionInterval: config.compactionInterval ?? 60000,
      agentId: config.agentId,
    };

    // Setup file paths
    this.queueFilePath = path.join(
      this.config.queueDir,
      `${this.config.agentId}-queue.ndjson`
    );

    // Ensure queue directory exists
    this.ensureQueueDirectory();

    // Load persisted queue on startup
    this.loadPersistedQueue();

    // Start compaction timer
    this.startCompactionTimer();
  }

  // ==========================================================================
  // Queue Operations
  // ==========================================================================

  /**
   * Add message to queue with specified priority
   *
   * @throws Error if queue is full and message cannot be added
   */
  enqueue<T>(message: MessageEnvelope<T>, priority?: MessagePriority): void {
    // Use message priority if not explicitly provided
    const effectivePriority = priority ?? message.priority;

    // Check size limits
    if (this.size() >= this.config.maxSize) {
      this.handleOverflow(effectivePriority);
    }

    // Create queue entry
    const entry: QueueEntry<T> = {
      message,
      queuedAt: new Date().toISOString(),
      priority: effectivePriority,
      entryId: this.generateEntryId(),
      processed: false,
    };

    // Add to appropriate priority queue
    this.getQueueForPriority(effectivePriority).push(entry);

    // Update metrics
    this.metrics.enqueued++;
    this.metrics.depthByPriority[effectivePriority]++;
    this.updateOldestMessageAge();

    // Persist to file
    this.persistEntry(entry);

    // Emit queue-full warning if approaching limit
    if (this.size() > this.config.maxSize * 0.9) {
      this.emitWarning(`Queue approaching limit: ${this.size()}/${this.config.maxSize}`);
    }
  }

  /**
   * Retrieve and remove highest priority message
   * Returns null if queue is empty
   */
  dequeue<T = unknown>(): MessageEnvelope<T> | null {
    // Check HIGH queue first
    let entry = this.highQueue.shift();
    let priority = MessagePriority.HIGH;

    // Then NORMAL queue
    if (!entry) {
      entry = this.normalQueue.shift();
      priority = MessagePriority.NORMAL;
    }

    // Finally LOW queue
    if (!entry) {
      entry = this.lowQueue.shift();
      priority = MessagePriority.LOW;
    }

    // Queue empty
    if (!entry) {
      return null;
    }

    // Calculate wait time
    const waitTime = Date.now() - new Date(entry.queuedAt).getTime();
    this.waitTimes.push(waitTime);

    // Keep only last 100 wait times for average calculation
    if (this.waitTimes.length > 100) {
      this.waitTimes.shift();
    }

    // Update metrics
    this.metrics.dequeued++;
    this.metrics.depthByPriority[priority]--;
    this.metrics.averageWaitTime =
      this.waitTimes.reduce((sum, t) => sum + t, 0) / this.waitTimes.length;
    this.updateOldestMessageAge();

    // Mark as processed in persistence file (will be removed on compaction)
    this.markProcessed(entry.entryId);

    return entry.message as MessageEnvelope<T>;
  }

  /**
   * Inspect queue head without removal
   */
  peek<T = unknown>(): MessageEnvelope<T> | null {
    // Check priority order
    const entry = this.highQueue[0] ?? this.normalQueue[0] ?? this.lowQueue[0];
    return entry ? (entry.message as MessageEnvelope<T>) : null;
  }

  /**
   * Get total queue size across all priorities
   */
  size(): number {
    return this.highQueue.length + this.normalQueue.length + this.lowQueue.length;
  }

  /**
   * Get size for specific priority level
   */
  sizeByPriority(priority: MessagePriority): number {
    return this.metrics.depthByPriority[priority];
  }

  /**
   * Empty entire queue
   */
  clear(): void {
    this.highQueue = [];
    this.normalQueue = [];
    this.lowQueue = [];

    // Reset metrics
    this.metrics.depthByPriority = {
      [MessagePriority.HIGH]: 0,
      [MessagePriority.NORMAL]: 0,
      [MessagePriority.LOW]: 0,
    };
    this.metrics.oldestMessageAge = 0;

    // Clear persistence file
    this.clearPersistedQueue();
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.size() === 0;
  }

  /**
   * Get current queue metrics
   */
  getMetrics(): Readonly<QueueMetrics> {
    return { ...this.metrics };
  }

  /**
   * Shutdown queue (stop compaction timer, final compaction)
   */
  shutdown(): void {
    if (this.compactionTimer) {
      clearInterval(this.compactionTimer);
      this.compactionTimer = undefined;
    }

    // Final compaction
    this.compact();
  }

  // ==========================================================================
  // Persistence Operations
  // ==========================================================================

  /**
   * Ensure queue directory exists
   */
  private ensureQueueDirectory(): void {
    if (!fs.existsSync(this.config.queueDir)) {
      fs.mkdirSync(this.config.queueDir, { recursive: true });
    }
  }

  /**
   * Load persisted queue from file on startup
   */
  private loadPersistedQueue(): void {
    if (!fs.existsSync(this.queueFilePath)) {
      return; // No persisted queue yet
    }

    try {
      const content = fs.readFileSync(this.queueFilePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      for (const line of lines) {
        const persisted: PersistedEntry = JSON.parse(line);

        // Skip already processed entries
        if (persisted.processed) {
          continue;
        }

        // Recreate queue entry
        const entry: QueueEntry = {
          message: persisted.message,
          queuedAt: persisted.queuedAt,
          priority: persisted.priority,
          entryId: persisted.entryId,
          processed: false,
        };

        // Add to appropriate queue
        this.getQueueForPriority(entry.priority).push(entry);

        // Update metrics
        this.metrics.depthByPriority[entry.priority]++;
      }

      // Update oldest message age
      this.updateOldestMessageAge();

    } catch (error) {
      console.error(`Failed to load persisted queue from ${this.queueFilePath}:`, error);
      // Continue with empty queue on error
    }
  }

  /**
   * Persist queue entry to file (append-only)
   */
  private persistEntry(entry: QueueEntry): void {
    const persisted: PersistedEntry = {
      entryId: entry.entryId,
      message: entry.message,
      queuedAt: entry.queuedAt,
      priority: entry.priority,
      processed: false,
    };

    const line = JSON.stringify(persisted) + '\n';

    try {
      fs.appendFileSync(this.queueFilePath, line, 'utf-8');
    } catch (error) {
      console.error(`Failed to persist queue entry:`, error);
    }
  }

  /**
   * Mark entry as processed in persistence file
   */
  private markProcessed(entryId: string): void {
    // For simplicity, we just track this in memory
    // The compaction process will remove processed entries from file
  }

  /**
   * Clear persisted queue file
   */
  private clearPersistedQueue(): void {
    try {
      if (fs.existsSync(this.queueFilePath)) {
        fs.unlinkSync(this.queueFilePath);
      }
    } catch (error) {
      console.error(`Failed to clear persisted queue:`, error);
    }
  }

  /**
   * Compact queue file by removing processed entries
   */
  private compact(): void {
    if (!fs.existsSync(this.queueFilePath)) {
      return; // Nothing to compact
    }

    try {
      // Collect all unprocessed entries currently in queues
      const allEntries = [
        ...this.highQueue,
        ...this.normalQueue,
        ...this.lowQueue,
      ];

      // Create set of active entry IDs
      const activeIds = new Set(allEntries.map(e => e.entryId));

      // Read existing file
      const content = fs.readFileSync(this.queueFilePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      // Filter to only unprocessed entries
      const activeLines = lines.filter(line => {
        const entry: PersistedEntry = JSON.parse(line);
        return activeIds.has(entry.entryId);
      });

      // Write compacted file atomically (write-tmp-rename pattern)
      const tmpPath = `${this.queueFilePath}.tmp`;
      fs.writeFileSync(tmpPath, activeLines.join('\n') + '\n', 'utf-8');
      fs.renameSync(tmpPath, this.queueFilePath);

    } catch (error) {
      console.error(`Failed to compact queue file:`, error);
    }
  }

  /**
   * Start periodic compaction timer
   */
  private startCompactionTimer(): void {
    this.compactionTimer = setInterval(() => {
      this.compact();
    }, this.config.compactionInterval);
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Get internal queue array for priority level
   */
  private getQueueForPriority(priority: MessagePriority): QueueEntry[] {
    switch (priority) {
      case MessagePriority.HIGH:
        return this.highQueue;
      case MessagePriority.NORMAL:
        return this.normalQueue;
      case MessagePriority.LOW:
        return this.lowQueue;
      default:
        throw new Error(`Unknown priority: ${priority}`);
    }
  }

  /**
   * Handle queue overflow based on priority
   *
   * Strategy: Reject LOW priority first, then NORMAL, never reject HIGH
   */
  private handleOverflow(incomingPriority: MessagePriority): void {
    // Try to make room by rejecting LOW priority messages
    if (this.lowQueue.length > 0) {
      this.lowQueue.shift();
      this.metrics.depthByPriority[MessagePriority.LOW]--;
      this.emitWarning('Queue full: rejected LOW priority message');
      return;
    }

    // Try to make room by rejecting NORMAL priority messages
    if (this.normalQueue.length > 0 && incomingPriority === MessagePriority.HIGH) {
      this.normalQueue.shift();
      this.metrics.depthByPriority[MessagePriority.NORMAL]--;
      this.emitWarning('Queue full: rejected NORMAL priority message for HIGH');
      return;
    }

    // Cannot make room - reject incoming message
    throw new Error(
      `Queue full (${this.config.maxSize} messages) and cannot reject lower priority messages`
    );
  }

  /**
   * Update oldest message age metric
   */
  private updateOldestMessageAge(): void {
    const allEntries = [
      ...this.highQueue,
      ...this.normalQueue,
      ...this.lowQueue,
    ];

    if (allEntries.length === 0) {
      this.metrics.oldestMessageAge = 0;
      return;
    }

    const oldestQueuedAt = Math.min(
      ...allEntries.map(e => new Date(e.queuedAt).getTime())
    );

    this.metrics.oldestMessageAge = Date.now() - oldestQueuedAt;
  }

  /**
   * Generate unique entry ID
   */
  private generateEntryId(): string {
    return `entry-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Emit warning event (for monitoring)
   */
  private emitWarning(message: string): void {
    // TODO: Integrate with event system when available
    console.warn(`[MessageQueue:${this.config.agentId}] ${message}`);
  }
}
