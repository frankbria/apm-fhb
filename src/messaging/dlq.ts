/**
 * APM Dead Letter Queue (DLQ)
 *
 * Implements Dead Letter Queue for permanently failed messages:
 * - Failed message storage with rich metadata
 * - Failure criteria detection
 * - DLQ management operations (add, list, get, retry, discard, export)
 * - Monitoring and alerts (thresholds, statistics)
 * - Size limits and auto-purge (max 1000, 7-day retention)
 * - Audit logging for all operations
 */

import * as fs from 'fs';
import * as path from 'path';
import { MessageEnvelope } from '../protocol/types';
import { ProtocolErrorHandler } from '../protocol/error-handler';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Failure reason types
 */
export enum FailureReason {
  MAX_RETRIES_EXCEEDED = 'max_retries_exceeded',
  RECEIVER_TERMINATED = 'receiver_terminated',
  SCHEMA_VALIDATION_FAILED = 'schema_validation_failed',
  CIRCUIT_BREAKER_OPEN = 'circuit_breaker_open',
  PERMANENT_PROTOCOL_ERROR = 'permanent_protocol_error',
  NACK_NOT_RECOVERABLE = 'nack_not_recoverable',
}

/**
 * Retry attempt history
 */
export interface RetryAttempt {
  /** Attempt number (1-based) */
  attemptNumber: number;
  /** When retry was attempted */
  timestamp: string;
  /** Error code (if any) */
  errorCode?: string;
  /** Error message */
  errorMessage?: string;
}

/**
 * DLQ entry metadata
 */
export interface DlqEntryMetadata {
  /** Original message envelope */
  message: MessageEnvelope;
  /** Failure reason */
  failureReason: FailureReason;
  /** Detailed failure message */
  failureMessage: string;
  /** Error code (if applicable) */
  errorCode?: string;
  /** Retry history */
  retryHistory: RetryAttempt[];
  /** Final failure timestamp */
  failedAt: string;
  /** Receiver agent ID */
  receiverId: string;
  /** Receiver state at failure time */
  receiverState?: string;
  /** Circuit breaker state (if applicable) */
  circuitBreakerState?: 'OPEN' | 'HALF_OPEN' | 'CLOSED';
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * DLQ entry
 */
export interface DlqEntry {
  /** Entry ID (same as message ID) */
  entryId: string;
  /** Entry metadata */
  metadata: DlqEntryMetadata;
  /** When entry was added to DLQ */
  addedAt: string;
}

/**
 * DLQ filter options
 */
export interface DlqFilter {
  /** Filter by error code */
  errorCode?: string;
  /** Filter by failure reason */
  failureReason?: FailureReason;
  /** Filter by receiver ID */
  receiverId?: string;
  /** Filter by date range (start) */
  startDate?: string;
  /** Filter by date range (end) */
  endDate?: string;
}

/**
 * DLQ statistics
 */
export interface DlqStats {
  /** Total entries in DLQ */
  totalEntries: number;
  /** Oldest entry age in milliseconds */
  oldestEntryAge: number;
  /** Entries by failure reason */
  entriesByReason: Record<FailureReason, number>;
  /** Entries by error code */
  entriesByErrorCode: Record<string, number>;
  /** Common failure reasons (top 5) */
  commonFailureReasons: Array<{ reason: FailureReason; count: number }>;
  /** DLQ growth rate (entries per hour, last 24h) */
  growthRate: number;
}

/**
 * DLQ configuration
 */
export interface DlqConfig {
  /** Agent ID for this DLQ */
  agentId: string;
  /** DLQ persistence directory (default: .apm-auto/queues) */
  dlqDir?: string;
  /** Maximum DLQ size (default: 1000) */
  maxSize?: number;
  /** Entry retention period in days (default: 7) */
  retentionDays?: number;
  /** Warning threshold (default: 10) */
  warningThreshold?: number;
  /** Critical threshold (default: 100) */
  criticalThreshold?: number;
  /** Error handler instance (optional) */
  errorHandler?: ProtocolErrorHandler;
}

/**
 * Audit log entry
 */
interface AuditLogEntry {
  /** Operation type */
  operation: 'add' | 'retry' | 'discard' | 'purge';
  /** Entry ID affected */
  entryId?: string;
  /** Timestamp */
  timestamp: string;
  /** Actor (who performed operation) */
  actor?: string;
  /** Justification/reason */
  reason?: string;
  /** Additional details */
  details?: Record<string, unknown>;
}

// ============================================================================
// DeadLetterQueue Class
// ============================================================================

/**
 * Dead Letter Queue for permanently failed messages
 */
export class DeadLetterQueue {
  private readonly config: Required<DlqConfig>;

  // DLQ storage
  private entries = new Map<string, DlqEntry>();

  // File paths
  private readonly dlqFilePath: string;
  private readonly auditLogPath: string;

  // Growth tracking (for growth rate calculation)
  private addTimestamps: number[] = [];

  /**
   * Create a new Dead Letter Queue
   */
  constructor(config: DlqConfig) {
    this.config = {
      dlqDir: config.dlqDir ?? '.apm-auto/queues',
      maxSize: config.maxSize ?? 1000,
      retentionDays: config.retentionDays ?? 7,
      warningThreshold: config.warningThreshold ?? 10,
      criticalThreshold: config.criticalThreshold ?? 100,
      errorHandler: config.errorHandler ?? ({} as ProtocolErrorHandler),
      agentId: config.agentId,
    };

    // Setup file paths
    this.dlqFilePath = path.join(
      this.config.dlqDir,
      `${this.config.agentId}-dlq.ndjson`
    );
    this.auditLogPath = path.join(
      this.config.dlqDir,
      `${this.config.agentId}-dlq-audit.ndjson`
    );

    // Ensure DLQ directory exists
    this.ensureDlqDirectory();

    // Load persisted DLQ entries
    this.loadPersistedEntries();

    // Check thresholds on startup
    this.checkThresholds();
  }

  // ==========================================================================
  // DLQ Management Operations
  // ==========================================================================

  /**
   * Add failed message to DLQ
   *
   * @param message - The failed message
   * @param metadata - Failure metadata
   */
  add(message: MessageEnvelope, metadata: Omit<DlqEntryMetadata, 'message'>): void {
    const entryId = message.messageId;

    // Check if already in DLQ
    if (this.entries.has(entryId)) {
      console.warn(
        `[DLQ:${this.config.agentId}] Message already in DLQ: ${entryId}`
      );
      return;
    }

    // Check size limit
    if (this.entries.size >= this.config.maxSize) {
      // Auto-purge oldest entry
      this.autoPurgeOldest();
    }

    // Create DLQ entry
    const entry: DlqEntry = {
      entryId,
      metadata: {
        ...metadata,
        message,
      },
      addedAt: new Date().toISOString(),
    };

    // Add to DLQ
    this.entries.set(entryId, entry);

    // Track add timestamp for growth rate
    this.addTimestamps.push(Date.now());

    // Persist entry
    this.persistEntry(entry);

    // Audit log
    this.auditLog({
      operation: 'add',
      entryId,
      timestamp: entry.addedAt,
      reason: metadata.failureReason,
      details: {
        errorCode: metadata.errorCode,
        failureMessage: metadata.failureMessage,
        retryCount: metadata.retryHistory.length,
      },
    });

    // Log addition
    console.error(
      `[DLQ:${this.config.agentId}] Added message to DLQ:`,
      `messageId=${entryId}`,
      `reason=${metadata.failureReason}`,
      `errorCode=${metadata.errorCode ?? 'N/A'}`
    );

    // Check thresholds
    this.checkThresholds();
  }

  /**
   * List DLQ entries with optional filtering
   *
   * @param filters - Filter criteria
   * @returns Array of DLQ entries matching filters
   */
  list(filters?: DlqFilter): DlqEntry[] {
    let entries = Array.from(this.entries.values());

    if (!filters) {
      return entries;
    }

    // Apply filters
    if (filters.errorCode) {
      entries = entries.filter(
        (e) => e.metadata.errorCode === filters.errorCode
      );
    }

    if (filters.failureReason) {
      entries = entries.filter(
        (e) => e.metadata.failureReason === filters.failureReason
      );
    }

    if (filters.receiverId) {
      entries = entries.filter(
        (e) => e.metadata.receiverId === filters.receiverId
      );
    }

    if (filters.startDate) {
      const startTime = new Date(filters.startDate).getTime();
      entries = entries.filter(
        (e) => new Date(e.metadata.failedAt).getTime() >= startTime
      );
    }

    if (filters.endDate) {
      const endTime = new Date(filters.endDate).getTime();
      entries = entries.filter(
        (e) => new Date(e.metadata.failedAt).getTime() <= endTime
      );
    }

    return entries;
  }

  /**
   * Get specific DLQ entry details
   *
   * @param entryId - Entry ID (message ID)
   * @returns DLQ entry or undefined
   */
  get(entryId: string): DlqEntry | undefined {
    return this.entries.get(entryId);
  }

  /**
   * Manual retry - re-queue message and reset retry count
   *
   * @param entryId - Entry ID to retry
   * @param actor - Who initiated retry
   * @returns The message to retry, or undefined if not found
   */
  retry(entryId: string, actor?: string): MessageEnvelope | undefined {
    const entry = this.entries.get(entryId);
    if (!entry) {
      console.warn(`[DLQ:${this.config.agentId}] Entry not found for retry: ${entryId}`);
      return undefined;
    }

    // Remove from DLQ
    this.entries.delete(entryId);

    // Persist deletion
    this.persistDeletion(entryId);

    // Audit log
    this.auditLog({
      operation: 'retry',
      entryId,
      timestamp: new Date().toISOString(),
      actor,
      reason: 'Manual retry',
      details: {
        originalFailureReason: entry.metadata.failureReason,
        retryCount: entry.metadata.retryHistory.length,
      },
    });

    console.log(
      `[DLQ:${this.config.agentId}] Manual retry initiated:`,
      `messageId=${entryId}`,
      `actor=${actor ?? 'unknown'}`
    );

    // Return message for re-queueing
    return entry.metadata.message;
  }

  /**
   * Permanently discard message from DLQ
   *
   * @param entryId - Entry ID to discard
   * @param actor - Who initiated discard
   * @param justification - Reason for discard
   */
  discard(entryId: string, actor?: string, justification?: string): void {
    const entry = this.entries.get(entryId);
    if (!entry) {
      console.warn(`[DLQ:${this.config.agentId}] Entry not found for discard: ${entryId}`);
      return;
    }

    // Remove from DLQ
    this.entries.delete(entryId);

    // Persist deletion
    this.persistDeletion(entryId);

    // Audit log
    this.auditLog({
      operation: 'discard',
      entryId,
      timestamp: new Date().toISOString(),
      actor,
      reason: justification ?? 'Manual discard',
      details: {
        failureReason: entry.metadata.failureReason,
        errorCode: entry.metadata.errorCode,
      },
    });

    console.log(
      `[DLQ:${this.config.agentId}] Message discarded:`,
      `messageId=${entryId}`,
      `actor=${actor ?? 'unknown'}`,
      `justification=${justification ?? 'N/A'}`
    );
  }

  /**
   * Export DLQ to JSON file for offline analysis
   *
   * @param exportPath - Path to export file
   */
  export(exportPath: string): void {
    const entries = Array.from(this.entries.values());

    const exportData = {
      agentId: this.config.agentId,
      exportedAt: new Date().toISOString(),
      totalEntries: entries.length,
      entries,
    };

    try {
      fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2), 'utf-8');
      console.log(
        `[DLQ:${this.config.agentId}] Exported ${entries.length} entries to ${exportPath}`
      );
    } catch (error) {
      console.error(`[DLQ:${this.config.agentId}] Export failed:`, error);
      throw error;
    }
  }

  // ==========================================================================
  // Monitoring and Statistics
  // ==========================================================================

  /**
   * Get DLQ statistics
   */
  getStats(): DlqStats {
    const entries = Array.from(this.entries.values());

    // Calculate oldest entry age
    let oldestEntryAge = 0;
    if (entries.length > 0) {
      const oldestAddedAt = Math.min(
        ...entries.map((e) => new Date(e.addedAt).getTime())
      );
      oldestEntryAge = Date.now() - oldestAddedAt;
    }

    // Count by failure reason
    const entriesByReason: Record<FailureReason, number> = {
      [FailureReason.MAX_RETRIES_EXCEEDED]: 0,
      [FailureReason.RECEIVER_TERMINATED]: 0,
      [FailureReason.SCHEMA_VALIDATION_FAILED]: 0,
      [FailureReason.CIRCUIT_BREAKER_OPEN]: 0,
      [FailureReason.PERMANENT_PROTOCOL_ERROR]: 0,
      [FailureReason.NACK_NOT_RECOVERABLE]: 0,
    };

    for (const entry of entries) {
      entriesByReason[entry.metadata.failureReason]++;
    }

    // Count by error code
    const entriesByErrorCode: Record<string, number> = {};
    for (const entry of entries) {
      const code = entry.metadata.errorCode ?? 'UNKNOWN';
      entriesByErrorCode[code] = (entriesByErrorCode[code] ?? 0) + 1;
    }

    // Common failure reasons (top 5)
    const commonFailureReasons = Object.entries(entriesByReason)
      .map(([reason, count]) => ({ reason: reason as FailureReason, count }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Growth rate (entries per hour, last 24h)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentAdds = this.addTimestamps.filter((t) => t > oneDayAgo);
    const growthRate = recentAdds.length / 24; // per hour

    return {
      totalEntries: entries.length,
      oldestEntryAge,
      entriesByReason,
      entriesByErrorCode,
      commonFailureReasons,
      growthRate,
    };
  }

  /**
   * Get DLQ summary for dashboard
   */
  getSummary(): string {
    const stats = this.getStats();
    const lines = [
      `DLQ Summary (${this.config.agentId}):`,
      `  Total entries: ${stats.totalEntries}`,
      `  Oldest entry: ${Math.round(stats.oldestEntryAge / 1000 / 60)} minutes ago`,
      `  Growth rate: ${stats.growthRate.toFixed(2)} entries/hour`,
      `  Common failures:`,
    ];

    for (const { reason, count } of stats.commonFailureReasons) {
      lines.push(`    - ${reason}: ${count}`);
    }

    return lines.join('\n');
  }

  // ==========================================================================
  // Auto-Purge and Retention
  // ==========================================================================

  /**
   * Auto-purge oldest entries when size limit exceeded
   */
  private autoPurgeOldest(): void {
    const entries = Array.from(this.entries.values());
    if (entries.length === 0) {
      return;
    }

    // Sort by addedAt (oldest first)
    entries.sort((a, b) => {
      return new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
    });

    // Remove oldest entry
    const oldest = entries[0];

    // Export before purging
    const exportPath = path.join(
      this.config.dlqDir,
      `purged-${oldest.entryId}.json`
    );
    try {
      fs.writeFileSync(
        exportPath,
        JSON.stringify(oldest, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error(`[DLQ:${this.config.agentId}] Failed to export before purge:`, error);
    }

    // Remove from DLQ
    this.entries.delete(oldest.entryId);

    // Persist deletion
    this.persistDeletion(oldest.entryId);

    // Audit log
    this.auditLog({
      operation: 'purge',
      entryId: oldest.entryId,
      timestamp: new Date().toISOString(),
      reason: 'Auto-purge: Size limit exceeded',
      details: {
        exportedTo: exportPath,
        age: Date.now() - new Date(oldest.addedAt).getTime(),
      },
    });

    console.warn(
      `[DLQ:${this.config.agentId}] Auto-purged oldest entry:`,
      `messageId=${oldest.entryId}`,
      `exported to ${exportPath}`
    );
  }

  /**
   * Purge entries older than retention period
   */
  purgeExpired(): void {
    const retentionMs = this.config.retentionDays * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - retentionMs;

    const entries = Array.from(this.entries.values());
    const expiredEntries = entries.filter((e) => {
      return new Date(e.addedAt).getTime() < cutoffTime;
    });

    if (expiredEntries.length === 0) {
      return;
    }

    // Export expired entries
    const exportPath = path.join(
      this.config.dlqDir,
      `expired-${new Date().toISOString()}.json`
    );
    try {
      fs.writeFileSync(
        exportPath,
        JSON.stringify(expiredEntries, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error(
        `[DLQ:${this.config.agentId}] Failed to export expired entries:`,
        error
      );
    }

    // Remove expired entries
    for (const entry of expiredEntries) {
      this.entries.delete(entry.entryId);
      this.persistDeletion(entry.entryId);
    }

    // Audit log
    this.auditLog({
      operation: 'purge',
      timestamp: new Date().toISOString(),
      reason: `Retention purge: ${expiredEntries.length} entries older than ${this.config.retentionDays} days`,
      details: {
        exportedTo: exportPath,
        entriesRemoved: expiredEntries.length,
      },
    });

    console.log(
      `[DLQ:${this.config.agentId}] Purged ${expiredEntries.length} expired entries`,
      `(exported to ${exportPath})`
    );
  }

  // ==========================================================================
  // Threshold Monitoring
  // ==========================================================================

  /**
   * Check DLQ thresholds and emit alerts
   */
  private checkThresholds(): void {
    const size = this.entries.size;

    if (size >= this.config.criticalThreshold) {
      console.error(
        `[DLQ:${this.config.agentId}] CRITICAL: DLQ size ${size} >= ${this.config.criticalThreshold}`
      );
    } else if (size >= this.config.warningThreshold) {
      console.warn(
        `[DLQ:${this.config.agentId}] WARNING: DLQ size ${size} >= ${this.config.warningThreshold}`
      );
    }
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Ensure DLQ directory exists
   */
  private ensureDlqDirectory(): void {
    if (!fs.existsSync(this.config.dlqDir)) {
      fs.mkdirSync(this.config.dlqDir, { recursive: true });
    }
  }

  /**
   * Load persisted DLQ entries from file
   */
  private loadPersistedEntries(): void {
    if (!fs.existsSync(this.dlqFilePath)) {
      return; // No persisted DLQ yet
    }

    try {
      const content = fs.readFileSync(this.dlqFilePath, 'utf-8');
      const lines = content.trim().split('\n').filter((line) => line.length > 0);

      for (const line of lines) {
        const entry: DlqEntry = JSON.parse(line);
        this.entries.set(entry.entryId, entry);
      }
    } catch (error) {
      console.error(
        `[DLQ:${this.config.agentId}] Failed to load persisted DLQ:`,
        error
      );
      // Continue with empty DLQ on error
    }
  }

  /**
   * Persist DLQ entry to file (append-only)
   */
  private persistEntry(entry: DlqEntry): void {
    const line = JSON.stringify(entry) + '\n';

    try {
      fs.appendFileSync(this.dlqFilePath, line, 'utf-8');
    } catch (error) {
      console.error(`[DLQ:${this.config.agentId}] Failed to persist DLQ entry:`, error);
    }
  }

  /**
   * Persist deletion (by rewriting entire file without deleted entry)
   */
  private persistDeletion(entryId: string): void {
    try {
      const entries = Array.from(this.entries.values());
      const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';

      // Atomic write: write-tmp-rename pattern
      const tmpPath = `${this.dlqFilePath}.tmp`;
      fs.writeFileSync(tmpPath, content, 'utf-8');
      fs.renameSync(tmpPath, this.dlqFilePath);
    } catch (error) {
      console.error(`[DLQ:${this.config.agentId}] Failed to persist deletion:`, error);
    }
  }

  /**
   * Audit log operation
   */
  private auditLog(entry: AuditLogEntry): void {
    const line = JSON.stringify(entry) + '\n';

    try {
      fs.appendFileSync(this.auditLogPath, line, 'utf-8');
    } catch (error) {
      console.error(`[DLQ:${this.config.agentId}] Failed to write audit log:`, error);
    }
  }
}
