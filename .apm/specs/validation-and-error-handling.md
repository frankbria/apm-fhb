# Validation and Error Handling Specification
**Protocol Version:** 1.0.0
**Date:** 2025-11-12

---

## 1. Overview

This specification defines the three-level validation framework and comprehensive error handling procedures for the APM Communication Protocol. All protocol implementations MUST adhere to these validation and error handling requirements.

---

## 2. Validation Framework

### 2.1 Three-Level Validation

All messages undergo three levels of validation:

```
Level 1: Syntax Validation
    ↓
Level 2: Schema Validation
    ↓
Level 3: Semantic Validation
```

#### Level 1: Syntax Validation

**Purpose:** Ensure message is valid UTF-8 JSON

**Checks:**
- ✅ Valid UTF-8 encoding (no invalid byte sequences)
- ✅ Valid JSON syntax (parseable by `JSON.parse()`)
- ✅ Non-empty message

**Failure Actions:**
- Reject message with `E_PROTOCOL_002` (Malformed JSON)
- Move to Dead Letter Queue (DLQ)
- Do NOT proceed to Level 2

**Example Failures:**
```json
// Invalid UTF-8
\xFF\xFE...

// Invalid JSON syntax
{"version": "1.0.0", "messageId": "msg_123"  // Missing closing brace

// Empty message
""
```

#### Level 2: Schema Validation

**Purpose:** Ensure message conforms to protocol schema

**Checks:**
- ✅ All required fields present
- ✅ Field types correct (string, number, object, array)
- ✅ Enum values valid
- ✅ Nested object structure correct
- ✅ Message size ≤ 1 MB

**Validation Method:**
- Zod schema validation against message type schema
- Field-by-field type checking
- Nested validation for complex payloads

**Failure Actions:**
- Return validation errors with field paths
- Reject message with `E_VALIDATION_00X` code
- Send NACK to sender with error details
- Optionally move to DLQ after max retries

**Example Failures:**
```json
// Missing required field
{
  "version": "1.0.0",
  // Missing messageId
  "timestamp": "2025-11-12T10:00:00.000Z"
}
// Error: E_VALIDATION_001 - Missing required field 'messageId'

// Invalid type
{
  "version": "1.0.0",
  "messageId": 123,  // Should be string
  "timestamp": "2025-11-12T10:00:00.000Z"
}
// Error: E_VALIDATION_002 - Invalid type for field 'messageId'

// Invalid enum value
{
  "messageType": "INVALID_TYPE"  // Not in MessageType enum
}
// Error: E_VALIDATION_003 - Invalid enum value
```

#### Level 3: Semantic Validation

**Purpose:** Enforce business rules and protocol semantics

**Checks:**
- ✅ Protocol version compatibility (1.x.x)
- ✅ Valid agent IDs (alphanumeric + underscore or "*")
- ✅ Correlation ID requirements met
- ✅ Business rule constraints (e.g., completed status = 100% progress)
- ✅ Message-type-specific rules

**Business Rules by Message Type:**

**TASK_UPDATE:**
- Progress must be 0.0 ≤ progress ≤ 1.0
- Completed status requires progress = 1.0
- Blocked status should include blocker details (warning)

**HANDOFF_REQUEST:**
- Source agent ≠ target agent
- Completed steps should be non-empty (warning)

**ACK:**
- Should include correlation ID (warning)

**NACK:**
- Should include suggested fix (warning)
- Permanent failures should set canRetry = false (warning)

**Failure Actions:**
- Return validation errors with business rule violations
- Reject message with `E_VALIDATION_009` (Business rule violation)
- Send NACK with specific rule violation details

---

## 3. Error Code Catalog

### 3.1 Error Categories

| Category | Prefix | Count | Description |
|----------|--------|-------|-------------|
| **Validation** | E_VALIDATION_xxx | 9 | Schema and validation errors |
| **Routing** | E_ROUTING_xxx | 5 | Message routing failures |
| **Protocol** | E_PROTOCOL_xxx | 6 | Protocol-level errors |
| **Task** | E_TASK_xxx | 6 | Task execution errors |
| **System** | E_SYSTEM_xxx | 5 | System and filesystem errors |

### 3.2 Validation Errors (E_VALIDATION_xxx)

| Code | Description | Severity | Recoverable | Remediation |
|------|-------------|----------|-------------|-------------|
| **E_VALIDATION_001** | Missing required field | Medium | Yes | Add missing field |
| **E_VALIDATION_002** | Invalid field type | Medium | Yes | Fix type |
| **E_VALIDATION_003** | Invalid enum value | Medium | Yes | Use valid enum |
| **E_VALIDATION_004** | Schema validation failed | Medium | Yes | Fix schema conformance |
| **E_VALIDATION_005** | Message size exceeded 1MB | High | No | Reduce payload size |
| **E_VALIDATION_006** | Invalid message ID format | Medium | Yes | Use generateMessageId() |
| **E_VALIDATION_007** | Invalid timestamp format | Medium | Yes | Use ISO 8601 UTC |
| **E_VALIDATION_008** | Invalid agent ID format | Medium | Yes | Use alphanumeric + "_" |
| **E_VALIDATION_009** | Business rule violation | Medium | Yes | Review business rules |

### 3.3 Routing Errors (E_ROUTING_xxx)

| Code | Description | Severity | Recoverable |
|------|-------------|----------|-------------|
| **E_ROUTING_001** | Agent not found | Medium | No |
| **E_ROUTING_002** | Invalid receiver specification | Medium | Yes |
| **E_ROUTING_003** | Channel unavailable | High | Yes |
| **E_ROUTING_004** | Broadcast failed (partial) | Medium | Yes |
| **E_ROUTING_005** | Routing table error | High | Yes |

### 3.4 Protocol Errors (E_PROTOCOL_xxx)

| Code | Description | Severity | Recoverable |
|------|-------------|----------|-------------|
| **E_PROTOCOL_001** | Unsupported protocol version | High | No |
| **E_PROTOCOL_002** | Malformed JSON/UTF-8 | Critical | No |
| **E_PROTOCOL_003** | Invalid correlation ID | Medium | Yes |
| **E_PROTOCOL_004** | Message timeout | Medium | Yes |
| **E_PROTOCOL_005** | Duplicate message ID | Low | Yes |
| **E_PROTOCOL_006** | Unexpected message type | Medium | Yes |

### 3.5 Task Errors (E_TASK_xxx)

| Code | Description | Severity | Recoverable |
|------|-------------|----------|-------------|
| **E_TASK_001** | Task not found | Medium | No |
| **E_TASK_002** | Task already assigned | Low | No |
| **E_TASK_003** | Task execution failed | High | Yes |
| **E_TASK_004** | Task dependency missing | High | Yes |
| **E_TASK_005** | Task timeout | High | Yes |
| **E_TASK_006** | Invalid task state transition | Medium | Yes |

### 3.6 System Errors (E_SYSTEM_xxx)

| Code | Description | Severity | Recoverable |
|------|-------------|----------|-------------|
| **E_SYSTEM_001** | Filesystem error | Critical | Yes |
| **E_SYSTEM_002** | Disk full | Critical | No |
| **E_SYSTEM_003** | Permission denied | Critical | No |
| **E_SYSTEM_004** | Channel locked | High | Yes |
| **E_SYSTEM_005** | Internal error | Critical | No |

---

## 4. Error Message Format

### 4.1 Standard Error Structure

```typescript
{
  errorCode: string;        // "E_VALIDATION_001"
  errorMessage: string;     // "Missing required field 'messageId'"
  field?: string;           // "messageId"
  expectedValue?: any;      // "string"
  actualValue?: any;        // undefined
  suggestions?: string[];   // ["Add messageId field", "Use generateMessageId()"]
  context?: object;         // Additional context
  timestamp?: string;       // ISO 8601 timestamp
}
```

### 4.2 Error Response Messages

**NACK Payload for Validation Error:**
```json
{
  "rejectedMessageId": "msg_20251112_100000_001",
  "reason": "Schema validation failed: Missing required field 'messageId'",
  "errorCode": "E_VALIDATION_001",
  "timestamp": "2025-11-12T10:00:00.150Z",
  "canRetry": true,
  "suggestedFix": "Add 'messageId' field using generateMessageId() utility"
}
```

**ERROR_REPORT Payload:**
```json
{
  "errorType": "ValidationError",
  "errorCode": "E_VALIDATION_004",
  "errorMessage": "Message failed schema validation",
  "severity": "medium",
  "context": {
    "messageId": "msg_123",
    "validationErrors": [
      {
        "field": "payload.taskId",
        "message": "Required field missing"
      }
    ]
  },
  "recoverable": true,
  "suggestedAction": "Review message schema and add missing fields"
}
```

---

## 5. Error Handling Procedures

### 5.1 Retry Policy

**Default Retry Configuration by Message Type:**

| Message Type | Max Retries | Base Delay | Max Delay | Backoff |
|-------------|-------------|------------|-----------|---------|
| TASK_ASSIGNMENT | 3 | 1000ms | 8000ms | Exponential (2x) |
| TASK_UPDATE | 2 | 1000ms | 4000ms | Exponential (2x) |
| STATE_SYNC | 2 | 1000ms | 4000ms | Exponential (2x) |
| ERROR_REPORT | 3 | 1000ms | 8000ms | Exponential (2x) |
| HANDOFF_REQUEST | 2 | 2000ms | 8000ms | Exponential (2x) |
| ACK | 0 | - | - | No retry (fire-and-forget) |
| NACK | 0 | - | - | No retry (fire-and-forget) |

**Retry Delay Calculation:**
```
delay = min(baseDelay * (backoffMultiplier ^ retryCount), maxDelay)

Examples:
Attempt 1: min(1000 * 2^0, 8000) = 1000ms
Attempt 2: min(1000 * 2^1, 8000) = 2000ms
Attempt 3: min(1000 * 2^2, 8000) = 4000ms
Attempt 4: min(1000 * 2^3, 8000) = 8000ms (capped)
```

### 5.2 Error Handling Decision Flow

```
Message Send Failed
       ↓
Is Circuit Breaker OPEN?
   Yes → Move to DLQ
   No  ↓
Is Error Recoverable?
   No  → Move to DLQ
   Yes ↓
Retry Count < Max Retries?
   No  → Move to DLQ
   Yes ↓
Apply Exponential Backoff
       ↓
Retry Send
```

### 5.3 Dead Letter Queue (DLQ)

**DLQ Entry Format:**
```json
{
  "timestamp": "2025-11-12T10:00:00.000Z",
  "reason": "Max retries exceeded",
  "error": {
    "code": "E_ROUTING_003",
    "message": "Channel unavailable",
    "field": null,
    "suggestions": ["Check filesystem permissions", "Verify channel directory exists"]
  },
  "originalMessage": {
    "version": "1.0.0",
    "messageId": "msg_123",
    ...
  }
}
```

**DLQ Management:**

**Write to DLQ:**
- Max retries exceeded
- Non-recoverable errors
- Circuit breaker OPEN
- Malformed messages (syntax errors)

**DLQ Operations:**
1. **Monitor:** Check DLQ size periodically
2. **Alert:** Trigger alert if > 10 entries
3. **Reprocess:** Manually retry DLQ entries after fixing issues
4. **Archive:** Move old entries (>30 days) to archive
5. **Cleanup:** Delete archived entries (>90 days)

**DLQ File Naming:**
```
.apm/dlq/
├── failed_msg_20251112_100000_001_1731413400000.json
├── failed_msg_20251112_100001_002_1731413401000.json
├── malformed_1731413402000.json
└── ...
```

### 5.4 Circuit Breaker Pattern

**Purpose:** Prevent cascading failures by temporarily stopping operations after threshold failures

**States:**
- **CLOSED:** Normal operation
- **OPEN:** Stop all operations (fail fast)
- **HALF_OPEN:** Test if system recovered

**Configuration:**
- Failure threshold: 5 consecutive failures
- Timeout: 60 seconds

**State Transitions:**
```
CLOSED ──(5 failures)──> OPEN
OPEN ──(60s timeout)──> HALF_OPEN
HALF_OPEN ──(success)──> CLOSED
HALF_OPEN ──(failure)──> OPEN
```

**Behavior:**
- **CLOSED:** Process messages normally
- **OPEN:** Reject all messages immediately, move to DLQ
- **HALF_OPEN:** Allow one test message, transition based on result

---

## 6. Error Recovery Procedures

### 6.1 Automatic Recovery

Some errors can be automatically corrected:

**Missing Priority Field:**
```typescript
// Before
{
  "version": "1.0.0",
  "messageId": "msg_123",
  // Missing priority
}

// After recovery
{
  "version": "1.0.0",
  "messageId": "msg_123",
  "priority": "NORMAL"  // Default value
}
```

**Invalid Timestamp:**
```typescript
// Before
{
  "timestamp": "invalid-timestamp"
}

// After recovery
{
  "timestamp": "2025-11-12T10:00:00.000Z"  // Current time
}
```

**Missing Correlation ID:**
```typescript
// Before (TASK_ASSIGNMENT requires correlation ID)
{
  "messageType": "TASK_ASSIGNMENT",
  // Missing correlationId
}

// After recovery
{
  "messageType": "TASK_ASSIGNMENT",
  "correlationId": "req_20251112_100000_abc123"  // Generated
}
```

### 6.2 Manual Recovery

**DLQ Reprocessing:**
1. Identify DLQ entry to reprocess
2. Fix underlying issue (permissions, config, etc.)
3. Call `reprocessDLQEntry(fileName)`
4. Message is retried automatically
5. If successful, DLQ entry is deleted

**Example:**
```typescript
const errorHandler = new ProtocolErrorHandler({ dlqPath: '.apm/dlq' });

// Reprocess specific entry
const message = await errorHandler.reprocessDLQEntry(
  'failed_msg_20251112_100000_001.json'
);

if (message) {
  // Retry sending message
  await sendMessage(message);
}
```

---

## 7. Validation Implementation

### 7.1 Validation API

```typescript
import { validate, ValidationLevel } from './protocol/validator';

// Validate at all three levels (default)
const result = validate(messageJson);

if (!result.valid) {
  console.error('Validation failed:');
  result.errors?.forEach(err => {
    console.error(`- [${err.errorCode}] ${err.errorMessage}`);
  });
}

// Validate at specific level
const syntaxOnly = validate(messageJson, ValidationLevel.SYNTAX);
const schemaOnly = validate(messageJson, ValidationLevel.SCHEMA);
const semanticOnly = validate(messageJson, ValidationLevel.SEMANTIC);
```

### 7.2 Custom Validators

**Register Custom Business Rule:**
```typescript
function validateCustomRule(message: ProtocolMessage): boolean {
  // Custom validation logic
  if (message.messageType === MessageType.TASK_ASSIGNMENT) {
    const payload = message.payload as TaskAssignmentPayload;
    // Ensure task ID follows naming convention
    return /^task_\d+_\d+$/.test(payload.taskId);
  }
  return true;
}
```

---

## 8. Error Handling Implementation

### 8.1 Error Handler Setup

```typescript
import { ProtocolErrorHandler } from './protocol/error-handler';

const errorHandler = new ProtocolErrorHandler({
  dlqPath: '.apm/dlq',
  enableRetries: true,
  retryPolicies: {
    [MessageType.TASK_ASSIGNMENT]: {
      maxRetries: 5,
      baseDelay: 2000,
      maxDelay: 16000,
      backoffMultiplier: 2
    }
  },
  circuitBreakerThreshold: 10,
  circuitBreakerTimeout: 120000
});
```

### 8.2 Handling Send Failures

```typescript
async function sendMessageWithRetry(message: ProtocolMessage): Promise<void> {
  const tracker: MessageTracker = {
    messageId: message.messageId,
    state: MessageState.PENDING,
    retryCount: 0
  };

  while (true) {
    try {
      await writeToChannel(message);
      errorHandler.recordSuccess();
      break;
    } catch (err) {
      const protocolError = createProtocolError(
        RoutingErrorCode.CHANNEL_UNAVAILABLE,
        { context: { error: String(err) } }
      );

      const shouldRetry = await errorHandler.handleSendFailure(
        message,
        protocolError,
        tracker
      );

      if (!shouldRetry) {
        throw new Error('Message send failed permanently');
      }

      tracker.retryCount++;
    }
  }
}
```

### 8.3 DLQ Monitoring

```typescript
// Get DLQ statistics
const stats = await errorHandler.getDLQStats();
console.log(`DLQ entries: ${stats.totalEntries}`);

// Alert if threshold exceeded
if (stats.totalEntries > 10) {
  console.warn('DLQ threshold exceeded! Review failed messages.');
}

// Cleanup old entries
const deleted = await errorHandler.clearOldDLQEntries(30); // 30 days
console.log(`Cleaned up ${deleted} old DLQ entries`);
```

---

## 9. Best Practices

### 9.1 Validation Best Practices

✅ **DO:**
- Validate at all three levels for incoming messages
- Use type-safe message builders to prevent validation errors
- Log validation errors with full context
- Send informative NACK messages with suggestions
- Implement idempotent handlers for duplicate messages

❌ **DON'T:**
- Skip validation for "trusted" sources
- Ignore warnings (they indicate potential issues)
- Process messages that fail semantic validation
- Retry validation errors without fixing the message
- Mix validation levels (always validate completely)

### 9.2 Error Handling Best Practices

✅ **DO:**
- Use exponential backoff for retries
- Monitor DLQ size and alert on growth
- Implement circuit breaker for cascade prevention
- Log all errors with correlation IDs
- Provide actionable remediation in error messages

❌ **DON'T:**
- Retry non-recoverable errors
- Exceed max retry limits
- Ignore DLQ entries indefinitely
- Block on error handling (use async)
- Suppress error details in production

---

## 10. Summary

This validation and error handling framework provides:

✅ **Three-level validation:** Syntax → Schema → Semantic
✅ **31 error codes** across 5 categories
✅ **Structured error format** with remediation suggestions
✅ **Retry policy** with exponential backoff
✅ **Dead letter queue** for permanent failures
✅ **Circuit breaker** for cascade prevention
✅ **Automatic recovery** for common errors
✅ **DLQ management** with monitoring and cleanup

**Implementation Files:**
- `src/protocol/errors.ts` - Error code definitions and metadata
- `src/protocol/validator.ts` - Three-level validation framework
- `src/protocol/error-handler.ts` - Error handling and retry logic

---

**End of Validation and Error Handling Specification**
