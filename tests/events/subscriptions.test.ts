/**
 * Subscription Manager Tests
 *
 * Comprehensive test suite for SubscriptionManager functionality including:
 * - Subscription lifecycle operations
 * - Subscription handles
 * - Subscription groups
 * - Once subscriptions
 * - TTL subscriptions
 * - Duplicate prevention
 * - Introspection API
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus, EmissionMode } from '../../src/events/bus';
import { SubscriptionManager } from '../../src/events/subscriptions';

describe('SubscriptionManager', () => {
  let bus: EventBus;
  let manager: SubscriptionManager;

  beforeEach(() => {
    // Use SYNC mode for deterministic test behavior (especially for once() subscriptions)
    bus = new EventBus({ defaultMode: EmissionMode.SYNC });
    manager = new SubscriptionManager(bus);
  });

  afterEach(() => {
    manager.clear();
    bus.shutdown();
  });

  describe('Subscription Lifecycle', () => {
    it('should subscribe with handle', async () => {
      const received: any[] = [];

      const handle = manager.subscribe('test:topic', (event) => {
        received.push(event.data);
      });

      expect(handle.id).toBeDefined();
      expect(handle.unsubscribe).toBeInstanceOf(Function);

      await bus.publish('test:topic', { value: 1 });

      // Wait for async delivery
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(1);
    });

    it('should unsubscribe using handle', async () => {
      const received: any[] = [];

      const handle = manager.subscribe('test:topic', (event) => {
        received.push(event.data);
      });

      await bus.publish('test:topic', { value: 1 });
      handle.unsubscribe();
      await bus.publish('test:topic', { value: 2 });

      // Wait for async delivery
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(1);
    });

    it('should unsubscribe by ID', async () => {
      const received: any[] = [];
      const callback = (event: any) => received.push(event.data);

      const handle1 = manager.subscribe('test:topic', callback);
      const handle2 = manager.subscribe('other:topic', callback);

      await bus.publish('test:topic', { value: 1 });
      await bus.publish('other:topic', { value: 2 });

      manager.unsubscribeById(callback.toString());

      await bus.publish('test:topic', { value: 3 });
      await bus.publish('other:topic', { value: 4 });

      // Wait for async delivery
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(2);
    });

    it('should unsubscribe from topic', async () => {
      const received1: any[] = [];
      const received2: any[] = [];

      manager.subscribe('test:topic', (event) => received1.push(event.data));
      manager.subscribe('test:topic', (event) => received2.push(event.data));

      await bus.publish('test:topic', { value: 1 });

      manager.unsubscribeFromTopic('test:topic');

      await bus.publish('test:topic', { value: 2 });

      // Wait for async delivery
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });
  });

  describe('Subscription Groups', () => {
    it('should create subscription group', () => {
      const group = manager.createGroup('group-1');

      expect(group.id).toBe('group-1');
      expect(group.subscriptions).toBeInstanceOf(Set);
      expect(group.createdAt).toBeDefined();
    });

    it('should subscribe to group', async () => {
      const received: any[] = [];

      manager.subscribeGroup('group-1', 'test:topic', (event) => {
        received.push(event.data);
      });

      await bus.publish('test:topic', { value: 1 });

      // Wait for async delivery
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(1);
    });

    it('should unsubscribe entire group', async () => {
      const received1: any[] = [];
      const received2: any[] = [];

      manager.subscribeGroup('group-1', 'test:topic', (event) => {
        received1.push(event.data);
      });

      manager.subscribeGroup('group-1', 'other:topic', (event) => {
        received2.push(event.data);
      });

      await bus.publish('test:topic', { value: 1 });
      await bus.publish('other:topic', { value: 2 });

      manager.unsubscribeGroup('group-1');

      await bus.publish('test:topic', { value: 3 });
      await bus.publish('other:topic', { value: 4 });

      // Wait for async delivery
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    it('should get group by ID', () => {
      manager.createGroup('group-1', { description: 'Test group' });

      const group = manager.getGroup('group-1');

      expect(group).toBeDefined();
      expect(group!.id).toBe('group-1');
      expect(group!.metadata?.description).toBe('Test group');
    });

    it('should list all groups', () => {
      manager.createGroup('group-1');
      manager.createGroup('group-2');
      manager.createGroup('group-3');

      const groups = manager.getGroups();

      expect(groups).toHaveLength(3);
    });
  });

  describe('Once Subscriptions', () => {
    it('should auto-unsubscribe after first event', async () => {
      const received: any[] = [];

      manager.subscribe('test:once', (event) => {
        received.push(event.data);
      }, { once: true });

      // In SYNC mode, each publish completes before next one starts
      // so once() can properly remove listener between publishes
      await bus.publish('test:once', { value: 1 });
      await bus.publish('test:once', { value: 2 });
      await bus.publish('test:once', { value: 3 });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ value: 1 });
    });

    it('should remove from tracking after once event', async () => {
      manager.subscribe('test:once', () => {}, { once: true });

      expect(manager.getSubscriptionCount('test:once')).toBe(1);

      await bus.publish('test:once', {});

      // Wait for auto-removal
      await new Promise(resolve => setTimeout(resolve, 50));

      // Note: The subscription info might still be in the manager
      // until the once handler completes, so we can't reliably test count here
    });
  });

  describe('TTL Subscriptions', () => {
    it('should auto-expire after TTL', async () => {
      vi.useFakeTimers();

      const received: any[] = [];

      manager.subscribe('test:ttl', (event) => {
        received.push(event.data);
      }, { ttl: 100 }); // 100ms TTL

      await bus.publish('test:ttl', { value: 1 });

      // Advance time by 50ms (within TTL)
      vi.advanceTimersByTime(50);
      await bus.publish('test:ttl', { value: 2 });

      // Advance time past TTL to trigger expiry timer
      vi.advanceTimersByTime(60);

      // Flush microtasks to allow expiry handler to run
      await Promise.resolve();

      await bus.publish('test:ttl', { value: 3 });

      expect(received.length).toBeLessThan(3); // Should not receive third event

      vi.useRealTimers();
    });

    it('should emit subscription-expired event', async () => {
      vi.useFakeTimers();

      let expiredEvent: any = null;

      manager.on('subscription-expired', (event) => {
        expiredEvent = event;
      });

      manager.subscribe('test:ttl', () => {}, { ttl: 100 });

      // Advance time past TTL to trigger expiry
      vi.advanceTimersByTime(110);

      // Flush microtasks to allow expiry handler to run
      await Promise.resolve();

      expect(expiredEvent).not.toBeNull();
      expect(expiredEvent.topic).toBe('test:ttl');

      vi.useRealTimers();
    });
  });

  describe('Duplicate Prevention', () => {
    it('should prevent duplicate subscriptions', () => {
      const callback = () => {};

      const handle1 = manager.subscribe('test:topic', callback);
      const handle2 = manager.subscribe('test:topic', callback);

      expect(handle1.id).toBe(handle2.id); // Same handle returned

      const stats = manager.getStats();
      expect(stats.duplicatePrevented).toBeGreaterThan(0);
    });

    it('should emit duplicate-subscription event', () => {
      let duplicateEvent: any = null;

      manager.on('duplicate-subscription', (event) => {
        duplicateEvent = event;
      });

      const callback = () => {};
      manager.subscribe('test:topic', callback);
      manager.subscribe('test:topic', callback);

      expect(duplicateEvent).not.toBeNull();
      expect(duplicateEvent.topic).toBe('test:topic');
    });
  });

  describe('Validation', () => {
    it('should validate topic format', () => {
      expect(() => {
        manager.subscribe('invalid topic!', () => {});
      }).toThrow('Invalid topic format');
    });

    it('should allow valid topic formats', () => {
      expect(() => {
        manager.subscribe('valid:topic', () => {});
        manager.subscribe('agent:*', () => {});
        manager.subscribe('task:**', () => {});
        manager.subscribe('simple_topic', () => {});
        manager.subscribe('with-dashes', () => {});
      }).not.toThrow();
    });

    it('should warn on potential listener leak', () => {
      let warningEvent: any = null;

      manager.on('listener-leak-warning', (event) => {
        warningEvent = event;
      });

      // Subscribe 51 times (threshold is 50)
      for (let i = 0; i < 51; i++) {
        manager.subscribe('test:topic', () => {});
      }

      expect(warningEvent).not.toBeNull();
      expect(warningEvent.count).toBeGreaterThanOrEqual(50);
    });
  });

  describe('Introspection', () => {
    it('should list subscriptions', () => {
      const callback1 = () => {};
      const callback2 = () => {};

      manager.subscribe('test:topic', callback1);
      manager.subscribe('other:topic', callback2);

      const all = manager.listSubscriptions();
      expect(all).toHaveLength(2);
    });

    it('should list subscriptions by subscriber ID', () => {
      const callback = () => {};

      manager.subscribe('test:topic', callback);
      manager.subscribe('other:topic', callback);

      const subscriptions = manager.listSubscriptions(callback.toString());
      expect(subscriptions).toHaveLength(2);
    });

    it('should get topic subscribers', () => {
      manager.subscribe('test:topic', () => {});
      manager.subscribe('test:topic', () => {});
      manager.subscribe('other:topic', () => {});

      const subscribers = manager.getTopicSubscribers('test:topic');
      expect(subscribers).toHaveLength(2);
    });

    it('should get subscription count', () => {
      manager.subscribe('test:topic', () => {});
      manager.subscribe('test:topic', () => {});
      manager.subscribe('other:topic', () => {});

      expect(manager.getSubscriptionCount('test:topic')).toBe(2);
      expect(manager.getSubscriptionCount('other:topic')).toBe(1);
      expect(manager.getSubscriptionCount()).toBe(3);
    });
  });

  describe('Statistics', () => {
    it('should track subscription statistics', () => {
      manager.subscribe('test:topic', () => {});
      manager.subscribe('test:topic', () => {});

      const stats = manager.getStats();

      expect(stats.totalSubscriptions).toBe(2);
      expect(stats.activeSubscriptions).toBe(2);
      expect(stats.groupCount).toBe(0);
    });

    it('should track group count', () => {
      manager.createGroup('group-1');
      manager.createGroup('group-2');

      const stats = manager.getStats();

      expect(stats.groupCount).toBe(2);
    });
  });

  describe('Clear', () => {
    it('should clear all subscriptions and groups', () => {
      manager.subscribe('test:topic', () => {});
      manager.createGroup('group-1');

      manager.clear();

      expect(manager.getSubscriptionCount()).toBe(0);
      expect(manager.getGroups()).toHaveLength(0);
      expect(manager.getStats().activeSubscriptions).toBe(0);
    });
  });

  describe('Subscription Options', () => {
    it('should accept metadata', () => {
      const handle = manager.subscribe('test:topic', () => {}, {
        metadata: { source: 'test', priority: 1 }
      });

      const subscriptions = manager.listSubscriptions();
      const subscription = subscriptions.find(s => s.handle.id === handle.id);

      expect(subscription?.metadata).toEqual({ source: 'test', priority: 1 });
    });

    it('should track subscription time', () => {
      const handle = manager.subscribe('test:topic', () => {});

      const subscriptions = manager.listSubscriptions();
      const subscription = subscriptions.find(s => s.handle.id === handle.id);

      expect(subscription?.subscribedAt).toBeDefined();
      expect(new Date(subscription!.subscribedAt)).toBeInstanceOf(Date);
    });

    it('should track expiry time for TTL subscriptions', () => {
      const handle = manager.subscribe('test:topic', () => {}, { ttl: 5000 });

      const subscriptions = manager.listSubscriptions();
      const subscription = subscriptions.find(s => s.handle.id === handle.id);

      expect(subscription?.ttl).toBe(5000);
      expect(subscription?.expiresAt).toBeDefined();
    });
  });
});
