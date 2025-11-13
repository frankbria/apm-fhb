/**
 * Process Tracker
 *
 * Database integration for agent process tracking. Records spawn events,
 * heartbeats, exits, and provides process metrics.
 */

import type { AgentPersistenceManager } from '../state/persistence.js';
import { AgentType, AgentStatus, type AgentState } from '../types/agent.js';
import { TransitionTrigger } from '../types/state.js';

/**
 * Process metadata stored in custom_metadata
 */
export interface ProcessMetadata {
  /** Process ID */
  pid: number;
  /** Spawn timestamp */
  spawnedAt: string;
  /** Prompt template ID used */
  promptTemplateId: string;
  /** Task ID assignment */
  taskId: string;
  /** Working directory */
  cwd: string;
}

/**
 * Spawn metadata for recording
 */
export interface SpawnMetadata {
  /** Process ID */
  processId: number;
  /** Prompt template ID */
  promptTemplateId: string;
  /** Task assignment ID */
  taskAssignment: string;
  /** Working directory */
  workingDirectory: string;
}

/**
 * Process metrics
 */
export interface ProcessMetrics {
  /** Agent ID */
  agentId: string;
  /** Runtime in milliseconds since spawn */
  runtime: number;
  /** Current agent status */
  status: AgentStatus;
  /** Last activity timestamp */
  lastActivityAt: Date;
  /** Heartbeat age in milliseconds */
  heartbeatAge: number;
  /** Spawn timestamp */
  spawnedAt?: Date;
}

/**
 * Process Tracker
 * Integrates agent process tracking with database persistence
 */
export class ProcessTracker {
  constructor(private persistence: AgentPersistenceManager) {}

  /**
   * Record agent spawn to database
   * 
   * @param agentId - Unique agent identifier
   * @param metadata - Process spawn metadata
   * @returns Created agent state
   */
  async recordSpawn(agentId: string, metadata: SpawnMetadata): Promise<AgentState> {
    // Prepare process metadata for custom_metadata JSON field
    const processMetadata: ProcessMetadata = {
      pid: metadata.processId,
      spawnedAt: new Date().toISOString(),
      promptTemplateId: metadata.promptTemplateId,
      taskId: metadata.taskAssignment,
      cwd: metadata.workingDirectory,
    };

    // Create agent with Spawning status
    const agent = await this.persistence.createAgent(
      agentId,
      AgentType.Implementation, // Default to Implementation, can be parameterized later
      {
        spawnedAt: new Date(),
        lastActivityAt: new Date(),
        processId: metadata.processId,
        // Store process metadata in custom_metadata field
        custom_metadata: {
          process: processMetadata,
        },
      }
    );

    // Transition to Active
    await this.persistence.updateAgentState(agentId, AgentStatus.Active, {
      trigger: TransitionTrigger.Automatic,
      metadata: {
        reason: 'Process spawned and ready',
      },
    });

    // Return updated agent state
    const updatedAgent = await this.persistence.getAgentState(agentId);
    return updatedAgent!;
  }

  /**
   * Update heartbeat for an agent
   * 
   * @param agentId - Agent identifier
   */
  async updateHeartbeat(agentId: string): Promise<void> {
    await this.persistence.updateHeartbeat(agentId);
  }

  /**
   * Record agent exit
   * 
   * @param agentId - Agent identifier
   * @param exitCode - Process exit code (0 = success, >0 = error, null = killed)
   * @param signal - Exit signal (e.g., 'SIGTERM', 'SIGKILL')
   */
  async recordExit(
    agentId: string,
    exitCode: number | null,
    signal: string | null
  ): Promise<void> {
    // Determine final status based on exit conditions
    let finalStatus: AgentStatus;
    let exitReason: string;

    if (exitCode === 0) {
      // Clean exit
      finalStatus = AgentStatus.Terminated;
      exitReason = 'Process exited successfully';
    } else if (exitCode !== null && exitCode > 0) {
      // Crashed with error code
      finalStatus = AgentStatus.Terminated;
      exitReason = `Process crashed with exit code ${exitCode}`;
    } else if (signal !== null) {
      // Killed by signal
      finalStatus = AgentStatus.Terminated;
      exitReason = `Process terminated by signal ${signal}`;
    } else {
      // Unknown exit condition
      finalStatus = AgentStatus.Terminated;
      exitReason = 'Process terminated with unknown status';
    }

    // Update agent state with exit information
    await this.persistence.updateAgentState(agentId, finalStatus, {
      trigger: TransitionTrigger.Automatic,
      metadata: {
        reason: exitReason,
        exitCode: exitCode ?? undefined,
        exitSignal: signal ?? undefined,
      },
    });
  }

  /**
   * Get all active agents
   * 
   * @returns Array of active agent states
   */
  async getActiveAgents(): Promise<AgentState[]> {
    // Query all agents
    const allAgents = await this.persistence.getAllAgents();

    // Filter for Active or Waiting status
    return allAgents.filter(
      agent => agent.status === AgentStatus.Active || agent.status === AgentStatus.Waiting
    );
  }

  /**
   * Get process metrics for an agent
   * 
   * @param agentId - Agent identifier
   * @returns Process metrics or undefined if not found
   */
  async getProcessMetrics(agentId: string): Promise<ProcessMetrics | undefined> {
    // Get agent state
    const agent = await this.persistence.getAgentState(agentId);
    if (!agent) {
      return undefined;
    }

    const now = new Date();
    
    // Extract spawn time from metadata
    let spawnedAt: Date | undefined;
    if (agent.metadata?.spawnedAt) {
      spawnedAt = new Date(agent.metadata.spawnedAt);
    }

    // Calculate runtime (ms since spawn)
    const runtime = spawnedAt ? now.getTime() - spawnedAt.getTime() : 0;

    // Get last activity timestamp
    const lastActivityAt = agent.metadata?.lastActivityAt 
      ? new Date(agent.metadata.lastActivityAt)
      : now;

    // Calculate heartbeat age (ms since last activity)
    const heartbeatAge = now.getTime() - lastActivityAt.getTime();

    return {
      agentId: agent.id,
      runtime,
      status: agent.status,
      lastActivityAt,
      heartbeatAge,
      spawnedAt,
    };
  }
}

/**
 * Create a new ProcessTracker instance
 * 
 * @param persistence - AgentPersistenceManager instance
 * @returns ProcessTracker instance
 */
export function createProcessTracker(persistence: AgentPersistenceManager): ProcessTracker {
  return new ProcessTracker(persistence);
}
