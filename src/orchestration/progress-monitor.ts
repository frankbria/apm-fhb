/**
 * Progress Monitoring via Memory Logs
 *
 * Monitors agent progress by watching memory log files, detecting completion markers,
 * tracking activity timestamps, and identifying stalled agents.
 */

import fs from 'fs/promises';
import { type AgentState, AgentStatus } from '../types/agent.js';
import { type AgentPersistenceManager } from '../state/persistence.js';

/**
 * Task progress status
 */
export enum TaskProgress {
  /** Not started */
  NotStarted = 'NotStarted',
  /** In progress */
  InProgress = 'InProgress',
  /** Completed successfully */
  Completed = 'Completed',
  /** Failed or blocked */
  Failed = 'Failed',
}

/**
 * Progress indicators found in memory logs
 */
export interface ProgressIndicators {
  /** Has completion marker (✓, ✅, [x], COMPLETE) */
  hasCompletionMarker: boolean;
  /** Has error indicators */
  hasErrors: boolean;
  /** Has blocking indicators */
  hasBlockers: boolean;
  /** Total lines in log */
  totalLines: number;
  /** Last activity timestamp (from file modification time) */
  lastActivity: Date;
}

/**
 * Agent progress summary
 */
export interface AgentProgress {
  /** Agent ID */
  agentId: string;
  /** Current task */
  currentTask: string | null;
  /** Task progress status */
  taskProgress: TaskProgress;
  /** Memory log path */
  memoryLogPath: string | null;
  /** Progress indicators */
  indicators: ProgressIndicators | null;
  /** Time since last activity (ms) */
  timeSinceActivity: number;
  /** Is agent stalled */
  isStalled: boolean;
  /** Agent status */
  agentStatus: AgentStatus;
}

/**
 * Progress monitoring configuration
 */
export interface ProgressMonitorConfig {
  /** Agent persistence manager */
  persistence: AgentPersistenceManager;
  /** Base memory path */
  memoryBasePath: string;
  /** Stall threshold in milliseconds (default: 5 minutes) */
  stallThresholdMs?: number;
}

/**
 * Progress Monitor
 * Monitors agent progress via memory log files
 */
export class ProgressMonitor {
  private config: ProgressMonitorConfig;
  private stallThresholdMs: number;

  constructor(config: ProgressMonitorConfig) {
    this.config = config;
    this.stallThresholdMs = config.stallThresholdMs ?? 5 * 60 * 1000; // 5 minutes default
  }

  /**
   * Get progress for a specific agent
   *
   * @param agentId - Agent ID
   * @returns Agent progress or null if agent not found
   */
  async getAgentProgress(agentId: string): Promise<AgentProgress | null> {
    const agent = await this.config.persistence.getAgentState(agentId);
    if (!agent) {
      return null;
    }

    // Get memory log path from agent metadata
    const memoryLogPath = agent.metadata.custom_metadata?.memoryLogPath as string | undefined;

    let indicators: ProgressIndicators | null = null;
    let taskProgress = TaskProgress.NotStarted;

    if (memoryLogPath) {
      // Read and analyze memory log
      indicators = await this.analyzeMemoryLog(memoryLogPath);

      // Determine task progress from indicators
      taskProgress = this.determineTaskProgress(indicators, agent);
    }

    // Calculate time since last activity
    const timeSinceActivity = Date.now() - new Date(agent.metadata.lastActivityAt).getTime();

    // Check if stalled
    const isStalled = this.isAgentStalled(agent, timeSinceActivity);

    return {
      agentId: agent.id,
      currentTask: agent.currentTask,
      taskProgress,
      memoryLogPath: memoryLogPath ?? null,
      indicators,
      timeSinceActivity,
      isStalled,
      agentStatus: agent.status,
    };
  }

  /**
   * Get progress for all active agents
   *
   * @returns Array of agent progress
   */
  async getAllAgentProgress(): Promise<AgentProgress[]> {
    const agents = await this.config.persistence.getAllAgents();

    const progressPromises = agents.map(agent => this.getAgentProgress(agent.id));
    const results = await Promise.all(progressPromises);

    return results.filter((p): p is AgentProgress => p !== null);
  }

  /**
   * Get stalled agents
   *
   * @returns Array of stalled agents
   */
  async getStalledAgents(): Promise<AgentProgress[]> {
    const allProgress = await this.getAllAgentProgress();
    return allProgress.filter(p => p.isStalled);
  }

  /**
   * Analyze memory log file for progress indicators
   *
   * @param logPath - Path to memory log file
   * @returns Progress indicators
   */
  async analyzeMemoryLog(logPath: string): Promise<ProgressIndicators> {
    try {
      // Get file stats for last modification time
      const stats = await fs.stat(logPath);

      // Read file content
      const content = await fs.readFile(logPath, 'utf-8');

      // Analyze content
      const lines = content.split('\n');
      const hasCompletionMarker = this.detectCompletionMarkers(content);
      const hasErrors = this.detectErrors(content);
      const hasBlockers = this.detectBlockers(content);

      return {
        hasCompletionMarker,
        hasErrors,
        hasBlockers,
        totalLines: lines.length,
        lastActivity: stats.mtime,
      };
    } catch (error) {
      // If file doesn't exist or can't be read, return minimal indicators
      return {
        hasCompletionMarker: false,
        hasErrors: false,
        hasBlockers: false,
        totalLines: 0,
        lastActivity: new Date(),
      };
    }
  }

  /**
   * Detect completion markers in content
   *
   * @param content - Log file content
   * @returns True if completion markers found
   */
  private detectCompletionMarkers(content: string): boolean {
    const completionPatterns = [
      /✓/i,
      /✅/i,
      /\[x\]/i,
      /\[X\]/i,
      /COMPLETE/i,
      /COMPLETED/i,
      /status:\s*completed/i,
      /Task.*Complete/i,
    ];

    return completionPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Detect error indicators in content
   *
   * @param content - Log file content
   * @returns True if errors found
   */
  private detectErrors(content: string): boolean {
    const errorPatterns = [
      /ERROR/i,
      /FAILED/i,
      /Exception/i,
      /Error:/i,
      /test.*fail/i,
    ];

    return errorPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Detect blocker indicators in content
   *
   * @param content - Log file content
   * @returns True if blockers found
   */
  private detectBlockers(content: string): boolean {
    const blockerPatterns = [
      /BLOCKED/i,
      /blocked by/i,
      /waiting for/i,
      /cannot proceed/i,
      /dependency.*incomplete/i,
    ];

    return blockerPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Determine task progress from indicators
   *
   * @param indicators - Progress indicators
   * @param agent - Agent state
   * @returns Task progress status
   */
  private determineTaskProgress(
    indicators: ProgressIndicators,
    agent: AgentState
  ): TaskProgress {
    // If agent terminated, check completion marker
    if (agent.status === AgentStatus.Terminated) {
      return indicators.hasCompletionMarker ? TaskProgress.Completed : TaskProgress.Failed;
    }

    // If has errors or blockers, mark as failed
    if (indicators.hasErrors || indicators.hasBlockers) {
      return TaskProgress.Failed;
    }

    // If has completion marker and still active, consider completed
    if (indicators.hasCompletionMarker) {
      return TaskProgress.Completed;
    }

    // If has content (totalLines > 0), in progress
    if (indicators.totalLines > 0) {
      return TaskProgress.InProgress;
    }

    return TaskProgress.NotStarted;
  }

  /**
   * Check if agent is stalled
   *
   * @param agent - Agent state
   * @param timeSinceActivity - Time since last activity in ms
   * @returns True if agent is stalled
   */
  private isAgentStalled(agent: AgentState, timeSinceActivity: number): boolean {
    // Only check active agents
    if (agent.status !== AgentStatus.Active) {
      return false;
    }

    // Check if time since activity exceeds threshold
    return timeSinceActivity > this.stallThresholdMs;
  }

  /**
   * Check if task is completed
   *
   * @param agentId - Agent ID
   * @returns True if task shows completion markers
   */
  async isTaskCompleted(agentId: string): Promise<boolean> {
    const progress = await this.getAgentProgress(agentId);
    return progress ? progress.taskProgress === TaskProgress.Completed : false;
  }

  /**
   * Get completion percentage for agent
   *
   * @param agentId - Agent ID
   * @returns Completion percentage (0-100) or null
   */
  async getCompletionPercentage(agentId: string): Promise<number | null> {
    const progress = await this.getAgentProgress(agentId);
    if (!progress || !progress.indicators) {
      return null;
    }

    // Simple heuristic based on indicators
    let percentage = 0;

    // Has content started
    if (progress.indicators.totalLines > 0) {
      percentage += 30;
    }

    // Has substantial content
    if (progress.indicators.totalLines > 50) {
      percentage += 20;
    }

    // No errors or blockers
    if (!progress.indicators.hasErrors && !progress.indicators.hasBlockers) {
      percentage += 25;
    }

    // Has completion marker
    if (progress.indicators.hasCompletionMarker) {
      percentage += 25;
    }

    return Math.min(percentage, 100);
  }

  /**
   * Get progress summary for all agents
   *
   * @returns Progress summary
   */
  async getProgressSummary(): Promise<{
    totalAgents: number;
    activeAgents: number;
    completedTasks: number;
    failedTasks: number;
    stalledAgents: number;
  }> {
    const allProgress = await this.getAllAgentProgress();

    return {
      totalAgents: allProgress.length,
      activeAgents: allProgress.filter(p => p.agentStatus === AgentStatus.Active).length,
      completedTasks: allProgress.filter(p => p.taskProgress === TaskProgress.Completed).length,
      failedTasks: allProgress.filter(p => p.taskProgress === TaskProgress.Failed).length,
      stalledAgents: allProgress.filter(p => p.isStalled).length,
    };
  }
}

/**
 * Create a ProgressMonitor instance
 */
export function createProgressMonitor(config: ProgressMonitorConfig): ProgressMonitor {
  return new ProgressMonitor(config);
}
