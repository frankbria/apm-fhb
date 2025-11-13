/**
 * APM Message Delivery Tracker
 *
 * Implements delivery confirmation and retry logic:
 * - Tracks sent messages awaiting acknowledgment
 * - Configurable timeouts per message type
 * - ACK/NACK acknowledgment handling
 * - Exponential backoff retry (max 3 retries: 1s, 2s, 4s)
 * - Delivery state persistence
 * - Lifecycle event emission
 */

import * as fs from 'fs';
import * as path from 'path';
import { MessageEnvelope, MessageType, MessagePriority } from '../protocol/types';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Delivery state for a sent message
 */
export interface DeliveryState {
  /** The sent message */
  message: MessageEnvelope;
  /** When message was sent (ISO 8601) */
  sentAt: string;
  /** Number of retry attempts */
  retryCount: number;
  /** When next retry should occur (ISO 8601, null if not scheduled) */
  nextRetryAt: string | null;
  /** When delivery times out (ISO 8601) */
  timeoutAt: string;
}

/**
 * Persisted delivery state
 */
interface PersistedDeliveryState {
  /** Message ID to delivery state mapping */
  deliveries: Record<string, DeliveryState>;
  /** Last update timestamp */
  lastUpdated: string;
}

/**
 * Delivery event types
 */
export enum DeliveryEventType {
  MESSAGE_SENT = 'message-sent',
  MESSAGE_ACKNOWLEDGED = 'message-acknowledged',
  MESSAGE_RETRY = 'message-retry',
  MESSAGE_FAILED = 'message-failed',
}

/**
 * Delivery event payload
 */
export interface DeliveryEvent {
  /** Event type */
  type: DeliveryEventType;
  /** Message ID */
  messageId: string;
  /** Correlation ID (if any) */
  correlationId?: string;
  /** Message type */
  messageType: MessageType;
  /** Event timestamp */
  timestamp: string;
  /** Additional context */
  context?: {
    /** Retry count for retry events */
    retryCount?: number;
    /** Failure reason for failed events */
    failureReason?: string;
    /** ACK status for acknowledged events */
    ackStatus?: string;
    /** NACK error code for NACK events */
    nackErrorCode?: string;
  };
}

/**
 * ACK message payload (simplified)
 */
export interface AckPayload {
  /** ID of message being acknowledged */
  originalMessageId: string;
  /** ACK status */
  status: 'received' | 'processed' | 'queued';
  /** Optional message */
  message?: string;
}

/**
 * NACK message payload (simplified)
 */
export interface NackPayload {
  /** ID of message being rejected */
  originalMessageId: string;
  /** Error code */
  errorCode: string;
  /** Error message */
  errorMessage: string;
  /** Whether error is recoverable */
  recoverable: boolean;
}

/**
 * Delivery tracker configuration
 */
export interface DeliveryTrackerConfig {
  /** Agent ID for this tracker */
  agentId: string;
  /** Delivery state persistence directory (default: .apm-auto/queues) */
  stateDir?: string;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Base retry delay in milliseconds (default: 1000) */
  baseRetryDelay?: number;
  /** Maximum retry delay in milliseconds (default: 4000) */
  maxRetryDelay?: number;
  /** Event listener callback */
  onEvent?: (event: DeliveryEvent) => void;
}

// ============================================================================
// Delivery Timeout Configuration
// ============================================================================

/**
 * Timeout configuration by message type (in milliseconds)
 * Based on Task 3.1 protocol specification
 */
const MESSAGE_TIMEOUTS: Record<MessageType, number> = {
  [MessageType.TASK_ASSIGNMENT]: 60000, // 60s
  [MessageType.TASK_UPDATE]: 30000, // 30s
  [MessageType.STATE_SYNC]: 30000, // 30s
  [MessageType.ERROR_REPORT]: 10000, // 10s
  [MessageType.HANDOFF_REQUEST]: 60000, // 60s
  [MessageType.ACK]: 0, // No timeout (fire-and-forget)
  [MessageType.NACK]: 0, // No timeout (fire-and-forget)
};

// ============================================================================
// DeliveryTracker Class
// ============================================================================

/**
 * Tracks message delivery and handles acknowledgments
 */
export class DeliveryTracker {
  private readonly config: Required<DeliveryTrackerConfig>;

  // Delivery state tracking
  private deliveries = new Map<string, DeliveryState>();

  // Retry timers
  private retryTimers = new Map<string, NodeJS.Timeout>();

  // File paths
  private readonly stateFilePath: string;

  /**
   * Create a new delivery tracker
   */
  constructor(config: DeliveryTrackerConfig) {
    this.config = {
      stateDir: config.stateDir ?? '.apm-auto/queues',
      maxRetries: config.maxRetries ?? 3,
      baseRetryDelay: config.baseRetryDelay ?? 1000,
      maxRetryDelay: config.maxRetryDelay ?? 4000,
      onEvent: config.onEvent ?? (() => {}),
      agentId: config.agentId,
    };

    // Setup file paths
    this.stateFilePath = path.join(
      this.config.stateDir,
      `${this.config.agentId}-delivery-state.json`
    );

    // Ensure state directory exists
    this.ensureStateDirectory();

    // Load persisted state on startup
    this.loadPersistedState();
  }

  // ==========================================================================
  // Delivery Tracking
  // ==========================================================================

  /**
   * Track a sent message awaiting acknowledgment
   *
   * @param message - The sent message
   */
  trackSentMessage(message: MessageEnvelope): void {
    const messageId = message.messageId;
    const messageType = message.messageType;

    // Skip tracking for ACK/NACK (fire-and-forget)
    if (messageType === MessageType.ACK || messageType === MessageType.NACK) {
      return;
    }

    const now = new Date();
    const timeout = MESSAGE_TIMEOUTS[messageType];
    const timeoutAt = new Date(now.getTime() + timeout);

    // Create delivery state
    const state: DeliveryState = {
      message,
      sentAt: now.toISOString(),
      retryCount: 0,
      nextRetryAt: null,
      timeoutAt: timeoutAt.toISOString(),
    };

    // Store delivery state
    this.deliveries.set(messageId, state);

    // Schedule timeout check
    this.scheduleTimeoutCheck(messageId, timeout);

    // Persist state
    this.persistState();

    // Emit event
    this.emitEvent({
      type: DeliveryEventType.MESSAGE_SENT,
      messageId,
      correlationId: message.correlationId,
      messageType,
      timestamp: now.toISOString(),
      context: {
        retryCount: 0,
      },
    });
  }

  /**
   * Handle ACK message
   *
   * @param ackMessage - The ACK message
   */
  handleAck(ackMessage: MessageEnvelope<AckPayload>): void {
    const originalMessageId = ackMessage.payload.originalMessageId;
    const state = this.deliveries.get(originalMessageId);

    if (!state) {
      // ACK for unknown message (already delivered or never tracked)
      console.warn(
        `[DeliveryTracker:${this.config.agentId}] ACK received for unknown message: ${originalMessageId}`
      );
      return;
    }

    // Cancel retry timer if exists
    this.cancelRetryTimer(originalMessageId);

    // Remove from tracking
    this.deliveries.delete(originalMessageId);

    // Persist state
    this.persistState();

    // Emit event
    this.emitEvent({
      type: DeliveryEventType.MESSAGE_ACKNOWLEDGED,
      messageId: originalMessageId,
      correlationId: state.message.correlationId,
      messageType: state.message.messageType,
      timestamp: new Date().toISOString(),
      context: {
        ackStatus: ackMessage.payload.status,
      },
    });
  }

  /**
   * Handle NACK message
   *
   * @param nackMessage - The NACK message
   * @returns Whether message should be moved to DLQ (true) or retried (false)
   */
  handleNack(nackMessage: MessageEnvelope<NackPayload>): boolean {
    const originalMessageId = nackMessage.payload.originalMessageId;
    const state = this.deliveries.get(originalMessageId);

    if (!state) {
      console.warn(
        `[DeliveryTracker:${this.config.agentId}] NACK received for unknown message: ${originalMessageId}`
      );
      return false;
    }

    const { errorCode, errorMessage, recoverable } = nackMessage.payload;

    // Log NACK
    console.warn(
      `[DeliveryTracker:${this.config.agentId}] NACK received:`,
      `messageId=${originalMessageId}`,
      `errorCode=${errorCode}`,
      `message=${errorMessage}`,
      `recoverable=${recoverable}`
    );

    // If not recoverable, move to DLQ
    if (!recoverable) {
      this.cancelRetryTimer(originalMessageId);
      this.deliveries.delete(originalMessageId);
      this.persistState();

      this.emitEvent({
        type: DeliveryEventType.MESSAGE_FAILED,
        messageId: originalMessageId,
        correlationId: state.message.correlationId,
        messageType: state.message.messageType,
        timestamp: new Date().toISOString(),
        context: {
          failureReason: `NACK: ${errorCode} - ${errorMessage}`,
          nackErrorCode: errorCode,
        },
      });

      return true; // Move to DLQ
    }

    // If recoverable, retry based on retry count
    if (state.retryCount < this.config.maxRetries) {
      this.scheduleRetry(originalMessageId);
      return false; // Retry
    } else {
      // Max retries exceeded, move to DLQ
      this.cancelRetryTimer(originalMessageId);
      this.deliveries.delete(originalMessageId);
      this.persistState();

      this.emitEvent({
        type: DeliveryEventType.MESSAGE_FAILED,
        messageId: originalMessageId,
        correlationId: state.message.correlationId,
        messageType: state.message.messageType,
        timestamp: new Date().toISOString(),
        context: {
          failureReason: `Max retries exceeded after NACK: ${errorCode}`,
          nackErrorCode: errorCode,
        },
      });

      return true; // Move to DLQ
    }
  }

  /**
   * Get delivery state for a message
   */
  getDeliveryState(messageId: string): DeliveryState | undefined {
    return this.deliveries.get(messageId);
  }

  /**
   * Get all pending deliveries
   */
  getPendingDeliveries(): DeliveryState[] {
    return Array.from(this.deliveries.values());
  }

  /**
   * Clear all delivery tracking (for testing)
   */
  clear(): void {
    // Cancel all retry timers
    for (const messageId of this.deliveries.keys()) {
      this.cancelRetryTimer(messageId);
    }

    // Clear deliveries
    this.deliveries.clear();

    // Persist state
    this.persistState();
  }

  /**
   * Shutdown tracker (cancel timers, persist state)
   */
  shutdown(): void {
    // Cancel all retry timers
    for (const messageId of this.deliveries.keys()) {
      this.cancelRetryTimer(messageId);
    }

    // Final state persistence
    this.persistState();
  }

  // ==========================================================================
  // Retry Logic
  // ==========================================================================

  /**
   * Schedule retry for a message
   *
   * Uses exponential backoff: delay = min(baseDelay * 2^retryCount, maxDelay)
   */
  private scheduleRetry(messageId: string): void {
    const state = this.deliveries.get(messageId);
    if (!state) {
      return;
    }

    // Calculate retry delay using exponential backoff
    const retryDelay = Math.min(
      this.config.baseRetryDelay * Math.pow(2, state.retryCount),
      this.config.maxRetryDelay
    );

    // Update state
    state.retryCount++;
    const nextRetryAt = new Date(Date.now() + retryDelay);
    state.nextRetryAt = nextRetryAt.toISOString();

    // Persist state
    this.persistState();

    // Schedule retry timer
    const timer = setTimeout(() => {
      this.executeRetry(messageId);
    }, retryDelay);

    this.retryTimers.set(messageId, timer);

    console.log(
      `[DeliveryTracker:${this.config.agentId}] Scheduled retry ${state.retryCount}/${this.config.maxRetries}`,
      `for message ${messageId} in ${retryDelay}ms`
    );
  }

  /**
   * Execute retry for a message
   */
  private executeRetry(messageId: string): void {
    const state = this.deliveries.get(messageId);
    if (!state) {
      return;
    }

    // Clear retry timer
    this.retryTimers.delete(messageId);

    // Reset nextRetryAt
    state.nextRetryAt = null;

    // Emit retry event
    this.emitEvent({
      type: DeliveryEventType.MESSAGE_RETRY,
      messageId,
      correlationId: state.message.correlationId,
      messageType: state.message.messageType,
      timestamp: new Date().toISOString(),
      context: {
        retryCount: state.retryCount,
      },
    });

    // Caller should re-send the message
    // (We emit the event, delivery system listens and re-sends)
  }

  /**
   * Schedule timeout check for a message
   */
  private scheduleTimeoutCheck(messageId: string, timeout: number): void {
    const timer = setTimeout(() => {
      this.checkTimeout(messageId);
    }, timeout);

    this.retryTimers.set(messageId, timer);
  }

  /**
   * Check if message has timed out
   */
  private checkTimeout(messageId: string): void {
    const state = this.deliveries.get(messageId);
    if (!state) {
      return; // Already acknowledged or removed
    }

    const now = Date.now();
    const timeoutAt = new Date(state.timeoutAt).getTime();

    if (now >= timeoutAt) {
      // Timeout occurred
      if (state.retryCount < this.config.maxRetries) {
        // Schedule retry
        this.scheduleRetry(messageId);
      } else {
        // Max retries exceeded, move to DLQ
        this.cancelRetryTimer(messageId);
        this.deliveries.delete(messageId);
        this.persistState();

        this.emitEvent({
          type: DeliveryEventType.MESSAGE_FAILED,
          messageId,
          correlationId: state.message.correlationId,
          messageType: state.message.messageType,
          timestamp: new Date().toISOString(),
          context: {
            failureReason: 'Timeout after max retries',
            retryCount: state.retryCount,
          },
        });
      }
    }
  }

  /**
   * Cancel retry timer for a message
   */
  private cancelRetryTimer(messageId: string): void {
    const timer = this.retryTimers.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(messageId);
    }
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Ensure state directory exists
   */
  private ensureStateDirectory(): void {
    if (!fs.existsSync(this.config.stateDir)) {
      fs.mkdirSync(this.config.stateDir, { recursive: true });
    }
  }

  /**
   * Load persisted delivery state from file
   */
  private loadPersistedState(): void {
    if (!fs.existsSync(this.stateFilePath)) {
      return; // No persisted state yet
    }

    try {
      const content = fs.readFileSync(this.stateFilePath, 'utf-8');
      const persisted: PersistedDeliveryState = JSON.parse(content);

      // Restore delivery states
      for (const [messageId, state] of Object.entries(persisted.deliveries)) {
        this.deliveries.set(messageId, state);

        // Check if we need to resume retry or timeout
        const now = Date.now();
        const timeoutAt = new Date(state.timeoutAt).getTime();

        if (state.nextRetryAt) {
          // Retry was scheduled
          const nextRetryAt = new Date(state.nextRetryAt).getTime();
          const retryDelay = Math.max(0, nextRetryAt - now);

          const timer = setTimeout(() => {
            this.executeRetry(messageId);
          }, retryDelay);

          this.retryTimers.set(messageId, timer);
        } else if (now < timeoutAt) {
          // Schedule timeout check
          const timeoutDelay = timeoutAt - now;
          this.scheduleTimeoutCheck(messageId, timeoutDelay);
        } else {
          // Already timed out, check for retry or fail
          this.checkTimeout(messageId);
        }
      }
    } catch (error) {
      console.error(
        `[DeliveryTracker:${this.config.agentId}] Failed to load persisted state:`,
        error
      );
      // Continue with empty state on error
    }
  }

  /**
   * Persist delivery state to file (atomic write)
   */
  private persistState(): void {
    const persisted: PersistedDeliveryState = {
      deliveries: Object.fromEntries(this.deliveries),
      lastUpdated: new Date().toISOString(),
    };

    try {
      // Atomic write: write-tmp-rename pattern
      const tmpPath = `${this.stateFilePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(persisted, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.stateFilePath);
    } catch (error) {
      console.error(
        `[DeliveryTracker:${this.config.agentId}] Failed to persist state:`,
        error
      );
    }
  }

  // ==========================================================================
  // Event Emission
  // ==========================================================================

  /**
   * Emit delivery lifecycle event
   */
  private emitEvent(event: DeliveryEvent): void {
    // Call configured event listener
    this.config.onEvent(event);

    // Also log to console for visibility
    console.log(
      `[DeliveryTracker:${this.config.agentId}] Event: ${event.type}`,
      `messageId=${event.messageId}`,
      event.context ? JSON.stringify(event.context) : ''
    );
  }
}
