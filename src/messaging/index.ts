/**
 * APM Messaging Module
 *
 * Exports message queue, serialization, delivery tracking, and DLQ components.
 */

export { MessageQueue } from './queue';
export {
  MessageSerializer,
  MessageDeserializer,
  type QueueMetadata,
  type QueuedMessage,
  type SerializationResult,
  type DeserializationResult,
  type SerializationMetrics,
  type SerializationStats,
} from './serializer';
export {
  DeliveryTracker,
  DeliveryEventType,
  type DeliveryState,
  type DeliveryEvent,
  type AckPayload,
  type NackPayload,
  type DeliveryTrackerConfig,
} from './delivery';
export {
  DeadLetterQueue,
  FailureReason,
  type DlqEntry,
  type DlqEntryMetadata,
  type DlqFilter,
  type DlqStats,
  type DlqConfig,
  type RetryAttempt,
} from './dlq';
