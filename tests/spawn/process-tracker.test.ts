/**
 * Process Tracker Tests
 * Tests for database process tracking integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionManager, createConnectionManager, TEST_CONFIG } from '../../src/db/connection.js';
import { setupTestDatabase } from '../../src/db/init.js';
import { AgentPersistenceManager, createAgentPersistence } from '../../src/state/persistence.js';
import { AgentStatus, AgentType } from '../../src/types/agent.js';
import { TransitionTrigger } from '../../src/types/state.js';
import {
  ProcessTracker,
  createProcessTracker,
  type SpawnMetadata,
} from '../../src/spawn/process-tracker.js';

describe('ProcessTracker', () => {
  let connectionManager: ConnectionManager;
  let persistence: AgentPersistenceManager;
  let tracker: ProcessTracker;

  beforeEach(async () => {
    // Create in-memory database for each test
    connectionManager = createConnectionManager(TEST_CONFIG);
    await connectionManager.connect();
    await setupTestDatabase(connectionManager);

    persistence = createAgentPersistence(connectionManager);
    await persistence.ensureIndexes();

    tracker = createProcessTracker(persistence);
  });

  afterEach(async () => {
    await connectionManager.disconnect();
  });

  describe('recordSpawn()', () => {
    it('should record agent spawn to database', async () => {
      const metadata: SpawnMetadata = {
        processId: 12345,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.1',
        workingDirectory: '/home/user/project',
      };

      const agent = await tracker.recordSpawn('agent_001', metadata);

      expect(agent.id).toBe('agent_001');
      expect(agent.type).toBe(AgentType.Implementation);
      expect(agent.status).toBe(AgentStatus.Active);
    });

    it('should transition to Active after spawn', async () => {
      const metadata: SpawnMetadata = {
        processId: 12345,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.1',
        workingDirectory: '/home/user/project',
      };

      await tracker.recordSpawn('agent_001', metadata);

      // Verify agent transitioned to Active
      const agent = await persistence.getAgentState('agent_001');
      expect(agent?.status).toBe(AgentStatus.Active);
    });

    it('should store process metadata in custom_metadata', async () => {
      const metadata: SpawnMetadata = {
        processId: 12345,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.1',
        workingDirectory: '/home/user/project',
      };

      await tracker.recordSpawn('agent_001', metadata);

      const agent = await persistence.getAgentState('agent_001');
      expect(agent?.metadata.custom_metadata).toBeDefined();
      expect(agent?.metadata.custom_metadata?.process).toBeDefined();
      expect(agent?.metadata.custom_metadata?.process.pid).toBe(12345);
      expect(agent?.metadata.custom_metadata?.process.promptTemplateId).toBe('implementation-agent-v1');
      expect(agent?.metadata.custom_metadata?.process.taskId).toBe('4.1');
      expect(agent?.metadata.custom_metadata?.process.cwd).toBe('/home/user/project');
    });

    it('should record spawn timestamp in metadata', async () => {
      const metadata: SpawnMetadata = {
        processId: 12345,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.1',
        workingDirectory: '/home/user/project',
      };

      const beforeSpawn = new Date();
      await tracker.recordSpawn('agent_001', metadata);
      const afterSpawn = new Date();

      const agent = await persistence.getAgentState('agent_001');
      expect(agent?.metadata.custom_metadata?.process.spawnedAt).toBeDefined();
      
      const spawnedAt = new Date(agent!.metadata.custom_metadata!.process.spawnedAt);
      expect(spawnedAt.getTime()).toBeGreaterThanOrEqual(beforeSpawn.getTime());
      expect(spawnedAt.getTime()).toBeLessThanOrEqual(afterSpawn.getTime());
    });

    it('should create state transition records', async () => {
      const metadata: SpawnMetadata = {
        processId: 12345,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.1',
        workingDirectory: '/home/user/project',
      };

      await tracker.recordSpawn('agent_001', metadata);

      const history = await persistence.getAgentHistory('agent_001');
      
      // Should have at least 2 transitions: null -> Spawning, Spawning -> Active
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history[0].toState).toBe(AgentStatus.Spawning);
      expect(history[1].toState).toBe(AgentStatus.Active);
    });
  });

  describe('updateHeartbeat()', () => {
    beforeEach(async () => {
      const metadata: SpawnMetadata = {
        processId: 12345,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.1',
        workingDirectory: '/home/user/project',
      };
      await tracker.recordSpawn('agent_heartbeat', metadata);
    });

    it('should update last activity timestamp', async () => {
      const agentBefore = await persistence.getAgentState('agent_heartbeat');
      const lastActivityBefore = agentBefore!.metadata.lastActivityAt;

      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10));

      await tracker.updateHeartbeat('agent_heartbeat');

      const agentAfter = await persistence.getAgentState('agent_heartbeat');
      const lastActivityAfter = agentAfter!.metadata.lastActivityAt;

      expect(lastActivityAfter).not.toEqual(lastActivityBefore);
      expect(new Date(lastActivityAfter).getTime()).toBeGreaterThan(new Date(lastActivityBefore).getTime());
    });

    it('should handle multiple heartbeat updates', async () => {
      for (let i = 0; i < 5; i++) {
        await tracker.updateHeartbeat('agent_heartbeat');
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const agent = await persistence.getAgentState('agent_heartbeat');
      expect(agent?.metadata.lastActivityAt).toBeDefined();
    });
  });

  describe('recordExit()', () => {
    beforeEach(async () => {
      const metadata: SpawnMetadata = {
        processId: 12345,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.1',
        workingDirectory: '/home/user/project',
      };
      await tracker.recordSpawn('agent_exit', metadata);
    });

    it('should record successful exit (exit code 0)', async () => {
      await tracker.recordExit('agent_exit', 0, null);

      const agent = await persistence.getAgentState('agent_exit');
      expect(agent?.status).toBe(AgentStatus.Terminated);
    });

    it('should record crashed exit (exit code > 0)', async () => {
      await tracker.recordExit('agent_exit', 1, null);

      const agent = await persistence.getAgentState('agent_exit');
      expect(agent?.status).toBe(AgentStatus.Terminated);
    });

    it('should record signal termination', async () => {
      await tracker.recordExit('agent_exit', null, 'SIGTERM');

      const agent = await persistence.getAgentState('agent_exit');
      expect(agent?.status).toBe(AgentStatus.Terminated);
    });

    it('should record exit metadata in state transitions', async () => {
      await tracker.recordExit('agent_exit', 1, null);

      const history = await persistence.getAgentHistory('agent_exit');
      
      // Find the termination transition
      const terminationTransition = history.find(t => t.toState === AgentStatus.Terminated);
      expect(terminationTransition).toBeDefined();
    });

    it('should handle SIGKILL termination', async () => {
      await tracker.recordExit('agent_exit', null, 'SIGKILL');

      const agent = await persistence.getAgentState('agent_exit');
      expect(agent?.status).toBe(AgentStatus.Terminated);
    });

    it('should handle unknown exit conditions', async () => {
      await tracker.recordExit('agent_exit', null, null);

      const agent = await persistence.getAgentState('agent_exit');
      expect(agent?.status).toBe(AgentStatus.Terminated);
    });
  });

  describe('getActiveAgents()', () => {
    it('should return empty array when no agents exist', async () => {
      const active = await tracker.getActiveAgents();
      expect(active).toEqual([]);
    });

    it('should return active agents', async () => {
      const metadata1: SpawnMetadata = {
        processId: 111,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.1',
        workingDirectory: '/home/user/project',
      };

      const metadata2: SpawnMetadata = {
        processId: 222,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.2',
        workingDirectory: '/home/user/project',
      };

      await tracker.recordSpawn('agent_001', metadata1);
      await tracker.recordSpawn('agent_002', metadata2);

      const active = await tracker.getActiveAgents();
      expect(active).toHaveLength(2);
      expect(active.map(a => a.id)).toContain('agent_001');
      expect(active.map(a => a.id)).toContain('agent_002');
    });

    it('should include waiting agents', async () => {
      const metadata: SpawnMetadata = {
        processId: 333,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.3',
        workingDirectory: '/home/user/project',
      };

      await tracker.recordSpawn('agent_waiting', metadata);

      // Transition to Waiting
      await persistence.updateAgentState('agent_waiting', AgentStatus.Waiting, {
        trigger: TransitionTrigger.UserAction,
      });

      const active = await tracker.getActiveAgents();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('agent_waiting');
      expect(active[0].status).toBe(AgentStatus.Waiting);
    });

    it('should exclude terminated agents', async () => {
      const metadata: SpawnMetadata = {
        processId: 444,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.4',
        workingDirectory: '/home/user/project',
      };

      await tracker.recordSpawn('agent_terminated', metadata);
      await tracker.recordExit('agent_terminated', 0, null);

      const active = await tracker.getActiveAgents();
      expect(active).toHaveLength(0);
    });

    it('should exclude idle agents', async () => {
      const metadata: SpawnMetadata = {
        processId: 555,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.5',
        workingDirectory: '/home/user/project',
      };

      await tracker.recordSpawn('agent_idle', metadata);

      // Transition to Idle
      await persistence.updateAgentState('agent_idle', AgentStatus.Idle, {
        trigger: TransitionTrigger.UserAction,
      });

      const active = await tracker.getActiveAgents();
      expect(active).toHaveLength(0);
    });

    it('should exclude spawning agents', async () => {
      // Create agent but don't call recordSpawn (which auto-transitions to Active)
      await persistence.createAgent('agent_spawning', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date(),
      });

      const active = await tracker.getActiveAgents();
      expect(active).toHaveLength(0);
    });
  });

  describe('getProcessMetrics()', () => {
    it('should return undefined for non-existent agent', async () => {
      const metrics = await tracker.getProcessMetrics('nonexistent');
      expect(metrics).toBeUndefined();
    });

    it('should calculate runtime since spawn', async () => {
      const metadata: SpawnMetadata = {
        processId: 666,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.6',
        workingDirectory: '/home/user/project',
      };

      await tracker.recordSpawn('agent_metrics', metadata);

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      const metrics = await tracker.getProcessMetrics('agent_metrics');

      expect(metrics).toBeDefined();
      expect(metrics!.agentId).toBe('agent_metrics');
      expect(metrics!.runtime).toBeGreaterThan(90); // At least 90ms
      expect(metrics!.runtime).toBeLessThan(200); // Less than 200ms
    });

    it('should return current status', async () => {
      const metadata: SpawnMetadata = {
        processId: 777,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.7',
        workingDirectory: '/home/user/project',
      };

      await tracker.recordSpawn('agent_status', metadata);

      const metrics = await tracker.getProcessMetrics('agent_status');

      expect(metrics!.status).toBe(AgentStatus.Active);
    });

    it('should calculate heartbeat age', async () => {
      const metadata: SpawnMetadata = {
        processId: 888,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.8',
        workingDirectory: '/home/user/project',
      };

      await tracker.recordSpawn('agent_heartbeat_age', metadata);

      // Wait before updating heartbeat
      await new Promise(resolve => setTimeout(resolve, 50));
      await tracker.updateHeartbeat('agent_heartbeat_age');

      // Wait again before checking metrics
      await new Promise(resolve => setTimeout(resolve, 50));

      const metrics = await tracker.getProcessMetrics('agent_heartbeat_age');

      expect(metrics!.heartbeatAge).toBeGreaterThan(40); // At least 40ms since last heartbeat
    });

    it('should include last activity timestamp', async () => {
      const metadata: SpawnMetadata = {
        processId: 999,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.9',
        workingDirectory: '/home/user/project',
      };

      await tracker.recordSpawn('agent_activity', metadata);

      const metrics = await tracker.getProcessMetrics('agent_activity');

      expect(metrics!.lastActivityAt).toBeInstanceOf(Date);
      expect(metrics!.lastActivityAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should include spawn timestamp', async () => {
      const metadata: SpawnMetadata = {
        processId: 1000,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.10',
        workingDirectory: '/home/user/project',
      };

      const beforeSpawn = new Date();
      await tracker.recordSpawn('agent_spawn_time', metadata);
      const afterSpawn = new Date();

      const metrics = await tracker.getProcessMetrics('agent_spawn_time');

      expect(metrics!.spawnedAt).toBeDefined();
      expect(metrics!.spawnedAt!.getTime()).toBeGreaterThanOrEqual(beforeSpawn.getTime());
      expect(metrics!.spawnedAt!.getTime()).toBeLessThanOrEqual(afterSpawn.getTime());
    });

    it('should handle metrics for terminated agent', async () => {
      const metadata: SpawnMetadata = {
        processId: 1001,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.11',
        workingDirectory: '/home/user/project',
      };

      await tracker.recordSpawn('agent_terminated_metrics', metadata);

      // Wait a bit before terminating
      await new Promise(resolve => setTimeout(resolve, 10));

      await tracker.recordExit('agent_terminated_metrics', 0, null);

      const metrics = await tracker.getProcessMetrics('agent_terminated_metrics');

      expect(metrics).toBeDefined();
      expect(metrics!.status).toBe(AgentStatus.Terminated);
      expect(metrics!.runtime).toBeGreaterThan(0);
    });
  });

  describe('createProcessTracker()', () => {
    it('should create ProcessTracker instance', () => {
      const tracker = createProcessTracker(persistence);
      expect(tracker).toBeInstanceOf(ProcessTracker);
    });
  });
});
