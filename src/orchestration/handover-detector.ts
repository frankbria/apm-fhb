/**
 * Handover Detection Logic
 *
 * Detects when agents are approaching context window limits and need to hand over
 * to a new agent instance. Monitors memory log sizes, detects handover markers,
 * and tracks handover states.
 */

import fs from 'fs/promises';
import { type AgentState, AgentStatus } from '../types/agent.js';
import { type AgentPersistenceManager } from '../state/persistence.js';

/**
 * Handover trigger reason
 */
export enum HandoverTrigger {
  /** Context window size limit approaching */
  ContextWindowLimit = 'ContextWindowLimit',
  /** Explicit handover marker detected */
  ExplicitMarker = 'ExplicitMarker',
  /** Memory log file size threshold exceeded */
  LogSizeThreshold = 'LogSizeThreshold',
  /** Manual handover requested */
  Manual = 'Manual',
}

/**
 * Handover state
 */
export enum HandoverState {
  /** No handover needed */
  None = 'None',
  /** Handover warning - approaching threshold */
  Warning = 'Warning',
  /** Handover needed - threshold exceeded */
  Needed = 'Needed',
  /** Handover in progress */
  InProgress = 'InProgress',
  /** Handover completed */
  Completed = 'Completed',
}

/**
 * Handover detection result
 */
export interface HandoverDetection {
  /** Agent ID */
  agentId: string;
  /** Current handover state */
  state: HandoverState;
  /** Trigger reasons */
  triggers: HandoverTrigger[];
  /** Memory log path */
  memoryLogPath: string | null;
  /** Log file size in bytes */
  logSizeBytes: number;
  /** Estimated context window usage (0-100%) */
  contextUsagePercent: number;
  /** Has explicit handover marker */
  hasHandoverMarker: boolean;
  /** Recommended action */
  recommendation: string;
}

/**
 * Handover history entry
 */
export interface HandoverHistoryEntry {
  /** Agent ID that initiated handover */
  fromAgentId: string;
  /** Agent ID that received handover (if completed) */
  toAgentId: string | null;
  /** Timestamp of handover detection */
  detectedAt: Date;
  /** Timestamp of handover completion */
  completedAt: Date | null;
  /** Trigger reasons */
  triggers: HandoverTrigger[];
  /** Current state */
  state: HandoverState;
}

/**
 * Handover Detector Configuration
 */
export interface HandoverDetectorConfig {
  /** Agent persistence manager */
  persistence: AgentPersistenceManager;
  /** Warning threshold percentage (default: 80%) */
  warningThresholdPercent?: number;
  /** Handover threshold percentage (default: 90%) */
  handoverThresholdPercent?: number;
  /** Maximum log size in bytes (default: 50KB) */
  maxLogSizeBytes?: number;
  /** Estimated average chars per token (default: 4) */
  charsPerToken?: number;
  /** Context window size in tokens (default: 200000) */
  contextWindowTokens?: number;
}

/**
 * Handover Detector
 * Detects when agents need to hand over to new instances
 */
export class HandoverDetector {
  private config: HandoverDetectorConfig;
  private warningThreshold: number;
  private handoverThreshold: number;
  private maxLogSize: number;
  private charsPerToken: number;
  private contextWindowTokens: number;
  private handoverHistory: HandoverHistoryEntry[] = [];

  constructor(config: HandoverDetectorConfig) {
    this.config = config;
    this.warningThreshold = config.warningThresholdPercent ?? 80;
    this.handoverThreshold = config.handoverThresholdPercent ?? 90;
    this.maxLogSize = config.maxLogSizeBytes ?? 50 * 1024; // 50KB default
    this.charsPerToken = config.charsPerToken ?? 4;
    this.contextWindowTokens = config.contextWindowTokens ?? 200000;
  }

  /**
   * Detect handover needs for a specific agent
   *
   * @param agentId - Agent ID
   * @returns Handover detection result
   */
  async detectHandover(agentId: string): Promise<HandoverDetection | null> {
    const agent = await this.config.persistence.getAgentState(agentId);
    if (!agent) {
      return null;
    }

    // Only check active agents
    if (agent.status !== AgentStatus.Active) {
      return this.createNoHandoverResult(agentId);
    }

    // Get memory log path
    const memoryLogPath = agent.metadata.custom_metadata?.memoryLogPath as string | undefined;
    if (!memoryLogPath) {
      return this.createNoHandoverResult(agentId);
    }

    // Analyze log file
    const logSizeBytes = await this.getLogFileSize(memoryLogPath);
    const hasHandoverMarker = await this.detectHandoverMarker(memoryLogPath);
    const contextUsagePercent = this.calculateContextUsage(logSizeBytes);

    // Determine triggers
    const triggers: HandoverTrigger[] = [];

    if (hasHandoverMarker) {
      triggers.push(HandoverTrigger.ExplicitMarker);
    }

    if (logSizeBytes >= this.maxLogSize) {
      triggers.push(HandoverTrigger.LogSizeThreshold);
    }

    if (contextUsagePercent >= this.handoverThreshold) {
      triggers.push(HandoverTrigger.ContextWindowLimit);
    }

    // Determine state
    const state = this.determineHandoverState(contextUsagePercent, triggers);

    // Generate recommendation
    const recommendation = this.generateRecommendation(state, triggers);

    return {
      agentId,
      state,
      triggers,
      memoryLogPath,
      logSizeBytes,
      contextUsagePercent,
      hasHandoverMarker,
      recommendation,
    };
  }

  /**
   * Detect handover needs for all active agents
   *
   * @returns Array of handover detections
   */
  async detectAllHandovers(): Promise<HandoverDetection[]> {
    const agents = await this.config.persistence.getAllAgents();
    const activeAgents = agents.filter(a => a.status === AgentStatus.Active);

    const detections = await Promise.all(
      activeAgents.map(agent => this.detectHandover(agent.id))
    );

    return detections.filter((d): d is HandoverDetection => d !== null);
  }

  /**
   * Get agents needing handover
   *
   * @returns Array of agents needing handover
   */
  async getAgentsNeedingHandover(): Promise<HandoverDetection[]> {
    const allDetections = await this.detectAllHandovers();
    return allDetections.filter(d => d.state === HandoverState.Needed);
  }

  /**
   * Get agents with handover warnings
   *
   * @returns Array of agents with warnings
   */
  async getAgentsWithWarnings(): Promise<HandoverDetection[]> {
    const allDetections = await this.detectAllHandovers();
    return allDetections.filter(d => d.state === HandoverState.Warning);
  }

  /**
   * Record handover initiation
   *
   * @param fromAgentId - Agent initiating handover
   * @param triggers - Trigger reasons
   */
  recordHandoverInitiated(fromAgentId: string, triggers: HandoverTrigger[]): void {
    this.handoverHistory.push({
      fromAgentId,
      toAgentId: null,
      detectedAt: new Date(),
      completedAt: null,
      triggers,
      state: HandoverState.InProgress,
    });
  }

  /**
   * Record handover completion
   *
   * @param fromAgentId - Agent that initiated handover
   * @param toAgentId - Agent that received handover
   */
  recordHandoverCompleted(fromAgentId: string, toAgentId: string): void {
    const entry = this.handoverHistory.find(
      h => h.fromAgentId === fromAgentId && h.state === HandoverState.InProgress
    );

    if (entry) {
      entry.toAgentId = toAgentId;
      entry.completedAt = new Date();
      entry.state = HandoverState.Completed;
    }
  }

  /**
   * Get handover history
   *
   * @param limit - Maximum number of entries
   * @returns Handover history entries
   */
  getHandoverHistory(limit?: number): HandoverHistoryEntry[] {
    const history = [...this.handoverHistory].reverse(); // Most recent first
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * Get handover history for specific agent
   *
   * @param agentId - Agent ID
   * @returns Handover history entries
   */
  getAgentHandoverHistory(agentId: string): HandoverHistoryEntry[] {
    return this.handoverHistory.filter(
      h => h.fromAgentId === agentId || h.toAgentId === agentId
    );
  }

  /**
   * Get log file size
   *
   * @param logPath - Path to log file
   * @returns File size in bytes
   */
  private async getLogFileSize(logPath: string): Promise<number> {
    try {
      const stats = await fs.stat(logPath);
      return stats.size;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Detect handover marker in log file
   *
   * @param logPath - Path to log file
   * @returns True if handover marker detected
   */
  private async detectHandoverMarker(logPath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(logPath, 'utf-8');
      const handoverPatterns = [
        /\[APM_HANDOVER_NEEDED\]/i,
        /\[APM_HANDOVER\]/i,
        /context window.*approaching/i,
        /handover.*needed/i,
        /requesting.*handover/i,
      ];

      return handoverPatterns.some(pattern => pattern.test(content));
    } catch (error) {
      return false;
    }
  }

  /**
   * Calculate context window usage percentage
   *
   * @param logSizeBytes - Log file size in bytes
   * @returns Usage percentage (0-100)
   */
  private calculateContextUsage(logSizeBytes: number): number {
    // Estimate tokens from file size
    const estimatedTokens = Math.ceil(logSizeBytes / this.charsPerToken);

    // Calculate percentage of context window
    const percentage = (estimatedTokens / this.contextWindowTokens) * 100;

    return Math.min(percentage, 100);
  }

  /**
   * Determine handover state
   *
   * @param contextUsagePercent - Context usage percentage
   * @param triggers - Trigger reasons
   * @returns Handover state
   */
  private determineHandoverState(
    contextUsagePercent: number,
    triggers: HandoverTrigger[]
  ): HandoverState {
    // Check for explicit marker first
    if (triggers.includes(HandoverTrigger.ExplicitMarker)) {
      return HandoverState.Needed;
    }

    // Check for threshold triggers
    if (
      triggers.includes(HandoverTrigger.ContextWindowLimit) ||
      triggers.includes(HandoverTrigger.LogSizeThreshold)
    ) {
      return HandoverState.Needed;
    }

    // Check for warning threshold
    if (contextUsagePercent >= this.warningThreshold) {
      return HandoverState.Warning;
    }

    return HandoverState.None;
  }

  /**
   * Generate recommendation based on state
   *
   * @param state - Handover state
   * @param triggers - Trigger reasons
   * @returns Recommendation text
   */
  private generateRecommendation(
    state: HandoverState,
    triggers: HandoverTrigger[]
  ): string {
    if (state === HandoverState.Needed) {
      const reasons = triggers
        .map(t => this.getTriggerDescription(t))
        .join(', ');
      return `Handover required: ${reasons}. Initiate handover to new agent instance.`;
    }

    if (state === HandoverState.Warning) {
      return 'Context window usage approaching limit. Monitor closely and prepare for handover.';
    }

    return 'No handover needed. Agent operating within normal parameters.';
  }

  /**
   * Get trigger description
   *
   * @param trigger - Handover trigger
   * @returns Description text
   */
  private getTriggerDescription(trigger: HandoverTrigger): string {
    switch (trigger) {
      case HandoverTrigger.ContextWindowLimit:
        return 'context window limit approaching';
      case HandoverTrigger.ExplicitMarker:
        return 'explicit handover marker detected';
      case HandoverTrigger.LogSizeThreshold:
        return 'log size threshold exceeded';
      case HandoverTrigger.Manual:
        return 'manual handover requested';
      default:
        return 'unknown trigger';
    }
  }

  /**
   * Create no-handover result
   *
   * @param agentId - Agent ID
   * @returns Handover detection result
   */
  private createNoHandoverResult(agentId: string): HandoverDetection {
    return {
      agentId,
      state: HandoverState.None,
      triggers: [],
      memoryLogPath: null,
      logSizeBytes: 0,
      contextUsagePercent: 0,
      hasHandoverMarker: false,
      recommendation: 'No handover needed. Agent operating within normal parameters.',
    };
  }
}

/**
 * Create a HandoverDetector instance
 */
export function createHandoverDetector(config: HandoverDetectorConfig): HandoverDetector {
  return new HandoverDetector(config);
}
