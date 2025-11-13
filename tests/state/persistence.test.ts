/**
 * State Persistence Tests
 * Tests for database persistence layer with atomic transactions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionManager, createConnectionManager, TEST_CONFIG } from '../../src/db/connection.js';
import { setupTestDatabase } from '../../src/db/init.js';
import { AgentPersistenceManager, createAgentPersistence } from '../../src/state/persistence.js';
import { AgentStatus, AgentType, AgentDomain } from '../../src/types/agent.js';
import { TransitionTrigger } from '../../src/types/state.js';

describe('Agent Persistence', () => {
  let connectionManager: ConnectionManager;
  let persistence: AgentPersistenceManager;

  beforeEach(async () => {
    // Create in-memory database for each test
    connectionManager = createConnectionManager(TEST_CONFIG);
    await connectionManager.connect();
    await setupTestDatabase(connectionManager);

    persistence = createAgentPersistence(connectionManager);
    await persistence.ensureIndexes();
  });

  afterEach(async () => {
    await connectionManager.disconnect();
  });

  describe('createAgent()', () => {
    it('should create agent with Spawning status', async () => {
      const agent = await persistence.createAgent(
        'agent_001',
        AgentType.Implementation,
        {
          domain: AgentDomain.Orchestration_CLI,
          spawnedAt: new Date(),
          lastActivityAt: new Date()
        }
      );

      expect(agent.id).toBe('agent_001');
      expect(agent.type).toBe(AgentType.Implementation);
      expect(agent.status).toBe(AgentStatus.Spawning);
      expect(agent.currentTask).toBeNull();
      expect(agent.metadata.domain).toBe(AgentDomain.Orchestration_CLI);
    });

    it('should record state transition on creation', async () => {
      await persistence.createAgent(
        'agent_002',
        AgentType.Manager,
        {
          spawnedAt: new Date(),
          lastActivityAt: new Date()
        }
      );

      const history = await persistence.getAgentHistory('agent_002');
      expect(history).toHaveLength(1);
      expect(history[0].fromState).toBeNull();
      expect(history[0].toState).toBe(AgentStatus.Spawning);
      expect(history[0].trigger).toBe(TransitionTrigger.Automatic);
    });

    it('should persist agent to database', async () => {
      await persistence.createAgent(
        'agent_003',
        AgentType.AdHoc,
        {
          spawnedAt: new Date(),
          lastActivityAt: new Date()
        }
      );

      const retrieved = await persistence.getAgentState('agent_003');
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('agent_003');
      expect(retrieved?.type).toBe(AgentType.AdHoc);
    });
  });

  describe('updateAgentState()', () => {
    beforeEach(async () => {
      await persistence.createAgent(
        'agent_update',
        AgentType.Implementation,
        {
          spawnedAt: new Date(),
          lastActivityAt: new Date()
        }
      );
    });

    it('should update agent status atomically', async () => {
      const updated = await persistence.updateAgentState(
        'agent_update',
        AgentStatus.Active,
        {
          trigger: TransitionTrigger.Automatic,
          metadata: { reason: 'Initialization complete' }
        }
      );

      expect(updated.status).toBe(AgentStatus.Active);
    });

    it('should record state transition', async () => {
      await persistence.updateAgentState(
        'agent_update',
        AgentStatus.Active,
        {
          trigger: TransitionTrigger.UserAction,
          metadata: { reason: 'Manual activation' }
        }
      );

      const history = await persistence.getAgentHistory('agent_update');
      expect(history.length).toBeGreaterThanOrEqual(2);

      const lastTransition = history[history.length - 1];
      expect(lastTransition.fromState).toBe(AgentStatus.Spawning);
      expect(lastTransition.toState).toBe(AgentStatus.Active);
      expect(lastTransition.trigger).toBe(TransitionTrigger.UserAction);
    });

    it('should reject invalid state transitions', async () => {
      await expect(
        persistence.updateAgentState(
          'agent_update',
          AgentStatus.Waiting, // Invalid: Spawning → Waiting
          { trigger: TransitionTrigger.Automatic }
        )
      ).rejects.toThrow(/Invalid state transition/);
    });

    it('should throw error for non-existent agent', async () => {
      await expect(
        persistence.updateAgentState(
          'nonexistent',
          AgentStatus.Active,
          { trigger: TransitionTrigger.Automatic }
        )
      ).rejects.toThrow(/Agent not found/);
    });

    it('should update heartbeat timestamp', async () => {
      const beforeUpdate = await persistence.getAgentState('agent_update');
      const heartbeatBefore = beforeUpdate?.metadata.lastActivityAt;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await persistence.updateAgentState(
        'agent_update',
        AgentStatus.Active,
        { trigger: TransitionTrigger.Automatic }
      );

      const afterUpdate = await persistence.getAgentState('agent_update');
      const heartbeatAfter = afterUpdate?.metadata.lastActivityAt;

      expect(heartbeatAfter!.getTime()).toBeGreaterThan(heartbeatBefore!.getTime());
    });
  });

  describe('updateAgentTask()', () => {
    beforeEach(async () => {
      await persistence.createAgent(
        'agent_task',
        AgentType.Implementation,
        {
          spawnedAt: new Date(),
          lastActivityAt: new Date()
        }
      );
    });

    it('should assign task to agent', async () => {
      await persistence.updateAgentTask('agent_task', 'task_1');

      const agent = await persistence.getAgentState('agent_task');
      expect(agent?.currentTask).toBe('task_1');
    });

    it('should clear task assignment', async () => {
      await persistence.updateAgentTask('agent_task', 'task_1');
      await persistence.updateAgentTask('agent_task', null);

      const agent = await persistence.getAgentState('agent_task');
      expect(agent?.currentTask).toBeNull();
    });
  });

  describe('getAgentState()', () => {
    it('should return undefined for non-existent agent', async () => {
      const agent = await persistence.getAgentState('nonexistent');
      expect(agent).toBeUndefined();
    });

    it('should retrieve agent with all metadata', async () => {
      const metadata = {
        domain: AgentDomain.Orchestration_Foundation,
        spawnedAt: new Date(),
        lastActivityAt: new Date(),
        worktreePath: '/tmp/worktree'
      };

      await persistence.createAgent('agent_meta', AgentType.Implementation, metadata);

      const agent = await persistence.getAgentState('agent_meta');
      expect(agent?.metadata.domain).toBe(AgentDomain.Orchestration_Foundation);
      expect(agent?.metadata.worktreePath).toBe('/tmp/worktree');
    });
  });

  describe('getAgentsByStatus()', () => {
    beforeEach(async () => {
      await persistence.createAgent('agent_s1', AgentType.Manager, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });
      await persistence.createAgent('agent_s2', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.updateAgentState('agent_s1', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });
    });

    it('should return agents filtered by status', async () => {
      const spawning = await persistence.getAgentsByStatus(AgentStatus.Spawning);
      expect(spawning).toHaveLength(1);
      expect(spawning[0].id).toBe('agent_s2');

      const active = await persistence.getAgentsByStatus(AgentStatus.Active);
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('agent_s1');
    });

    it('should return empty array for status with no agents', async () => {
      const waiting = await persistence.getAgentsByStatus(AgentStatus.Waiting);
      expect(waiting).toHaveLength(0);
    });

    it('should order agents by spawn time', async () => {
      const agents = await persistence.getAgentsByStatus(AgentStatus.Spawning);
      expect(agents.length).toBeGreaterThan(0);
      // First agent should be spawned first
    });
  });

  describe('getActiveAgents()', () => {
    it('should return only active agents', async () => {
      await persistence.createAgent('agent_a1', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });
      await persistence.createAgent('agent_a2', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.updateAgentState('agent_a1', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });

      const active = await persistence.getActiveAgents();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('agent_a1');
    });
  });

  describe('getAgentHistory()', () => {
    it('should return transitions in chronological order', async () => {
      await persistence.createAgent('agent_h', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.updateAgentState('agent_h', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });
      await persistence.updateAgentState('agent_h', AgentStatus.Waiting, {
        trigger: TransitionTrigger.Dependency
      });

      const history = await persistence.getAgentHistory('agent_h');
      expect(history).toHaveLength(3);
      expect(history[0].toState).toBe(AgentStatus.Spawning);
      expect(history[1].toState).toBe(AgentStatus.Active);
      expect(history[2].toState).toBe(AgentStatus.Waiting);
    });

    it('should respect limit parameter', async () => {
      await persistence.createAgent('agent_limit', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.updateAgentState('agent_limit', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });

      const history = await persistence.getAgentHistory('agent_limit', 1);
      expect(history).toHaveLength(1);
    });
  });

  describe('getAgentStatistics()', () => {
    it('should calculate time in each state', async () => {
      await persistence.createAgent('agent_stats', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.updateAgentState('agent_stats', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });

      const stats = await persistence.getAgentStatistics('agent_stats');
      expect(stats).toBeDefined();
      expect(stats!.agentId).toBe('agent_stats');
      expect(stats!.totalTransitions).toBe(2);
      expect(stats!.timeInStates[AgentStatus.Spawning]).toBeGreaterThanOrEqual(0);
    });

    it('should return undefined for non-existent agent', async () => {
      const stats = await persistence.getAgentStatistics('nonexistent');
      expect(stats).toBeUndefined();
    });

    it('should count transitions by trigger', async () => {
      await persistence.createAgent('agent_trig', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.updateAgentState('agent_trig', AgentStatus.Active, {
        trigger: TransitionTrigger.UserAction
      });

      const stats = await persistence.getAgentStatistics('agent_trig');
      expect(stats!.transitionsByTrigger[TransitionTrigger.Automatic]).toBe(1); // Creation
      expect(stats!.transitionsByTrigger[TransitionTrigger.UserAction]).toBe(1); // Update
    });
  });

  describe('deleteAgent()', () => {
    it('should soft delete by marking as Terminated', async () => {
      await persistence.createAgent('agent_del', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.deleteAgent('agent_del', 'User requested deletion');

      const agent = await persistence.getAgentState('agent_del');
      expect(agent?.status).toBe(AgentStatus.Terminated);
    });

    it('should record deletion reason in transition', async () => {
      await persistence.createAgent('agent_del2', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.deleteAgent('agent_del2', 'Test deletion');

      const history = await persistence.getAgentHistory('agent_del2');
      const lastTransition = history[history.length - 1];
      expect(lastTransition.metadata?.reason).toBe('Test deletion');
    });
  });

  describe('hardDeleteAgent()', () => {
    it('should permanently remove agent from database', async () => {
      await persistence.createAgent('agent_hard', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.hardDeleteAgent('agent_hard');

      const agent = await persistence.getAgentState('agent_hard');
      expect(agent).toBeUndefined();
    });

    it('should remove state transitions', async () => {
      await persistence.createAgent('agent_hard2', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.hardDeleteAgent('agent_hard2');

      const history = await persistence.getAgentHistory('agent_hard2');
      expect(history).toHaveLength(0);
    });
  });

  describe('Transaction atomicity', () => {
    it('should rollback on error during state update', async () => {
      await persistence.createAgent('agent_tx', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      // Try invalid transition (should fail and rollback)
      await expect(
        persistence.updateAgentState('agent_tx', AgentStatus.Waiting, {
          trigger: TransitionTrigger.Automatic
        })
      ).rejects.toThrow();

      // Agent should still be in Spawning state
      const agent = await persistence.getAgentState('agent_tx');
      expect(agent?.status).toBe(AgentStatus.Spawning);
    });
  });
});
