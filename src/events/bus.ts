/**
 * Event Bus Core Implementation
 *
 * Central event bus coordinating all agent communication events with topic-based
 * publish-subscribe, wildcard support, and multiple emission modes.
 *
 * Features:
 * - Wildcard topic subscriptions (* for single level, ** for multi-level)
 * - Multiple emission modes (async, sync, parallel)
 * - Event metadata injection (timestamp, eventId, publisherId)
 * - Event cancellation support
 * - FIFO delivery order guarantee within topics
 * - Sequence numbering for debugging
 */

import EventEmitter2 from 'eventemitter2';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

/**
 * Event metadata automatically injected into all events
 */
export interface EventMetadata {
  timestamp: string;
  eventId: string;
  publisherId?: string;
  sequenceNumber: number;
}

/**
 * Event data wrapper with metadata
 */
export interface EventData<T = any> {
  topic: string;
  data: T;
  metadata: EventMetadata;
}

/**
 * Event emission mode
 */
export enum EmissionMode {
  ASYNC = 'async',      // Fire-and-forget async (default)
  SYNC = 'sync',        // Wait for all handlers
  PARALLEL = 'parallel' // Run handlers concurrently
}

/**
 * Event cancellation result from handler
 */
export interface CancellationResult {
  cancel: true;
  reason?: string;
}

/**
 * Event bus configuration options
 */
export interface EventBusConfig {
  wildcard?: boolean;
  delimiter?: string;
  maxListeners?: number;
  newListener?: boolean;
  verboseMemoryLeak?: boolean;
  defaultMode?: EmissionMode;
}

/**
 * Event bus statistics
 */
export interface EventBusStats {
  totalPublished: number;
  totalDelivered: number;
  totalCancelled: number;
  topicCounts: Map<string, number>;
  averageDeliveryTime: number;
  currentSequence: number;
}

/**
 * Central event bus for agent communication
 *
 * Supports topic-based pub/sub with wildcard patterns:
 * - Single wildcard (*): Match single level (e.g., agent:* matches agent:spawned)
 * - Multi wildcard (**): Match any levels (e.g., agent:** matches all agent events)
 *
 * Topic format: category:subcategory:action
 * Examples:
 * - agent:spawned:manager
 * - task:completed:1.2
 * - message:broadcast
 */
export class EventBus extends EventEmitter {
  private emitter: EventEmitter2;
  private sequenceCounter: number = 0;
  private defaultMode: EmissionMode;
  private topicModes: Map<string, EmissionMode> = new Map();

  // Statistics
  private stats = {
    totalPublished: 0,
    totalDelivered: 0,
    totalCancelled: 0,
    topicCounts: new Map<string, number>(),
    deliveryTimes: [] as number[],
    maxDeliveryTimeSamples: 1000
  };

  constructor(config: EventBusConfig = {}) {
    super();

    this.defaultMode = config.defaultMode || EmissionMode.ASYNC;

    // Initialize EventEmitter2 with configuration
    this.emitter = new EventEmitter2({
      wildcard: config.wildcard !== false, // Default true
      delimiter: config.delimiter || ':',
      maxListeners: config.maxListeners || 100,
      newListener: config.newListener || false,
      verboseMemoryLeak: config.verboseMemoryLeak !== false // Default true
    });

    // Handle internal errors
    this.emitter.on('error', (error) => {
      // Emit bus-error as a regular event
      process.nextTick(() => {
        this.emitter.emit('bus-error', {
          topic: 'bus-error',
          data: { error, timestamp: new Date().toISOString() },
          metadata: {
            timestamp: new Date().toISOString(),
            eventId: uuidv4(),
            sequenceNumber: ++this.sequenceCounter
          }
        });
      });
    });
  }

  /**
   * Publish event to topic with automatic metadata injection
   *
   * @param topic Topic in format category:subcategory:action
   * @param eventData Event data payload
   * @param publisherId Optional publisher agent ID
   * @param mode Optional emission mode override
   * @returns Promise resolving to number of listeners notified
   */
  async publish<T = any>(
    topic: string,
    eventData: T,
    publisherId?: string,
    mode?: EmissionMode
  ): Promise<number> {
    const startTime = Date.now();

    // Generate metadata
    const metadata: EventMetadata = {
      timestamp: new Date().toISOString(),
      eventId: uuidv4(),
      publisherId,
      sequenceNumber: ++this.sequenceCounter
    };

    // Wrap with metadata
    const wrappedEvent: EventData<T> = {
      topic,
      data: eventData,
      metadata
    };

    // Update statistics
    this.stats.totalPublished++;
    const topicCount = this.stats.topicCounts.get(topic) || 0;
    this.stats.topicCounts.set(topic, topicCount + 1);

    // Determine emission mode
    const emissionMode = mode || this.topicModes.get(topic) || this.defaultMode;

    let deliveredCount: number;

    try {
      switch (emissionMode) {
        case EmissionMode.SYNC:
          deliveredCount = await this.emitSync(topic, wrappedEvent);
          break;
        case EmissionMode.PARALLEL:
          deliveredCount = await this.emitParallel(topic, wrappedEvent);
          break;
        case EmissionMode.ASYNC:
        default:
          deliveredCount = await this.emitAsync(topic, wrappedEvent);
          break;
      }

      this.stats.totalDelivered += deliveredCount;

      // Track delivery time
      const deliveryTime = Date.now() - startTime;
      this.stats.deliveryTimes.push(deliveryTime);
      if (this.stats.deliveryTimes.length > this.stats.maxDeliveryTimeSamples) {
        this.stats.deliveryTimes.shift();
      }

      return deliveredCount;
    } catch (error) {
      this.emit('publish-error', { topic, error, metadata });
      throw error;
    }
  }

  /**
   * Fire-and-forget async emission (default)
   * Handlers invoked asynchronously in next tick
   */
  private async emitAsync<T>(topic: string, event: EventData<T>): Promise<number> {
    const listeners = this.emitter.listeners(topic);

    // Invoke all handlers asynchronously in next tick
    listeners.forEach(listener => {
      process.nextTick(async () => {
        try {
          const result = await listener(event);
          if (this.isCancellation(result)) {
            this.handleCancellation(topic, event, result);
          }
        } catch (error) {
          this.handleListenerError(topic, event, error as Error);
        }
      });
    });

    return listeners.length;
  }

  /**
   * Synchronous emission - wait for all handlers to complete
   * Handlers invoked sequentially in FIFO order
   */
  private async emitSync<T>(topic: string, event: EventData<T>): Promise<number> {
    const listeners = this.emitter.listeners(topic);
    let deliveredCount = 0;

    for (const listener of listeners) {
      try {
        const result = await listener(event);
        deliveredCount++;

        // Check for cancellation
        if (this.isCancellation(result)) {
          this.handleCancellation(topic, event, result);
          break; // Stop propagation
        }
      } catch (error) {
        this.handleListenerError(topic, event, error as Error);
      }
    }

    return deliveredCount;
  }

  /**
   * Parallel emission - run all handlers concurrently
   * All handlers invoked at once, wait for all to complete
   */
  private async emitParallel<T>(topic: string, event: EventData<T>): Promise<number> {
    const listeners = this.emitter.listeners(topic);

    const results = await Promise.allSettled(
      listeners.map(listener => listener(event))
    );

    let deliveredCount = 0;
    let cancelled = false;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        deliveredCount++;

        if (this.isCancellation(result.value)) {
          cancelled = true;
          this.handleCancellation(topic, event, result.value);
        }
      } else {
        this.handleListenerError(topic, event, result.reason);
      }
    }

    if (cancelled) {
      this.stats.totalCancelled++;
    }

    return deliveredCount;
  }

  /**
   * Subscribe to topic with callback
   * Supports wildcard patterns (* and **)
   *
   * @param topic Topic pattern to subscribe to
   * @param callback Event handler callback
   * @returns Unsubscribe function
   */
  on(topic: string, callback: (event: EventData) => void | Promise<void> | CancellationResult): this {
    this.emitter.on(topic, callback);
    return this;
  }

  /**
   * Subscribe to topic, auto-unsubscribe after first event
   *
   * @param topic Topic pattern to subscribe to
   * @param callback Event handler callback
   * @returns Unsubscribe function
   */
  once(topic: string, callback: (event: EventData) => void | Promise<void>): this {
    this.emitter.once(topic, callback);
    return this;
  }

  /**
   * Unsubscribe from topic
   *
   * @param topic Topic pattern
   * @param callback Callback to remove (if omitted, removes all for topic)
   */
  off(topic: string, callback?: (event: EventData) => void | Promise<void>): this {
    if (callback) {
      this.emitter.off(topic, callback);
    } else {
      this.emitter.removeAllListeners(topic);
    }
    return this;
  }

  /**
   * Set emission mode for specific topic pattern
   *
   * @param topic Topic pattern
   * @param mode Emission mode (async, sync, parallel)
   */
  setTopicMode(topic: string, mode: EmissionMode): void {
    this.topicModes.set(topic, mode);
  }

  /**
   * Get emission mode for topic
   *
   * @param topic Topic pattern
   * @returns Emission mode
   */
  getTopicMode(topic: string): EmissionMode {
    return this.topicModes.get(topic) || this.defaultMode;
  }

  /**
   * Get listeners for topic pattern
   *
   * @param topic Topic pattern
   * @returns Array of listener functions
   */
  listeners(topic: string): Function[] {
    return this.emitter.listeners(topic);
  }

  /**
   * Get listener count for topic
   *
   * @param topic Topic pattern (optional, returns total if omitted)
   * @returns Number of listeners
   */
  listenerCount(topic?: string): number {
    if (topic) {
      return this.emitter.listeners(topic).length;
    }

    // Total across all topics (excluding internal 'error' listener)
    const eventNames = this.emitter.eventNames().filter(name => name !== 'error');
    return eventNames.reduce((total, event) => {
      return total + this.emitter.listeners(event as string).length;
    }, 0);
  }

  /**
   * Get all event names (topics) with active listeners
   *
   * @returns Array of topic names
   */
  eventNames(): string[] {
    return this.emitter.eventNames().map(name => String(name));
  }

  /**
   * Remove all listeners for all topics
   */
  removeAllListeners(topic?: string): this {
    this.emitter.removeAllListeners(topic);
    return this;
  }

  /**
   * Get event bus statistics
   *
   * @returns Statistics object
   */
  getStats(): EventBusStats {
    const averageDeliveryTime = this.stats.deliveryTimes.length > 0
      ? this.stats.deliveryTimes.reduce((sum, time) => sum + time, 0) / this.stats.deliveryTimes.length
      : 0;

    return {
      totalPublished: this.stats.totalPublished,
      totalDelivered: this.stats.totalDelivered,
      totalCancelled: this.stats.totalCancelled,
      topicCounts: new Map(this.stats.topicCounts),
      averageDeliveryTime,
      currentSequence: this.sequenceCounter
    };
  }

  /**
   * Reset statistics counters
   */
  resetStats(): void {
    this.stats.totalPublished = 0;
    this.stats.totalDelivered = 0;
    this.stats.totalCancelled = 0;
    this.stats.topicCounts.clear();
    this.stats.deliveryTimes = [];
  }

  /**
   * Shutdown event bus
   * Removes all listeners and clears statistics
   */
  shutdown(): void {
    this.emitter.removeAllListeners();
    this.topicModes.clear();
    this.resetStats();
    this.sequenceCounter = 0;
  }

  /**
   * Check if result is a cancellation
   */
  private isCancellation(result: any): result is CancellationResult {
    return result && typeof result === 'object' && result.cancel === true;
  }

  /**
   * Handle event cancellation
   */
  private handleCancellation<T>(
    topic: string,
    event: EventData<T>,
    cancellation: CancellationResult
  ): void {
    this.stats.totalCancelled++;

    // Emit on next tick to avoid interfering with current event flow
    process.nextTick(() => {
      // Emit as a regular event on the internal emitter
      this.emitter.emit('event-cancelled', {
        topic,
        data: {
          topic,
          eventId: event.metadata.eventId,
          reason: cancellation.reason,
          timestamp: new Date().toISOString()
        },
        metadata: {
          timestamp: new Date().toISOString(),
          eventId: this.generateEventId(),
          sequenceNumber: ++this.sequenceCounter
        }
      });
    });
  }

  /**
   * Handle listener error
   */
  private handleListenerError<T>(
    topic: string,
    event: EventData<T>,
    error: Error
  ): void {
    // Emit on next tick to avoid interfering with current event flow
    process.nextTick(() => {
      // Emit as a regular event on the internal emitter
      this.emitter.emit('listener-error', {
        topic: 'listener-error',
        data: {
          topic,
          eventId: event.metadata.eventId,
          error,
          timestamp: new Date().toISOString()
        },
        metadata: {
          timestamp: new Date().toISOString(),
          eventId: this.generateEventId(),
          sequenceNumber: ++this.sequenceCounter
        }
      });
    });
  }

  /**
   * Generate event ID (helper method)
   */
  private generateEventId(): string {
    return uuidv4();
  }
}

/**
 * Singleton event bus instance
 */
let globalEventBus: EventBus | null = null;

/**
 * Get or create global event bus instance
 *
 * @param config Optional configuration (only used on first call)
 * @returns Global event bus instance
 */
export function getEventBus(config?: EventBusConfig): EventBus {
  if (!globalEventBus) {
    globalEventBus = new EventBus(config);
  }
  return globalEventBus;
}

/**
 * Reset global event bus instance (useful for testing)
 */
export function resetEventBus(): void {
  if (globalEventBus) {
    globalEventBus.shutdown();
    globalEventBus = null;
  }
}
