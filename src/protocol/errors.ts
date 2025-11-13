/**
 * APM Communication Protocol - Error Codes and Error Handling
 * Version: 1.0.0
 *
 * This file contains error code definitions, error message formats,
 * and error handling utilities for the protocol.
 */

import { ErrorSeverity } from './types';

// ============================================================================
// Error Code Definitions
// ============================================================================

/**
 * Error code categories
 */
export enum ErrorCategory {
  VALIDATION = 'VALIDATION',
  ROUTING = 'ROUTING',
  PROTOCOL = 'PROTOCOL',
  TASK = 'TASK',
  SYSTEM = 'SYSTEM'
}

/**
 * Validation error codes (E_VALIDATION_xxx)
 */
export enum ValidationErrorCode {
  /** Missing required field */
  MISSING_FIELD = 'E_VALIDATION_001',
  /** Invalid field type */
  INVALID_TYPE = 'E_VALIDATION_002',
  /** Invalid enum value */
  INVALID_ENUM = 'E_VALIDATION_003',
  /** Schema validation failed */
  SCHEMA_FAILED = 'E_VALIDATION_004',
  /** Message size exceeded limit (1MB) */
  SIZE_EXCEEDED = 'E_VALIDATION_005',
  /** Invalid message ID format */
  INVALID_MESSAGE_ID = 'E_VALIDATION_006',
  /** Invalid timestamp format */
  INVALID_TIMESTAMP = 'E_VALIDATION_007',
  /** Invalid agent ID format */
  INVALID_AGENT_ID = 'E_VALIDATION_008',
  /** Business rule violation */
  BUSINESS_RULE = 'E_VALIDATION_009'
}

/**
 * Routing error codes (E_ROUTING_xxx)
 */
export enum RoutingErrorCode {
  /** Agent not found in registry */
  AGENT_NOT_FOUND = 'E_ROUTING_001',
  /** Invalid receiver specification */
  INVALID_RECEIVER = 'E_ROUTING_002',
  /** Channel unavailable */
  CHANNEL_UNAVAILABLE = 'E_ROUTING_003',
  /** Broadcast failed (partial delivery) */
  BROADCAST_FAILED = 'E_ROUTING_004',
  /** Routing table corrupted */
  ROUTING_TABLE_ERROR = 'E_ROUTING_005'
}

/**
 * Protocol error codes (E_PROTOCOL_xxx)
 */
export enum ProtocolErrorCode {
  /** Unsupported protocol version */
  VERSION_UNSUPPORTED = 'E_PROTOCOL_001',
  /** Malformed JSON or invalid UTF-8 */
  MALFORMED_MESSAGE = 'E_PROTOCOL_002',
  /** Invalid correlation ID */
  INVALID_CORRELATION_ID = 'E_PROTOCOL_003',
  /** Message timeout */
  TIMEOUT = 'E_PROTOCOL_004',
  /** Duplicate message ID */
  DUPLICATE_MESSAGE = 'E_PROTOCOL_005',
  /** Unexpected message type */
  UNEXPECTED_TYPE = 'E_PROTOCOL_006'
}

/**
 * Task error codes (E_TASK_xxx)
 */
export enum TaskErrorCode {
  /** Task not found */
  NOT_FOUND = 'E_TASK_001',
  /** Task already assigned */
  ALREADY_ASSIGNED = 'E_TASK_002',
  /** Task execution failed */
  EXECUTION_FAILED = 'E_TASK_003',
  /** Task dependency missing */
  DEPENDENCY_MISSING = 'E_TASK_004',
  /** Task timeout */
  TIMEOUT = 'E_TASK_005',
  /** Invalid task state transition */
  INVALID_STATE = 'E_TASK_006'
}

/**
 * System error codes (E_SYSTEM_xxx)
 */
export enum SystemErrorCode {
  /** File system error */
  FILESYSTEM_ERROR = 'E_SYSTEM_001',
  /** Insufficient disk space */
  DISK_FULL = 'E_SYSTEM_002',
  /** Permission denied */
  PERMISSION_DENIED = 'E_SYSTEM_003',
  /** Channel locked */
  CHANNEL_LOCKED = 'E_SYSTEM_004',
  /** Internal error */
  INTERNAL_ERROR = 'E_SYSTEM_005'
}

/**
 * All error codes combined
 */
export type ErrorCode =
  | ValidationErrorCode
  | RoutingErrorCode
  | ProtocolErrorCode
  | TaskErrorCode
  | SystemErrorCode;

// ============================================================================
// Error Metadata
// ============================================================================

/**
 * Error metadata for each error code
 */
export interface ErrorMetadata {
  /** Error code */
  code: ErrorCode;
  /** Category */
  category: ErrorCategory;
  /** Human-readable description */
  description: string;
  /** Default severity */
  severity: ErrorSeverity;
  /** Whether error is recoverable */
  recoverable: boolean;
  /** Suggested remediation actions */
  remediation: string[];
}

/**
 * Error code catalog
 */
export const ERROR_CATALOG: Record<ErrorCode, ErrorMetadata> = {
  // Validation Errors
  [ValidationErrorCode.MISSING_FIELD]: {
    code: ValidationErrorCode.MISSING_FIELD,
    category: ErrorCategory.VALIDATION,
    description: 'Required field is missing from message',
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    remediation: [
      'Add the missing required field to the message',
      'Check message schema documentation',
      'Ensure message builder includes all required fields'
    ]
  },
  [ValidationErrorCode.INVALID_TYPE]: {
    code: ValidationErrorCode.INVALID_TYPE,
    category: ErrorCategory.VALIDATION,
    description: 'Field has incorrect type',
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    remediation: [
      'Check field type in schema',
      'Convert value to correct type',
      'Verify serialization is correct'
    ]
  },
  [ValidationErrorCode.INVALID_ENUM]: {
    code: ValidationErrorCode.INVALID_ENUM,
    category: ErrorCategory.VALIDATION,
    description: 'Field value is not a valid enum value',
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    remediation: [
      'Use valid enum value from schema',
      'Check for typos in enum value',
      'Consult protocol documentation for valid values'
    ]
  },
  [ValidationErrorCode.SCHEMA_FAILED]: {
    code: ValidationErrorCode.SCHEMA_FAILED,
    category: ErrorCategory.VALIDATION,
    description: 'Message failed schema validation',
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    remediation: [
      'Review validation errors for specific issues',
      'Ensure message conforms to schema',
      'Use type-safe message builders'
    ]
  },
  [ValidationErrorCode.SIZE_EXCEEDED]: {
    code: ValidationErrorCode.SIZE_EXCEEDED,
    category: ErrorCategory.VALIDATION,
    description: 'Message size exceeds 1MB limit',
    severity: ErrorSeverity.HIGH,
    recoverable: false,
    remediation: [
      'Reduce payload size',
      'Split large payloads into multiple messages',
      'Use file references instead of embedding large data',
      'Enable compression for large payloads'
    ]
  },
  [ValidationErrorCode.INVALID_MESSAGE_ID]: {
    code: ValidationErrorCode.INVALID_MESSAGE_ID,
    category: ErrorCategory.VALIDATION,
    description: 'Message ID format is invalid',
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    remediation: [
      'Use generateMessageId() utility',
      'Ensure format: msg_{timestamp}_{random}',
      'Do not manually construct message IDs'
    ]
  },
  [ValidationErrorCode.INVALID_TIMESTAMP]: {
    code: ValidationErrorCode.INVALID_TIMESTAMP,
    category: ErrorCategory.VALIDATION,
    description: 'Timestamp is not valid ISO 8601 format',
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    remediation: [
      'Use getCurrentTimestamp() utility',
      'Ensure ISO 8601 format: YYYY-MM-DDTHH:mm:ss.SSSZ',
      'Use UTC timezone'
    ]
  },
  [ValidationErrorCode.INVALID_AGENT_ID]: {
    code: ValidationErrorCode.INVALID_AGENT_ID,
    category: ErrorCategory.VALIDATION,
    description: 'Agent ID format is invalid',
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    remediation: [
      'Use alphanumeric characters and underscores only',
      'Or use "*" for broadcast',
      'Check agent registry for valid IDs'
    ]
  },
  [ValidationErrorCode.BUSINESS_RULE]: {
    code: ValidationErrorCode.BUSINESS_RULE,
    category: ErrorCategory.VALIDATION,
    description: 'Business rule validation failed',
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    remediation: [
      'Review business rule requirements',
      'Check field value constraints',
      'Consult protocol specification'
    ]
  },

  // Routing Errors
  [RoutingErrorCode.AGENT_NOT_FOUND]: {
    code: RoutingErrorCode.AGENT_NOT_FOUND,
    category: ErrorCategory.ROUTING,
    description: 'Target agent not found in registry',
    severity: ErrorSeverity.MEDIUM,
    recoverable: false,
    remediation: [
      'Verify agent ID is correct',
      'Check agent is registered',
      'Wait for agent to come online',
      'Query agent registry for available agents'
    ]
  },
  [RoutingErrorCode.INVALID_RECEIVER]: {
    code: RoutingErrorCode.INVALID_RECEIVER,
    category: ErrorCategory.ROUTING,
    description: 'Receiver specification is invalid',
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    remediation: [
      'Check receiver.agentId and receiver.type',
      'Ensure valid agent identifier format',
      'Use "*" for broadcast if intended'
    ]
  },
  [RoutingErrorCode.CHANNEL_UNAVAILABLE]: {
    code: RoutingErrorCode.CHANNEL_UNAVAILABLE,
    category: ErrorCategory.ROUTING,
    description: 'Message channel is unavailable',
    severity: ErrorSeverity.HIGH,
    recoverable: true,
    remediation: [
      'Retry after exponential backoff',
      'Check filesystem permissions',
      'Verify channel directory exists',
      'Check disk space availability'
    ]
  },
  [RoutingErrorCode.BROADCAST_FAILED]: {
    code: RoutingErrorCode.BROADCAST_FAILED,
    category: ErrorCategory.ROUTING,
    description: 'Broadcast message failed to reach some agents',
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    remediation: [
      'Check which agents failed to receive',
      'Retry to failed agents individually',
      'Verify all agents are online',
      'Check agent registry consistency'
    ]
  },
  [RoutingErrorCode.ROUTING_TABLE_ERROR]: {
    code: RoutingErrorCode.ROUTING_TABLE_ERROR,
    category: ErrorCategory.ROUTING,
    description: 'Routing table is corrupted or invalid',
    severity: ErrorSeverity.HIGH,
    recoverable: true,
    remediation: [
      'Rebuild routing table from registry',
      'Verify registry file integrity',
      'Restart agent to reload routing table'
    ]
  },

  // Protocol Errors
  [ProtocolErrorCode.VERSION_UNSUPPORTED]: {
    code: ProtocolErrorCode.VERSION_UNSUPPORTED,
    category: ErrorCategory.PROTOCOL,
    description: 'Protocol version is not supported',
    severity: ErrorSeverity.HIGH,
    recoverable: false,
    remediation: [
      'Upgrade agent to support protocol version',
      'Check protocol version compatibility',
      'Review migration guide if available'
    ]
  },
  [ProtocolErrorCode.MALFORMED_MESSAGE]: {
    code: ProtocolErrorCode.MALFORMED_MESSAGE,
    category: ErrorCategory.PROTOCOL,
    description: 'Message is malformed (invalid JSON or UTF-8)',
    severity: ErrorSeverity.CRITICAL,
    recoverable: false,
    remediation: [
      'Check sender serialization logic',
      'Verify UTF-8 encoding',
      'Use protocol serialization utilities',
      'Check for file corruption'
    ]
  },
  [ProtocolErrorCode.INVALID_CORRELATION_ID]: {
    code: ProtocolErrorCode.INVALID_CORRELATION_ID,
    category: ErrorCategory.PROTOCOL,
    description: 'Correlation ID is missing or invalid',
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    remediation: [
      'Include correlation ID for request messages',
      'Use generateCorrelationId() utility',
      'Ensure correlation ID matches request'
    ]
  },
  [ProtocolErrorCode.TIMEOUT]: {
    code: ProtocolErrorCode.TIMEOUT,
    category: ErrorCategory.PROTOCOL,
    description: 'Message acknowledgment timeout',
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    remediation: [
      'Retry with exponential backoff',
      'Check receiver is online',
      'Verify message was delivered',
      'Increase timeout if needed'
    ]
  },
  [ProtocolErrorCode.DUPLICATE_MESSAGE]: {
    code: ProtocolErrorCode.DUPLICATE_MESSAGE,
    category: ErrorCategory.PROTOCOL,
    description: 'Message ID has already been processed',
    severity: ErrorSeverity.LOW,
    recoverable: true,
    remediation: [
      'This is expected with at-least-once delivery',
      'Ensure handlers are idempotent',
      'Acknowledge duplicate to prevent retries'
    ]
  },
  [ProtocolErrorCode.UNEXPECTED_TYPE]: {
    code: ProtocolErrorCode.UNEXPECTED_TYPE,
    category: ErrorCategory.PROTOCOL,
    description: 'Received unexpected message type',
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    remediation: [
      'Check message routing logic',
      'Verify sender is sending correct type',
      'Ensure receiver handles this message type'
    ]
  },

  // Task Errors
  [TaskErrorCode.NOT_FOUND]: {
    code: TaskErrorCode.NOT_FOUND,
    category: ErrorCategory.TASK,
    description: 'Task not found',
    severity: ErrorSeverity.MEDIUM,
    recoverable: false,
    remediation: [
      'Verify task ID is correct',
      'Check task was created',
      'Query task registry'
    ]
  },
  [TaskErrorCode.ALREADY_ASSIGNED]: {
    code: TaskErrorCode.ALREADY_ASSIGNED,
    category: ErrorCategory.TASK,
    description: 'Task is already assigned to another agent',
    severity: ErrorSeverity.LOW,
    recoverable: false,
    remediation: [
      'This is informational - task is being handled',
      'No action needed if assignment is correct',
      'Check for assignment conflicts if unexpected'
    ]
  },
  [TaskErrorCode.EXECUTION_FAILED]: {
    code: TaskErrorCode.EXECUTION_FAILED,
    category: ErrorCategory.TASK,
    description: 'Task execution failed',
    severity: ErrorSeverity.HIGH,
    recoverable: true,
    remediation: [
      'Review task error logs',
      'Check task requirements',
      'Retry with fixes',
      'Escalate to Manager if persistent'
    ]
  },
  [TaskErrorCode.DEPENDENCY_MISSING]: {
    code: TaskErrorCode.DEPENDENCY_MISSING,
    category: ErrorCategory.TASK,
    description: 'Required task dependency is missing',
    severity: ErrorSeverity.HIGH,
    recoverable: true,
    remediation: [
      'Wait for dependency to complete',
      'Verify dependency task ID',
      'Check dependency status',
      'Ensure dependency outputs are available'
    ]
  },
  [TaskErrorCode.TIMEOUT]: {
    code: TaskErrorCode.TIMEOUT,
    category: ErrorCategory.TASK,
    description: 'Task execution exceeded timeout',
    severity: ErrorSeverity.HIGH,
    recoverable: true,
    remediation: [
      'Increase task timeout if appropriate',
      'Check for infinite loops or deadlocks',
      'Optimize task execution',
      'Split task into smaller subtasks'
    ]
  },
  [TaskErrorCode.INVALID_STATE]: {
    code: TaskErrorCode.INVALID_STATE,
    category: ErrorCategory.TASK,
    description: 'Invalid task state transition',
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    remediation: [
      'Review task state machine',
      'Ensure state transitions are valid',
      'Check for race conditions',
      'Verify state synchronization'
    ]
  },

  // System Errors
  [SystemErrorCode.FILESYSTEM_ERROR]: {
    code: SystemErrorCode.FILESYSTEM_ERROR,
    category: ErrorCategory.SYSTEM,
    description: 'File system operation failed',
    severity: ErrorSeverity.CRITICAL,
    recoverable: true,
    remediation: [
      'Check filesystem health',
      'Verify file permissions',
      'Check disk space',
      'Retry operation'
    ]
  },
  [SystemErrorCode.DISK_FULL]: {
    code: SystemErrorCode.DISK_FULL,
    category: ErrorCategory.SYSTEM,
    description: 'Insufficient disk space',
    severity: ErrorSeverity.CRITICAL,
    recoverable: false,
    remediation: [
      'Free up disk space',
      'Archive old logs',
      'Increase disk quota',
      'Enable log rotation'
    ]
  },
  [SystemErrorCode.PERMISSION_DENIED]: {
    code: SystemErrorCode.PERMISSION_DENIED,
    category: ErrorCategory.SYSTEM,
    description: 'Permission denied for file operation',
    severity: ErrorSeverity.CRITICAL,
    recoverable: false,
    remediation: [
      'Check file permissions',
      'Verify user has required access',
      'Fix directory permissions',
      'Run with appropriate privileges'
    ]
  },
  [SystemErrorCode.CHANNEL_LOCKED]: {
    code: SystemErrorCode.CHANNEL_LOCKED,
    category: ErrorCategory.SYSTEM,
    description: 'Channel file is locked by another process',
    severity: ErrorSeverity.HIGH,
    recoverable: true,
    remediation: [
      'Wait for lock to release',
      'Check for stale locks',
      'Verify only one writer per channel',
      'Implement lock timeout'
    ]
  },
  [SystemErrorCode.INTERNAL_ERROR]: {
    code: SystemErrorCode.INTERNAL_ERROR,
    category: ErrorCategory.SYSTEM,
    description: 'Internal system error',
    severity: ErrorSeverity.CRITICAL,
    recoverable: false,
    remediation: [
      'Check system logs',
      'Report bug if reproducible',
      'Restart agent',
      'Check for software updates'
    ]
  }
};

// ============================================================================
// Error Message Format
// ============================================================================

/**
 * Standard error message format
 */
export interface ProtocolError {
  /** Error code */
  errorCode: ErrorCode;
  /** Human-readable error message */
  errorMessage: string;
  /** Field path (if applicable) */
  field?: string;
  /** Expected value/format */
  expectedValue?: unknown;
  /** Actual value received */
  actualValue?: unknown;
  /** Remediation suggestions */
  suggestions?: string[];
  /** Additional context */
  context?: Record<string, unknown>;
  /** Timestamp when error occurred */
  timestamp?: string;
}

/**
 * Create a protocol error
 */
export function createProtocolError(
  code: ErrorCode,
  overrides?: Partial<ProtocolError>
): ProtocolError {
  const metadata = ERROR_CATALOG[code];

  return {
    errorCode: code,
    errorMessage: overrides?.errorMessage || metadata.description,
    field: overrides?.field,
    expectedValue: overrides?.expectedValue,
    actualValue: overrides?.actualValue,
    suggestions: overrides?.suggestions || metadata.remediation,
    context: overrides?.context,
    timestamp: new Date().toISOString()
  };
}

// ============================================================================
// Error Utilities
// ============================================================================

/**
 * Check if error is recoverable
 */
export function isRecoverableError(code: ErrorCode): boolean {
  return ERROR_CATALOG[code].recoverable;
}

/**
 * Get error severity
 */
export function getErrorSeverity(code: ErrorCode): ErrorSeverity {
  return ERROR_CATALOG[code].severity;
}

/**
 * Get error category
 */
export function getErrorCategory(code: ErrorCode): ErrorCategory {
  return ERROR_CATALOG[code].category;
}

/**
 * Get remediation suggestions
 */
export function getRemediationSuggestions(code: ErrorCode): string[] {
  return ERROR_CATALOG[code].remediation;
}

/**
 * Format error for display
 */
export function formatError(error: ProtocolError): string {
  let formatted = `[${error.errorCode}] ${error.errorMessage}`;

  if (error.field) {
    formatted += `\n  Field: ${error.field}`;
  }

  if (error.expectedValue !== undefined) {
    formatted += `\n  Expected: ${JSON.stringify(error.expectedValue)}`;
  }

  if (error.actualValue !== undefined) {
    formatted += `\n  Actual: ${JSON.stringify(error.actualValue)}`;
  }

  if (error.suggestions && error.suggestions.length > 0) {
    formatted += `\n  Suggestions:`;
    error.suggestions.forEach(suggestion => {
      formatted += `\n    - ${suggestion}`;
    });
  }

  return formatted;
}

/**
 * Format multiple errors
 */
export function formatErrors(errors: ProtocolError[]): string {
  return errors.map((err, idx) => `${idx + 1}. ${formatError(err)}`).join('\n\n');
}
