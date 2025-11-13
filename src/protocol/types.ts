/**
 * APM Communication Protocol - Type Definitions
 * Version: 1.0.0
 *
 * This file contains TypeScript type definitions for all protocol messages,
 * envelopes, and payloads. These types are used for compile-time type checking
 * and runtime validation.
 */

// ============================================================================
// Protocol Version
// ============================================================================

export const PROTOCOL_VERSION = '1.0.0';

// ============================================================================
// Enums and Constants
// ============================================================================

/**
 * Agent types in the APM system
 */
export enum AgentType {
  Manager = 'Manager',
  Implementation = 'Implementation',
  AdHoc = 'AdHoc',
  All = '*' // Special value for broadcast
}

/**
 * Message priority levels
 */
export enum MessagePriority {
  HIGH = 'HIGH',
  NORMAL = 'NORMAL',
  LOW = 'LOW'
}

/**
 * Message types supported by the protocol
 */
export enum MessageType {
  TASK_ASSIGNMENT = 'TASK_ASSIGNMENT',
  TASK_UPDATE = 'TASK_UPDATE',
  STATE_SYNC = 'STATE_SYNC',
  ERROR_REPORT = 'ERROR_REPORT',
  HANDOFF_REQUEST = 'HANDOFF_REQUEST',
  ACK = 'ACK',
  NACK = 'NACK'
}

/**
 * Message lifecycle states
 */
export enum MessageState {
  PENDING = 'PENDING',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED'
}

/**
 * Task status values
 */
export enum TaskStatus {
  IN_PROGRESS = 'in_progress',
  BLOCKED = 'blocked',
  PENDING_REVIEW = 'pending_review',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

/**
 * Task execution types
 */
export enum ExecutionType {
  SINGLE_STEP = 'single-step',
  MULTI_STEP = 'multi-step'
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low'
}

/**
 * Handoff reasons
 */
export enum HandoffReason {
  CONTEXT_WINDOW_LIMIT = 'context_window_limit',
  SPECIALIZATION_REQUIRED = 'specialization_required',
  LOAD_BALANCING = 'load_balancing'
}

/**
 * State sync entity types
 */
export enum EntityType {
  AGENT = 'agent',
  TASK = 'task',
  MEMORY_LOG = 'memory_log',
  CONFIGURATION = 'configuration'
}

/**
 * State sync operations
 */
export enum StateOperation {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete'
}

/**
 * ACK status values
 */
export enum AckStatus {
  RECEIVED = 'received',
  PROCESSED = 'processed',
  QUEUED = 'queued'
}

// ============================================================================
// Core Types
// ============================================================================

/**
 * Agent identification
 */
export interface AgentIdentifier {
  /** Unique agent ID (or "*" for broadcast) */
  agentId: string;
  /** Agent type */
  type: AgentType;
}

/**
 * Message metadata
 */
export interface MessageMetadata {
  /** Number of retry attempts (default: 0) */
  retryCount?: number;
  /** Time-to-live in seconds (default: 3600) */
  ttl?: number;
  /** Categorization tags */
  tags?: string[];
  /** Custom metadata fields */
  [key: string]: unknown;
}

/**
 * Base message envelope
 * All protocol messages conform to this structure
 */
export interface MessageEnvelope<T = unknown> {
  /** Protocol version (semver) */
  version: string;
  /** Unique message identifier */
  messageId: string;
  /** Correlation ID for request-response pairing (optional) */
  correlationId?: string;
  /** ISO 8601 UTC timestamp */
  timestamp: string;
  /** Sender identification */
  sender: AgentIdentifier;
  /** Receiver identification */
  receiver: AgentIdentifier;
  /** Message type identifier */
  messageType: MessageType;
  /** Message priority */
  priority: MessagePriority;
  /** Message-type-specific payload */
  payload: T;
  /** Optional metadata */
  metadata?: MessageMetadata;
}

// ============================================================================
// Payload Types
// ============================================================================

/**
 * Task dependency information
 */
export interface TaskDependency {
  /** Task ID of dependency */
  taskId: string;
  /** Dependency status */
  status: TaskStatus;
  /** Output files/artifacts from dependency */
  outputs?: string[];
}

/**
 * Task context information
 */
export interface TaskContext {
  /** Related files for task */
  relatedFiles?: string[];
  /** Whether Ad-Hoc delegation is required */
  requiresAdHoc?: boolean;
  /** Estimated duration in seconds */
  estimatedDuration?: number;
  /** Additional context fields */
  [key: string]: unknown;
}

/**
 * TASK_ASSIGNMENT payload
 * Manager → Implementation: Assign a new task
 */
export interface TaskAssignmentPayload {
  /** Unique task identifier */
  taskId: string;
  /** Human-readable task reference */
  taskRef: string;
  /** Detailed task description/instructions */
  taskDescription: string;
  /** Path to memory log file */
  memoryLogPath: string;
  /** Execution type */
  executionType: ExecutionType;
  /** Task dependencies (optional) */
  dependencies?: TaskDependency[];
  /** Additional context (optional) */
  context?: TaskContext;
}

/**
 * Task blocker information
 */
export interface TaskBlocker {
  /** Blocker type */
  type: string;
  /** Blocker description */
  description: string;
  /** Blocker severity */
  severity: ErrorSeverity;
}

/**
 * TASK_UPDATE payload
 * Implementation → Manager: Report task progress
 */
export interface TaskUpdatePayload {
  /** Task ID being updated */
  taskId: string;
  /** Progress percentage (0.0 - 1.0) */
  progress: number;
  /** Current task status */
  status: TaskStatus;
  /** Current step description (optional) */
  currentStep?: string;
  /** Progress notes (optional) */
  notes?: string;
  /** Modified files (optional) */
  filesModified?: string[];
  /** Blockers preventing progress (optional) */
  blockers?: TaskBlocker[];
  /** Estimated completion timestamp (optional) */
  estimatedCompletion?: string;
}

/**
 * STATE_SYNC payload
 * Bi-directional: Synchronize state changes
 */
export interface StateSyncPayload {
  /** Entity type being synchronized */
  entityType: EntityType;
  /** Unique entity identifier */
  entityId: string;
  /** State operation */
  operation: StateOperation;
  /** Current state */
  state: Record<string, unknown>;
  /** Previous state (for updates) */
  previousState?: Record<string, unknown>;
  /** When state change occurred */
  syncTimestamp: string;
}

/**
 * Error context information
 */
export interface ErrorContext {
  /** Task ID (if error relates to task) */
  taskId?: string;
  /** Step where error occurred */
  step?: string;
  /** File where error occurred */
  file?: string;
  /** Line number */
  line?: number;
  /** Additional context fields */
  [key: string]: unknown;
}

/**
 * ERROR_REPORT payload
 * Any → Manager: Report errors or failures
 */
export interface ErrorReportPayload {
  /** Error category */
  errorType: string;
  /** Machine-readable error code (optional) */
  errorCode?: string;
  /** Human-readable error message */
  errorMessage: string;
  /** Error severity */
  severity: ErrorSeverity;
  /** Error context (optional) */
  context?: ErrorContext;
  /** Stack trace (optional) */
  stackTrace?: string;
  /** Whether error is recoverable */
  recoverable?: boolean;
  /** Suggested remediation action (optional) */
  suggestedAction?: string;
  /** Additional error metadata (optional) */
  metadata?: Record<string, unknown>;
}

/**
 * Handoff context for task continuation
 */
export interface HandoffContext {
  /** Completed steps */
  completedSteps: string[];
  /** Current step */
  currentStep: string;
  /** Memory log path */
  memoryLogPath: string;
  /** State snapshot for continuation */
  stateSnapshot: {
    /** Files created during task */
    filesCreated?: string[];
    /** Pending actions */
    pendingActions?: string[];
    /** Additional state fields */
    [key: string]: unknown;
  };
}

/**
 * HANDOFF_REQUEST payload
 * Agent → Agent: Request task handoff
 */
export interface HandoffRequestPayload {
  /** Task ID being handed off */
  taskId: string;
  /** Reason for handoff */
  reason: HandoffReason;
  /** Source agent initiating handoff */
  sourceAgent: AgentIdentifier;
  /** Target agent receiving handoff */
  targetAgent: AgentIdentifier;
  /** Context for task continuation */
  handoffContext: HandoffContext;
}

/**
 * ACK payload
 * Receiver → Sender: Acknowledge message receipt
 */
export interface AckPayload {
  /** ID of acknowledged message */
  acknowledgedMessageId: string;
  /** Acknowledgment status */
  status: AckStatus;
  /** When message was acknowledged */
  timestamp: string;
  /** Processing time in milliseconds (optional) */
  processingTime?: number;
  /** Additional notes (optional) */
  notes?: string;
}

/**
 * NACK payload
 * Receiver → Sender: Reject message with reason
 */
export interface NackPayload {
  /** ID of rejected message */
  rejectedMessageId: string;
  /** Human-readable rejection reason */
  reason: string;
  /** When message was rejected */
  timestamp: string;
  /** Machine-readable error code (optional) */
  errorCode?: string;
  /** Whether sender can retry */
  canRetry?: boolean;
  /** Suggested fix (optional) */
  suggestedFix?: string;
}

// ============================================================================
// Message Type Definitions
// ============================================================================

export type TaskAssignmentMessage = MessageEnvelope<TaskAssignmentPayload>;
export type TaskUpdateMessage = MessageEnvelope<TaskUpdatePayload>;
export type StateSyncMessage = MessageEnvelope<StateSyncPayload>;
export type ErrorReportMessage = MessageEnvelope<ErrorReportPayload>;
export type HandoffRequestMessage = MessageEnvelope<HandoffRequestPayload>;
export type AckMessage = MessageEnvelope<AckPayload>;
export type NackMessage = MessageEnvelope<NackPayload>;

/**
 * Union type of all message types
 */
export type ProtocolMessage =
  | TaskAssignmentMessage
  | TaskUpdateMessage
  | StateSyncMessage
  | ErrorReportMessage
  | HandoffRequestMessage
  | AckMessage
  | NackMessage;

// ============================================================================
// Message Tracking
// ============================================================================

/**
 * Message tracker for state management
 */
export interface MessageTracker {
  /** Message ID */
  messageId: string;
  /** Correlation ID (if any) */
  correlationId?: string;
  /** Current state */
  state: MessageState;
  /** When message was sent */
  sentAt?: Date;
  /** When message was delivered */
  deliveredAt?: Date;
  /** When message was processed */
  processedAt?: Date;
  /** Retry count */
  retryCount: number;
  /** Last error (if any) */
  lastError?: string;
  /** Timeout handle (for cleanup) */
  timeoutHandle?: NodeJS.Timeout;
}

// ============================================================================
// Serialization Types
// ============================================================================

/**
 * Serialization options
 */
export interface SerializationOptions {
  /** Whether to pretty-print JSON (default: false) */
  prettyPrint?: boolean;
  /** Whether to compress payload if > threshold (default: false) */
  compress?: boolean;
  /** Compression threshold in bytes (default: 10240 = 10KB) */
  compressionThreshold?: number;
}

/**
 * Deserialization result
 */
export interface DeserializationResult<T = unknown> {
  /** Whether deserialization succeeded */
  success: boolean;
  /** Deserialized message (if successful) */
  message?: MessageEnvelope<T>;
  /** Error information (if failed) */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Validation error
 */
export interface ValidationError {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Field path (if applicable) */
  field?: string;
  /** Expected value/format */
  expectedValue?: unknown;
  /** Actual value received */
  actualValue?: unknown;
  /** Remediation suggestions */
  suggestions?: string[];
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation succeeded */
  valid: boolean;
  /** Validation errors (if failed) */
  errors?: ValidationError[];
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for TaskAssignmentMessage
 */
export function isTaskAssignmentMessage(msg: ProtocolMessage): msg is TaskAssignmentMessage {
  return msg.messageType === MessageType.TASK_ASSIGNMENT;
}

/**
 * Type guard for TaskUpdateMessage
 */
export function isTaskUpdateMessage(msg: ProtocolMessage): msg is TaskUpdateMessage {
  return msg.messageType === MessageType.TASK_UPDATE;
}

/**
 * Type guard for StateSyncMessage
 */
export function isStateSyncMessage(msg: ProtocolMessage): msg is StateSyncMessage {
  return msg.messageType === MessageType.STATE_SYNC;
}

/**
 * Type guard for ErrorReportMessage
 */
export function isErrorReportMessage(msg: ProtocolMessage): msg is ErrorReportMessage {
  return msg.messageType === MessageType.ERROR_REPORT;
}

/**
 * Type guard for HandoffRequestMessage
 */
export function isHandoffRequestMessage(msg: ProtocolMessage): msg is HandoffRequestMessage {
  return msg.messageType === MessageType.HANDOFF_REQUEST;
}

/**
 * Type guard for AckMessage
 */
export function isAckMessage(msg: ProtocolMessage): msg is AckMessage {
  return msg.messageType === MessageType.ACK;
}

/**
 * Type guard for NackMessage
 */
export function isNackMessage(msg: ProtocolMessage): msg is NackMessage {
  return msg.messageType === MessageType.NACK;
}
