/**
 * Lifecycle Event Tests
 * Tests for event emission, subscription, buffering, and replay
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConnectionManager, createConnectionManager, TEST_CONFIG } from '../../src/db/connection.js';
import { setupTestDatabase } from '../../src/db/init.js';
import { AgentPersistenceManager, createAgentPersistence } from '../../src/state/persistence.js';
import {
  LifecycleEventManager,
  LifecycleEventType,
  createEventPayload
} from '../../src/state/events.js';
import { AgentStatus, AgentType } from '../../src/types/agent.js';
import { TransitionTrigger } from '../../src/types/state.js';

describe('Lifecycle Events', () => {
  let connectionManager: ConnectionManager;
  let persistence: AgentPersistenceManager;
  let eventManager: LifecycleEventManager;

  beforeEach(async () => {
    connectionManager = createConnectionManager(TEST_CONFIG);
    await connectionManager.connect();
    await setupTestDatabase(connectionManager);

    persistence = createAgentPersistence(connectionManager);
    eventManager = new LifecycleEventManager(connectionManager);
  });

  afterEach(async () => {
    eventManager.removeAllListeners();
    await connectionManager.disconnect();
  });

  describe('Event emission', () => {
    it('should emit agent:spawning event', (done) => {
      const payload = createEventPayload(
        'agent_001',
        null,
        AgentStatus.Spawning,
        TransitionTrigger.Automatic
      );

      eventManager.onLifecycleEvent(LifecycleEventType.AgentSpawning, (received) => {
        expect(received.agentId).toBe('agent_001');
        expect(received.toState).toBe(AgentStatus.Spawning);
        done();
      });

      eventManager.emitLifecycleEvent(LifecycleEventType.AgentSpawning, payload);
    });

    it('should emit agent:active event', (done) => {
      const payload = createEventPayload(
        'agent_002',
        AgentStatus.Spawning,
        AgentStatus.Active,
        TransitionTrigger.Automatic
      );

      eventManager.onLifecycleEvent(LifecycleEventType.AgentActive, (received) => {
        expect(received.fromState).toBe(AgentStatus.Spawning);
        expect(received.toState).toBe(AgentStatus.Active);
        done();
      });

      eventManager.emitLifecycleEvent(LifecycleEventType.AgentActive, payload);
    });

    it('should emit agent:terminated event', (done) => {
      const payload = createEventPayload(
        'agent_003',
        AgentStatus.Active,
        AgentStatus.Terminated,
        TransitionTrigger.Error,
        { reason: 'Crash detected' }
      );

      eventManager.onLifecycleEvent(LifecycleEventType.AgentTerminated, (received) => {
        expect(received.toState).toBe(AgentStatus.Terminated);
        expect(received.trigger).toBe(TransitionTrigger.Error);
        expect(received.metadata.reason).toBe('Crash detected');
        done();
      });

      eventManager.emitLifecycleEvent(LifecycleEventType.AgentTerminated, payload);
    });
  });

  describe('Event subscription', () => {
    it('should support multiple listeners for same event', () => {
      let count = 0;
      const handler1 = () => { count++; };
      const handler2 = () => { count++; };

      eventManager.onLifecycleEvent(LifecycleEventType.AgentActive, handler1);
      eventManager.onLifecycleEvent(LifecycleEventType.AgentActive, handler2);

      const payload = createEventPayload(
        'agent_multi',
        AgentStatus.Spawning,
        AgentStatus.Active,
        TransitionTrigger.Automatic
      );

      eventManager.emitLifecycleEvent(LifecycleEventType.AgentActive, payload);

      expect(count).toBe(2);
    });

    it('should support once() for single occurrence', () => {
      let count = 0;
      const handler = () => { count++; };

      eventManager.onceLifecycleEvent(LifecycleEventType.AgentActive, handler);

      const payload = createEventPayload(
        'agent_once',
        AgentStatus.Spawning,
        AgentStatus.Active,
        TransitionTrigger.Automatic
      );

      eventManager.emitLifecycleEvent(LifecycleEventType.AgentActive, payload);
      eventManager.emitLifecycleEvent(LifecycleEventType.AgentActive, payload);

      expect(count).toBe(1);
    });

    it('should support unsubscribing', () => {
      let count = 0;
      const handler = () => { count++; };

      eventManager.onLifecycleEvent(LifecycleEventType.AgentActive, handler);
      eventManager.offLifecycleEvent(LifecycleEventType.AgentActive, handler);

      const payload = createEventPayload(
        'agent_unsub',
        AgentStatus.Spawning,
        AgentStatus.Active,
        TransitionTrigger.Automatic
      );

      eventManager.emitLifecycleEvent(LifecycleEventType.AgentActive, payload);

      expect(count).toBe(0);
    });

    it('should support catch-all listener', () => {
      const events: LifecycleEventType[] = [];

      eventManager.onAllLifecycleEvents((eventType) => {
        events.push(eventType);
      });

      eventManager.emitLifecycleEvent(
        LifecycleEventType.AgentSpawning,
        createEventPayload('agent_1', null, AgentStatus.Spawning, TransitionTrigger.Automatic)
      );

      eventManager.emitLifecycleEvent(
        LifecycleEventType.AgentActive,
        createEventPayload('agent_1', AgentStatus.Spawning, AgentStatus.Active, TransitionTrigger.Automatic)
      );

      expect(events).toHaveLength(2);
      expect(events).toContain(LifecycleEventType.AgentSpawning);
      expect(events).toContain(LifecycleEventType.AgentActive);
    });
  });

  describe('Event buffering', () => {
    it('should buffer events when database unavailable', async () => {
      await connectionManager.disconnect();

      const payload = createEventPayload(
        'agent_buffer',
        null,
        AgentStatus.Spawning,
        TransitionTrigger.Automatic
      );

      eventManager.emitLifecycleEvent(LifecycleEventType.AgentSpawning, payload);

      const bufferStatus = eventManager.getBufferStatus();
      expect(bufferStatus.size).toBe(1);
    });

    it('should replay buffered events on reconnection', async () => {
      await connectionManager.disconnect();

      // Emit events while disconnected
      for (let i = 0; i < 3; i++) {
        const payload = createEventPayload(
          `agent_${i}`,
          null,
          AgentStatus.Spawning,
          TransitionTrigger.Automatic
        );
        eventManager.emitLifecycleEvent(LifecycleEventType.AgentSpawning, payload);
      }

      expect(eventManager.getBufferStatus().size).toBe(3);

      // Reconnect and replay
      await connectionManager.connect();
      await setupTestDatabase(connectionManager);

      const replayed = await eventManager.replayBufferedEvents();
      expect(replayed).toBe(3);
      expect(eventManager.getBufferStatus().size).toBe(0);
    });

    it('should respect buffer size limit', async () => {
      const smallBufferManager = new LifecycleEventManager(connectionManager, {
        maxSize: 2,
        overflowStrategy: 'drop-oldest',
        autoReplay: false
      });

      await connectionManager.disconnect();

      // Emit 3 events (buffer size is 2)
      for (let i = 0; i < 3; i++) {
        const payload = createEventPayload(
          `agent_${i}`,
          null,
          AgentStatus.Spawning,
          TransitionTrigger.Automatic
        );
        smallBufferManager.emitLifecycleEvent(LifecycleEventType.AgentSpawning, payload);
      }

      const status = smallBufferManager.getBufferStatus();
      expect(status.size).toBe(2); // Oldest event dropped
    });
  });

  describe('Event replay', () => {
    it('should replay historical events from database', async () => {
      // Create agent and perform state transitions
      await persistence.createAgent('agent_replay', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      await persistence.updateAgentState('agent_replay', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });

      // Replay events
      const count = await eventManager.replayHistoricalEvents('agent_replay');
      expect(count).toBe(2); // Spawning + Active
    });

    it('should replay events from specific timestamp', async () => {
      await persistence.createAgent('agent_time', AgentType.Implementation, {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      });

      const now = new Date();

      await persistence.updateAgentState('agent_time', AgentStatus.Active, {
        trigger: TransitionTrigger.Automatic
      });

      // Replay only events after 'now' (should get Active transition only)
      const count = await eventManager.replayHistoricalEvents('agent_time', now);
      expect(count).toBe(1);
    });
  });

  describe('Event statistics', () => {
    it('should track listener counts', () => {
      eventManager.onLifecycleEvent(LifecycleEventType.AgentActive, () => {});
      eventManager.onLifecycleEvent(LifecycleEventType.AgentActive, () => {});
      eventManager.onLifecycleEvent(LifecycleEventType.AgentTerminated, () => {});

      const stats = eventManager.getEventStats();
      expect(stats.listenerCounts[LifecycleEventType.AgentActive]).toBe(2);
      expect(stats.listenerCounts[LifecycleEventType.AgentTerminated]).toBe(1);
      expect(stats.totalListeners).toBeGreaterThanOrEqual(3);
    });

    it('should track buffer utilization', async () => {
      await connectionManager.disconnect();

      for (let i = 0; i < 5; i++) {
        eventManager.emitLifecycleEvent(
          LifecycleEventType.AgentSpawning,
          createEventPayload(`agent_${i}`, null, AgentStatus.Spawning, TransitionTrigger.Automatic)
        );
      }

      const stats = eventManager.getEventStats();
      expect(stats.bufferSize).toBe(5);
      expect(stats.bufferUtilization).toBeGreaterThan(0);
    });
  });
});
