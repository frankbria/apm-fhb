/**
 * Event Bus and Message Routing Module
 *
 * Central event coordination for agent communication with:
 * - Topic-based publish-subscribe (EventBus)
 * - Message routing with pattern matching (MessageRouter)
 * - Subscription lifecycle management (SubscriptionManager)
 *
 * Part of Task 3.4 - Event Bus and Message Routing implementation.
 */

// Event Bus Core
export {
  EventBus,
  EventMetadata,
  EventData,
  EmissionMode,
  CancellationResult,
  EventBusConfig,
  EventBusStats,
  getEventBus,
  resetEventBus
} from './bus';

// Message Router
export {
  MessageRouter,
  SubscriberPriority,
  SubscriberInfo,
  RoutingRule,
  RoutingResult,
  RoutingStats,
  createDirectTopic,
  createBroadcastTopic,
  createTypeTopic
} from './router';

// Subscription Manager
export {
  SubscriptionManager,
  SubscriptionHandle,
  SubscriptionInfo,
  SubscriptionOptions,
  SubscriptionGroup
} from './subscriptions';
