/**
 * Database State Updates
 *
 * Implements database state updater persisting completion status for system coordination.
 * Updates task records, agent state transitions, and audit trails with atomic transactions.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { ConnectionManager } from '../db/connection';
import { AgentStatus } from '../types/agent';
import { TransitionTrigger, StateEntityType } from '../types/state';

/**
 * Test results for task
 */
export interface TestResults {
  total: number;
  passed: number;
  coveragePercent?: number;
}

/**
 * Quality gate results
 */
export interface QualityGateResults {
  tdd?: boolean;
  commits?: boolean;
  security?: boolean;
  coverage?: boolean;
}

/**
 * Task update data
 */
export interface TaskUpdateData {
  /** Task ID */
  taskId: string;
  /** Agent ID */
  agentId: string;
  /** Completion status */
  status: string;
  /** Deliverables */
  deliverables: string[];
  /** Test results */
  testResults?: TestResults;
  /** Quality gates */
  qualityGates?: QualityGateResults;
}

/**
 * Task completion data
 */
export interface TaskCompletionData {
  taskId: string;
  agentId: string;
  status: string;
  completedAt: Date;
  deliverables: string[];
  testResults?: TestResults;
  qualityGates?: QualityGateResults;
}

/**
 * State Updater
 * Persists completion status to database with atomic transactions
 */
export class StateUpdater extends EventEmitter {
  constructor(private connectionManager: ConnectionManager) {
    super();
    this.ensureTaskCompletionTable();
  }

  /**
   * Ensure task_completions table exists
   */
  private async ensureTaskCompletionTable(): Promise<void> {
    await this.connectionManager.transaction(async (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_completions (
          task_id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          status TEXT NOT NULL,
          completed_at TEXT NOT NULL,
          deliverables TEXT,
          test_results TEXT,
          quality_gates TEXT
        )
      `);
    });
  }

  /**
   * Update task completion
   *
   * @param data - Task update data
   */
  async updateTaskCompletion(data: TaskUpdateData): Promise<void> {
    await this.connectionManager.transaction(async (db) => {
      const now = new Date().toISOString();

      // Get current agent state
      const agent = db.prepare(`
        SELECT id, type, status, current_task, domain, metadata,
               worktree_path, spawned_at, last_activity_at
        FROM agents
        WHERE id = ?
      `).get(data.agentId) as any;

      if (!agent) {
        throw new Error(`Agent not found: ${data.agentId}`);
      }

      const oldStatus = agent.status;

      // Insert or update task completion
      db.prepare(`
        INSERT OR REPLACE INTO task_completions (
          task_id, agent_id, status, completed_at, deliverables, test_results, quality_gates
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.taskId,
        data.agentId,
        data.status,
        now,
        JSON.stringify(data.deliverables),
        data.testResults ? JSON.stringify(data.testResults) : null,
        data.qualityGates ? JSON.stringify(data.qualityGates) : null
      );

      // Update agent state to Waiting
      db.prepare(`
        UPDATE agents
        SET status = ?,
            current_task = NULL,
            last_activity_at = ?
        WHERE id = ?
      `).run(AgentStatus.Waiting, now, data.agentId);

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
        data.agentId,
        oldStatus,
        AgentStatus.Waiting,
        now,
        TransitionTrigger.Automatic,
        JSON.stringify({ reason: 'Task completion', taskId: data.taskId })
      );

      // Emit events
      this.emit('task_completed_db', {
        taskId: data.taskId,
        completedAt: new Date(now),
        deliverables: data.deliverables,
        testResults: data.testResults,
        qualityGates: data.qualityGates,
      });

      this.emit('agent_state_updated', {
        agentId: data.agentId,
        newState: AgentStatus.Waiting,
        oldState: oldStatus,
        timestamp: new Date(now),
      });

      this.emit('state_transition_recorded', {
        transitionId,
        fromState: oldStatus,
        toState: AgentStatus.Waiting,
        taskId: data.taskId,
      });
    });
  }

  /**
   * Get task completion data
   *
   * @param taskId - Task ID
   * @returns Task completion data or undefined
   */
  async getTaskCompletionData(taskId: string): Promise<TaskCompletionData | undefined> {
    const row = await this.connectionManager.get<any>(`
      SELECT task_id, agent_id, status, completed_at, deliverables, test_results, quality_gates
      FROM task_completions
      WHERE task_id = ?
    `, [taskId]);

    if (!row) {
      return undefined;
    }

    return {
      taskId: row.task_id,
      agentId: row.agent_id,
      status: row.status,
      completedAt: new Date(row.completed_at),
      deliverables: row.deliverables ? JSON.parse(row.deliverables) : [],
      testResults: row.test_results ? JSON.parse(row.test_results) : undefined,
      qualityGates: row.quality_gates ? JSON.parse(row.quality_gates) : undefined,
    };
  }

  /**
   * Get all completed tasks
   *
   * @returns Array of task completion data
   */
  async getAllCompletedTasks(): Promise<TaskCompletionData[]> {
    const rows = await this.connectionManager.query<any>(`
      SELECT task_id, agent_id, status, completed_at, deliverables, test_results, quality_gates
      FROM task_completions
      ORDER BY completed_at DESC
    `);

    return rows.map(row => ({
      taskId: row.task_id,
      agentId: row.agent_id,
      status: row.status,
      completedAt: new Date(row.completed_at),
      deliverables: row.deliverables ? JSON.parse(row.deliverables) : [],
      testResults: row.test_results ? JSON.parse(row.test_results) : undefined,
      qualityGates: row.quality_gates ? JSON.parse(row.quality_gates) : undefined,
    }));
  }
}

/**
 * Create a StateUpdater instance
 *
 * @param connectionManager - Database connection manager
 * @returns StateUpdater instance
 */
export function createStateUpdater(connectionManager: ConnectionManager): StateUpdater {
  return new StateUpdater(connectionManager);
}
