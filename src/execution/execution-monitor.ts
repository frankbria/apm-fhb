/**
 * Execution Monitoring System
 *
 * Tracks Implementation agent work progress, detects anomalies, records milestones,
 * collects execution metrics, and emits events for Manager coordination.
 */

import { EventEmitter } from 'events';
import { type ProcessTracker } from '../spawn/process-tracker.js';

/**
 * Milestone type
 */
export enum MilestoneType {
  /** Subtask completed */
  SubtaskCompleted = 'subtask_completed',
  /** Test passed */
  TestPassed = 'test_passed',
  /** Deliverable created */
  DeliverableCreated = 'deliverable_created',
  /** Coverage threshold reached */
  CoverageReached = 'coverage_reached',
  /** Build successful */
  BuildSuccessful = 'build_successful',
  /** Custom milestone */
  Custom = 'custom',
}

/**
 * Anomaly type
 */
export enum AnomalyType {
  /** No progress for threshold duration */
  NoProgress = 'no_progress',
  /** Repeated errors */
  RepeatedErrors = 'repeated_errors',
  /** Process unhealthy */
  ProcessUnhealthy = 'process_unhealthy',
  /** Memory usage high */
  HighMemoryUsage = 'high_memory_usage',
  /** Execution timeout */
  ExecutionTimeout = 'execution_timeout',
}

/**
 * Anomaly severity
 */
export enum AnomalySeverity {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Critical = 'critical',
}

/**
 * Milestone record
 */
export interface Milestone {
  /** Milestone type */
  type: MilestoneType;
  /** Description */
  description: string;
  /** Timestamp */
  timestamp: Date;
  /** Progress percentage (0-100) */
  progressPercent: number;
}

/**
 * Anomaly record
 */
export interface Anomaly {
  /** Anomaly type */
  type: AnomalyType;
  /** Description */
  description: string;
  /** Severity */
  severity: AnomalySeverity;
  /** Timestamp */
  timestamp: Date;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Execution metrics
 */
export interface ExecutionMetrics {
  /** Time elapsed (ms) */
  timeElapsedMs: number;
  /** Steps completed */
  stepsCompleted: number;
  /** Tests run */
  testsRun: number;
  /** Coverage percentage */
  coveragePercent: number;
  /** Files created */
  filesCreated: number;
  /** Files modified */
  filesModified: number;
  /** Estimated completion time (ms) */
  estimatedCompletionMs: number | null;
}

/**
 * Monitoring state
 */
export enum MonitoringState {
  /** Not started */
  NotStarted = 'not_started',
  /** Monitoring active */
  Active = 'active',
  /** Paused */
  Paused = 'paused',
  /** Stopped */
  Stopped = 'stopped',
}

/**
 * Execution monitoring session
 */
export interface MonitoringSession {
  /** Session ID */
  id: string;
  /** Agent ID */
  agentId: string;
  /** Task ID */
  taskId: string;
  /** Start time */
  startTime: Date;
  /** State */
  state: MonitoringState;
  /** Milestones */
  milestones: Milestone[];
  /** Anomalies */
  anomalies: Anomaly[];
  /** Current metrics */
  metrics: ExecutionMetrics;
}

/**
 * Execution monitor configuration
 */
export interface ExecutionMonitorConfig {
  /** Process tracker instance */
  processTracker?: ProcessTracker;
  /** Health check interval (ms) */
  healthCheckIntervalMs?: number;
  /** No progress threshold (ms) */
  noProgressThresholdMs?: number;
  /** Anomaly check interval (ms) */
  anomalyCheckIntervalMs?: number;
  /** Expected total steps (for progress calculation) */
  expectedTotalSteps?: number;
}

/**
 * Execution Monitor
 * Monitors Implementation agent execution progress and detects anomalies
 */
export class ExecutionMonitor extends EventEmitter {
  private config: ExecutionMonitorConfig;
  private sessions: Map<string, MonitoringSession>;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private anomalyCheckInterval: NodeJS.Timeout | null = null;
  private errorPatternCache: Map<string, number>; // Track error patterns

  constructor(config: ExecutionMonitorConfig) {
    super();
    this.config = config;
    this.sessions = new Map();
    this.errorPatternCache = new Map();
  }

  /**
   * Start monitoring an agent's task execution
   *
   * @param agentId - Agent ID
   * @param taskId - Task ID
   * @returns Monitoring session ID
   */
  startMonitoring(agentId: string, taskId: string): string {
    const sessionId = `${agentId}-${taskId}-${Date.now()}`;

    const session: MonitoringSession = {
      id: sessionId,
      agentId,
      taskId,
      startTime: new Date(),
      state: MonitoringState.Active,
      milestones: [],
      anomalies: [],
      metrics: {
        timeElapsedMs: 0,
        stepsCompleted: 0,
        testsRun: 0,
        coveragePercent: 0,
        filesCreated: 0,
        filesModified: 0,
        estimatedCompletionMs: null,
      },
    };

    this.sessions.set(sessionId, session);

    // Start periodic health checks
    this.startHealthChecks();

    // Start anomaly detection
    this.startAnomalyDetection();

    this.emit('monitoring_started', {
      sessionId,
      agentId,
      taskId,
      startTime: session.startTime,
    });

    return sessionId;
  }

  /**
   * Stop monitoring
   *
   * @param sessionId - Monitoring session ID
   */
  stopMonitoring(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.state = MonitoringState.Stopped;

    // Update final metrics
    session.metrics.timeElapsedMs = Date.now() - session.startTime.getTime();

    this.emit('monitoring_stopped', {
      sessionId,
      agentId: session.agentId,
      taskId: session.taskId,
      duration: session.metrics.timeElapsedMs,
      finalMetrics: session.metrics,
    });

    // Clean up if no more active sessions
    if (!Array.from(this.sessions.values()).some(s => s.state === MonitoringState.Active)) {
      this.stopHealthChecks();
      this.stopAnomalyDetection();
    }
  }

  /**
   * Pause monitoring
   *
   * @param sessionId - Monitoring session ID
   */
  pauseMonitoring(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== MonitoringState.Active) {
      return;
    }

    session.state = MonitoringState.Paused;

    // Update elapsed time before pausing
    session.metrics.timeElapsedMs = Date.now() - session.startTime.getTime();

    this.emit('monitoring_paused', {
      sessionId,
      agentId: session.agentId,
      taskId: session.taskId,
    });
  }

  /**
   * Resume monitoring
   *
   * @param sessionId - Monitoring session ID
   */
  resumeMonitoring(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== MonitoringState.Paused) {
      return;
    }

    session.state = MonitoringState.Active;

    // Adjust start time to account for pause duration
    const pausedDuration = Date.now() - (session.startTime.getTime() + session.metrics.timeElapsedMs);
    session.startTime = new Date(session.startTime.getTime() + pausedDuration);

    this.emit('monitoring_resumed', {
      sessionId,
      agentId: session.agentId,
      taskId: session.taskId,
    });
  }

  /**
   * Record milestone
   *
   * @param sessionId - Monitoring session ID
   * @param milestoneType - Milestone type
   * @param description - Milestone description
   */
  recordMilestone(sessionId: string, milestoneType: MilestoneType, description: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Update steps completed for certain milestone types
    if (
      milestoneType === MilestoneType.SubtaskCompleted ||
      milestoneType === MilestoneType.DeliverableCreated
    ) {
      session.metrics.stepsCompleted++;
    }

    // Update tests run
    if (milestoneType === MilestoneType.TestPassed) {
      session.metrics.testsRun++;
    }

    // Calculate progress percentage
    const expectedTotal = this.config.expectedTotalSteps ?? 10;
    const progressPercent = Math.min(
      Math.round((session.metrics.stepsCompleted / expectedTotal) * 100),
      100
    );

    const milestone: Milestone = {
      type: milestoneType,
      description,
      timestamp: new Date(),
      progressPercent,
    };

    session.milestones.push(milestone);

    // Update estimated completion time
    if (session.metrics.stepsCompleted > 0) {
      const elapsedMs = Date.now() - session.startTime.getTime();
      const avgTimePerStep = elapsedMs / session.metrics.stepsCompleted;
      const remainingSteps = expectedTotal - session.metrics.stepsCompleted;
      session.metrics.estimatedCompletionMs = Math.round(avgTimePerStep * remainingSteps);
    }

    this.emit('milestone_reached', {
      sessionId,
      agentId: session.agentId,
      taskId: session.taskId,
      milestoneType,
      description,
      timestamp: milestone.timestamp,
      progressPercent,
    });
  }

  /**
   * Track metrics
   *
   * @param sessionId - Monitoring session ID
   * @returns Current metrics
   */
  trackMetrics(sessionId: string): ExecutionMetrics | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    // Update time elapsed
    if (session.state === MonitoringState.Active) {
      session.metrics.timeElapsedMs = Date.now() - session.startTime.getTime();
    }

    return { ...session.metrics };
  }

  /**
   * Update metrics
   *
   * @param sessionId - Monitoring session ID
   * @param updates - Metric updates
   */
  updateMetrics(
    sessionId: string,
    updates: Partial<Omit<ExecutionMetrics, 'timeElapsedMs'>>
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Update metrics (excluding timeElapsedMs which is calculated)
    if (updates.stepsCompleted !== undefined) {
      session.metrics.stepsCompleted = updates.stepsCompleted;
    }
    if (updates.testsRun !== undefined) {
      session.metrics.testsRun = updates.testsRun;
    }
    if (updates.coveragePercent !== undefined) {
      session.metrics.coveragePercent = updates.coveragePercent;
    }
    if (updates.filesCreated !== undefined) {
      session.metrics.filesCreated = updates.filesCreated;
    }
    if (updates.filesModified !== undefined) {
      session.metrics.filesModified = updates.filesModified;
    }
  }

  /**
   * Detect anomalies for active sessions
   */
  private detectAnomalies(): void {
    for (const session of this.sessions.values()) {
      if (session.state !== MonitoringState.Active) {
        continue;
      }

      // Check for no progress
      this.checkNoProgress(session);

      // Check process health if tracker available
      if (this.config.processTracker) {
        this.checkProcessHealth(session);
      }

      // Check for repeated errors
      this.checkRepeatedErrors(session);
    }
  }

  /**
   * Check for no progress anomaly
   *
   * @param session - Monitoring session
   */
  private checkNoProgress(session: MonitoringSession): void {
    const threshold = this.config.noProgressThresholdMs ?? 5 * 60 * 1000; // 5 minutes

    if (session.milestones.length === 0) {
      const timeSinceStart = Date.now() - session.startTime.getTime();
      if (timeSinceStart > threshold) {
        this.recordAnomaly(
          session.id,
          AnomalyType.NoProgress,
          `No milestones recorded for ${Math.round(timeSinceStart / 1000)}s`,
          AnomalySeverity.High
        );
      }
      return;
    }

    const lastMilestone = session.milestones[session.milestones.length - 1];
    const timeSinceLastMilestone = Date.now() - lastMilestone.timestamp.getTime();

    if (timeSinceLastMilestone > threshold) {
      this.recordAnomaly(
        session.id,
        AnomalyType.NoProgress,
        `No progress for ${Math.round(timeSinceLastMilestone / 1000)}s since last milestone`,
        AnomalySeverity.Medium
      );
    }
  }

  /**
   * Check process health
   *
   * @param session - Monitoring session
   */
  private checkProcessHealth(session: MonitoringSession): void {
    if (!this.config.processTracker) {
      return;
    }

    // Check if process is still running
    const processInfo = this.config.processTracker.getProcessInfo(session.agentId);
    if (!processInfo) {
      this.recordAnomaly(
        session.id,
        AnomalyType.ProcessUnhealthy,
        'Process not found in tracker',
        AnomalySeverity.Critical
      );
      return;
    }

    // Check memory usage if available
    if (processInfo.metrics?.memoryUsage) {
      const memoryMB = processInfo.metrics.memoryUsage / (1024 * 1024);
      if (memoryMB > 1024) {
        // > 1GB
        this.recordAnomaly(
          session.id,
          AnomalyType.HighMemoryUsage,
          `High memory usage: ${Math.round(memoryMB)}MB`,
          AnomalySeverity.Medium,
          { memoryMB }
        );
      }
    }
  }

  /**
   * Check for repeated errors
   *
   * @param session - Monitoring session
   */
  private checkRepeatedErrors(session: MonitoringSession): void {
    // Look for recent anomalies with same pattern
    const recentAnomalies = session.anomalies.filter(
      a => Date.now() - a.timestamp.getTime() < 60 * 1000 // Last minute
    );

    // Group by description pattern
    const errorCounts = new Map<string, number>();
    for (const anomaly of recentAnomalies) {
      const pattern = this.extractErrorPattern(anomaly.description);
      errorCounts.set(pattern, (errorCounts.get(pattern) || 0) + 1);
    }

    // Check for patterns occurring 3+ times
    for (const [pattern, count] of errorCounts) {
      if (count >= 3) {
        this.recordAnomaly(
          session.id,
          AnomalyType.RepeatedErrors,
          `Error pattern repeated ${count} times: ${pattern}`,
          AnomalySeverity.High,
          { pattern, count }
        );
      }
    }
  }

  /**
   * Extract error pattern from description
   *
   * @param description - Error description
   * @returns Error pattern
   */
  private extractErrorPattern(description: string): string {
    // Remove numbers and specific values to identify pattern
    return description
      .replace(/\d+/g, 'N')
      .replace(/[a-f0-9]{8,}/gi, 'HASH')
      .substring(0, 100);
  }

  /**
   * Record anomaly
   *
   * @param sessionId - Monitoring session ID
   * @param type - Anomaly type
   * @param description - Description
   * @param severity - Severity
   * @param context - Additional context
   */
  private recordAnomaly(
    sessionId: string,
    type: AnomalyType,
    description: string,
    severity: AnomalySeverity,
    context?: Record<string, unknown>
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Check if similar anomaly was recently reported (avoid spam)
    const recentSimilar = session.anomalies.find(
      a =>
        a.type === type &&
        a.description === description &&
        Date.now() - a.timestamp.getTime() < 60 * 1000 // Last minute
    );

    if (recentSimilar) {
      return; // Don't report duplicate
    }

    const anomaly: Anomaly = {
      type,
      description,
      severity,
      timestamp: new Date(),
      context,
    };

    session.anomalies.push(anomaly);

    this.emit('anomaly_detected', {
      sessionId,
      agentId: session.agentId,
      taskId: session.taskId,
      anomalyType: type,
      description,
      severity,
      timestamp: anomaly.timestamp,
      context,
    });
  }

  /**
   * Get monitoring session
   *
   * @param sessionId - Session ID
   * @returns Monitoring session or null
   */
  getSession(sessionId: string): MonitoringSession | null {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : null;
  }

  /**
   * Get all active sessions
   *
   * @returns Active monitoring sessions
   */
  getActiveSessions(): MonitoringSession[] {
    return Array.from(this.sessions.values()).filter(s => s.state === MonitoringState.Active);
  }

  /**
   * Start health checks
   */
  private startHealthChecks(): void {
    if (this.healthCheckInterval) {
      return; // Already running
    }

    const interval = this.config.healthCheckIntervalMs ?? 30 * 1000; // 30 seconds
    this.healthCheckInterval = setInterval(() => {
      for (const session of this.sessions.values()) {
        if (session.state === MonitoringState.Active && this.config.processTracker) {
          this.checkProcessHealth(session);
        }
      }
    }, interval);
  }

  /**
   * Stop health checks
   */
  private stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Start anomaly detection
   */
  private startAnomalyDetection(): void {
    if (this.anomalyCheckInterval) {
      return; // Already running
    }

    const interval = this.config.anomalyCheckIntervalMs ?? 60 * 1000; // 1 minute
    this.anomalyCheckInterval = setInterval(() => {
      this.detectAnomalies();
    }, interval);
  }

  /**
   * Stop anomaly detection
   */
  private stopAnomalyDetection(): void {
    if (this.anomalyCheckInterval) {
      clearInterval(this.anomalyCheckInterval);
      this.anomalyCheckInterval = null;
    }
  }

  /**
   * Clean up all monitoring sessions
   */
  cleanup(): void {
    this.stopHealthChecks();
    this.stopAnomalyDetection();
    this.sessions.clear();
    this.errorPatternCache.clear();
    this.removeAllListeners();
  }
}

/**
 * Create an ExecutionMonitor instance
 *
 * @param config - Execution monitor configuration
 * @returns ExecutionMonitor instance
 */
export function createExecutionMonitor(config: ExecutionMonitorConfig): ExecutionMonitor {
  return new ExecutionMonitor(config);
}
