/**
 * Message Routing Logic
 *
 * Implements routing rules engine with pattern matching for agent communication.
 * Supports direct routing, broadcast routing, and type-based routing per Task 3.1
 * protocol specification.
 *
 * Features:
 * - Pattern matching (exact, prefix, wildcard, regex)
 * - Priority-based subscriber ordering (HIGH → NORMAL → LOW)
 * - Routing statistics and monitoring
 * - Dynamic routing rule updates
 * - Integration with Task 3.1 protocol message types
 */

import { EventBus, EventData } from './bus';
import { AgentType } from '../protocol/types';

/**
 * Subscriber priority levels
 */
export enum SubscriberPriority {
  HIGH = 'HIGH',
  NORMAL = 'NORMAL',
  LOW = 'LOW'
}

/**
 * Priority ordering for sorting
 */
const PRIORITY_ORDER: Record<SubscriberPriority, number> = {
  [SubscriberPriority.HIGH]: 0,
  [SubscriberPriority.NORMAL]: 1,
  [SubscriberPriority.LOW]: 2
};

/**
 * Subscriber information
 */
export interface SubscriberInfo {
  id: string;
  callback: (event: EventData) => void | Promise<void>;
  priority: SubscriberPriority;
  metadata?: Record<string, any>;
  subscribedAt: string;
}

/**
 * Routing rule definition
 */
export interface RoutingRule {
  pattern: string;
  priority: SubscriberPriority;
  description?: string;
  regex?: RegExp;
  createdAt: string;
}

/**
 * Routing result
 */
export interface RoutingResult {
  delivered: number;
  failed: number;
  topics: string[];
  matchedSubscribers: number;
}

/**
 * Routing statistics
 */
export interface RoutingStats {
  totalRouted: number;
  routedPerTopic: Map<string, number>;
  subscriberInvocations: Map<string, number>;
  averageRoutingTime: number;
  failedRoutingAttempts: number;
  noSubscribersCount: number;
}

/**
 * Message Router
 *
 * Implements routing rules from Task 3.1 protocol:
 * - Direct routing: message:direct:{receiverId}
 * - Broadcast routing: message:broadcast
 * - Type-based routing: message:type:{agentType}
 */
export class MessageRouter {
  private eventBus: EventBus;
  private subscriptionRegistry: Map<string, Set<SubscriberInfo>> = new Map();
  private routingRules: Map<string, RoutingRule> = new Map();

  // Statistics
  private stats = {
    totalRouted: 0,
    routedPerTopic: new Map<string, number>(),
    subscriberInvocations: new Map<string, number>(),
    routingTimes: [] as number[],
    failedRoutingAttempts: 0,
    noSubscribersCount: 0,
    maxSamples: 1000
  };

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Subscribe to a routing pattern
   *
   * @param pattern Topic pattern (supports wildcards)
   * @param subscriberId Unique subscriber identifier
   * @param callback Event handler callback
   * @param priority Priority level (default: NORMAL)
   * @param metadata Optional metadata
   * @returns Subscriber info
   */
  subscribe(
    pattern: string,
    subscriberId: string,
    callback: (event: EventData) => void | Promise<void>,
    priority: SubscriberPriority = SubscriberPriority.NORMAL,
    metadata?: Record<string, any>
  ): SubscriberInfo {
    const subscriberInfo: SubscriberInfo = {
      id: subscriberId,
      callback,
      priority,
      metadata,
      subscribedAt: new Date().toISOString()
    };

    // Add to subscription registry
    if (!this.subscriptionRegistry.has(pattern)) {
      this.subscriptionRegistry.set(pattern, new Set());
    }
    this.subscriptionRegistry.get(pattern)!.add(subscriberInfo);

    // Subscribe to event bus
    this.eventBus.on(pattern, callback);

    return subscriberInfo;
  }

  /**
   * Unsubscribe from pattern
   *
   * @param pattern Topic pattern
   * @param subscriberId Subscriber ID to remove
   * @returns True if subscriber was found and removed
   */
  unsubscribe(pattern: string, subscriberId: string): boolean {
    const subscribers = this.subscriptionRegistry.get(pattern);
    if (!subscribers) {
      return false;
    }

    const subscriber = Array.from(subscribers).find(s => s.id === subscriberId);
    if (!subscriber) {
      return false;
    }

    // Remove from registry
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      this.subscriptionRegistry.delete(pattern);
    }

    // Unsubscribe from event bus
    this.eventBus.off(pattern, subscriber.callback);

    return true;
  }

  /**
   * Route message using protocol routing rules
   *
   * Routing types from Task 3.1 protocol:
   * - Direct: message:direct:{receiverId}
   * - Broadcast: message:broadcast
   * - Type-based: message:type:{agentType}
   *
   * IMPORTANT: Always publishes to EventBus to deliver to ALL subscribers
   * (router-registered, SubscriptionManager-registered, and direct EventBus subscribers)
   *
   * @param topic Topic to route to
   * @param data Message data
   * @param publisherId Publisher agent ID
   * @returns Routing result
   */
  async route(topic: string, data: any, publisherId?: string): Promise<RoutingResult> {
    const startTime = Date.now();

    try {
      // Get matching subscribers from router's registry (for statistics)
      const subscribers = this.getMatchingSubscribers(topic);

      // Sort by priority (for statistics tracking)
      const sortedSubscribers = this.sortByPriority(subscribers);

      // ALWAYS publish to event bus - it will handle delivery to ALL subscribers
      // (not just router-registered ones, but also SubscriptionManager and direct bus subscribers)
      const deliveredCount = await this.eventBus.publish(topic, data, publisherId);

      // Update statistics
      this.stats.totalRouted++;
      const topicCount = this.stats.routedPerTopic.get(topic) || 0;
      this.stats.routedPerTopic.set(topic, topicCount + 1);

      // Update subscriber invocation counts (only for router-registered subscribers)
      for (const subscriber of sortedSubscribers) {
        const invocations = this.stats.subscriberInvocations.get(subscriber.id) || 0;
        this.stats.subscriberInvocations.set(subscriber.id, invocations + 1);
      }

      // Track routing time
      const routingTime = Date.now() - startTime;
      this.stats.routingTimes.push(routingTime);
      if (this.stats.routingTimes.length > this.stats.maxSamples) {
        this.stats.routingTimes.shift();
      }

      // Track no subscribers if EventBus also had none
      if (deliveredCount === 0) {
        this.stats.noSubscribersCount++;
      }

      return {
        delivered: deliveredCount,
        failed: deliveredCount === 0 ? 1 : 0,
        topics: [topic],
        matchedSubscribers: deliveredCount // Use actual delivery count from EventBus
      };
    } catch (error) {
      this.stats.failedRoutingAttempts++;
      throw error;
    }
  }

  /**
   * Add routing rule
   *
   * @param pattern Topic pattern
   * @param priority Priority level
   * @param description Optional description
   */
  addRoutingRule(
    pattern: string,
    priority: SubscriberPriority = SubscriberPriority.NORMAL,
    description?: string
  ): void {
    const rule: RoutingRule = {
      pattern,
      priority,
      description,
      regex: this.compilePattern(pattern),
      createdAt: new Date().toISOString()
    };

    this.routingRules.set(pattern, rule);
  }

  /**
   * Remove routing rule
   *
   * @param pattern Topic pattern
   * @returns True if rule was removed
   */
  removeRoutingRule(pattern: string): boolean {
    return this.routingRules.delete(pattern);
  }

  /**
   * Get all routing rules
   *
   * @returns Array of routing rules
   */
  getRoutingRules(): RoutingRule[] {
    return Array.from(this.routingRules.values());
  }

  /**
   * Get matching subscribers for topic
   *
   * @param topic Topic to match
   * @returns Array of matching subscribers
   */
  private getMatchingSubscribers(topic: string): SubscriberInfo[] {
    const matches: SubscriberInfo[] = [];

    for (const [pattern, subscribers] of this.subscriptionRegistry) {
      if (this.matchesPattern(topic, pattern)) {
        matches.push(...Array.from(subscribers));
      }
    }

    return matches;
  }

  /**
   * Check if topic matches pattern
   *
   * Supports:
   * - Exact match: topic === pattern
   * - Single wildcard: pattern ends with ':*'
   * - Multi-level wildcard: pattern contains ':**' or '**'
   * - Regex: advanced patterns
   *
   * @param topic Topic to test
   * @param pattern Pattern to match against
   * @returns True if matches
   */
  private matchesPattern(topic: string, pattern: string): boolean {
    // Exact match
    if (topic === pattern) {
      return true;
    }

    // Multi-level wildcard (**) - matches everything under prefix
    if (pattern.includes('**')) {
      const prefix = pattern.replace(':**', ':').replace('**', '');
      if (prefix === '' || topic.startsWith(prefix)) {
        return true;
      }
    }

    // Single wildcard (*) - matches one level
    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -2); // Remove ':*'
      if (topic.startsWith(prefix + ':')) {
        // Check that there are no more ':' after prefix
        const remainder = topic.slice(prefix.length + 1);
        if (!remainder.includes(':')) {
          return true;
        }
      }
    }

    // Check routing rules for regex patterns
    const rule = this.routingRules.get(pattern);
    if (rule && rule.regex) {
      return rule.regex.test(topic);
    }

    return false;
  }

  /**
   * Compile pattern to regex for advanced matching
   *
   * @param pattern Topic pattern
   * @returns Compiled regex or undefined
   */
  private compilePattern(pattern: string): RegExp | undefined {
    // Only compile if pattern contains regex special characters
    if (!/[.+?^${}()|[\]\\]/.test(pattern)) {
      return undefined;
    }

    try {
      return new RegExp(pattern);
    } catch {
      return undefined;
    }
  }

  /**
   * Sort subscribers by priority
   *
   * @param subscribers Array of subscribers
   * @returns Sorted array (HIGH → NORMAL → LOW, FIFO within same priority)
   */
  private sortByPriority(subscribers: SubscriberInfo[]): SubscriberInfo[] {
    return subscribers.slice().sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      // Same priority - maintain FIFO order by subscription time
      return new Date(a.subscribedAt).getTime() - new Date(b.subscribedAt).getTime();
    });
  }

  /**
   * Get routing statistics
   *
   * @returns Statistics object
   */
  getStats(): RoutingStats {
    const averageRoutingTime = this.stats.routingTimes.length > 0
      ? this.stats.routingTimes.reduce((sum, time) => sum + time, 0) / this.stats.routingTimes.length
      : 0;

    return {
      totalRouted: this.stats.totalRouted,
      routedPerTopic: new Map(this.stats.routedPerTopic),
      subscriberInvocations: new Map(this.stats.subscriberInvocations),
      averageRoutingTime,
      failedRoutingAttempts: this.stats.failedRoutingAttempts,
      noSubscribersCount: this.stats.noSubscribersCount
    };
  }

  /**
   * Reset routing statistics
   */
  resetStats(): void {
    this.stats.totalRouted = 0;
    this.stats.routedPerTopic.clear();
    this.stats.subscriberInvocations.clear();
    this.stats.routingTimes = [];
    this.stats.failedRoutingAttempts = 0;
    this.stats.noSubscribersCount = 0;
  }

  /**
   * Get all subscribers
   *
   * @returns Map of pattern to subscribers
   */
  getAllSubscribers(): Map<string, SubscriberInfo[]> {
    const result = new Map<string, SubscriberInfo[]>();

    for (const [pattern, subscribers] of this.subscriptionRegistry) {
      result.set(pattern, Array.from(subscribers));
    }

    return result;
  }

  /**
   * Get subscriber count for pattern
   *
   * @param pattern Optional pattern (returns total if omitted)
   * @returns Number of subscribers
   */
  getSubscriberCount(pattern?: string): number {
    if (pattern) {
      const subscribers = this.subscriptionRegistry.get(pattern);
      return subscribers ? subscribers.size : 0;
    }

    // Total across all patterns
    let total = 0;
    for (const subscribers of this.subscriptionRegistry.values()) {
      total += subscribers.size;
    }
    return total;
  }

  /**
   * Clear all subscriptions and routing rules
   */
  clear(): void {
    // Unsubscribe all from event bus
    for (const [pattern, subscribers] of this.subscriptionRegistry) {
      for (const subscriber of subscribers) {
        this.eventBus.off(pattern, subscriber.callback);
      }
    }

    this.subscriptionRegistry.clear();
    this.routingRules.clear();
    this.resetStats();
  }
}

/**
 * Create direct routing topic for specific receiver
 *
 * @param receiverId Receiver agent ID
 * @returns Direct routing topic
 */
export function createDirectTopic(receiverId: string): string {
  return `message:direct:${receiverId}`;
}

/**
 * Create broadcast routing topic
 *
 * @returns Broadcast routing topic
 */
export function createBroadcastTopic(): string {
  return 'message:broadcast';
}

/**
 * Create type-based routing topic for agent type
 *
 * @param agentType Agent type (Implementation, Manager, etc.)
 * @returns Type-based routing topic
 */
export function createTypeTopic(agentType: AgentType): string {
  return `message:type:${agentType}`;
}
