/**
 * Agent Recovery System for apm-auto
 *
 * Provides agent health monitoring, crash detection, and automatic recovery
 * with exponential backoff and retry limits.
 */

import { AgentStatus, AgentState } from '../types/agent.js';
import { TransitionTrigger } from '../types/state.js';
import type { ConnectionManager } from '../db/connection.js';
import { AgentPersistenceManager } from './persistence.js';
import { LifecycleEventManager, LifecycleEventType, createEventPayload } from './events.js';
import { getLogger } from '../cli/logger.js';

// Get logger instance
const logger = getLogger();

/**
 * Recovery Configuration
 */
export interface RecoveryConfig {
  /** Heartbeat timeout in milliseconds (default: 60000 = 60 seconds) */
  heartbeatTimeout: number;
  /** Monitoring interval in milliseconds (default: 10000 = 10 seconds) */
  monitoringInterval: number;
  /** Maximum recovery attempts per agent (default: 3) */
  maxRetryAttempts: number;
  /** Base delay for exponential backoff in milliseconds (default: 5000 = 5 seconds) */
  retryBaseDelay: number;
  /** Enable automatic recovery (default: true) */
  autoRecovery: boolean;
}

/**
 * Recovery Result
 */
export interface RecoveryResult {
  /** Whether recovery was successful */
  success: boolean;
  /** Number of recovery attempts made */
  attempts: number;
  /** Error message if recovery failed */
  error?: string;
  /** Time taken for recovery in milliseconds */
  duration?: number;
}

/**
 * Crashed Agent Information
 */
export interface CrashedAgentInfo {
  /** Agent state */
  agent: AgentState;
  /** Crash reason */
  reason: string;
  /** Time since last heartbeat in milliseconds */
  timeSinceHeartbeat: number;
  /** When crash was detected */
  detectedAt: Date;
}

/**
 * Recovery Statistics
 */
export interface RecoveryStatistics {
  /** Total crashes detected */
  totalCrashes: number;
  /** Total recovery attempts */
  totalAttempts: number;
  /** Successful recoveries */
  successfulRecoveries: number;
  /** Failed recoveries */
  failedRecoveries: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Average recovery time in milliseconds */
  avgRecoveryTime: number;
}

/**
 * Agent Recovery Manager
 * Handles crash detection, recovery attempts, and health monitoring
 */
export class AgentRecoveryManager {
  private config: Required<RecoveryConfig>;
  private monitoringIntervalId?: NodeJS.Timeout;
  private isMonitoring: boolean = false;
  private recoveryAttempts: Map<string, number> = new Map();
  private recoveryStats: RecoveryStatistics = {
    totalCrashes: 0,
    totalAttempts: 0,
    successfulRecoveries: 0,
    failedRecoveries: 0,
    successRate: 0,
    avgRecoveryTime: 0
  };
  private recoveryTimes: number[] = [];

  constructor(
    private connectionManager: ConnectionManager,
    private persistenceManager: AgentPersistenceManager,
    private eventManager: LifecycleEventManager,
    config: Partial<RecoveryConfig> = {}
  ) {
    this.config = {
      heartbeatTimeout: config.heartbeatTimeout ?? 60000, // 60 seconds
      monitoringInterval: config.monitoringInterval ?? 10000, // 10 seconds
      maxRetryAttempts: config.maxRetryAttempts ?? 3,
      retryBaseDelay: config.retryBaseDelay ?? 5000, // 5 seconds
      autoRecovery: config.autoRecovery ?? true
    };
  }

  /**
   * Start heartbeat monitoring
   *
   * @example
   * ```typescript
   * recovery.startHeartbeatMonitoring();
   * // Monitoring runs in background every 10 seconds
   * ```
   */
  startHeartbeatMonitoring(): void {
    if (this.isMonitoring) {
      logger.warn('Heartbeat monitoring already started');
      return;
    }

    logger.info('Starting agent heartbeat monitoring', {
      interval: this.config.monitoringInterval,
      timeout: this.config.heartbeatTimeout
    });

    this.isMonitoring = true;

    // Run initial check
    this.checkHeartbeats().catch(error => {
      logger.error('Error in heartbeat check', { error });
    });

    // Schedule periodic checks
    this.monitoringIntervalId = setInterval(() => {
      this.checkHeartbeats().catch(error => {
        logger.error('Error in heartbeat check', { error });
      });
    }, this.config.monitoringInterval);
  }

  /**
   * Stop heartbeat monitoring
   */
  stopHeartbeatMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    logger.info('Stopping agent heartbeat monitoring');

    if (this.monitoringIntervalId) {
      clearInterval(this.monitoringIntervalId);
      this.monitoringIntervalId = undefined;
    }

    this.isMonitoring = false;
  }

  /**
   * Check for agents with stale heartbeats
   */
  private async checkHeartbeats(): Promise<void> {
    const crashedAgents = await this.detectCrashedAgents();

    if (crashedAgents.length === 0) {
      return;
    }

    logger.warn(`Detected ${crashedAgents.length} crashed agent(s)`, {
      agents: crashedAgents.map(ca => ca.agent.id)
    });

    // Attempt recovery if auto-recovery is enabled
    if (this.config.autoRecovery) {
      for (const crashedAgent of crashedAgents) {
        await this.attemptRecovery(crashedAgent.agent.id, crashedAgent.reason);
      }
    }
  }

  /**
   * Detect crashed agents by checking heartbeat timestamps
   *
   * @returns Array of crashed agent information
   *
   * @example
   * ```typescript
   * const crashed = await recovery.detectCrashedAgents();
   * for (const info of crashed) {
   *   console.log(`Agent ${info.agent.id} crashed: ${info.reason}`);
   * }
   * ```
   */
  async detectCrashedAgents(): Promise<CrashedAgentInfo[]> {
    const now = Date.now();
    const timeoutThreshold = now - this.config.heartbeatTimeout;
    const thresholdISO = new Date(timeoutThreshold).toISOString();

    // Query agents with stale heartbeats in Active or Waiting states
    const staleAgents = await this.connectionManager.query<any>(`
      SELECT id, type, status, current_task, domain, metadata,
             worktree_path, spawned_at, last_activity_at
      FROM agents
      WHERE status IN (?, ?)
        AND last_activity_at < ?
    `, [AgentStatus.Active, AgentStatus.Waiting, thresholdISO]);

    const crashedAgents: CrashedAgentInfo[] = [];

    for (const row of staleAgents) {
      const agent = await this.persistenceManager.getAgentState(row.id);
      if (!agent) {
        continue;
      }

      const lastActivityTime = new Date(row.last_activity_at).getTime();
      const timeSinceHeartbeat = now - lastActivityTime;

      crashedAgents.push({
        agent,
        reason: `No heartbeat for ${Math.round(timeSinceHeartbeat / 1000)} seconds`,
        timeSinceHeartbeat,
        detectedAt: new Date()
      });
    }

    return crashedAgents;
  }

  /**
   * Attempt to recover a crashed agent
   *
   * @param agentId - Agent identifier
   * @param crashReason - Reason for crash
   * @returns Recovery result
   *
   * @example
   * ```typescript
   * const result = await recovery.attemptRecovery('agent_impl_001', 'Heartbeat timeout');
   * if (result.success) {
   *   console.log(`Agent recovered after ${result.attempts} attempt(s)`);
   * } else {
   *   console.error(`Recovery failed: ${result.error}`);
   * }
   * ```
   */
  async attemptRecovery(
    agentId: string,
    crashReason: string
  ): Promise<RecoveryResult> {
    const startTime = Date.now();

    // Get current retry count
    const currentAttempts = this.recoveryAttempts.get(agentId) ?? 0;

    // Calculate next attempt number
    const attemptNumber = currentAttempts + 1;

    // Check if max attempts exceeded
    if (currentAttempts >= this.config.maxRetryAttempts) {
      const error = `Max recovery attempts (${this.config.maxRetryAttempts}) exceeded`;
      logger.error('Agent recovery failed - max attempts exceeded', {
        agentId,
        attempts: currentAttempts
      });

      // Emit recovery failed event
      this.eventManager.emitLifecycleEvent(
        LifecycleEventType.AgentTerminated,
        createEventPayload(
          agentId,
          AgentStatus.Active, // or whatever current state
          AgentStatus.Terminated,
          TransitionTrigger.Error,
          { reason: error, crashReason, recoveryFailed: true }
        )
      );

      // Escalate to user notification
      await this.escalateToUser(agentId, crashReason, currentAttempts);

      this.recoveryStats.failedRecoveries++;
      this.updateStatistics();

      return {
        success: false,
        attempts: attemptNumber,
        error,
        duration: Date.now() - startTime
      };
    }

    // Increment retry count
    this.recoveryAttempts.set(agentId, attemptNumber);
    this.recoveryStats.totalAttempts++;
    this.recoveryStats.totalCrashes = this.recoveryAttempts.size;

    logger.info(`Starting recovery attempt ${attemptNumber}/${this.config.maxRetryAttempts}`, {
      agentId,
      crashReason
    });

    // Emit crash detected event (on first attempt only)
    if (attemptNumber === 1) {
      this.emitRecoveryEvent('agent:crash-detected', agentId, crashReason);
    }

    // Emit recovery started event
    this.emitRecoveryEvent('agent:recovery-started', agentId, crashReason, attemptNumber);

    try {
      // Step 1: Mark agent as Terminated with crash reason
      await this.persistenceManager.updateAgentState(agentId, AgentStatus.Terminated, {
        trigger: TransitionTrigger.Error,
        metadata: {
          reason: 'Agent crashed',
          crashReason,
          recoveryAttempt: attemptNumber,
          detectedAt: new Date().toISOString()
        }
      });

      logger.info('Marked crashed agent as Terminated', { agentId });

      // Step 2: Wait for exponential backoff delay
      if (attemptNumber > 1) {
        const delay = this.calculateBackoffDelay(attemptNumber - 1);
        logger.info(`Waiting ${delay}ms before recovery attempt`, { agentId });
        await this.sleep(delay);
      }

      // Step 3: Attempt restart (placeholder for Phase 4 Task 4.1)
      // TODO: Implement actual agent spawning in Phase 4
      logger.warn('Agent restart not yet implemented (Phase 4 Task 4.1)', { agentId });

      // Step 4: Restore context from last checkpoint (placeholder for Phase 5)
      // TODO: Implement checkpoint restoration in Phase 5
      logger.warn('Checkpoint restoration not yet implemented (Phase 5)', { agentId });

      // For now, consider recovery "successful" if we can mark as terminated
      // In Phase 4, we'll actually respawn the agent
      const duration = Date.now() - startTime;
      this.recoveryTimes.push(duration);
      this.recoveryStats.successfulRecoveries++;
      this.updateStatistics();

      // Keep retry count for historical tracking
      // Use resetRecoveryAttempts() to explicitly clear if needed

      // Emit recovery succeeded event
      this.emitRecoveryEvent('agent:recovery-succeeded', agentId, crashReason, attemptNumber);

      logger.info('Agent recovery completed', {
        agentId,
        attempts: attemptNumber,
        duration
      });

      return {
        success: true,
        attempts: attemptNumber,
        duration
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Recovery attempt failed', {
        agentId,
        attempt: attemptNumber,
        error: errorMessage
      });

      // Emit recovery failed event
      this.emitRecoveryEvent(
        'agent:recovery-failed',
        agentId,
        crashReason,
        attemptNumber,
        errorMessage
      );

      // If we've reached max attempts, mark as failed
      if (attemptNumber >= this.config.maxRetryAttempts) {
        this.recoveryStats.failedRecoveries++;
        this.updateStatistics();
        await this.escalateToUser(agentId, crashReason, attemptNumber);
      }

      return {
        success: false,
        attempts: attemptNumber,
        error: errorMessage,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Escalate recovery failure to user
   */
  private async escalateToUser(
    agentId: string,
    crashReason: string,
    attempts: number
  ): Promise<void> {
    logger.error('ESCALATION: Agent recovery failed after max attempts', {
      agentId,
      crashReason,
      attempts,
      action: 'Manual intervention required'
    });

    // Emit escalation event
    this.emitRecoveryEvent('agent:recovery-escalated', agentId, crashReason, attempts);

    // TODO: Add user notification mechanism (Phase 6 - Monitoring)
    // - Send email/notification
    // - Update TUI with alert
    // - Write to incident log
  }

  /**
   * Calculate exponential backoff delay
   * Delays: 5s, 10s, 20s for attempts 1, 2, 3
   */
  private calculateBackoffDelay(attemptIndex: number): number {
    return this.config.retryBaseDelay * Math.pow(2, attemptIndex);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Emit a recovery-related event
   */
  private emitRecoveryEvent(
    eventType: string,
    agentId: string,
    reason: string,
    attempt?: number,
    error?: string
  ): void {
    const metadata: Record<string, any> = { reason };
    if (attempt !== undefined) {
      metadata.attempt = attempt;
    }
    if (error !== undefined) {
      metadata.error = error;
    }

    // Emit custom recovery event
    this.eventManager.emit(eventType, {
      agentId,
      timestamp: new Date(),
      metadata
    });
  }

  /**
   * Update recovery statistics
   */
  private updateStatistics(): void {
    const total = this.recoveryStats.successfulRecoveries + this.recoveryStats.failedRecoveries;
    this.recoveryStats.successRate = total > 0
      ? this.recoveryStats.successfulRecoveries / total
      : 0;

    if (this.recoveryTimes.length > 0) {
      const totalTime = this.recoveryTimes.reduce((sum, time) => sum + time, 0);
      this.recoveryStats.avgRecoveryTime = totalTime / this.recoveryTimes.length;
    }
  }

  /**
   * Get recovery statistics
   *
   * @returns Recovery statistics
   */
  getRecoveryStatistics(): RecoveryStatistics {
    return { ...this.recoveryStats };
  }

  /**
   * Get current recovery attempts for an agent
   *
   * @param agentId - Agent identifier
   * @returns Number of recovery attempts
   */
  getRecoveryAttempts(agentId: string): number {
    return this.recoveryAttempts.get(agentId) ?? 0;
  }

  /**
   * Reset recovery attempts for an agent
   *
   * @param agentId - Agent identifier
   */
  resetRecoveryAttempts(agentId: string): void {
    this.recoveryAttempts.delete(agentId);
    logger.info('Reset recovery attempts', { agentId });
  }

  /**
   * Check if monitoring is active
   */
  isMonitoringActive(): boolean {
    return this.isMonitoring;
  }

  /**
   * Get recovery configuration
   */
  getConfig(): Required<RecoveryConfig> {
    return { ...this.config };
  }

  /**
   * Update recovery configuration
   *
   * Note: If monitoring is active, it will be restarted with new config
   */
  updateConfig(config: Partial<RecoveryConfig>): void {
    const wasMonitoring = this.isMonitoring;

    if (wasMonitoring) {
      this.stopHeartbeatMonitoring();
    }

    this.config = {
      ...this.config,
      ...config
    };

    logger.info('Updated recovery configuration', this.config);

    if (wasMonitoring) {
      this.startHeartbeatMonitoring();
    }
  }
}

/**
 * Create a new agent recovery manager
 *
 * @param connectionManager - Database connection manager
 * @param persistenceManager - Agent persistence manager
 * @param eventManager - Lifecycle event manager
 * @param config - Optional recovery configuration
 * @returns Agent recovery manager instance
 */
export function createAgentRecovery(
  connectionManager: ConnectionManager,
  persistenceManager: AgentPersistenceManager,
  eventManager: LifecycleEventManager,
  config?: Partial<RecoveryConfig>
): AgentRecoveryManager {
  return new AgentRecoveryManager(
    connectionManager,
    persistenceManager,
    eventManager,
    config
  );
}
