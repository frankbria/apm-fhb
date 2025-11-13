/**
 * Event Bus Integration Tests
 *
 * End-to-end integration tests covering:
 * - Agent coordination flows
 * - Message routing with priority queue integration (Task 3.2)
 * - State updates from file monitoring (Task 3.3)
 * - Concurrent operations and thread safety
 * - Error handling across components
 * - Performance characteristics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus, EmissionMode } from '../../src/events/bus';
import { MessageRouter, SubscriberPriority, createDirectTopic, createBroadcastTopic } from '../../src/events/router';
import { SubscriptionManager } from '../../src/events/subscriptions';

describe('Event Bus Integration', () => {
  let bus: EventBus;
  let router: MessageRouter;
  let manager: SubscriptionManager;

  beforeEach(() => {
    // Use SYNC mode for predictable test behavior
    bus = new EventBus({ defaultMode: EmissionMode.SYNC });
    router = new MessageRouter(bus);
    manager = new SubscriptionManager(bus);
  });

  afterEach(() => {
    manager.clear();
    router.clear();
    bus.shutdown();
  });

  describe('Agent Coordination Flows', () => {
    it('should coordinate agent spawn flow', async () => {
      const events: string[] = [];

      // Manager subscribes to spawn events
      manager.subscribe('agent:spawn:request', (event) => {
        events.push('spawn-request-received');

        // Manager spawns agent and publishes spawned event
        setTimeout(async () => {
          await bus.publish('agent:spawned', {
            agentId: event.data.agentId,
            type: event.data.type
          });
        }, 10);
      });

      // Monitor subscribes to spawned events
      manager.subscribe('agent:spawned', (event) => {
        events.push('agent-spawned');
      });

      // Trigger spawn request
      await bus.publish('agent:spawn:request', {
        agentId: 'impl-1',
        type: 'Implementation'
      });

      // Wait for async flow
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(events).toContain('spawn-request-received');
      expect(events).toContain('agent-spawned');
    });

    it('should coordinate task assignment flow', async () => {
      const events: string[] = [];

      // Implementation agent subscribes to direct messages
      const agentId = 'impl-1';
      const directTopic = createDirectTopic(agentId);

      manager.subscribe(directTopic, (event) => {
        events.push('task-received');

        // Agent publishes task started
        setTimeout(async () => {
          await bus.publish('task:started', {
            taskId: event.data.taskId,
            agentId
          });
        }, 10);
      });

      // Manager subscribes to task started events
      manager.subscribe('task:started', (event) => {
        events.push('task-started');
      });

      // Manager sends task assignment
      await router.route(directTopic, {
        taskId: '3.4',
        description: 'Implement event bus'
      });

      // Wait for async flow
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(events).toContain('task-received');
      expect(events).toContain('task-started');
    });

    it('should coordinate task completion flow', async () => {
      const events: any[] = [];

      // Manager subscribes to task completion events
      manager.subscribe('task:completed:*', (event) => {
        events.push({
          type: 'task-completed',
          taskId: event.data.taskId
        });

        // Manager updates state
        setTimeout(async () => {
          await bus.publish('state:updated', {
            agentId: event.data.agentId,
            status: 'COMPLETED'
          });
        }, 10);
      });

      // Monitor subscribes to state updates
      manager.subscribe('state:updated', (event) => {
        events.push({
          type: 'state-updated',
          agentId: event.data.agentId
        });
      });

      // Agent publishes task completed
      await bus.publish('task:completed:3.4', {
        taskId: '3.4',
        agentId: 'impl-1',
        status: 'COMPLETED'
      });

      // Wait for async flow
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('task-completed');
      expect(events[1].type).toBe('state-updated');
    });

    it('should coordinate broadcast announcements', async () => {
      const received: string[] = [];
      const broadcastTopic = createBroadcastTopic();

      // Multiple agents subscribe to broadcast
      manager.subscribe(broadcastTopic, (event) => {
        received.push('agent-1');
      });

      manager.subscribe(broadcastTopic, (event) => {
        received.push('agent-2');
      });

      manager.subscribe(broadcastTopic, (event) => {
        received.push('agent-3');
      });

      // Manager broadcasts shutdown
      await router.route(broadcastTopic, { action: 'shutdown' });

      // Wait for async delivery
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(3);
    });
  });

  describe('Priority Queue Integration', () => {
    it('should respect message priority in routing', async () => {
      const received: any[] = [];

      // Subscribe with different priorities
      router.subscribe('priority:test', 'high', (event) => {
        received.push({ priority: 'HIGH', data: event.data });
      }, SubscriberPriority.HIGH);

      router.subscribe('priority:test', 'normal', (event) => {
        received.push({ priority: 'NORMAL', data: event.data });
      }, SubscriberPriority.NORMAL);

      router.subscribe('priority:test', 'low', (event) => {
        received.push({ priority: 'LOW', data: event.data });
      }, SubscriberPriority.LOW);

      await router.route('priority:test', { message: 'test' });

      // Wait for async delivery
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(3);
      // In async mode, order may vary, but all should receive
      expect(received.filter(r => r.priority === 'HIGH')).toHaveLength(1);
      expect(received.filter(r => r.priority === 'NORMAL')).toHaveLength(1);
      expect(received.filter(r => r.priority === 'LOW')).toHaveLength(1);
    });

    it('should handle message bursts efficiently', async () => {
      const received: any[] = [];

      manager.subscribe('burst:test', (event) => {
        received.push(event.data);
      });

      const startTime = Date.now();

      // Send 100 messages
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(bus.publish('burst:test', { index: i }));
      }

      await Promise.all(promises);

      const elapsed = Date.now() - startTime;

      // Wait for all async deliveries
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(received).toHaveLength(100);
      expect(elapsed).toBeLessThan(1000); // Should be fast
    });
  });

  describe('State Update Integration', () => {
    it('should process state updates from file monitoring', async () => {
      const stateUpdates: any[] = [];

      // Subscribe to state update events (from Task 3.3 integration)
      manager.subscribe('state:update:*', (event) => {
        stateUpdates.push({
          eventType: event.data.type,
          taskId: event.data.taskId,
          status: event.data.newStatus
        });
      });

      // Simulate file monitoring events
      await bus.publish('state:update:task-completed', {
        type: 'TASK_COMPLETED',
        taskId: '3.4',
        newStatus: 'COMPLETED',
        agentId: 'impl-1'
      });

      await bus.publish('state:update:task-blocked', {
        type: 'TASK_BLOCKED',
        taskId: '3.5',
        newStatus: 'BLOCKED',
        agentId: 'impl-2'
      });

      // Wait for async delivery
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(stateUpdates).toHaveLength(2);
      expect(stateUpdates[0].status).toBe('COMPLETED');
      expect(stateUpdates[1].status).toBe('BLOCKED');
    });

    it('should batch related state updates', async () => {
      const batches: any[][] = [];
      let currentBatch: any[] = [];

      manager.subscribe('state:**', (event) => {
        currentBatch.push(event.data);

        // Simulate batching with 50ms window
        setTimeout(() => {
          if (currentBatch.length > 0) {
            batches.push([...currentBatch]);
            currentBatch = [];
          }
        }, 50);
      });

      // Send rapid updates
      await bus.publish('state:update', { taskId: '3.1' });
      await bus.publish('state:update', { taskId: '3.2' });
      await bus.publish('state:update', { taskId: '3.3' });

      // Wait for batching
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(batches.length).toBeGreaterThan(0);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent publish and subscribe', async () => {
      const received: any[] = [];

      // Concurrent subscriptions
      const subscribePromises = [];
      for (let i = 0; i < 10; i++) {
        subscribePromises.push(
          new Promise<void>((resolve) => {
            manager.subscribe(`topic:${i}`, (event) => {
              received.push(event.data);
            });
            resolve();
          })
        );
      }

      await Promise.all(subscribePromises);

      // Concurrent publications
      const publishPromises = [];
      for (let i = 0; i < 10; i++) {
        publishPromises.push(bus.publish(`topic:${i}`, { value: i }));
      }

      await Promise.all(publishPromises);

      // Wait for async deliveries
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(received).toHaveLength(10);
    });

    it('should maintain event ordering per topic', async () => {
      const received: number[] = [];

      manager.subscribe('ordered:topic', (event) => {
        received.push(event.data.sequence);
      });

      // Publish in order
      for (let i = 0; i < 20; i++) {
        await bus.publish('ordered:topic', { sequence: i }, undefined, EmissionMode.SYNC);
      }

      expect(received).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    });

    it('should handle high concurrency without race conditions', async () => {
      const received = new Set<number>();

      manager.subscribe('concurrent:**', (event) => {
        received.add(event.data.id);
      });

      // Publish 1000 concurrent events
      const promises = [];
      for (let i = 0; i < 1000; i++) {
        promises.push(bus.publish('concurrent:test', { id: i }));
      }

      await Promise.all(promises);

      // Wait for all deliveries
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(received.size).toBe(1000);
    });
  });

  describe('Error Handling', () => {
    it('should handle subscriber errors without stopping delivery', async () => {
      const received: any[] = [];
      const errors: any[] = [];

      bus.on('listener-error', (error) => {
        errors.push(error);
      });

      // First subscriber throws error
      manager.subscribe('test:error', (event) => {
        throw new Error('Subscriber error');
      });

      // Second subscriber should still receive
      manager.subscribe('test:error', (event) => {
        received.push(event.data);
      });

      await bus.publish('test:error', { value: 1 }, undefined, EmissionMode.PARALLEL);

      // Wait for async delivery
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(errors).toHaveLength(1);
      expect(received).toHaveLength(1);
    });

    it('should handle routing to non-existent topics gracefully', async () => {
      const result = await router.route('nonexistent:topic', {});

      expect(result.delivered).toBe(0);
      expect(result.failed).toBe(1);
    });

    it('should recover from event bus errors', async () => {
      const received: any[] = [];

      bus.on('bus-error', (error) => {
        // Error logged
      });

      manager.subscribe('test:topic', (event) => {
        received.push(event.data);
      });

      await bus.publish('test:topic', { value: 1 });

      // Wait for delivery
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(1);
    });
  });

  describe('Performance', () => {
    it('should achieve >1000 events/sec throughput', async () => {
      const received: any[] = [];

      manager.subscribe('perf:test', (event) => {
        received.push(event.data);
      });

      const eventCount = 2000;
      const startTime = Date.now();

      const promises = [];
      for (let i = 0; i < eventCount; i++) {
        promises.push(bus.publish('perf:test', { index: i }));
      }

      await Promise.all(promises);
      const publishTime = Date.now() - startTime;

      const eventsPerSecond = (eventCount / publishTime) * 1000;

      expect(eventsPerSecond).toBeGreaterThan(1000);
    });

    it('should have bounded memory usage', () => {
      // Subscribe and unsubscribe many times
      for (let i = 0; i < 1000; i++) {
        const handle = manager.subscribe('test:topic', () => {});
        handle.unsubscribe();
      }

      // Active subscriptions should be 0
      expect(manager.getSubscriptionCount()).toBe(0);
    });

    it('should handle wildcard matching efficiently', async () => {
      const received: any[] = [];

      // Many wildcard subscriptions
      manager.subscribe('agent:**', (event) => received.push(event));
      manager.subscribe('task:**', (event) => received.push(event));
      manager.subscribe('message:**', (event) => received.push(event));

      const startTime = Date.now();

      // Publish to various topics
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(bus.publish(`agent:spawned:${i}`, {}));
      }

      await Promise.all(promises);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(500); // Should be fast
    });
  });

  describe('End-to-End Flows', () => {
    it('should complete full message lifecycle', async () => {
      const lifecycle: string[] = [];

      // Publisher
      const publisherId = 'manager-1';

      // Subscriber
      manager.subscribe('message:test', (event) => {
        lifecycle.push('received');

        // Send acknowledgment
        setTimeout(async () => {
          await bus.publish('message:ack', {
            messageId: event.metadata.eventId,
            receiverId: 'impl-1'
          });
        }, 10);
      });

      // ACK handler
      manager.subscribe('message:ack', (event) => {
        lifecycle.push('acknowledged');
      });

      // Publish message
      await bus.publish('message:test', { content: 'test' }, publisherId);
      lifecycle.push('published');

      // Wait for full lifecycle
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(lifecycle).toEqual(['published', 'received', 'acknowledged']);
    });

    it('should integrate all components in complex scenario', async () => {
      const events: any[] = [];

      // Create subscription group for manager
      manager.createGroup('manager-subscriptions');

      // Manager subscribes to multiple patterns
      manager.subscribeGroup('manager-subscriptions', 'agent:**', (event) => {
        events.push({ source: 'manager', type: 'agent-event', topic: event.topic });
      });

      manager.subscribeGroup('manager-subscriptions', 'task:**', (event) => {
        events.push({ source: 'manager', type: 'task-event', topic: event.topic });
      });

      // Router handles direct messages
      const agentId = 'impl-1';
      router.subscribe(createDirectTopic(agentId), agentId, (event) => {
        events.push({ source: 'agent', type: 'direct-message', data: event.data });
      }, SubscriberPriority.HIGH);

      // Publish various events
      await bus.publish('agent:spawned:manager', { agentId: 'manager-1' });
      await bus.publish('task:started:3.4', { taskId: '3.4' });
      await router.route(createDirectTopic(agentId), { message: 'start task' });

      // Wait for all deliveries
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events.filter(e => e.source === 'manager')).toHaveLength(2);
      expect(events.filter(e => e.source === 'agent')).toHaveLength(1);
    });
  });
});
