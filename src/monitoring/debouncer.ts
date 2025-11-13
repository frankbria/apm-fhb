/**
 * APM File Change Debouncer
 *
 * Implements debouncing logic for file change events:
 * - Timer-based debouncing with configurable delay
 * - Batching of related changes to same file
 * - Change type priority (unlink > change > add)
 * - Edge case handling (rapid create-delete-create)
 * - Immediate mode for critical files
 * - Metrics tracking
 */

import { EventEmitter } from 'events';
import { FileEvent, FileEventType } from './file-watcher';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Pending change entry
 */
interface PendingChange {
  /** File path */
  filePath: string;
  /** Event type (most destructive wins) */
  eventType: FileEventType;
  /** Last change timestamp */
  lastChangeTimestamp: Date;
  /** Debounce timer ID */
  timerId: NodeJS.Timeout;
  /** Original event (most recent) */
  originalEvent: FileEvent;
}

/**
 * Debounced event
 */
export interface DebouncedEvent {
  /** Event type (collapsed from multiple changes) */
  eventType: FileEventType;
  /** File path */
  filePath: string;
  /** First change timestamp */
  firstChangeTimestamp: Date;
  /** Last change timestamp */
  lastChangeTimestamp: Date;
  /** Number of changes collapsed */
  changesCollapsed: number;
  /** Final emission timestamp */
  emittedAt: Date;
}

/**
 * Debouncer metrics
 */
export interface DebouncerMetrics {
  /** Total events debounced */
  totalDebounced: number;
  /** Total events emitted */
  totalEmitted: number;
  /** Total changes collapsed */
  totalCollapsed: number;
  /** Average quiet period (ms) */
  averageQuietPeriod: number;
  /** Files currently pending debounce */
  currentlyPending: number;
  /** Immediate mode triggers */
  immediateModeCount: number;
}

/**
 * Debouncer configuration
 */
export interface DebouncerConfig {
  /** Debounce delay in milliseconds (default: 500) */
  debounceDelay?: number;
  /** Critical file patterns (no debouncing) */
  criticalPatterns?: string[];
  /** Enable metrics tracking */
  enableMetrics?: boolean;
}

// ============================================================================
// FileChangeDebouncer Class
// ============================================================================

/**
 * Debounces rapid file change events
 *
 * Collapses multiple changes to same file into single event after quiet period.
 * Handles edge cases and supports immediate mode for critical files.
 */
export class FileChangeDebouncer extends EventEmitter {
  private readonly config: Required<DebouncerConfig>;

  // Pending changes per file
  private pendingChanges = new Map<string, PendingChange>();

  // First change timestamps (for quiet period calculation)
  private firstChangeTimestamps = new Map<string, Date>();

  // Metrics tracking
  private metrics: DebouncerMetrics = {
    totalDebounced: 0,
    totalEmitted: 0,
    totalCollapsed: 0,
    averageQuietPeriod: 0,
    currentlyPending: 0,
    immediateModeCount: 0,
  };

  // Quiet periods (for average calculation)
  private quietPeriods: number[] = [];

  /**
   * Create a new file change debouncer
   */
  constructor(config: DebouncerConfig = {}) {
    super();

    this.config = {
      debounceDelay: config.debounceDelay ?? 500,
      criticalPatterns: config.criticalPatterns ?? ['**/URGENT_*.md'],
      enableMetrics: config.enableMetrics ?? true,
    };
  }

  // ==========================================================================
  // Debouncing Logic
  // ==========================================================================

  /**
   * Process file event with debouncing
   *
   * @param event - File event from watcher
   */
  processEvent(event: FileEvent): void {
    const { filePath, eventType } = event;

    // Check if this is a critical file (immediate mode)
    if (this.isCriticalFile(filePath)) {
      this.emitImmediate(event);
      return;
    }

    // Handle edge case: file deleted before debounce completes
    if (eventType === FileEventType.UNLINK) {
      this.handleUnlink(event);
      return;
    }

    // Check if file already has pending change
    const existingPending = this.pendingChanges.get(filePath);

    if (existingPending) {
      // Update existing pending change
      this.updatePendingChange(existingPending, event);
    } else {
      // Create new pending change
      this.createPendingChange(event);
    }

    // Update metrics
    if (this.config.enableMetrics) {
      this.metrics.totalDebounced++;
      this.metrics.currentlyPending = this.pendingChanges.size;
    }
  }

  /**
   * Create new pending change entry
   */
  private createPendingChange(event: FileEvent): void {
    const { filePath, eventType } = event;

    // Track first change timestamp
    this.firstChangeTimestamps.set(filePath, event.timestamp);

    // Create timer
    const timerId = setTimeout(() => {
      this.emitDebouncedEvent(filePath);
    }, this.config.debounceDelay);

    // Create pending entry
    const pending: PendingChange = {
      filePath,
      eventType,
      lastChangeTimestamp: event.timestamp,
      timerId,
      originalEvent: event,
    };

    this.pendingChanges.set(filePath, pending);
  }

  /**
   * Update existing pending change
   */
  private updatePendingChange(existing: PendingChange, event: FileEvent): void {
    // Clear existing timer
    clearTimeout(existing.timerId);

    // Determine new event type (most destructive wins)
    const newEventType = this.getMostDestructiveEventType(
      existing.eventType,
      event.eventType
    );

    // Update pending entry
    existing.eventType = newEventType;
    existing.lastChangeTimestamp = event.timestamp;
    existing.originalEvent = event;

    // Set new timer
    existing.timerId = setTimeout(() => {
      this.emitDebouncedEvent(existing.filePath);
    }, this.config.debounceDelay);
  }

  /**
   * Handle unlink event (immediate emission)
   */
  private handleUnlink(event: FileEvent): void {
    const { filePath } = event;

    // Cancel pending change if exists
    const existing = this.pendingChanges.get(filePath);
    if (existing) {
      clearTimeout(existing.timerId);
      this.pendingChanges.delete(filePath);
    }

    // Emit unlink immediately (don't wait for debounce)
    this.emitImmediate(event);
  }

  /**
   * Emit debounced event after quiet period
   */
  private emitDebouncedEvent(filePath: string): void {
    const pending = this.pendingChanges.get(filePath);
    if (!pending) {
      return; // Already emitted or cancelled
    }

    // Calculate quiet period
    const firstChange = this.firstChangeTimestamps.get(filePath);
    const quietPeriod = firstChange
      ? Date.now() - firstChange.getTime()
      : this.config.debounceDelay;

    // Calculate changes collapsed (at least 1)
    const changesCollapsed = Math.max(
      1,
      Math.floor(quietPeriod / this.config.debounceDelay)
    );

    // Create debounced event
    const debouncedEvent: DebouncedEvent = {
      eventType: pending.eventType,
      filePath: pending.filePath,
      firstChangeTimestamp: firstChange || pending.lastChangeTimestamp,
      lastChangeTimestamp: pending.lastChangeTimestamp,
      changesCollapsed,
      emittedAt: new Date(),
    };

    // Clean up
    this.pendingChanges.delete(filePath);
    this.firstChangeTimestamps.delete(filePath);

    // Update metrics
    if (this.config.enableMetrics) {
      this.metrics.totalEmitted++;
      this.metrics.totalCollapsed += changesCollapsed - 1; // Subtract 1 (first change)
      this.metrics.currentlyPending = this.pendingChanges.size;

      this.quietPeriods.push(quietPeriod);
      if (this.quietPeriods.length > 100) {
        this.quietPeriods.shift();
      }

      this.metrics.averageQuietPeriod =
        this.quietPeriods.reduce((sum, p) => sum + p, 0) /
        this.quietPeriods.length;
    }

    // Emit event
    this.emit('debounced-event', debouncedEvent);
  }

  /**
   * Emit event immediately without debouncing
   */
  private emitImmediate(event: FileEvent): void {
    const debouncedEvent: DebouncedEvent = {
      eventType: event.eventType,
      filePath: event.filePath,
      firstChangeTimestamp: event.timestamp,
      lastChangeTimestamp: event.timestamp,
      changesCollapsed: 1,
      emittedAt: new Date(),
    };

    // Update metrics
    if (this.config.enableMetrics) {
      this.metrics.totalEmitted++;
      this.metrics.immediateModeCount++;
    }

    // Emit immediately
    this.emit('debounced-event', debouncedEvent);
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Determine most destructive event type
   *
   * Priority: unlink > change > add
   */
  private getMostDestructiveEventType(
    type1: FileEventType,
    type2: FileEventType
  ): FileEventType {
    const priority = {
      [FileEventType.UNLINK]: 3,
      [FileEventType.CHANGE]: 2,
      [FileEventType.ADD]: 1,
    };

    return priority[type1] >= priority[type2] ? type1 : type2;
  }

  /**
   * Check if file matches critical pattern (immediate mode)
   */
  private isCriticalFile(filePath: string): boolean {
    // Simple pattern matching (supports wildcards)
    for (const pattern of this.config.criticalPatterns) {
      if (this.matchPattern(filePath, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Simple wildcard pattern matching
   */
  private matchPattern(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '.*') // ** matches any path
      .replace(/\*/g, '[^/]*') // * matches any non-slash
      .replace(/\./g, '\\.'); // Escape dots

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }

  // ==========================================================================
  // Metrics and Status
  // ==========================================================================

  /**
   * Get debouncer metrics
   */
  getMetrics(): Readonly<DebouncerMetrics> {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalDebounced: 0,
      totalEmitted: 0,
      totalCollapsed: 0,
      averageQuietPeriod: 0,
      currentlyPending: 0,
      immediateModeCount: 0,
    };
    this.quietPeriods = [];
  }

  /**
   * Get currently pending file paths
   */
  getPendingFiles(): string[] {
    return Array.from(this.pendingChanges.keys());
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Clear all pending changes and timers
   */
  clear(): void {
    // Cancel all timers
    for (const pending of this.pendingChanges.values()) {
      clearTimeout(pending.timerId);
    }

    // Clear maps
    this.pendingChanges.clear();
    this.firstChangeTimestamps.clear();

    // Update metrics
    if (this.config.enableMetrics) {
      this.metrics.currentlyPending = 0;
    }
  }

  /**
   * Flush all pending changes immediately
   */
  flush(): void {
    const filePaths = Array.from(this.pendingChanges.keys());

    for (const filePath of filePaths) {
      // Cancel timer
      const pending = this.pendingChanges.get(filePath);
      if (pending) {
        clearTimeout(pending.timerId);
      }

      // Emit immediately
      this.emitDebouncedEvent(filePath);
    }
  }
}
