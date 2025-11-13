/**
 * State Persistence Layer for apm-auto
 *
 * Provides database persistence for agent state management with atomic
 * transactions, state history tracking, and comprehensive query capabilities.
 */

import { v4 as uuidv4 } from 'uuid';
import type { ConnectionManager } from '../db/connection.js';
import {
  AgentState,
  AgentStatus,
  AgentType,
  AgentMetadata,
  AgentDomain
} from '../types/agent.js';
import {
  AgentStateTransition,
  TransitionTrigger,
  StateEntityType,
  StateTransitionMetadata
} from '../types/state.js';
import { validateTransition } from './agent-lifecycle.js';

/**
 * Agent State Update Options
 */
export interface AgentStateUpdateOptions {
  /** Transition trigger type */
  trigger: TransitionTrigger;
  /** Additional metadata for the transition */
  metadata?: StateTransitionMetadata;
}

/**
 * Agent Statistics
 */
export interface AgentStatistics {
  /** Agent ID */
  agentId: string;
  /** Total time in each state (milliseconds) */
  timeInStates: Record<AgentStatus, number>;
  /** Total number of state transitions */
  totalTransitions: number;
  /** Transition counts by type */
  transitionsByTrigger: Record<TransitionTrigger, number>;
  /** Time since spawn (milliseconds) */
  lifetime: number;
  /** Average time per state (milliseconds) */
  avgTimePerState: number;
}

/**
 * Agent Persistence Manager
 * Handles all database operations for agent state management
 */
export class AgentPersistenceManager {
  constructor(private connectionManager: ConnectionManager) {}

  /**
   * Create a new agent with Spawning status
   *
   * @param agentId - Unique agent identifier
   * @param type - Agent type (Manager, Implementation, AdHoc)
   * @param metadata - Agent metadata
   * @returns Created agent state
   *
   * @example
   * ```typescript
   * const agent = await persistence.createAgent(
   *   'agent_impl_001',
   *   AgentType.Implementation,
   *   { domain: AgentDomain.Orchestration_CLI, spawnedAt: new Date(), lastActivityAt: new Date() }
   * );
   * ```
   */
  async createAgent(
    agentId: string,
    type: AgentType,
    metadata: AgentMetadata
  ): Promise<AgentState> {
    return this.connectionManager.transaction(async (db) => {
      // Validate initial state
      const validation = validateTransition(null, AgentStatus.Spawning);
      if (!validation.allowed) {
        throw new Error(`Invalid initial state: ${validation.reason}`);
      }

      const now = new Date().toISOString();
      const metadataJson = JSON.stringify(metadata);

      // Insert agent record
      db.prepare(`
        INSERT INTO agents (
          id, type, status, current_task, domain, metadata,
          worktree_path, spawned_at, last_activity_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        agentId,
        type,
        AgentStatus.Spawning,
        null, // No current task initially
        metadata.domain ?? null,
        metadataJson,
        metadata.worktreePath ?? null,
        now,
        now
      );

      // Record state transition (initial → Spawning)
      const transitionId = uuidv4();
      db.prepare(`
        INSERT INTO state_transitions (
          id, entity_type, entity_id, from_state, to_state,
          timestamp, trigger, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        transitionId,
        StateEntityType.Agent,
        agentId,
        '', // Initial transition (empty string for initial state)
        AgentStatus.Spawning,
        now,
        TransitionTrigger.Automatic,
        JSON.stringify({ reason: 'Agent creation' })
      );

      // Return created agent state
      return {
        id: agentId,
        type,
        status: AgentStatus.Spawning,
        currentTask: null,
        metadata
      };
    });
  }

  /**
   * Update agent state atomically with state transition tracking
   *
   * @param agentId - Agent identifier
   * @param newStatus - New agent status
   * @param options - Update options (trigger, metadata)
   * @returns Updated agent state
   *
   * @throws Error if agent not found or transition invalid
   *
   * @example
   * ```typescript
   * await persistence.updateAgentState('agent_impl_001', AgentStatus.Active, {
   *   trigger: TransitionTrigger.Automatic,
   *   metadata: { reason: 'Task assigned' }
   * });
   * ```
   */
  async updateAgentState(
    agentId: string,
    newStatus: AgentStatus,
    options: AgentStateUpdateOptions
  ): Promise<AgentState> {
    return this.connectionManager.transaction(async (db) => {
      // Get current agent state
      const currentAgent = db.prepare(`
        SELECT id, type, status, current_task, domain, metadata,
               worktree_path, spawned_at, last_activity_at
        FROM agents
        WHERE id = ?
      `).get(agentId) as any;

      if (!currentAgent) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      // Validate state transition
      const validation = validateTransition(currentAgent.status, newStatus);
      if (!validation.allowed) {
        throw new Error(
          `Invalid state transition for agent ${agentId}: ${validation.reason}`
        );
      }

      const now = new Date().toISOString();

      // Update agent record
      db.prepare(`
        UPDATE agents
        SET status = ?,
            last_activity_at = ?
        WHERE id = ?
      `).run(newStatus, now, agentId);

      // Record state transition
      const transitionId = uuidv4();
      db.prepare(`
        INSERT INTO state_transitions (
          id, entity_type, entity_id, from_state, to_state,
          timestamp, trigger, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        transitionId,
        StateEntityType.Agent,
        agentId,
        currentAgent.status,
        newStatus,
        now,
        options.trigger,
        JSON.stringify(options.metadata ?? {})
      );

      // Parse and return updated agent state
      const metadata: AgentMetadata = JSON.parse(currentAgent.metadata);
      metadata.lastActivityAt = new Date(now);

      return {
        id: agentId,
        type: currentAgent.type as AgentType,
        status: newStatus,
        currentTask: currentAgent.current_task,
        metadata
      };
    });
  }

  /**
   * Update agent's current task assignment
   *
   * @param agentId - Agent identifier
   * @param taskId - Task identifier (null to clear)
   * @returns Updated agent state
   */
  async updateAgentTask(
    agentId: string,
    taskId: string | null
  ): Promise<AgentState> {
    return this.connectionManager.transaction(async (db) => {
      const now = new Date().toISOString();

      // Update current task
      db.prepare(`
        UPDATE agents
        SET current_task = ?,
            last_activity_at = ?
        WHERE id = ?
      `).run(taskId, now, agentId);

      // Get updated agent state
      const agent = await this.getAgentState(agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      return agent;
    });
  }

  /**
   * Update agent heartbeat timestamp
   *
   * @param agentId - Agent identifier
   */
  async updateHeartbeat(agentId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.connectionManager.execute(`
      UPDATE agents
      SET last_activity_at = ?
      WHERE id = ?
    `, [now, agentId]);
  }

  /**
   * Get current agent state
   *
   * @param agentId - Agent identifier
   * @returns Agent state or undefined if not found
   */
  async getAgentState(agentId: string): Promise<AgentState | undefined> {
    const row = await this.connectionManager.get<any>(`
      SELECT id, type, status, current_task, domain, metadata,
             worktree_path, spawned_at, last_activity_at
      FROM agents
      WHERE id = ?
    `, [agentId]);

    if (!row) {
      return undefined;
    }

    return this.rowToAgentState(row);
  }

  /**
   * Get all agents by status
   *
   * @param status - Agent status to filter by
   * @returns Array of agent states
   */
  async getAgentsByStatus(status: AgentStatus): Promise<AgentState[]> {
    const rows = await this.connectionManager.query<any>(`
      SELECT id, type, status, current_task, domain, metadata,
             worktree_path, spawned_at, last_activity_at
      FROM agents
      WHERE status = ?
      ORDER BY spawned_at ASC
    `, [status]);

    return rows.map(row => this.rowToAgentState(row));
  }

  /**
   * Get all active agents
   *
   * @returns Array of active agent states
   */
  async getActiveAgents(): Promise<AgentState[]> {
    return this.getAgentsByStatus(AgentStatus.Active);
  }

  /**
   * Get all agents
   *
   * @returns Array of all agent states
   */
  async getAllAgents(): Promise<AgentState[]> {
    const rows = await this.connectionManager.query<any>(`
      SELECT id, type, status, current_task, domain, metadata,
             worktree_path, spawned_at, last_activity_at
      FROM agents
      ORDER BY spawned_at ASC
    `);

    return rows.map(row => this.rowToAgentState(row));
  }

  /**
   * Get state transition history for an agent
   *
   * @param agentId - Agent identifier
   * @param limit - Maximum number of transitions to return
   * @returns Array of state transitions in chronological order
   */
  async getAgentHistory(
    agentId: string,
    limit?: number
  ): Promise<AgentStateTransition[]> {
    const sql = `
      SELECT id, entity_type, entity_id, from_state, to_state,
             timestamp, trigger, metadata
      FROM state_transitions
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY timestamp ASC
      ${limit ? `LIMIT ${limit}` : ''}
    `;

    const rows = await this.connectionManager.query<any>(sql, [
      StateEntityType.Agent,
      agentId
    ]);

    return rows.map(row => ({
      id: row.id,
      entityType: StateEntityType.Agent,
      entityId: row.entity_id,
      fromState: (row.from_state === '' ? null : row.from_state) as any as AgentStatus,
      toState: row.to_state as AgentStatus,
      timestamp: new Date(row.timestamp),
      trigger: row.trigger as TransitionTrigger,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }));
  }

  /**
   * Calculate agent statistics from state history
   *
   * @param agentId - Agent identifier
   * @returns Agent statistics
   */
  async getAgentStatistics(agentId: string): Promise<AgentStatistics | undefined> {
    const agent = await this.getAgentState(agentId);
    if (!agent) {
      return undefined;
    }

    const history = await this.getAgentHistory(agentId);

    // Initialize statistics
    const timeInStates: Record<AgentStatus, number> = {
      [AgentStatus.Spawning]: 0,
      [AgentStatus.Active]: 0,
      [AgentStatus.Waiting]: 0,
      [AgentStatus.Idle]: 0,
      [AgentStatus.Terminated]: 0
    };

    const transitionsByTrigger: Record<TransitionTrigger, number> = {
      [TransitionTrigger.UserAction]: 0,
      [TransitionTrigger.Automatic]: 0,
      [TransitionTrigger.Timeout]: 0,
      [TransitionTrigger.Error]: 0,
      [TransitionTrigger.Dependency]: 0,
      [TransitionTrigger.Recovery]: 0
    };

    // Calculate time in each state
    const now = Date.now();
    for (let i = 0; i < history.length; i++) {
      const transition = history[i];
      const nextTransition = history[i + 1];

      const stateStartTime = transition.timestamp.getTime();
      const stateEndTime = nextTransition
        ? nextTransition.timestamp.getTime()
        : now;

      const duration = stateEndTime - stateStartTime;
      timeInStates[transition.toState] += duration;

      // Count transitions by trigger
      transitionsByTrigger[transition.trigger]++;
    }

    // Calculate lifetime
    const spawnTime = agent.metadata.spawnedAt.getTime();
    const lifetime = now - spawnTime;

    // Calculate average time per state
    const totalStateTime = Object.values(timeInStates).reduce((sum, time) => sum + time, 0);
    const statesVisited = Object.values(timeInStates).filter(time => time > 0).length;
    const avgTimePerState = statesVisited > 0 ? totalStateTime / statesVisited : 0;

    return {
      agentId,
      timeInStates,
      totalTransitions: history.length,
      transitionsByTrigger,
      lifetime,
      avgTimePerState
    };
  }

  /**
   * Delete agent (soft delete by marking as Terminated)
   *
   * @param agentId - Agent identifier
   * @param reason - Termination reason
   */
  async deleteAgent(
    agentId: string,
    reason: string = 'Agent deleted'
  ): Promise<void> {
    await this.updateAgentState(agentId, AgentStatus.Terminated, {
      trigger: TransitionTrigger.UserAction,
      metadata: { reason }
    });
  }

  /**
   * Hard delete agent (removes from database)
   *
   * WARNING: This permanently removes the agent and all state transitions.
   * Use soft delete (deleteAgent) instead for normal operations.
   *
   * @param agentId - Agent identifier
   */
  async hardDeleteAgent(agentId: string): Promise<void> {
    await this.connectionManager.transaction(async (db) => {
      // Delete state transitions first (foreign key)
      db.prepare(`
        DELETE FROM state_transitions
        WHERE entity_type = ? AND entity_id = ?
      `).run(StateEntityType.Agent, agentId);

      // Delete agent record
      db.prepare(`
        DELETE FROM agents
        WHERE id = ?
      `).run(agentId);
    });
  }

  /**
   * Convert database row to AgentState
   */
  private rowToAgentState(row: any): AgentState {
    const metadata: AgentMetadata = JSON.parse(row.metadata);

    // Ensure dates are Date objects
    metadata.spawnedAt = new Date(row.spawned_at);
    metadata.lastActivityAt = new Date(row.last_activity_at);

    // Add worktree path if present
    if (row.worktree_path) {
      metadata.worktreePath = row.worktree_path;
    }

    // Add domain if present
    if (row.domain) {
      metadata.domain = row.domain as AgentDomain;
    }

    return {
      id: row.id,
      type: row.type as AgentType,
      status: row.status as AgentStatus,
      currentTask: row.current_task,
      metadata
    };
  }

  /**
   * Ensure required database indexes exist
   *
   * This method is idempotent and safe to call multiple times.
   */
  async ensureIndexes(): Promise<void> {
    await this.connectionManager.transaction(async (db) => {
      // Index on agent status for getAgentsByStatus queries
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_agents_status
        ON agents(status)
      `);

      // Index on agent type
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_agents_type
        ON agents(type)
      `);

      // Index on current task (partial index for non-null values)
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_agents_current_task
        ON agents(current_task)
        WHERE current_task IS NOT NULL
      `);

      // Index on domain (partial index for non-null values)
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_agents_domain
        ON agents(domain)
        WHERE domain IS NOT NULL
      `);

      // Index on last_activity_at for crash detection
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_agents_last_activity
        ON agents(last_activity_at)
      `);

      // Composite index for state transition queries
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_transitions_entity
        ON state_transitions(entity_type, entity_id, timestamp)
      `);

      // Index on transition trigger type
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_transitions_trigger
        ON state_transitions(trigger)
      `);
    });
  }
}

/**
 * Create a new agent persistence manager
 *
 * @param connectionManager - Database connection manager
 * @returns Agent persistence manager instance
 */
export function createAgentPersistence(
  connectionManager: ConnectionManager
): AgentPersistenceManager {
  return new AgentPersistenceManager(connectionManager);
}
