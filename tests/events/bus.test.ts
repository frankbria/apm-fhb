/**
 * Event Bus Tests
 *
 * Comprehensive test suite for EventBus core functionality including:
 * - Event publication and delivery
 * - Wildcard subscriptions (* and **)
 * - Event metadata injection
 * - Multiple emission modes (async, sync, parallel)
 * - Event cancellation
 * - Statistics tracking
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus, EmissionMode, EventData, CancellationResult } from '../../src/events/bus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    // Use SYNC mode as default for predictable test behavior
    bus = new EventBus({ defaultMode: EmissionMode.SYNC });
  });

  afterEach(() => {
    bus.shutdown();
  });

  describe('Event Publication', () => {
    it('should publish events to exact match subscribers', async () => {
      const received: any[] = [];

      bus.on('agent:spawned:manager', (event) => {
        received.push(event.data);
      });

      await bus.publish('agent:spawned:manager', { agentId: 'manager-1' });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ agentId: 'manager-1' });
    });

    it('should add event metadata automatically', async () => {
      let receivedEvent: EventData | null = null;

      bus.on('test:topic', (event) => {
        receivedEvent = event;
      });

      await bus.publish('test:topic', { test: 'data' }, 'publisher-1');

      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent!.metadata).toMatchObject({
        publisherId: 'publisher-1',
        sequenceNumber: 1
      });
      expect(receivedEvent!.metadata.timestamp).toBeDefined();
      expect(receivedEvent!.metadata.eventId).toBeDefined();
    });

    it('should deliver to multiple subscribers', async () => {
      const received1: any[] = [];
      const received2: any[] = [];
      const received3: any[] = [];

      bus.on('task:completed', (event) => received1.push(event.data));
      bus.on('task:completed', (event) => received2.push(event.data));
      bus.on('task:completed', (event) => received3.push(event.data));

      await bus.publish('task:completed', { taskId: '1.2' });

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
      expect(received3).toHaveLength(1);
    });

    it('should preserve event data through routing', async () => {
      const complexData = {
        nested: { value: 42 },
        array: [1, 2, 3],
        string: 'test'
      };

      let receivedData: any = null;

      bus.on('data:test', (event) => {
        receivedData = event.data;
      });

      await bus.publish('data:test', complexData);

      expect(receivedData).toEqual(complexData);
    });

    it('should increment sequence numbers', async () => {
      const sequences: number[] = [];

      bus.on('test:**', (event) => {
        sequences.push(event.metadata.sequenceNumber);
      });

      await bus.publish('test:1', {});
      await bus.publish('test:2', {});
      await bus.publish('test:3', {});

      expect(sequences).toEqual([1, 2, 3]);
    });
  });

  describe('Wildcard Subscriptions', () => {
    it('should support single wildcard (*) matching', async () => {
      const received: string[] = [];

      bus.on('agent:*', (event) => {
        received.push(event.topic);
      });

      await bus.publish('agent:spawned', {});
      await bus.publish('agent:terminated', {});
      await bus.publish('agent:spawned:manager', {}); // Should NOT match (too deep)

      // Wait for async handlers
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(2);
      expect(received).toContain('agent:spawned');
      expect(received).toContain('agent:terminated');
      expect(received).not.toContain('agent:spawned:manager');
    });

    it('should support multi-level wildcard (**) matching', async () => {
      const received: string[] = [];

      bus.on('agent:**', (event) => {
        received.push(event.topic);
      });

      await bus.publish('agent:spawned', {});
      await bus.publish('agent:spawned:manager', {});
      await bus.publish('agent:terminated:impl', {});

      // Wait for async handlers
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(3);
    });

    it('should support global wildcard (**) listener', async () => {
      const received: string[] = [];

      bus.on('**', (event) => {
        received.push(event.topic);
      });

      await bus.publish('agent:spawned', {});
      await bus.publish('task:completed:1.2', {});
      await bus.publish('message:broadcast', {});

      // Wait for async handlers
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(3);
    });
  });

  describe('Emission Modes', () => {
    it('should support async emission (default)', async () => {
      const order: string[] = [];

      bus.on('test:async', async (event) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        order.push('handler-1');
      });

      bus.on('test:async', async (event) => {
        await new Promise(resolve => setTimeout(resolve, 5));
        order.push('handler-2');
      });

      const count = await bus.publish('test:async', {}, undefined, EmissionMode.ASYNC);
      order.push('published');

      expect(count).toBe(2);
      expect(order).toEqual(['published']); // Async handlers haven't finished yet
    });

    it('should support sync emission', async () => {
      const order: string[] = [];

      bus.on('test:sync', async (event) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        order.push('handler-1');
      });

      bus.on('test:sync', async (event) => {
        await new Promise(resolve => setTimeout(resolve, 5));
        order.push('handler-2');
      });

      const count = await bus.publish('test:sync', {}, undefined, EmissionMode.SYNC);
      order.push('published');

      expect(count).toBe(2);
      expect(order).toEqual(['handler-1', 'handler-2', 'published']);
    });

    it('should support parallel emission', async () => {
      const order: string[] = [];
      const startTime = Date.now();

      bus.on('test:parallel', async (event) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        order.push('handler-1');
      });

      bus.on('test:parallel', async (event) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        order.push('handler-2');
      });

      const count = await bus.publish('test:parallel', {}, undefined, EmissionMode.PARALLEL);
      const elapsed = Date.now() - startTime;

      expect(count).toBe(2);
      expect(order).toHaveLength(2);
      expect(elapsed).toBeLessThan(100); // Should be ~50ms, not ~100ms (sequential)
    });

    it('should use topic-specific emission mode', async () => {
      bus.setTopicMode('critical:*', EmissionMode.SYNC);

      const order: string[] = [];

      bus.on('critical:event', () => {
        order.push('handler');
      });

      await bus.publish('critical:event', {});
      order.push('published');

      expect(order).toEqual(['handler', 'published']);
    });
  });

  describe('Event Cancellation', () => {
    it('should support event cancellation in sync mode', async () => {
      const received: string[] = [];

      bus.on('test:cancel', () => {
        received.push('handler-1');
        return { cancel: true, reason: 'validation failed' };
      });

      bus.on('test:cancel', () => {
        received.push('handler-2'); // Should NOT execute
      });

      await bus.publish('test:cancel', {}, undefined, EmissionMode.SYNC);

      expect(received).toEqual(['handler-1']);
    });

    it('should emit cancellation events', async () => {
      let cancelledEvent: any = null;

      bus.on('event-cancelled', (event) => {
        cancelledEvent = event.data;
      });

      bus.on('test:topic', (): CancellationResult => {
        return { cancel: true, reason: 'test cancellation' };
      });

      await bus.publish('test:topic', {}, undefined, EmissionMode.SYNC);

      // Wait for nextTick since cancellation events are emitted asynchronously
      await new Promise(resolve => process.nextTick(resolve));

      expect(cancelledEvent).not.toBeNull();
      expect(cancelledEvent.reason).toBe('test cancellation');
    });
  });

  describe('Statistics', () => {
    it('should track publication statistics', async () => {
      bus.on('test:topic', () => {});

      await bus.publish('test:topic', {});
      await bus.publish('test:topic', {});
      await bus.publish('other:topic', {});

      const stats = bus.getStats();

      expect(stats.totalPublished).toBe(3);
      expect(stats.totalDelivered).toBe(2); // Only test:topic has subscriber
      expect(stats.topicCounts.get('test:topic')).toBe(2);
      expect(stats.topicCounts.get('other:topic')).toBe(1);
    });

    it('should track average delivery time', async () => {
      bus.on('test:topic', () => {});

      await bus.publish('test:topic', {}, undefined, EmissionMode.SYNC);
      await bus.publish('test:topic', {}, undefined, EmissionMode.SYNC);

      const stats = bus.getStats();

      expect(stats.averageDeliveryTime).toBeGreaterThanOrEqual(0);
    });

    it('should reset statistics', async () => {
      bus.on('test:topic', () => {});

      await bus.publish('test:topic', {});
      bus.resetStats();

      const stats = bus.getStats();

      expect(stats.totalPublished).toBe(0);
      expect(stats.totalDelivered).toBe(0);
      expect(stats.topicCounts.size).toBe(0);
    });
  });

  describe('Subscription Management', () => {
    it('should support once subscriptions', async () => {
      const received: any[] = [];

      bus.once('test:once', (event) => {
        received.push(event.data);
      });

      await bus.publish('test:once', { value: 1 });
      await bus.publish('test:once', { value: 2 });

      // Wait for async handlers
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ value: 1 });
    });

    it('should support unsubscribe', async () => {
      const received: any[] = [];
      const handler = (event: EventData) => {
        received.push(event.data);
      };

      bus.on('test:unsub', handler);

      await bus.publish('test:unsub', { value: 1 });
      bus.off('test:unsub', handler);
      await bus.publish('test:unsub', { value: 2 });

      // Wait for async handlers
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(1);
    });

    it('should get listener count', () => {
      bus.on('test:topic', () => {});
      bus.on('test:topic', () => {});
      bus.on('other:topic', () => {});

      expect(bus.listenerCount('test:topic')).toBe(2);
      expect(bus.listenerCount('other:topic')).toBe(1);
      expect(bus.listenerCount()).toBe(3);
    });

    it('should get event names', () => {
      bus.on('agent:spawned', () => {});
      bus.on('task:completed', () => {});

      const names = bus.eventNames();

      expect(names).toContain('agent:spawned');
      expect(names).toContain('task:completed');
    });

    it('should remove all listeners', () => {
      bus.on('test:topic', () => {});
      bus.on('test:topic', () => {});

      bus.removeAllListeners('test:topic');

      expect(bus.listenerCount('test:topic')).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle listener errors gracefully', async () => {
      const errors: any[] = [];
      const received: any[] = [];

      bus.on('listener-error', (event) => {
        errors.push(event.data);
      });

      bus.on('test:error', () => {
        // Throw error - this should be caught by emitParallel
        const error = new Error('Handler error');
        // Suppress the error output in tests
        error.stack = undefined;
        throw error;
      });

      bus.on('test:error', (event) => {
        received.push(event.data); // Should still execute
      });

      // Errors in PARALLEL mode are caught by Promise.allSettled
      await bus.publish('test:error', { value: 1 }, undefined, EmissionMode.PARALLEL);

      // Wait for nextTick and async handlers
      await new Promise(resolve => process.nextTick(resolve));
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(errors).toHaveLength(1);
      expect(received).toHaveLength(1);
    });
  });

  describe('Shutdown', () => {
    it('should clear all listeners and stats on shutdown', async () => {
      bus.on('test:topic', () => {});
      await bus.publish('test:topic', {});

      bus.shutdown();

      expect(bus.listenerCount()).toBe(0);
      expect(bus.getStats().totalPublished).toBe(0);
    });
  });
});
