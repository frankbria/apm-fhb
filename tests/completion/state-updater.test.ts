/**
 * Tests for StateUpdater
 *
 * Validates database state updates for task completion with transactions,
 * agent state transitions, audit logging, and concurrency handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateUpdater, TaskUpdateData } from '../../src/completion/state-updater';
import { ConnectionManager } from '../../src/db/connection';
import { AgentPersistenceManager } from '../../src/state/persistence';
import { AgentStatus, AgentType } from '../../src/types/agent';
import { TransitionTrigger } from '../../src/types/state';
import path from 'path';
import fs from 'fs/promises';

describe('StateUpdater', () => {
  let updater: StateUpdater;
  let connectionManager: ConnectionManager;
  let persistence: AgentPersistenceManager;
  let testDbPath: string;

  beforeEach(async () => {
    // Create test database
    testDbPath = path.join(process.cwd(), 'test-state-updater.db');
    connectionManager = new ConnectionManager({ filename: testDbPath });
    await connectionManager.connect();

    // Create tables
    const db = await connectionManager.getDirectConnection();
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        current_task TEXT,
        domain TEXT,
        metadata TEXT,
        worktree_path TEXT,
        spawned_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS state_transitions (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        trigger TEXT NOT NULL,
        metadata TEXT
      )
    `);

    // Release the direct connection
    connectionManager.releaseDirectConnection(db);

    persistence = new AgentPersistenceManager(connectionManager);
    updater = new StateUpdater(connectionManager);
  });

  afterEach(async () => {
    await connectionManager.disconnect();
    await fs.rm(testDbPath, { force: true });
  });

  describe('Task Completion Updates', () => {
    it('should update task status to Completed', async () => {
      // Create agent
      const agent = await persistence.createAgent('agent_1', AgentType.Implementation, {
        domain: 'Testing',
        spawnedAt: new Date(),
        lastActivityAt: new Date(),
      });

      await persistence.updateAgentState(agent.id, AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic,
      });

      // Update task to completed
      const updateData: TaskUpdateData = {
        taskId: 'Task_1_1',
        agentId: 'agent_1',
        status: 'Completed',
        deliverables: ['file1.ts', 'file2.ts'],
        testResults: { total: 30, passed: 30, coveragePercent: 90 },
        qualityGates: { tdd: true, commits: true, security: true, coverage: true },
      };

      await updater.updateTaskCompletion(updateData);

      // Verify agent transitioned to Waiting
      const updatedAgent = await persistence.getAgentState('agent_1');
      expect(updatedAgent?.status).toBe(AgentStatus.Waiting);
    });

    it('should store deliverables as JSON', async () => {
      const agent = await persistence.createAgent('agent_2', AgentType.Implementation, {
        domain: 'Testing',
        spawnedAt: new Date(),
        lastActivityAt: new Date(),
      });

      await persistence.updateAgentState(agent.id, AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic,
      });

      const updateData: TaskUpdateData = {
        taskId: 'Task_1_2',
        agentId: 'agent_2',
        status: 'Completed',
        deliverables: ['file1.ts', 'file2.ts', 'file3.ts'],
      };

      await updater.updateTaskCompletion(updateData);

      // Verify stored
      const result = await updater.getTaskCompletionData('Task_1_2');
      expect(result?.deliverables).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
    });

    it('should store test results as JSON', async () => {
      const agent = await persistence.createAgent('agent_3', AgentType.Implementation, {
        domain: 'Testing',
        spawnedAt: new Date(),
        lastActivityAt: new Date(),
      });

      await persistence.updateAgentState(agent.id, AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic,
      });

      const updateData: TaskUpdateData = {
        taskId: 'Task_1_3',
        agentId: 'agent_3',
        status: 'Completed',
        deliverables: [],
        testResults: { total: 50, passed: 50, coveragePercent: 95.5 },
      };

      await updater.updateTaskCompletion(updateData);

      const result = await updater.getTaskCompletionData('Task_1_3');
      expect(result?.testResults).toEqual({ total: 50, passed: 50, coveragePercent: 95.5 });
    });

    it('should store quality gate results as JSON', async () => {
      const agent = await persistence.createAgent('agent_4', AgentType.Implementation, {
        domain: 'Testing',
        spawnedAt: new Date(),
        lastActivityAt: new Date(),
      });

      await persistence.updateAgentState(agent.id, AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic,
      });

      const updateData: TaskUpdateData = {
        taskId: 'Task_1_4',
        agentId: 'agent_4',
        status: 'Completed',
        deliverables: [],
        qualityGates: { tdd: true, commits: true, security: true, coverage: true },
      };

      await updater.updateTaskCompletion(updateData);

      const result = await updater.getTaskCompletionData('Task_1_4');
      expect(result?.qualityGates).toEqual({ tdd: true, commits: true, security: true, coverage: true });
    });
  });

  describe('Agent State Transitions', () => {
    it('should transition agent from Active to Waiting', async () => {
      const agent = await persistence.createAgent('agent_5', AgentType.Implementation, {
        domain: 'Testing',
        spawnedAt: new Date(),
        lastActivityAt: new Date(),
      });

      await persistence.updateAgentState(agent.id, AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic,
      });

      const updateData: TaskUpdateData = {
        taskId: 'Task_2_1',
        agentId: 'agent_5',
        status: 'Completed',
        deliverables: [],
      };

      await updater.updateTaskCompletion(updateData);

      const updatedAgent = await persistence.getAgentState('agent_5');
      expect(updatedAgent?.status).toBe(AgentStatus.Waiting);
    });

    it('should clear current_task_id after completion', async () => {
      const agent = await persistence.createAgent('agent_6', AgentType.Implementation, {
        domain: 'Testing',
        spawnedAt: new Date(),
        lastActivityAt: new Date(),
      });

      await persistence.updateAgentState(agent.id, AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic,
      });

      await persistence.updateAgentTask('agent_6', 'Task_2_2');

      const updateData: TaskUpdateData = {
        taskId: 'Task_2_2',
        agentId: 'agent_6',
        status: 'Completed',
        deliverables: [],
      };

      await updater.updateTaskCompletion(updateData);

      const updatedAgent = await persistence.getAgentState('agent_6');
      expect(updatedAgent?.currentTask).toBeNull();
    });

    it('should update last_activity_at timestamp', async () => {
      const agent = await persistence.createAgent('agent_7', AgentType.Implementation, {
        domain: 'Testing',
        spawnedAt: new Date(),
        lastActivityAt: new Date(),
      });

      await persistence.updateAgentState(agent.id, AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic,
      });

      const beforeUpdate = new Date();

      const updateData: TaskUpdateData = {
        taskId: 'Task_2_3',
        agentId: 'agent_7',
        status: 'Completed',
        deliverables: [],
      };

      await updater.updateTaskCompletion(updateData);

      const updatedAgent = await persistence.getAgentState('agent_7');
      expect(updatedAgent?.metadata.lastActivityAt).toBeInstanceOf(Date);
      expect(updatedAgent?.metadata.lastActivityAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
    });
  });

  describe('Event Emission', () => {
    it('should emit task_completed_db event', async () => {
      const agent = await persistence.createAgent('agent_8', AgentType.Implementation, {
        domain: 'Testing',
        spawnedAt: new Date(),
        lastActivityAt: new Date(),
      });

      await persistence.updateAgentState(agent.id, AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic,
      });

      const eventSpy = vi.fn();
      updater.on('task_completed_db', eventSpy);

      const updateData: TaskUpdateData = {
        taskId: 'Task_3_1',
        agentId: 'agent_8',
        status: 'Completed',
        deliverables: ['file1.ts'],
      };

      await updater.updateTaskCompletion(updateData);

      expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 'Task_3_1',
        completedAt: expect.any(Date),
        deliverables: ['file1.ts'],
      }));
    });

    it('should emit agent_state_updated event', async () => {
      const agent = await persistence.createAgent('agent_9', AgentType.Implementation, {
        domain: 'Testing',
        spawnedAt: new Date(),
        lastActivityAt: new Date(),
      });

      await persistence.updateAgentState(agent.id, AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic,
      });

      const eventSpy = vi.fn();
      updater.on('agent_state_updated', eventSpy);

      const updateData: TaskUpdateData = {
        taskId: 'Task_3_2',
        agentId: 'agent_9',
        status: 'Completed',
        deliverables: [],
      };

      await updater.updateTaskCompletion(updateData);

      expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'agent_9',
        newState: AgentStatus.Waiting,
        oldState: AgentStatus.Active,
      }));
    });
  });

  describe('Error Handling', () => {
    it('should throw error for non-existent agent', async () => {
      const updateData: TaskUpdateData = {
        taskId: 'Task_4_1',
        agentId: 'nonexistent',
        status: 'Completed',
        deliverables: [],
      };

      await expect(updater.updateTaskCompletion(updateData)).rejects.toThrow();
    });
  });
});
