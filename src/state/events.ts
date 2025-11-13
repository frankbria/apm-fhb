/**
 * Agent Lifecycle Event System for apm-auto
 *
 * Provides event-driven architecture for agent state transitions with
 * event buffering, replay capabilities, and integration with CLI logging.
 */

import { EventEmitter } from 'events';
import { AgentStatus } from '../types/agent.js';
import { TransitionTrigger, StateEntityType } from '../types/state.js';
import type { ConnectionManager } from '../db/connection.js';
import { getLogger } from '../cli/logger.js';

// Get logger instance
const logger = getLogger();

/**
 * Lifecycle Event Types
 * Maps agent states to event names
 */
export enum LifecycleEventType {
  AgentSpawning = 'agent:spawning',
  AgentActive = 'agent:active',
  AgentWaiting = 'agent:waiting',
  AgentIdle = 'agent:idle',
  AgentTerminated = 'agent:terminated'
}

/**
 * Lifecycle Event Payload
 * Data emitted with each lifecycle event
 */
export interface LifecycleEventPayload {
  /** Agent identifier */
  agentId: string;
  /** Previous state (null for initial spawn) */
  fromState: AgentStatus | null;
  /** New state */
  toState: AgentStatus;
  /** Event timestamp */
  timestamp: Date;
  /** What triggered the transition */
  trigger: TransitionTrigger;
  /** Additional metadata */
  metadata: Record<string, any>;
}

/**
 * Event Handler Function Type
 */
export type LifecycleEventHandler = (payload: LifecycleEventPayload) => void | Promise<void>;

/**
 * Buffered Event
 * Event stored in buffer during database unavailability
 */
interface BufferedEvent {
  /** Event type */
  type: LifecycleEventType;
  /** Event payload */
  payload: LifecycleEventPayload;
  /** When event was buffered */
  bufferedAt: Date;
}

/**
 * Event Buffer Configuration
 */
export interface EventBufferConfig {
  /** Maximum number of events to buffer (default: 1000) */
  maxSize: number;
  /** Overflow strategy: 'drop-oldest' or 'drop-newest' (default: 'drop-oldest') */
  overflowStrategy: 'drop-oldest' | 'drop-newest';
  /** Enable automatic replay when connection restores (default: true) */
  autoReplay: boolean;
}

/**
 * Agent Lifecycle Event Manager
 * Manages event emission, subscription, buffering, and replay
 */
export class LifecycleEventManager extends EventEmitter {
  private eventBuffer: BufferedEvent[] = [];
  private bufferConfig: Required<EventBufferConfig>;
  private connectionManager?: ConnectionManager;
  private isConnected: boolean = true;

  constructor(
    connectionManager?: ConnectionManager,
    bufferConfig: Partial<EventBufferConfig> = {}
  ) {
    super();
    this.connectionManager = connectionManager;
    this.bufferConfig = {
      maxSize: bufferConfig.maxSize ?? 1000,
      overflowStrategy: bufferConfig.overflowStrategy ?? 'drop-oldest',
      autoReplay: bufferConfig.autoReplay ?? true
    };

    // Monitor connection status if connection manager provided
    if (connectionManager) {
      this.setupConnectionMonitoring();
    }
  }

  /**
   * Emit a lifecycle event
   *
   * @param eventType - Type of lifecycle event
   * @param payload - Event payload
   *
   * @example
   * ```typescript
   * events.emitLifecycleEvent(LifecycleEventType.AgentActive, {
   *   agentId: 'agent_impl_001',
   *   fromState: AgentStatus.Spawning,
   *   toState: AgentStatus.Active,
   *   timestamp: new Date(),
   *   trigger: TransitionTrigger.Automatic,
   *   metadata: { reason: 'Initialization complete' }
   * });
   * ```
   */
  emitLifecycleEvent(
    eventType: LifecycleEventType,
    payload: LifecycleEventPayload
  ): void {
    // Log event at appropriate level
    this.logEvent(eventType, payload);

    // If database unavailable, buffer the event
    if (!this.isConnected) {
      this.bufferEvent(eventType, payload);
      logger.warn(`Database unavailable, buffering event: ${eventType}`, {
        agentId: payload.agentId,
        bufferSize: this.eventBuffer.length
      });
      return;
    }

    // Emit event to all listeners
    this.emit(eventType, payload);

    // Also emit a generic 'lifecycle' event for catch-all handlers
    this.emit('lifecycle', eventType, payload);
  }

  /**
   * Subscribe to a specific lifecycle event
   *
   * @param eventType - Type of event to listen for
   * @param handler - Event handler function
   *
   * @example
   * ```typescript
   * events.onLifecycleEvent(LifecycleEventType.AgentTerminated, (payload) => {
   *   console.log(`Agent ${payload.agentId} terminated`);
   * });
   * ```
   */
  onLifecycleEvent(
    eventType: LifecycleEventType,
    handler: LifecycleEventHandler
  ): void {
    this.on(eventType, handler);
  }

  /**
   * Subscribe to a lifecycle event for a single occurrence
   *
   * @param eventType - Type of event to listen for
   * @param handler - Event handler function
   */
  onceLifecycleEvent(
    eventType: LifecycleEventType,
    handler: LifecycleEventHandler
  ): void {
    this.once(eventType, handler);
  }

  /**
   * Unsubscribe from a lifecycle event
   *
   * @param eventType - Type of event to stop listening for
   * @param handler - Event handler function to remove
   */
  offLifecycleEvent(
    eventType: LifecycleEventType,
    handler: LifecycleEventHandler
  ): void {
    this.off(eventType, handler);
  }

  /**
   * Subscribe to all lifecycle events
   *
   * @param handler - Handler that receives event type and payload
   *
   * @example
   * ```typescript
   * events.onAllLifecycleEvents((eventType, payload) => {
   *   console.log(`Lifecycle event: ${eventType}`, payload);
   * });
   * ```
   */
  onAllLifecycleEvents(
    handler: (eventType: LifecycleEventType, payload: LifecycleEventPayload) => void
  ): void {
    this.on('lifecycle', handler);
  }

  /**
   * Get current buffer status
   *
   * @returns Buffer statistics
   */
  getBufferStatus(): {
    size: number;
    maxSize: number;
    utilization: number;
    oldestEvent?: Date;
    newestEvent?: Date;
  } {
    return {
      size: this.eventBuffer.length,
      maxSize: this.bufferConfig.maxSize,
      utilization: this.eventBuffer.length / this.bufferConfig.maxSize,
      oldestEvent: this.eventBuffer[0]?.bufferedAt,
      newestEvent: this.eventBuffer[this.eventBuffer.length - 1]?.bufferedAt
    };
  }

  /**
   * Clear event buffer
   *
   * WARNING: This discards all buffered events
   */
  clearBuffer(): void {
    const count = this.eventBuffer.length;
    this.eventBuffer = [];
    logger.info(`Cleared event buffer (${count} events discarded)`);
  }

  /**
   * Manually replay buffered events
   *
   * @returns Number of events replayed
   */
  async replayBufferedEvents(): Promise<number> {
    if (this.eventBuffer.length === 0) {
      return 0;
    }

    logger.info(`Replaying ${this.eventBuffer.length} buffered events`);
    const events = [...this.eventBuffer];
    this.eventBuffer = [];

    for (const bufferedEvent of events) {
      this.emit(bufferedEvent.type, bufferedEvent.payload);
      this.emit('lifecycle', bufferedEvent.type, bufferedEvent.payload);
    }

    logger.info(`Successfully replayed ${events.length} events`);
    return events.length;
  }

  /**
   * Replay historical events from database
   *
   * @param agentId - Agent identifier
   * @param fromTimestamp - Start timestamp (optional)
   * @returns Number of events replayed
   *
   * @example
   * ```typescript
   * // Replay all events for an agent
   * await events.replayHistoricalEvents('agent_impl_001');
   *
   * // Replay events from last hour
   * const oneHourAgo = new Date(Date.now() - 3600000);
   * await events.replayHistoricalEvents('agent_impl_001', oneHourAgo);
   * ```
   */
  async replayHistoricalEvents(
    agentId: string,
    fromTimestamp?: Date
  ): Promise<number> {
    if (!this.connectionManager) {
      throw new Error('Connection manager required for historical replay');
    }

    // Query state transitions from database
    let sql = `
      SELECT entity_id, from_state, to_state, timestamp, trigger, metadata
      FROM state_transitions
      WHERE entity_type = ? AND entity_id = ?
    `;
    const params: any[] = [StateEntityType.Agent, agentId];

    if (fromTimestamp) {
      sql += ' AND timestamp >= ?';
      params.push(fromTimestamp.toISOString());
    }

    sql += ' ORDER BY timestamp ASC';

    const transitions = await this.connectionManager.query<any>(sql, params);

    // Replay each transition as an event
    for (const transition of transitions) {
      const toState = transition.to_state as AgentStatus;
      const eventType = this.mapStatusToEventType(toState);

      const payload: LifecycleEventPayload = {
        agentId: transition.entity_id,
        fromState: (transition.from_state === '' ? null : transition.from_state) as AgentStatus | null,
        toState,
        timestamp: new Date(transition.timestamp),
        trigger: transition.trigger as TransitionTrigger,
        metadata: transition.metadata ? JSON.parse(transition.metadata) : {}
      };

      this.emit(eventType, payload);
      this.emit('lifecycle', eventType, payload);
    }

    logger.info(`Replayed ${transitions.length} historical events for agent ${agentId}`);
    return transitions.length;
  }

  /**
   * Get event statistics
   *
   * @returns Event listener and buffer statistics
   */
  getEventStats(): {
    listenerCounts: Record<string, number>;
    totalListeners: number;
    bufferSize: number;
    bufferUtilization: number;
  } {
    const listenerCounts: Record<string, number> = {};
    let totalListeners = 0;

    // Count listeners for each event type
    for (const eventType of Object.values(LifecycleEventType)) {
      const count = this.listenerCount(eventType);
      listenerCounts[eventType] = count;
      totalListeners += count;
    }

    // Add lifecycle catch-all listeners
    const lifecycleCount = this.listenerCount('lifecycle');
    listenerCounts['lifecycle'] = lifecycleCount;
    totalListeners += lifecycleCount;

    return {
      listenerCounts,
      totalListeners,
      bufferSize: this.eventBuffer.length,
      bufferUtilization: this.eventBuffer.length / this.bufferConfig.maxSize
    };
  }

  /**
   * Buffer an event during database unavailability
   */
  private bufferEvent(
    eventType: LifecycleEventType,
    payload: LifecycleEventPayload
  ): void {
    const bufferedEvent: BufferedEvent = {
      type: eventType,
      payload,
      bufferedAt: new Date()
    };

    // Handle buffer overflow
    if (this.eventBuffer.length >= this.bufferConfig.maxSize) {
      if (this.bufferConfig.overflowStrategy === 'drop-oldest') {
        const dropped = this.eventBuffer.shift();
        logger.warn('Event buffer full, dropping oldest event', {
          droppedEvent: dropped?.type,
          droppedAgent: dropped?.payload.agentId
        });
      } else {
        // drop-newest: don't add new event
        logger.warn('Event buffer full, dropping newest event', {
          droppedEvent: eventType,
          droppedAgent: payload.agentId
        });
        return;
      }
    }

    this.eventBuffer.push(bufferedEvent);
  }

  /**
   * Setup connection monitoring for automatic buffering/replay
   */
  private setupConnectionMonitoring(): void {
    if (!this.connectionManager) {
      return;
    }

    // Monitor connection events
    this.connectionManager.on('connected', () => {
      this.isConnected = true;
      logger.info('Database connection restored');

      // Auto-replay buffered events if enabled
      if (this.bufferConfig.autoReplay && this.eventBuffer.length > 0) {
        this.replayBufferedEvents().catch(error => {
          logger.error('Failed to replay buffered events', { error });
        });
      }
    });

    this.connectionManager.on('disconnected', () => {
      this.isConnected = false;
      logger.warn('Database connection lost, event buffering enabled');
    });

    this.connectionManager.on('error', (error: Error) => {
      this.isConnected = false;
      logger.error('Database connection error', { error: error.message });
    });

    // Initial connection check
    this.isConnected = this.connectionManager.isConnected();
  }

  /**
   * Map agent status to event type
   */
  private mapStatusToEventType(status: AgentStatus): LifecycleEventType {
    const mapping: Record<AgentStatus, LifecycleEventType> = {
      [AgentStatus.Spawning]: LifecycleEventType.AgentSpawning,
      [AgentStatus.Active]: LifecycleEventType.AgentActive,
      [AgentStatus.Waiting]: LifecycleEventType.AgentWaiting,
      [AgentStatus.Idle]: LifecycleEventType.AgentIdle,
      [AgentStatus.Terminated]: LifecycleEventType.AgentTerminated
    };
    return mapping[status];
  }

  /**
   * Log event at appropriate level
   */
  private logEvent(
    eventType: LifecycleEventType,
    payload: LifecycleEventPayload
  ): void {
    const logData = {
      agentId: payload.agentId,
      transition: `${payload.fromState ?? 'null'} → ${payload.toState}`,
      trigger: payload.trigger
    };

    switch (eventType) {
      case LifecycleEventType.AgentSpawning:
        logger.info('Agent spawning', logData);
        break;
      case LifecycleEventType.AgentActive:
        logger.info('Agent active', logData);
        break;
      case LifecycleEventType.AgentWaiting:
        logger.info('Agent waiting', logData);
        break;
      case LifecycleEventType.AgentIdle:
        logger.info('Agent idle', logData);
        break;
      case LifecycleEventType.AgentTerminated:
        // Log at ERROR if crash/error, INFO if normal termination
        const isError = payload.trigger === TransitionTrigger.Error;
        if (isError) {
          logger.error('Agent terminated (error)', {
            ...logData,
            reason: payload.metadata.reason
          });
        } else {
          logger.info('Agent terminated', logData);
        }
        break;
    }
  }
}

/**
 * Create a new lifecycle event manager
 *
 * @param connectionManager - Optional database connection manager for replay
 * @param bufferConfig - Optional buffer configuration
 * @returns Lifecycle event manager instance
 */
export function createLifecycleEventManager(
  connectionManager?: ConnectionManager,
  bufferConfig?: Partial<EventBufferConfig>
): LifecycleEventManager {
  return new LifecycleEventManager(connectionManager, bufferConfig);
}

/**
 * Helper function to create event payload from state transition
 *
 * @param agentId - Agent identifier
 * @param fromState - Previous state
 * @param toState - New state
 * @param trigger - Transition trigger
 * @param metadata - Additional metadata
 * @returns Lifecycle event payload
 */
export function createEventPayload(
  agentId: string,
  fromState: AgentStatus | null,
  toState: AgentStatus,
  trigger: TransitionTrigger,
  metadata: Record<string, any> = {}
): LifecycleEventPayload {
  return {
    agentId,
    fromState,
    toState,
    timestamp: new Date(),
    trigger,
    metadata
  };
}
