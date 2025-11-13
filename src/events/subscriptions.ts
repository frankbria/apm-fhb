/**
 * Subscription Management
 *
 * Implements subscription lifecycle operations for event bus including:
 * - Subscription handles for targeted unsubscribe
 * - Subscription groups for bulk management
 * - Once subscriptions (auto-unsubscribe after first event)
 * - TTL subscriptions (time-to-live expiry)
 * - Subscription validation and introspection
 *
 * Features:
 * - Lifecycle operations (subscribe, unsubscribe, groups)
 * - TTL-based automatic expiry
 * - Duplicate subscription prevention
 * - Memory leak warnings
 * - Comprehensive introspection API
 */

import { EventBus, EventData } from './bus';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

/**
 * Subscription handle for targeted unsubscribe
 */
export interface SubscriptionHandle {
  id: string;
  unsubscribe: () => void;
}

/**
 * Subscription information
 */
export interface SubscriptionInfo {
  topic: string;
  callback: (event: EventData) => void | Promise<void>;
  handle: SubscriptionHandle;
  subscribedAt: string;
  metadata?: Record<string, any>;
  ttl?: number;
  expiresAt?: string;
  groupId?: string;
  once?: boolean;
}

/**
 * Subscription options
 */
export interface SubscriptionOptions {
  priority?: 'HIGH' | 'NORMAL' | 'LOW';
  once?: boolean;
  ttl?: number; // Time-to-live in milliseconds
  metadata?: Record<string, any>;
  groupId?: string;
}

/**
 * Subscription group
 */
export interface SubscriptionGroup {
  id: string;
  subscriptions: Set<SubscriptionHandle>;
  createdAt: string;
  metadata?: Record<string, any>;
}

/**
 * Subscription Manager
 *
 * Manages subscription lifecycle with support for groups, TTL, and validation.
 */
export class SubscriptionManager extends EventEmitter {
  private eventBus: EventBus;
  private subscriptions: Map<string, SubscriptionInfo[]> = new Map();
  private groups: Map<string, SubscriptionGroup> = new Map();
  private expiryTimers: Map<string, NodeJS.Timeout> = new Map();

  // Validation thresholds
  private readonly MAX_LISTENERS_WARNING = 50;
  private readonly TOPIC_VALIDATION_REGEX = /^[a-zA-Z0-9:*_-]+$/;

  // Statistics
  private stats = {
    totalSubscriptions: 0,
    activeSubscriptions: 0,
    expiredSubscriptions: 0,
    duplicatePrevented: 0
  };

  constructor(eventBus: EventBus) {
    super();
    this.eventBus = eventBus;
  }

  /**
   * Subscribe to topic with callback
   *
   * @param topic Topic pattern to subscribe to
   * @param callback Event handler callback
   * @param options Subscription options
   * @returns Subscription handle
   */
  subscribe(
    topic: string,
    callback: (event: EventData) => void | Promise<void>,
    options: SubscriptionOptions = {}
  ): SubscriptionHandle {
    // Validate topic format
    if (!this.validateTopic(topic)) {
      throw new Error(`Invalid topic format: ${topic}`);
    }

    // Check for duplicate subscription
    if (this.isDuplicate(topic, callback, options.groupId)) {
      this.stats.duplicatePrevented++;
      this.emit('duplicate-subscription', { topic, groupId: options.groupId });

      // Return existing handle if found
      const existing = this.findExistingSubscription(topic, callback, options.groupId);
      if (existing) {
        return existing.handle;
      }
    }

    // Check for potential listener leak
    this.checkListenerLeak(topic);

    // Create subscription handle
    const handleId = uuidv4();
    const handle: SubscriptionHandle = {
      id: handleId,
      unsubscribe: () => this.unsubscribeByHandle(handleId)
    };

    // Calculate expiry time if TTL provided
    let expiresAt: string | undefined;
    if (options.ttl) {
      const expiryTime = new Date(Date.now() + options.ttl);
      expiresAt = expiryTime.toISOString();
    }

    // Create subscription info
    const subscriptionInfo: SubscriptionInfo = {
      topic,
      callback,
      handle,
      subscribedAt: new Date().toISOString(),
      metadata: options.metadata,
      ttl: options.ttl,
      expiresAt,
      groupId: options.groupId,
      once: options.once
    };

    // Store in subscriptions map
    const subscriberId = this.getSubscriberId(callback);
    if (!this.subscriptions.has(subscriberId)) {
      this.subscriptions.set(subscriberId, []);
    }
    this.subscriptions.get(subscriberId)!.push(subscriptionInfo);

    // Add to group if specified
    if (options.groupId) {
      this.addToGroup(options.groupId, handle);
    }

    // Subscribe to event bus
    if (options.once) {
      this.eventBus.once(topic, callback);
      // Auto-remove from tracking after first event
      this.eventBus.once(topic, () => {
        this.removeSubscriptionInfo(handleId);
      });
    } else {
      this.eventBus.on(topic, callback);
    }

    // Set up TTL expiry timer if specified
    if (options.ttl) {
      this.setupExpiryTimer(handleId, options.ttl, topic, callback);
    }

    // Update statistics
    this.stats.totalSubscriptions++;
    this.stats.activeSubscriptions++;

    return handle;
  }

  /**
   * Unsubscribe using handle
   *
   * @param handle Subscription handle or handle ID
   */
  unsubscribe(handle: SubscriptionHandle | string): void {
    const handleId = typeof handle === 'string' ? handle : handle.id;
    this.unsubscribeByHandle(handleId);
  }

  /**
   * Unsubscribe by handle ID
   *
   * @param handleId Handle ID
   */
  private unsubscribeByHandle(handleId: string): void {
    // Find subscription
    const subscription = this.findSubscriptionByHandle(handleId);
    if (!subscription) {
      return;
    }

    // Unsubscribe from event bus
    this.eventBus.off(subscription.topic, subscription.callback);

    // Remove from subscriptions map
    this.removeSubscriptionInfo(handleId);

    // Clear expiry timer if exists
    this.clearExpiryTimer(handleId);

    // Update statistics
    this.stats.activeSubscriptions--;
  }

  /**
   * Unsubscribe all subscriptions for subscriber
   *
   * @param subscriberId Subscriber ID (callback-based)
   */
  unsubscribeById(subscriberId: string): void {
    const subscriptions = this.subscriptions.get(subscriberId);
    if (!subscriptions) {
      return;
    }

    // Unsubscribe each
    for (const subscription of subscriptions.slice()) {
      this.unsubscribeByHandle(subscription.handle.id);
    }

    this.subscriptions.delete(subscriberId);
  }

  /**
   * Unsubscribe all subscriptions for topic
   *
   * @param topic Topic pattern
   */
  unsubscribeFromTopic(topic: string): void {
    const toUnsubscribe: string[] = [];

    // Find all subscriptions for topic
    for (const subscriptions of this.subscriptions.values()) {
      for (const subscription of subscriptions) {
        if (subscription.topic === topic) {
          toUnsubscribe.push(subscription.handle.id);
        }
      }
    }

    // Unsubscribe each
    for (const handleId of toUnsubscribe) {
      this.unsubscribeByHandle(handleId);
    }
  }

  /**
   * Create subscription group
   *
   * @param groupId Group identifier
   * @param metadata Optional metadata
   * @returns Subscription group
   */
  createGroup(groupId: string, metadata?: Record<string, any>): SubscriptionGroup {
    if (this.groups.has(groupId)) {
      return this.groups.get(groupId)!;
    }

    const group: SubscriptionGroup = {
      id: groupId,
      subscriptions: new Set(),
      createdAt: new Date().toISOString(),
      metadata
    };

    this.groups.set(groupId, group);
    return group;
  }

  /**
   * Subscribe to topic within a group
   *
   * @param groupId Group identifier
   * @param topic Topic pattern
   * @param callback Event handler callback
   * @param options Additional options
   * @returns Subscription handle
   */
  subscribeGroup(
    groupId: string,
    topic: string,
    callback: (event: EventData) => void | Promise<void>,
    options: Omit<SubscriptionOptions, 'groupId'> = {}
  ): SubscriptionHandle {
    // Ensure group exists
    if (!this.groups.has(groupId)) {
      this.createGroup(groupId);
    }

    // Subscribe with group ID
    return this.subscribe(topic, callback, { ...options, groupId });
  }

  /**
   * Unsubscribe all subscriptions in group
   *
   * @param groupId Group identifier
   */
  unsubscribeGroup(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) {
      return;
    }

    // Unsubscribe all in group
    for (const handle of group.subscriptions) {
      this.unsubscribeByHandle(handle.id);
    }

    this.groups.delete(groupId);
  }

  /**
   * Add subscription to group
   *
   * @param groupId Group identifier
   * @param handle Subscription handle
   */
  private addToGroup(groupId: string, handle: SubscriptionHandle): void {
    if (!this.groups.has(groupId)) {
      this.createGroup(groupId);
    }

    this.groups.get(groupId)!.subscriptions.add(handle);
  }

  /**
   * Set up TTL expiry timer
   *
   * @param handleId Handle ID
   * @param ttl Time-to-live in milliseconds
   * @param topic Topic pattern
   * @param callback Callback function
   */
  private setupExpiryTimer(
    handleId: string,
    ttl: number,
    topic: string,
    callback: (event: EventData) => void | Promise<void>
  ): void {
    const timer = setTimeout(() => {
      // Unsubscribe
      this.eventBus.off(topic, callback);
      this.removeSubscriptionInfo(handleId);
      this.expiryTimers.delete(handleId);

      // Update statistics
      this.stats.activeSubscriptions--;
      this.stats.expiredSubscriptions++;

      // Emit expiry event
      this.emit('subscription-expired', { handleId, topic, timestamp: new Date().toISOString() });
    }, ttl);

    this.expiryTimers.set(handleId, timer);
  }

  /**
   * Clear expiry timer
   *
   * @param handleId Handle ID
   */
  private clearExpiryTimer(handleId: string): void {
    const timer = this.expiryTimers.get(handleId);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(handleId);
    }
  }

  /**
   * Validate topic format
   *
   * @param topic Topic to validate
   * @returns True if valid
   */
  private validateTopic(topic: string): boolean {
    return this.TOPIC_VALIDATION_REGEX.test(topic);
  }

  /**
   * Check for duplicate subscription
   *
   * @param topic Topic pattern
   * @param callback Callback function
   * @param groupId Optional group ID
   * @returns True if duplicate
   */
  private isDuplicate(
    topic: string,
    callback: (event: EventData) => void | Promise<void>,
    groupId?: string
  ): boolean {
    const subscriberId = this.getSubscriberId(callback);
    const subscriptions = this.subscriptions.get(subscriberId);

    if (!subscriptions) {
      return false;
    }

    return subscriptions.some(
      sub => sub.topic === topic && sub.callback === callback && sub.groupId === groupId
    );
  }

  /**
   * Find existing subscription
   *
   * @param topic Topic pattern
   * @param callback Callback function
   * @param groupId Optional group ID
   * @returns Subscription info if found
   */
  private findExistingSubscription(
    topic: string,
    callback: (event: EventData) => void | Promise<void>,
    groupId?: string
  ): SubscriptionInfo | undefined {
    const subscriberId = this.getSubscriberId(callback);
    const subscriptions = this.subscriptions.get(subscriberId);

    if (!subscriptions) {
      return undefined;
    }

    return subscriptions.find(
      sub => sub.topic === topic && sub.callback === callback && sub.groupId === groupId
    );
  }

  /**
   * Check for potential listener leak
   *
   * @param topic Topic pattern
   */
  private checkListenerLeak(topic: string): void {
    const count = this.getSubscriptionCount(topic);
    if (count >= this.MAX_LISTENERS_WARNING) {
      this.emit('listener-leak-warning', {
        topic,
        count,
        threshold: this.MAX_LISTENERS_WARNING,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Find subscription by handle ID
   *
   * @param handleId Handle ID
   * @returns Subscription info if found
   */
  private findSubscriptionByHandle(handleId: string): SubscriptionInfo | undefined {
    for (const subscriptions of this.subscriptions.values()) {
      const found = subscriptions.find(sub => sub.handle.id === handleId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  /**
   * Remove subscription info from tracking
   *
   * @param handleId Handle ID
   */
  private removeSubscriptionInfo(handleId: string): void {
    for (const [subscriberId, subscriptions] of this.subscriptions.entries()) {
      const index = subscriptions.findIndex(sub => sub.handle.id === handleId);
      if (index !== -1) {
        subscriptions.splice(index, 1);
        if (subscriptions.length === 0) {
          this.subscriptions.delete(subscriberId);
        }
        return;
      }
    }
  }

  /**
   * Get subscriber ID from callback
   *
   * @param callback Callback function
   * @returns Subscriber ID
   */
  private getSubscriberId(callback: Function): string {
    return callback.toString();
  }

  /**
   * List subscriptions
   *
   * @param subscriberId Optional subscriber ID filter
   * @returns Array of subscription info
   */
  listSubscriptions(subscriberId?: string): SubscriptionInfo[] {
    if (subscriberId) {
      return this.subscriptions.get(subscriberId) || [];
    }

    // All subscriptions
    const all: SubscriptionInfo[] = [];
    for (const subscriptions of this.subscriptions.values()) {
      all.push(...subscriptions);
    }
    return all;
  }

  /**
   * Get topic subscribers
   *
   * @param topic Topic pattern
   * @returns Array of subscription info for topic
   */
  getTopicSubscribers(topic: string): SubscriptionInfo[] {
    const subscribers: SubscriptionInfo[] = [];

    for (const subscriptions of this.subscriptions.values()) {
      for (const subscription of subscriptions) {
        if (subscription.topic === topic) {
          subscribers.push(subscription);
        }
      }
    }

    return subscribers;
  }

  /**
   * Get subscription count
   *
   * @param topic Optional topic filter
   * @returns Number of subscriptions
   */
  getSubscriptionCount(topic?: string): number {
    if (topic) {
      return this.getTopicSubscribers(topic).length;
    }

    // Total count
    let total = 0;
    for (const subscriptions of this.subscriptions.values()) {
      total += subscriptions.length;
    }
    return total;
  }

  /**
   * Get all groups
   *
   * @returns Array of subscription groups
   */
  getGroups(): SubscriptionGroup[] {
    return Array.from(this.groups.values());
  }

  /**
   * Get group by ID
   *
   * @param groupId Group identifier
   * @returns Subscription group if found
   */
  getGroup(groupId: string): SubscriptionGroup | undefined {
    return this.groups.get(groupId);
  }

  /**
   * Get statistics
   *
   * @returns Statistics object
   */
  getStats() {
    return {
      totalSubscriptions: this.stats.totalSubscriptions,
      activeSubscriptions: this.stats.activeSubscriptions,
      expiredSubscriptions: this.stats.expiredSubscriptions,
      duplicatePrevented: this.stats.duplicatePrevented,
      groupCount: this.groups.size,
      activeTimers: this.expiryTimers.size
    };
  }

  /**
   * Clear all subscriptions and groups
   */
  clear(): void {
    // Clear all expiry timers
    for (const timer of this.expiryTimers.values()) {
      clearTimeout(timer);
    }

    // Unsubscribe all from event bus
    for (const subscriptions of this.subscriptions.values()) {
      for (const subscription of subscriptions) {
        this.eventBus.off(subscription.topic, subscription.callback);
      }
    }

    this.subscriptions.clear();
    this.groups.clear();
    this.expiryTimers.clear();
    this.stats.activeSubscriptions = 0;
  }
}
