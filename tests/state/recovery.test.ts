/**
 * Agent Recovery Tests
 * Tests for crash detection, heartbeat monitoring, and recovery logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConnectionManager, createConnectionManager, TEST_CONFIG } from '../../src/db/connection.js';
import { setupTestDatabase } from '../../src/db/init.js';
import { AgentPersistenceManager, createAgentPersistence } from '../../src/state/persistence.js';
import { LifecycleEventManager } from '../../src/state/events.js';
import { AgentRecoveryManager } from '../../src/state/recovery.js';
import { AgentStatus, AgentType } from '../../src/types/agent.js';
import { TransitionTrigger } from '../../src/types/state.js';

describe('Agent Recovery', () => {
  let connectionManager: ConnectionManager;
  let persistence: AgentPersistenceManager;
  let eventManager: LifecycleEventManager;
  let recovery: AgentRecoveryManager;

  beforeEach(async () => {
    connectionManager = createConnectionManager(TEST_CONFIG);
    await connectionManager.connect();
    await setupTestDatabase(connectionManager);

    persistence = createAgentPersistence(connectionManager);
    eventManager = new LifecycleEventManager();
    recovery = new AgentRecoveryManager(
      connectionManager,
      persistence,
      eventManager,
      {
        heartbeatTimeout: 1000, // 1 second for fast testing
        monitoringInterval: 500,
        maxRetryAttempts: 3,
        retryBaseDelay: 100,
        autoRecovery: false // Disable auto for manual testing
      }
    );
  });

  afterEach(async () => {
    recovery.stopHeartbeatMonitoring();
    await connectionManager.disconnect();
  });

  describe('detectCrashedAgents()', () => {
    it('should detect agents with stale heartbeats', async () => {
      // Create agent
      await persistence.createAgent('agent_stale', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      // Transition to Active
      await persistence.updateAgentState('agent_stale', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });

      // Manually set old heartbeat by updating database directly
      const oldTime = new Date(Date.now() - 5000).toISOString(); // 5 seconds ago
      await connectionManager.execute(
        'UPDATE agents SET last_activity_at = ? WHERE id = ?',
        [oldTime, 'agent_stale']
      );

      // Detect crashes
      const crashed = await recovery.detectCrashedAgents();
      expect(crashed.length).toBeGreaterThan(0);
      expect(crashed[0].agent.id).toBe('agent_stale');
      expect(crashed[0].timeSinceHeartbeat).toBeGreaterThan(1000);
    });

    it('should not detect agents with recent heartbeats', async () => {
      await persistence.createAgent('agent_healthy', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.updateAgentState('agent_healthy', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });

      // Update heartbeat to now
      await persistence.updateHeartbeat('agent_healthy');

      const crashed = await recovery.detectCrashedAgents();
      expect(crashed).toHaveLength(0);
    });

    it('should only check Active and Waiting agents', async () => {
      // Create Idle agent with stale heartbeat
      await persistence.createAgent('agent_idle', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.updateAgentState('agent_idle', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });

      await persistence.updateAgentState('agent_idle', AgentStatus.Idle, {
        trigger: TransitionTrigger.Automatic
      });

      // Set old heartbeat
      const oldTime = new Date(Date.now() - 5000).toISOString();
      await connectionManager.execute(
        'UPDATE agents SET last_activity_at = ? WHERE id = ?',
        [oldTime, 'agent_idle']
      );

      const crashed = await recovery.detectCrashedAgents();
      const hasIdleAgent = crashed.some(c => c.agent.id === 'agent_idle');
      expect(hasIdleAgent).toBe(false); // Idle agents not monitored
    });
  });

  describe('attemptRecovery()', () => {
    it('should mark crashed agent as Terminated', async () => {
      await persistence.createAgent('agent_recover', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.updateAgentState('agent_recover', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });

      const result = await recovery.attemptRecovery('agent_recover', 'Test crash');

      expect(result.attempts).toBe(1);

      const agent = await persistence.getAgentState('agent_recover');
      expect(agent?.status).toBe(AgentStatus.Terminated);
    });

    it('should enforce max retry attempts', async () => {
      await persistence.createAgent('agent_retry', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.updateAgentState('agent_retry', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });

      // Attempt recovery 4 times (max is 3)
      for (let i = 0; i < 4; i++) {
        const result = await recovery.attemptRecovery('agent_retry', 'Crash');

        if (i < 3) {
          expect(result.attempts).toBe(i + 1);
        } else {
          // 4th attempt should fail with max attempts error
          expect(result.success).toBe(false);
          expect(result.error).toContain('Max recovery attempts');
        }

        // Re-mark as Active for next retry (simulate respawn attempt)
        if (i < 3) {
          await connectionManager.execute(
            'UPDATE agents SET status = ? WHERE id = ?',
            [AgentStatus.Active, 'agent_retry']
          );
        }
      }
    });

    it('should track recovery attempts', async () => {
      await persistence.createAgent('agent_track', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.updateAgentState('agent_track', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });

      await recovery.attemptRecovery('agent_track', 'Crash');

      const attempts = recovery.getRecoveryAttempts('agent_track');
      expect(attempts).toBe(1);
    });

    it('should reset attempts on successful recovery', async () => {
      await persistence.createAgent('agent_reset', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.updateAgentState('agent_reset', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });

      const result = await recovery.attemptRecovery('agent_reset', 'Crash');
      expect(result.success).toBe(true);

      const attempts = recovery.getRecoveryAttempts('agent_reset');
      expect(attempts).toBe(0); // Reset after success
    });
  });

  describe('Recovery statistics', () => {
    it('should track recovery statistics', async () => {
      await persistence.createAgent('agent_stats1', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.updateAgentState('agent_stats1', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });

      await recovery.attemptRecovery('agent_stats1', 'Crash 1');

      const stats = recovery.getRecoveryStatistics();
      expect(stats.totalAttempts).toBeGreaterThan(0);
      expect(stats.successfulRecoveries).toBeGreaterThan(0);
    });

    it('should calculate success rate', async () => {
      await persistence.createAgent('agent_rate', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.updateAgentState('agent_rate', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });

      await recovery.attemptRecovery('agent_rate', 'Test');

      const stats = recovery.getRecoveryStatistics();
      expect(stats.successRate).toBeGreaterThanOrEqual(0);
      expect(stats.successRate).toBeLessThanOrEqual(1);
    });
  });

  describe('Heartbeat monitoring', () => {
    it('should start and stop monitoring', () => {
      expect(recovery.isMonitoringActive()).toBe(false);

      recovery.startHeartbeatMonitoring();
      expect(recovery.isMonitoringActive()).toBe(true);

      recovery.stopHeartbeatMonitoring();
      expect(recovery.isMonitoringActive()).toBe(false);
    });

    it('should not start monitoring twice', () => {
      recovery.startHeartbeatMonitoring();
      recovery.startHeartbeatMonitoring(); // Should log warning but not fail

      expect(recovery.isMonitoringActive()).toBe(true);
    });
  });

  describe('Configuration', () => {
    it('should return current configuration', () => {
      const config = recovery.getConfig();
      expect(config.heartbeatTimeout).toBe(1000);
      expect(config.maxRetryAttempts).toBe(3);
    });

    it('should update configuration', () => {
      recovery.updateConfig({ maxRetryAttempts: 5 });

      const config = recovery.getConfig();
      expect(config.maxRetryAttempts).toBe(5);
    });
  });
});
