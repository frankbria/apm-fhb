/**
 * APM Communication Protocol - Error Handling Procedures
 * Version: 1.0.0
 *
 * This file implements error handling procedures including:
 * - Retry logic with exponential backoff
 * - Dead letter queue (DLQ) management
 * - Error recovery procedures
 * - Circuit breaker pattern
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ProtocolMessage,
  MessageType,
  MessageState,
  MessageTracker
} from './types';
import {
  ErrorCode,
  ProtocolError,
  isRecoverableError,
  getErrorSeverity,
  createProtocolError
} from './errors';
import { serializeMessage } from './serialization';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  /** Maximum retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds */
  baseDelay: number;
  /** Maximum delay in milliseconds */
  maxDelay: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
}

/**
 * Default retry policies by message type
 */
export const DEFAULT_RETRY_POLICIES: Record<MessageType, RetryPolicy> = {
  [MessageType.TASK_ASSIGNMENT]: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 8000,
    backoffMultiplier: 2
  },
  [MessageType.TASK_UPDATE]: {
    maxRetries: 2,
    baseDelay: 1000,
    maxDelay: 4000,
    backoffMultiplier: 2
  },
  [MessageType.STATE_SYNC]: {
    maxRetries: 2,
    baseDelay: 1000,
    maxDelay: 4000,
    backoffMultiplier: 2
  },
  [MessageType.ERROR_REPORT]: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 8000,
    backoffMultiplier: 2
  },
  [MessageType.HANDOFF_REQUEST]: {
    maxRetries: 2,
    baseDelay: 2000,
    maxDelay: 8000,
    backoffMultiplier: 2
  },
  [MessageType.ACK]: {
    maxRetries: 0, // ACK is fire-and-forget
    baseDelay: 0,
    maxDelay: 0,
    backoffMultiplier: 1
  },
  [MessageType.NACK]: {
    maxRetries: 0, // NACK is fire-and-forget
    baseDelay: 0,
    maxDelay: 0,
    backoffMultiplier: 1
  }
};

/**
 * Error handling configuration
 */
export interface ErrorHandlerConfig {
  /** DLQ directory path */
  dlqPath: string;
  /** Enable retry logic */
  enableRetries: boolean;
  /** Custom retry policies */
  retryPolicies?: Partial<Record<MessageType, RetryPolicy>>;
  /** Circuit breaker threshold */
  circuitBreakerThreshold?: number;
  /** Circuit breaker timeout (ms) */
  circuitBreakerTimeout?: number;
}

// ============================================================================
// Error Handler Class
// ============================================================================

/**
 * Error handler for protocol messages
 */
export class ProtocolErrorHandler {
  private config: Required<ErrorHandlerConfig>;
  private retryPolicies: Record<MessageType, RetryPolicy>;
  private failureCount = 0;
  private circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private lastFailureTime?: Date;

  constructor(config: ErrorHandlerConfig) {
    this.config = {
      dlqPath: config.dlqPath,
      enableRetries: config.enableRetries,
      retryPolicies: config.retryPolicies || {},
      circuitBreakerThreshold: config.circuitBreakerThreshold || 5,
      circuitBreakerTimeout: config.circuitBreakerTimeout || 60000
    };

    // Merge custom retry policies with defaults
    this.retryPolicies = { ...DEFAULT_RETRY_POLICIES, ...config.retryPolicies };
  }

  /**
   * Handle message send failure
   *
   * @param message - Failed message
   * @param error - Error that occurred
   * @param tracker - Message tracker
   * @returns true if should retry, false if should move to DLQ
   */
  async handleSendFailure(
    message: ProtocolMessage,
    error: ProtocolError,
    tracker: MessageTracker
  ): Promise<boolean> {
    // Check circuit breaker
    if (this.circuitState === 'OPEN') {
      await this.moveToDLQ(message, error, 'Circuit breaker is open');
      return false;
    }

    // Check if error is recoverable
    if (!isRecoverableError(error.errorCode)) {
      await this.moveToDLQ(message, error, 'Non-recoverable error');
      this.recordFailure();
      return false;
    }

    // Check retry policy
    const policy = this.retryPolicies[message.messageType];
    if (!this.config.enableRetries || tracker.retryCount >= policy.maxRetries) {
      await this.moveToDLQ(message, error, 'Max retries exceeded');
      this.recordFailure();
      return false;
    }

    // Calculate retry delay
    const delay = this.calculateRetryDelay(tracker.retryCount, policy);

    // Log retry attempt
    console.log(
      `[Retry] Message ${message.messageId} (attempt ${tracker.retryCount + 1}/${policy.maxRetries}) after ${delay}ms`
    );

    // Wait before retry
    await this.sleep(delay);

    return true;
  }

  /**
   * Handle message receive failure
   *
   * @param messageJson - Raw message string
   * @param error - Error that occurred
   */
  async handleReceiveFailure(
    messageJson: string,
    error: ProtocolError
  ): Promise<void> {
    // Log error
    console.error('[Receive Error]', error);

    // Move malformed messages to DLQ
    if (error.errorCode === 'E_PROTOCOL_002') {
      await this.moveMalformedToDLQ(messageJson, error);
    }
  }

  /**
   * Move message to dead letter queue
   *
   * @param message - Failed message
   * @param error - Error information
   * @param reason - Failure reason
   */
  private async moveToDLQ(
    message: ProtocolMessage,
    error: ProtocolError,
    reason: string
  ): Promise<void> {
    const dlqEntry = {
      timestamp: new Date().toISOString(),
      reason,
      error: {
        code: error.errorCode,
        message: error.errorMessage,
        field: error.field,
        suggestions: error.suggestions
      },
      originalMessage: message
    };

    const fileName = `failed_${message.messageId}_${Date.now()}.json`;
    const filePath = path.join(this.config.dlqPath, fileName);

    try {
      // Ensure DLQ directory exists
      await fs.mkdir(this.config.dlqPath, { recursive: true });

      // Write DLQ entry
      await fs.writeFile(filePath, JSON.stringify(dlqEntry, null, 2), 'utf-8');

      console.log(`[DLQ] Moved message ${message.messageId} to ${filePath}`);
    } catch (err) {
      console.error('[DLQ Error] Failed to write DLQ entry:', err);
    }
  }

  /**
   * Move malformed message to DLQ
   *
   * @param messageJson - Raw message string
   * @param error - Error information
   */
  private async moveMalformedToDLQ(
    messageJson: string,
    error: ProtocolError
  ): Promise<void> {
    const dlqEntry = {
      timestamp: new Date().toISOString(),
      reason: 'Malformed message',
      error: {
        code: error.errorCode,
        message: error.errorMessage
      },
      rawMessage: messageJson
    };

    const fileName = `malformed_${Date.now()}.json`;
    const filePath = path.join(this.config.dlqPath, fileName);

    try {
      await fs.mkdir(this.config.dlqPath, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(dlqEntry, null, 2), 'utf-8');

      console.log(`[DLQ] Moved malformed message to ${filePath}`);
    } catch (err) {
      console.error('[DLQ Error] Failed to write DLQ entry:', err);
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   *
   * @param retryCount - Current retry count
   * @param policy - Retry policy
   * @returns Delay in milliseconds
   */
  private calculateRetryDelay(retryCount: number, policy: RetryPolicy): number {
    const delay = policy.baseDelay * Math.pow(policy.backoffMultiplier, retryCount);
    return Math.min(delay, policy.maxDelay);
  }

  /**
   * Sleep for specified duration
   *
   * @param ms - Duration in milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Record failure for circuit breaker
   */
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.failureCount >= this.config.circuitBreakerThreshold) {
      this.circuitState = 'OPEN';
      console.warn(
        `[Circuit Breaker] OPEN after ${this.failureCount} failures`
      );

      // Schedule circuit breaker reset
      setTimeout(() => {
        this.circuitState = 'HALF_OPEN';
        this.failureCount = 0;
        console.log('[Circuit Breaker] Entering HALF_OPEN state');
      }, this.config.circuitBreakerTimeout);
    }
  }

  /**
   * Record success for circuit breaker
   */
  recordSuccess(): void {
    if (this.circuitState === 'HALF_OPEN') {
      this.circuitState = 'CLOSED';
      console.log('[Circuit Breaker] CLOSED after successful operation');
    }
    this.failureCount = Math.max(0, this.failureCount - 1);
  }

  /**
   * Get DLQ statistics
   */
  async getDLQStats(): Promise<{
    totalEntries: number;
    oldestEntry: string | null;
    newestEntry: string | null;
  }> {
    try {
      const files = await fs.readdir(this.config.dlqPath);
      const dlqFiles = files.filter(f => f.startsWith('failed_') || f.startsWith('malformed_'));

      return {
        totalEntries: dlqFiles.length,
        oldestEntry: dlqFiles.length > 0 ? dlqFiles[0] : null,
        newestEntry: dlqFiles.length > 0 ? dlqFiles[dlqFiles.length - 1] : null
      };
    } catch (err) {
      return {
        totalEntries: 0,
        oldestEntry: null,
        newestEntry: null
      };
    }
  }

  /**
   * Reprocess DLQ entry
   *
   * @param fileName - DLQ file name
   * @returns Original message if successful
   */
  async reprocessDLQEntry(fileName: string): Promise<ProtocolMessage | null> {
    const filePath = path.join(this.config.dlqPath, fileName);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const dlqEntry = JSON.parse(content);

      if (dlqEntry.originalMessage) {
        // Delete from DLQ
        await fs.unlink(filePath);

        console.log(`[DLQ] Reprocessing ${fileName}`);
        return dlqEntry.originalMessage as ProtocolMessage;
      }

      return null;
    } catch (err) {
      console.error(`[DLQ] Failed to reprocess ${fileName}:`, err);
      return null;
    }
  }

  /**
   * Clear old DLQ entries
   *
   * @param olderThanDays - Delete entries older than this many days
   */
  async clearOldDLQEntries(olderThanDays: number): Promise<number> {
    try {
      const files = await fs.readdir(this.config.dlqPath);
      const now = Date.now();
      const cutoff = olderThanDays * 24 * 60 * 60 * 1000;

      let deleted = 0;

      for (const file of files) {
        const filePath = path.join(this.config.dlqPath, file);
        const stats = await fs.stat(filePath);

        if (now - stats.mtimeMs > cutoff) {
          await fs.unlink(filePath);
          deleted++;
        }
      }

      console.log(`[DLQ] Deleted ${deleted} old entries`);
      return deleted;
    } catch (err) {
      console.error('[DLQ] Failed to clear old entries:', err);
      return 0;
    }
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(): {
    state: string;
    failureCount: number;
    lastFailureTime?: string;
  } {
    return {
      state: this.circuitState,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime?.toISOString()
    };
  }
}

// ============================================================================
// Error Recovery Utilities
// ============================================================================

/**
 * Attempt to recover from error
 *
 * @param error - Error to recover from
 * @param message - Original message
 * @returns Corrected message if recoverable, null otherwise
 */
export async function attemptRecovery(
  error: ProtocolError,
  message: ProtocolMessage
): Promise<ProtocolMessage | null> {
  switch (error.errorCode) {
    case 'E_VALIDATION_001': // Missing field
      return attemptMissingFieldRecovery(error, message);

    case 'E_VALIDATION_007': // Invalid timestamp
      return attemptTimestampRecovery(message);

    case 'E_PROTOCOL_003': // Invalid correlation ID
      return attemptCorrelationIdRecovery(message);

    default:
      return null;
  }
}

/**
 * Attempt to recover from missing field
 */
function attemptMissingFieldRecovery(
  error: ProtocolError,
  message: ProtocolMessage
): ProtocolMessage | null {
  // Some missing fields have safe defaults
  if (error.field === 'priority') {
    return {
      ...message,
      priority: 'NORMAL' as any
    };
  }

  if (error.field === 'metadata') {
    return {
      ...message,
      metadata: {}
    };
  }

  return null;
}

/**
 * Attempt to recover from invalid timestamp
 */
function attemptTimestampRecovery(
  message: ProtocolMessage
): ProtocolMessage | null {
  return {
    ...message,
    timestamp: new Date().toISOString()
  };
}

/**
 * Attempt to recover from invalid correlation ID
 */
function attemptCorrelationIdRecovery(
  message: ProtocolMessage
): ProtocolMessage | null {
  // Generate new correlation ID if missing
  if (!message.correlationId) {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .replace(/\..+/, '');
    const random = Math.random().toString(36).substring(2, 10);

    return {
      ...message,
      correlationId: `req_${timestamp}_${random}`
    };
  }

  return null;
}
