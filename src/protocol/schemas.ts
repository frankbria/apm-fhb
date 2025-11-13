/**
 * APM Communication Protocol - Validation Schemas
 * Version: 1.0.0
 *
 * This file contains Zod schemas for runtime validation of all protocol
 * messages. These schemas enforce type safety and validate message structure.
 */

import { z } from 'zod';
import {
  PROTOCOL_VERSION,
  AgentType,
  MessagePriority,
  MessageType,
  TaskStatus,
  ExecutionType,
  ErrorSeverity,
  HandoffReason,
  EntityType,
  StateOperation,
  AckStatus
} from './types';

// ============================================================================
// Constants
// ============================================================================

/** Maximum message size (1MB uncompressed) */
export const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB

/** Message ID pattern: msg_{timestamp}_{random} */
export const MESSAGE_ID_PATTERN = /^msg_[0-9]{8}_[0-9]{6}_[a-zA-Z0-9]+$/;

/** ISO 8601 timestamp pattern (basic check) */
export const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ============================================================================
// Base Schemas
// ============================================================================

/**
 * Agent identifier schema
 */
export const AgentIdentifierSchema = z.object({
  agentId: z.string().min(1),
  type: z.nativeEnum(AgentType)
});

/**
 * Message metadata schema
 */
export const MessageMetadataSchema = z.object({
  retryCount: z.number().int().min(0).optional(),
  ttl: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional()
}).passthrough(); // Allow additional fields

/**
 * Base message envelope schema
 */
export const MessageEnvelopeSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  messageId: z.string().regex(MESSAGE_ID_PATTERN),
  correlationId: z.string().optional(),
  timestamp: z.string().regex(ISO_8601_PATTERN),
  sender: AgentIdentifierSchema,
  receiver: AgentIdentifierSchema,
  messageType: z.nativeEnum(MessageType),
  priority: z.nativeEnum(MessagePriority),
  payload: z.unknown(), // Validated by message-type-specific schemas
  metadata: MessageMetadataSchema.optional()
});

// ============================================================================
// Payload Schemas
// ============================================================================

/**
 * Task dependency schema
 */
export const TaskDependencySchema = z.object({
  taskId: z.string().min(1),
  status: z.nativeEnum(TaskStatus),
  outputs: z.array(z.string()).optional()
});

/**
 * Task context schema
 */
export const TaskContextSchema = z.object({
  relatedFiles: z.array(z.string()).optional(),
  requiresAdHoc: z.boolean().optional(),
  estimatedDuration: z.number().int().positive().optional()
}).passthrough();

/**
 * TASK_ASSIGNMENT payload schema
 */
export const TaskAssignmentPayloadSchema = z.object({
  taskId: z.string().min(1),
  taskRef: z.string().min(1),
  taskDescription: z.string().min(1),
  memoryLogPath: z.string().min(1),
  executionType: z.nativeEnum(ExecutionType),
  dependencies: z.array(TaskDependencySchema).optional(),
  context: TaskContextSchema.optional()
});

/**
 * Task blocker schema
 */
export const TaskBlockerSchema = z.object({
  type: z.string().min(1),
  description: z.string().min(1),
  severity: z.nativeEnum(ErrorSeverity)
});

/**
 * TASK_UPDATE payload schema
 */
export const TaskUpdatePayloadSchema = z.object({
  taskId: z.string().min(1),
  progress: z.number().min(0).max(1),
  status: z.nativeEnum(TaskStatus),
  currentStep: z.string().optional(),
  notes: z.string().optional(),
  filesModified: z.array(z.string()).optional(),
  blockers: z.array(TaskBlockerSchema).optional(),
  estimatedCompletion: z.string().regex(ISO_8601_PATTERN).optional()
});

/**
 * STATE_SYNC payload schema
 */
export const StateSyncPayloadSchema = z.object({
  entityType: z.nativeEnum(EntityType),
  entityId: z.string().min(1),
  operation: z.nativeEnum(StateOperation),
  state: z.record(z.unknown()),
  previousState: z.record(z.unknown()).optional(),
  syncTimestamp: z.string().regex(ISO_8601_PATTERN)
});

/**
 * Error context schema
 */
export const ErrorContextSchema = z.object({
  taskId: z.string().optional(),
  step: z.string().optional(),
  file: z.string().optional(),
  line: z.number().int().positive().optional()
}).passthrough();

/**
 * ERROR_REPORT payload schema
 */
export const ErrorReportPayloadSchema = z.object({
  errorType: z.string().min(1),
  errorCode: z.string().optional(),
  errorMessage: z.string().min(1),
  severity: z.nativeEnum(ErrorSeverity),
  context: ErrorContextSchema.optional(),
  stackTrace: z.string().optional(),
  recoverable: z.boolean().optional(),
  suggestedAction: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

/**
 * Handoff context schema
 */
export const HandoffContextSchema = z.object({
  completedSteps: z.array(z.string()),
  currentStep: z.string().min(1),
  memoryLogPath: z.string().min(1),
  stateSnapshot: z.object({
    filesCreated: z.array(z.string()).optional(),
    pendingActions: z.array(z.string()).optional()
  }).passthrough()
});

/**
 * HANDOFF_REQUEST payload schema
 */
export const HandoffRequestPayloadSchema = z.object({
  taskId: z.string().min(1),
  reason: z.nativeEnum(HandoffReason),
  sourceAgent: AgentIdentifierSchema,
  targetAgent: AgentIdentifierSchema,
  handoffContext: HandoffContextSchema
});

/**
 * ACK payload schema
 */
export const AckPayloadSchema = z.object({
  acknowledgedMessageId: z.string().min(1),
  status: z.nativeEnum(AckStatus),
  timestamp: z.string().regex(ISO_8601_PATTERN),
  processingTime: z.number().int().min(0).optional(),
  notes: z.string().optional()
});

/**
 * NACK payload schema
 */
export const NackPayloadSchema = z.object({
  rejectedMessageId: z.string().min(1),
  reason: z.string().min(1),
  timestamp: z.string().regex(ISO_8601_PATTERN),
  errorCode: z.string().optional(),
  canRetry: z.boolean().optional(),
  suggestedFix: z.string().optional()
});

// ============================================================================
// Message Schemas
// ============================================================================

/**
 * TASK_ASSIGNMENT message schema
 */
export const TaskAssignmentMessageSchema = MessageEnvelopeSchema.extend({
  messageType: z.literal(MessageType.TASK_ASSIGNMENT),
  payload: TaskAssignmentPayloadSchema
});

/**
 * TASK_UPDATE message schema
 */
export const TaskUpdateMessageSchema = MessageEnvelopeSchema.extend({
  messageType: z.literal(MessageType.TASK_UPDATE),
  payload: TaskUpdatePayloadSchema
});

/**
 * STATE_SYNC message schema
 */
export const StateSyncMessageSchema = MessageEnvelopeSchema.extend({
  messageType: z.literal(MessageType.STATE_SYNC),
  payload: StateSyncPayloadSchema
});

/**
 * ERROR_REPORT message schema
 */
export const ErrorReportMessageSchema = MessageEnvelopeSchema.extend({
  messageType: z.literal(MessageType.ERROR_REPORT),
  payload: ErrorReportPayloadSchema
});

/**
 * HANDOFF_REQUEST message schema
 */
export const HandoffRequestMessageSchema = MessageEnvelopeSchema.extend({
  messageType: z.literal(MessageType.HANDOFF_REQUEST),
  payload: HandoffRequestPayloadSchema
});

/**
 * ACK message schema
 */
export const AckMessageSchema = MessageEnvelopeSchema.extend({
  messageType: z.literal(MessageType.ACK),
  payload: AckPayloadSchema
});

/**
 * NACK message schema
 */
export const NackMessageSchema = MessageEnvelopeSchema.extend({
  messageType: z.literal(MessageType.NACK),
  payload: NackPayloadSchema
});

/**
 * Protocol message schema (union of all message types)
 */
export const ProtocolMessageSchema = z.discriminatedUnion('messageType', [
  TaskAssignmentMessageSchema,
  TaskUpdateMessageSchema,
  StateSyncMessageSchema,
  ErrorReportMessageSchema,
  HandoffRequestMessageSchema,
  AckMessageSchema,
  NackMessageSchema
]);

// ============================================================================
// Schema Map
// ============================================================================

/**
 * Map of message types to their payload schemas
 */
export const PayloadSchemaMap = {
  [MessageType.TASK_ASSIGNMENT]: TaskAssignmentPayloadSchema,
  [MessageType.TASK_UPDATE]: TaskUpdatePayloadSchema,
  [MessageType.STATE_SYNC]: StateSyncPayloadSchema,
  [MessageType.ERROR_REPORT]: ErrorReportPayloadSchema,
  [MessageType.HANDOFF_REQUEST]: HandoffRequestPayloadSchema,
  [MessageType.ACK]: AckPayloadSchema,
  [MessageType.NACK]: NackPayloadSchema
} as const;

/**
 * Map of message types to their full message schemas
 */
export const MessageSchemaMap = {
  [MessageType.TASK_ASSIGNMENT]: TaskAssignmentMessageSchema,
  [MessageType.TASK_UPDATE]: TaskUpdateMessageSchema,
  [MessageType.STATE_SYNC]: StateSyncMessageSchema,
  [MessageType.ERROR_REPORT]: ErrorReportMessageSchema,
  [MessageType.HANDOFF_REQUEST]: HandoffRequestMessageSchema,
  [MessageType.ACK]: AckMessageSchema,
  [MessageType.NACK]: NackMessageSchema
} as const;

// ============================================================================
// Custom Validators
// ============================================================================

/**
 * Validate protocol version compatibility
 */
export function validateProtocolVersion(version: string): boolean {
  const [major] = version.split('.').map(Number);
  const [expectedMajor] = PROTOCOL_VERSION.split('.').map(Number);
  return major === expectedMajor;
}

/**
 * Validate message size
 */
export function validateMessageSize(messageJson: string): boolean {
  const size = new TextEncoder().encode(messageJson).length;
  return size <= MAX_MESSAGE_SIZE;
}

/**
 * Validate agent ID format
 */
export function validateAgentId(agentId: string): boolean {
  // Allow "*" for broadcast or alphanumeric with underscores
  return agentId === '*' || /^[a-zA-Z0-9_]+$/.test(agentId);
}

/**
 * Validate correlation ID exists for request messages
 */
export function validateCorrelationId(
  messageType: MessageType,
  correlationId?: string
): boolean {
  const requiresCorrelation = [
    MessageType.TASK_ASSIGNMENT,
    MessageType.HANDOFF_REQUEST,
    MessageType.ACK,
    MessageType.NACK
  ];

  if (requiresCorrelation.includes(messageType)) {
    return correlationId !== undefined && correlationId.length > 0;
  }

  return true; // Optional for other message types
}

/**
 * Business rule: Validate task progress is between 0 and 1
 */
export function validateTaskProgress(progress: number): boolean {
  return progress >= 0 && progress <= 1;
}

/**
 * Business rule: Validate completed status requires 100% progress
 */
export function validateCompletedStatus(
  status: TaskStatus,
  progress: number
): boolean {
  if (status === TaskStatus.COMPLETED) {
    return progress === 1.0;
  }
  return true;
}

/**
 * Business rule: Validate handoff target is different from source
 */
export function validateHandoffTarget(
  sourceAgentId: string,
  targetAgentId: string
): boolean {
  return sourceAgentId !== targetAgentId;
}
