/**
 * APM Communication Protocol - Validation Framework
 * Version: 1.0.0
 *
 * This file implements a three-level validation framework:
 * 1. Syntax validation (valid UTF-8 JSON)
 * 2. Schema validation (message structure)
 * 3. Semantic validation (business rules)
 */

import {
  MessageEnvelope,
  ProtocolMessage,
  MessageType,
  TaskStatus,
  ValidationResult,
  ValidationError
} from './types';
import {
  ProtocolMessageSchema,
  validateProtocolVersion,
  validateMessageSize,
  validateAgentId,
  validateCorrelationId,
  validateTaskProgress,
  validateCompletedStatus,
  validateHandoffTarget
} from './schemas';
import {
  ValidationErrorCode,
  ProtocolErrorCode,
  createProtocolError,
  ProtocolError
} from './errors';

// ============================================================================
// Validation Levels
// ============================================================================

/**
 * Validation level enum
 */
export enum ValidationLevel {
  /** Level 1: Syntax validation only */
  SYNTAX = 'syntax',
  /** Level 2: Syntax + Schema validation */
  SCHEMA = 'schema',
  /** Level 3: Syntax + Schema + Semantic validation */
  SEMANTIC = 'semantic'
}

/**
 * Validation result with detailed errors
 */
export interface DetailedValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation level that was performed */
  level: ValidationLevel;
  /** Validation errors (if any) */
  errors?: ProtocolError[];
  /** Warnings (non-fatal issues) */
  warnings?: ProtocolError[];
}

// ============================================================================
// Level 1: Syntax Validation
// ============================================================================

/**
 * Validate message syntax (UTF-8 JSON)
 *
 * Checks:
 * - Valid UTF-8 encoding
 * - Valid JSON syntax
 * - Not empty
 *
 * @param messageJson - Raw message string
 * @returns Validation result
 */
export function validateSyntax(messageJson: string): DetailedValidationResult {
  const errors: ProtocolError[] = [];

  // Check not empty
  if (!messageJson || messageJson.trim().length === 0) {
    errors.push(
      createProtocolError(ProtocolErrorCode.MALFORMED_MESSAGE, {
        errorMessage: 'Message is empty',
        suggestions: ['Provide non-empty message']
      })
    );
    return { valid: false, level: ValidationLevel.SYNTAX, errors };
  }

  // Check UTF-8 encoding
  try {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const bytes = encoder.encode(messageJson);
    decoder.decode(bytes);
  } catch (err) {
    errors.push(
      createProtocolError(ProtocolErrorCode.MALFORMED_MESSAGE, {
        errorMessage: 'Invalid UTF-8 encoding',
        context: { error: err instanceof Error ? err.message : String(err) }
      })
    );
    return { valid: false, level: ValidationLevel.SYNTAX, errors };
  }

  // Check JSON syntax
  try {
    JSON.parse(messageJson);
  } catch (err) {
    errors.push(
      createProtocolError(ProtocolErrorCode.MALFORMED_MESSAGE, {
        errorMessage: 'Invalid JSON syntax',
        context: { error: err instanceof Error ? err.message : String(err) },
        suggestions: [
          'Check for missing commas, quotes, or brackets',
          'Use JSON.stringify() to serialize',
          'Validate JSON with a linter'
        ]
      })
    );
    return { valid: false, level: ValidationLevel.SYNTAX, errors };
  }

  return { valid: true, level: ValidationLevel.SYNTAX };
}

// ============================================================================
// Level 2: Schema Validation
// ============================================================================

/**
 * Validate message schema (structure and types)
 *
 * Checks:
 * - Required fields present
 * - Field types correct
 * - Enum values valid
 * - Nested object structure
 *
 * @param message - Parsed message object
 * @returns Validation result
 */
export function validateSchema(message: unknown): DetailedValidationResult {
  const errors: ProtocolError[] = [];
  const warnings: ProtocolError[] = [];

  // Basic type check
  if (typeof message !== 'object' || message === null) {
    errors.push(
      createProtocolError(ValidationErrorCode.INVALID_TYPE, {
        errorMessage: 'Message must be an object',
        field: 'message',
        expectedValue: 'object',
        actualValue: typeof message
      })
    );
    return { valid: false, level: ValidationLevel.SCHEMA, errors };
  }

  // Validate with Zod schema
  const result = ProtocolMessageSchema.safeParse(message);

  if (!result.success) {
    const zodErrors = result.error.errors;

    for (const zodError of zodErrors) {
      const field = zodError.path.join('.');
      const errorCode = zodError.code;

      let code: ValidationErrorCode;
      if (errorCode === 'invalid_type') {
        code = ValidationErrorCode.INVALID_TYPE;
      } else if (errorCode === 'invalid_enum_value') {
        code = ValidationErrorCode.INVALID_ENUM;
      } else {
        code = ValidationErrorCode.SCHEMA_FAILED;
      }

      errors.push(
        createProtocolError(code, {
          errorMessage: zodError.message,
          field,
          expectedValue: 'expected' in zodError ? (zodError as any).expected : undefined,
          actualValue: 'received' in zodError ? (zodError as any).received : undefined
        })
      );
    }

    return { valid: false, level: ValidationLevel.SCHEMA, errors };
  }

  // Check message size (warning threshold)
  const messageJson = JSON.stringify(message);
  if (!validateMessageSize(messageJson)) {
    errors.push(
      createProtocolError(ValidationErrorCode.SIZE_EXCEEDED, {
        errorMessage: 'Message size exceeds 1MB limit',
        field: 'message',
        actualValue: `${messageJson.length} bytes`,
        expectedValue: '≤ 1048576 bytes'
      })
    );
  } else if (messageJson.length > 100000) {
    // Warning for >100KB
    warnings.push(
      createProtocolError(ValidationErrorCode.SIZE_EXCEEDED, {
        errorMessage: 'Message size exceeds recommended 100KB',
        field: 'message',
        actualValue: `${messageJson.length} bytes`,
        suggestions: [
          'Consider splitting into multiple messages',
          'Enable compression for large payloads',
          'Use file references instead of embedding data'
        ]
      })
    );
  }

  return {
    valid: errors.length === 0,
    level: ValidationLevel.SCHEMA,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

// ============================================================================
// Level 3: Semantic Validation
// ============================================================================

/**
 * Validate message semantics (business rules)
 *
 * Checks:
 * - Protocol version compatibility
 * - Valid agent IDs
 * - Correlation ID requirements
 * - Business rule constraints
 *
 * @param message - Validated message
 * @returns Validation result
 */
export function validateSemantics(message: ProtocolMessage): DetailedValidationResult {
  const errors: ProtocolError[] = [];
  const warnings: ProtocolError[] = [];

  // Validate protocol version
  if (!validateProtocolVersion(message.version)) {
    errors.push(
      createProtocolError(ProtocolErrorCode.VERSION_UNSUPPORTED, {
        errorMessage: 'Unsupported protocol version',
        field: 'version',
        expectedValue: '1.x.x',
        actualValue: message.version
      })
    );
  }

  // Validate agent IDs
  if (!validateAgentId(message.sender.agentId)) {
    errors.push(
      createProtocolError(ValidationErrorCode.INVALID_AGENT_ID, {
        errorMessage: 'Invalid sender agent ID format',
        field: 'sender.agentId',
        actualValue: message.sender.agentId
      })
    );
  }

  if (!validateAgentId(message.receiver.agentId)) {
    errors.push(
      createProtocolError(ValidationErrorCode.INVALID_AGENT_ID, {
        errorMessage: 'Invalid receiver agent ID format',
        field: 'receiver.agentId',
        actualValue: message.receiver.agentId
      })
    );
  }

  // Validate correlation ID requirements
  if (!validateCorrelationId(message.messageType, message.correlationId)) {
    errors.push(
      createProtocolError(ProtocolErrorCode.INVALID_CORRELATION_ID, {
        errorMessage: `Correlation ID required for ${message.messageType}`,
        field: 'correlationId',
        actualValue: message.correlationId || 'undefined'
      })
    );
  }

  // Message-type-specific business rules
  switch (message.messageType) {
    case MessageType.TASK_UPDATE:
      validateTaskUpdateSemantics(message as any, errors, warnings);
      break;

    case MessageType.HANDOFF_REQUEST:
      validateHandoffSemantics(message as any, errors, warnings);
      break;

    case MessageType.ACK:
      validateAckSemantics(message as any, errors, warnings);
      break;

    case MessageType.NACK:
      validateNackSemantics(message as any, errors, warnings);
      break;

    // Add validation for other message types as needed
  }

  return {
    valid: errors.length === 0,
    level: ValidationLevel.SEMANTIC,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

/**
 * Validate TASK_UPDATE business rules
 */
function validateTaskUpdateSemantics(
  message: any,
  errors: ProtocolError[],
  warnings: ProtocolError[]
): void {
  const { progress, status } = message.payload;

  // Validate progress range
  if (!validateTaskProgress(progress)) {
    errors.push(
      createProtocolError(ValidationErrorCode.BUSINESS_RULE, {
        errorMessage: 'Task progress must be between 0.0 and 1.0',
        field: 'payload.progress',
        expectedValue: '0.0 ≤ progress ≤ 1.0',
        actualValue: progress
      })
    );
  }

  // Validate completed status requires 100% progress
  if (!validateCompletedStatus(status, progress)) {
    errors.push(
      createProtocolError(ValidationErrorCode.BUSINESS_RULE, {
        errorMessage: 'Completed status requires progress = 1.0',
        field: 'payload.status',
        expectedValue: { status: TaskStatus.COMPLETED, progress: 1.0 },
        actualValue: { status, progress }
      })
    );
  }

  // Warning for blocked status without blockers
  if (status === TaskStatus.BLOCKED && (!message.payload.blockers || message.payload.blockers.length === 0)) {
    warnings.push(
      createProtocolError(ValidationErrorCode.BUSINESS_RULE, {
        errorMessage: 'Blocked status should include blocker information',
        field: 'payload.blockers',
        suggestions: ['Add blocker details to explain what is blocking progress']
      })
    );
  }
}

/**
 * Validate HANDOFF_REQUEST business rules
 */
function validateHandoffSemantics(
  message: any,
  errors: ProtocolError[],
  warnings: ProtocolError[]
): void {
  const { sourceAgent, targetAgent } = message.payload;

  // Validate source != target
  if (!validateHandoffTarget(sourceAgent.agentId, targetAgent.agentId)) {
    errors.push(
      createProtocolError(ValidationErrorCode.BUSINESS_RULE, {
        errorMessage: 'Handoff source and target must be different agents',
        field: 'payload.targetAgent',
        actualValue: { source: sourceAgent.agentId, target: targetAgent.agentId }
      })
    );
  }

  // Warning if handoff context is empty
  const { completedSteps } = message.payload.handoffContext;
  if (!completedSteps || completedSteps.length === 0) {
    warnings.push(
      createProtocolError(ValidationErrorCode.BUSINESS_RULE, {
        errorMessage: 'Handoff with no completed steps may indicate premature handoff',
        field: 'payload.handoffContext.completedSteps',
        suggestions: ['Verify handoff is necessary', 'Include completed work context']
      })
    );
  }
}

/**
 * Validate ACK business rules
 */
function validateAckSemantics(
  message: any,
  errors: ProtocolError[],
  warnings: ProtocolError[]
): void {
  // ACK messages should have correlation ID matching acknowledged message
  if (!message.correlationId) {
    warnings.push(
      createProtocolError(ValidationErrorCode.BUSINESS_RULE, {
        errorMessage: 'ACK should include correlation ID for request tracking',
        field: 'correlationId',
        suggestions: ['Include correlation ID to match with original message']
      })
    );
  }
}

/**
 * Validate NACK business rules
 */
function validateNackSemantics(
  message: any,
  errors: ProtocolError[],
  warnings: ProtocolError[]
): void {
  const { reason, canRetry, suggestedFix } = message.payload;

  // Warn if NACK has no suggested fix
  if (!suggestedFix) {
    warnings.push(
      createProtocolError(ValidationErrorCode.BUSINESS_RULE, {
        errorMessage: 'NACK should include suggested fix for sender',
        field: 'payload.suggestedFix',
        suggestions: ['Provide actionable guidance for sender to fix the issue']
      })
    );
  }

  // Warn if canRetry is true but reason suggests permanent failure
  if (canRetry && reason.toLowerCase().includes('permanent')) {
    warnings.push(
      createProtocolError(ValidationErrorCode.BUSINESS_RULE, {
        errorMessage: 'Permanent failure should set canRetry = false',
        field: 'payload.canRetry',
        suggestions: ['Set canRetry = false for permanent failures']
      })
    );
  }
}

// ============================================================================
// Composite Validation
// ============================================================================

/**
 * Validate message at specified level
 *
 * @param messageJson - Raw message string
 * @param level - Validation level to perform
 * @returns Detailed validation result
 */
export function validate(
  messageJson: string,
  level: ValidationLevel = ValidationLevel.SEMANTIC
): DetailedValidationResult {
  // Level 1: Syntax
  const syntaxResult = validateSyntax(messageJson);
  if (!syntaxResult.valid) {
    return syntaxResult;
  }

  if (level === ValidationLevel.SYNTAX) {
    return syntaxResult;
  }

  // Parse message
  const message = JSON.parse(messageJson);

  // Level 2: Schema
  const schemaResult = validateSchema(message);
  if (!schemaResult.valid) {
    return schemaResult;
  }

  if (level === ValidationLevel.SCHEMA) {
    return schemaResult;
  }

  // Level 3: Semantic
  const semanticResult = validateSemantics(message as ProtocolMessage);

  // Merge warnings from schema validation
  if (schemaResult.warnings) {
    semanticResult.warnings = [
      ...(schemaResult.warnings || []),
      ...(semanticResult.warnings || [])
    ];
  }

  return semanticResult;
}

/**
 * Quick validation check (returns boolean)
 *
 * @param messageJson - Raw message string
 * @param level - Validation level
 * @returns true if valid, false otherwise
 */
export function isValid(
  messageJson: string,
  level: ValidationLevel = ValidationLevel.SEMANTIC
): boolean {
  return validate(messageJson, level).valid;
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Get validation errors as formatted string
 *
 * @param result - Validation result
 * @returns Formatted error string
 */
export function formatValidationErrors(result: DetailedValidationResult): string {
  if (result.valid) {
    return 'No errors';
  }

  let output = `Validation failed at ${result.level} level:\n`;

  if (result.errors) {
    output += '\nErrors:\n';
    result.errors.forEach((err, idx) => {
      output += `${idx + 1}. [${err.errorCode}] ${err.errorMessage}\n`;
      if (err.field) {
        output += `   Field: ${err.field}\n`;
      }
      if (err.suggestions && err.suggestions.length > 0) {
        output += `   Suggestions:\n`;
        err.suggestions.forEach(s => {
          output += `     - ${s}\n`;
        });
      }
    });
  }

  if (result.warnings) {
    output += '\nWarnings:\n';
    result.warnings.forEach((warn, idx) => {
      output += `${idx + 1}. [${warn.errorCode}] ${warn.errorMessage}\n`;
      if (warn.field) {
        output += `   Field: ${warn.field}\n`;
      }
    });
  }

  return output;
}
