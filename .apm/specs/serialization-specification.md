# Message Serialization Specification
**Protocol Version:** 1.0.0
**Date:** 2025-11-12

---

## 1. Overview

This document specifies the serialization format, encoding rules, and size constraints for APM protocol messages. All agents MUST conform to these specifications for interoperability.

---

## 2. Format Specification

### 2.1 Primary Format: NDJSON

**Messages are serialized as Newline-Delimited JSON (NDJSON):**

- One complete JSON object per line
- Lines separated by `\n` (newline character, ASCII 0x0A)
- No trailing commas or extra whitespace between lines
- Each line MUST be valid JSON independently

**Example:**
```ndjson
{"version":"1.0.0","messageId":"msg_20251112_103045_abc123","timestamp":"2025-11-12T10:30:45.123Z","sender":{"agentId":"manager_001","type":"Manager"},"receiver":{"agentId":"impl_001","type":"Implementation"},"messageType":"TASK_ASSIGNMENT","priority":"HIGH","payload":{"taskId":"task_3_1","taskRef":"Task 3.1","taskDescription":"Design protocol","memoryLogPath":".apm/Memory/task_3_1.md","executionType":"multi-step"}}
{"version":"1.0.0","messageId":"msg_20251112_103046_def456","timestamp":"2025-11-12T10:30:46.456Z","sender":{"agentId":"impl_001","type":"Implementation"},"receiver":{"agentId":"manager_001","type":"Manager"},"messageType":"ACK","priority":"NORMAL","payload":{"acknowledgedMessageId":"msg_20251112_103045_abc123","status":"received","timestamp":"2025-11-12T10:30:46.456Z"}}
```

### 2.2 Character Encoding

**UTF-8 Encoding:**
- All messages MUST be encoded in UTF-8
- No BOM (Byte Order Mark)
- Invalid UTF-8 sequences MUST be rejected with `E_PROTOCOL_002`

**String Escaping:**
- Follow JSON RFC 8259 escaping rules
- Special characters: `"`, `\`, `/`, `\b`, `\f`, `\n`, `\r`, `\t`
- Unicode: `\uXXXX` format

### 2.3 JSON Serialization Rules

**Field Ordering:**
- No specific ordering required (JSON objects are unordered)
- Recommended order: version, messageId, correlationId, timestamp, sender, receiver, messageType, priority, payload, metadata

**Number Format:**
- Integers: No decimal point (e.g., `42`)
- Floats: Decimal point required (e.g., `0.5`)
- No leading zeros (e.g., `007` is invalid, use `7`)
- Scientific notation allowed (e.g., `1.23e-4`)

**Boolean Values:**
- Lowercase only: `true` or `false`
- Not: `True`, `TRUE`, `1`, `0`

**Null Values:**
- Lowercase only: `null`
- Omit optional fields instead of setting to `null` (preferred)

**Arrays:**
- Empty arrays allowed: `[]`
- Trailing commas not allowed: `[1, 2,]` ❌ → `[1, 2]` ✅

**Objects:**
- Empty objects allowed: `{}`
- Duplicate keys not allowed (last value wins, but avoid)
- Trailing commas not allowed

---

## 3. Message Size Constraints

### 3.1 Size Limits

| Constraint | Limit | Enforcement |
|-----------|-------|-------------|
| **Maximum message size** | 1 MB (1,048,576 bytes) | Hard limit, reject with `E_VALIDATION_005` |
| **Recommended maximum** | 100 KB | Warning threshold |
| **Minimum message size** | 100 bytes | Typical minimum for valid envelope |

**Size Calculation:**
```typescript
const messageSize = new TextEncoder().encode(JSON.stringify(message)).length;
if (messageSize > 1048576) {
  throw new Error('Message exceeds 1MB limit');
}
```

### 3.2 Compression (Optional)

**Compression Trigger:**
- Compress payloads exceeding 10 KB (configurable)
- Use gzip compression (RFC 1952)

**Compressed Message Format:**
```json
{
  "compressed": true,
  "data": "H4sIAAAAAAAA/+...base64..."
}
```

**Decompression:**
1. Detect `compressed: true` flag
2. Base64 decode `data` field
3. Gunzip to get original JSON
4. Parse and validate

**Important:** Compression is transparent to protocol layer—decompressed message MUST still conform to size limits.

---

## 4. Schema Versioning

### 4.1 Version Field

**Every message includes protocol version:**
```json
{
  "version": "1.0.0"
}
```

**Semantic Versioning (semver):**
- Format: `MAJOR.MINOR.PATCH`
- Example: `1.0.0`, `1.2.3`, `2.0.0`

### 4.2 Version Compatibility

**MAJOR version (1.x.x → 2.x.x):**
- Breaking changes allowed
- May remove fields, change types, alter semantics
- Agents MUST reject incompatible versions

**MINOR version (1.0.x → 1.1.x):**
- Backward-compatible additions
- New optional fields, new message types
- Agents SHOULD accept newer minor versions

**PATCH version (1.0.0 → 1.0.1):**
- Bug fixes, clarifications
- No message format changes
- Fully compatible

### 4.3 Version Detection

**Validation:**
```typescript
function validateProtocolVersion(version: string): boolean {
  const [major] = version.split('.').map(Number);
  const [expectedMajor] = PROTOCOL_VERSION.split('.').map(Number);
  return major === expectedMajor;
}
```

**Rejection:**
```json
{
  "messageType": "NACK",
  "payload": {
    "rejectedMessageId": "msg_123",
    "reason": "Unsupported protocol version: 2.0.0 (expected 1.x.x)",
    "errorCode": "E_PROTOCOL_001",
    "canRetry": false
  }
}
```

---

## 5. Serialization Process

### 5.1 Serialization Steps

**Sender Side:**
1. **Create Message Object:**
   - Populate all required fields
   - Add optional fields as needed
   - Generate messageId and timestamp

2. **Validate Message:**
   - Check required fields present
   - Validate field types
   - Validate business rules

3. **Serialize to JSON:**
   - Use `JSON.stringify()` (no pretty-printing)
   - Compact format (no extra whitespace)

4. **Check Size:**
   - Calculate UTF-8 byte size
   - Reject if > 1 MB

5. **Apply Compression (optional):**
   - If size > 10 KB
   - Gzip and base64 encode
   - Wrap in compression envelope

6. **Append Newline:**
   - Add `\n` to end of JSON
   - Ready for NDJSON stream

7. **Write to Channel:**
   - Append to `.ndjson` log file
   - Use file locking for safety

### 5.2 Deserialization Steps

**Receiver Side:**
1. **Read Line from Stream:**
   - Read until `\n` delimiter
   - Trim whitespace

2. **Parse JSON:**
   - Use `JSON.parse()`
   - Catch syntax errors → `E_PROTOCOL_002`

3. **Check Compression:**
   - If `compressed: true`, decompress
   - Base64 decode → gunzip → parse

4. **Validate Syntax:**
   - UTF-8 encoding valid
   - JSON well-formed

5. **Validate Schema:**
   - Check envelope structure
   - Validate required fields
   - Validate field types

6. **Validate Semantics:**
   - Check protocol version
   - Validate message type
   - Apply business rules

7. **Return Message or Error:**
   - Success: Return parsed message
   - Failure: Return validation errors

---

## 6. Error Handling

### 6.1 Serialization Errors

**Invalid Message Structure:**
```typescript
// Missing required field
{
  "version": "1.0.0",
  // Missing messageId
  "timestamp": "2025-11-12T10:00:00.000Z",
  "sender": {"agentId": "impl_001", "type": "Implementation"}
}
// Error: E_VALIDATION_001 - Missing required field 'messageId'
```

**Message Too Large:**
```typescript
// Payload exceeds 1 MB
{
  "version": "1.0.0",
  "messageId": "msg_123",
  "payload": {
    "data": "..." // > 1 MB
  }
}
// Error: E_VALIDATION_005 - Message size exceeded limit
```

### 6.2 Deserialization Errors

**Malformed JSON:**
```json
{"version": "1.0.0", "messageId": "msg_123" // Missing closing brace
```
→ Error: `E_PROTOCOL_002: Malformed JSON`

**Invalid UTF-8:**
```
\xFF\xFE... (invalid UTF-8 bytes)
```
→ Error: `E_PROTOCOL_002: Invalid UTF-8 encoding`

**Schema Validation Failed:**
```json
{
  "version": "1.0.0",
  "messageId": "msg_123",
  "timestamp": "not-iso-8601",
  "messageType": "INVALID_TYPE"
}
```
→ Error: `E_VALIDATION_004: Schema validation failed`

---

## 7. TypeScript Type Definitions

### 7.1 Type Export

**Generated from schemas:**
```typescript
// src/protocol/types.ts
export interface MessageEnvelope<T = unknown> {
  version: string;
  messageId: string;
  correlationId?: string;
  timestamp: string;
  sender: AgentIdentifier;
  receiver: AgentIdentifier;
  messageType: MessageType;
  priority: MessagePriority;
  payload: T;
  metadata?: MessageMetadata;
}

export type ProtocolMessage =
  | TaskAssignmentMessage
  | TaskUpdateMessage
  | StateSyncMessage
  | ErrorReportMessage
  | HandoffRequestMessage
  | AckMessage
  | NackMessage;
```

### 7.2 Type Safety

**Compile-time checking:**
```typescript
import { TaskAssignmentMessage, MessageType } from './protocol/types';

const message: TaskAssignmentMessage = {
  version: '1.0.0',
  messageId: generateMessageId(),
  timestamp: new Date().toISOString(),
  sender: { agentId: 'manager_001', type: 'Manager' },
  receiver: { agentId: 'impl_001', type: 'Implementation' },
  messageType: MessageType.TASK_ASSIGNMENT,
  priority: 'HIGH',
  payload: {
    taskId: 'task_3_1',
    taskRef: 'Task 3.1',
    taskDescription: 'Design protocol',
    memoryLogPath: '.apm/Memory/task_3_1.md',
    executionType: 'multi-step'
  }
};
```

**Runtime validation with Zod:**
```typescript
import { TaskAssignmentMessageSchema } from './protocol/schemas';

const result = TaskAssignmentMessageSchema.safeParse(message);
if (result.success) {
  console.log('Valid message:', result.data);
} else {
  console.error('Validation errors:', result.error.errors);
}
```

---

## 8. Examples

### 8.1 Complete Serialization Example

**Message Object:**
```typescript
const message: TaskAssignmentMessage = {
  version: '1.0.0',
  messageId: 'msg_20251112_103045_abc123',
  correlationId: 'req_20251112_103045_xyz789',
  timestamp: '2025-11-12T10:30:45.123Z',
  sender: {
    agentId: 'manager_001',
    type: 'Manager'
  },
  receiver: {
    agentId: 'impl_001',
    type: 'Implementation'
  },
  messageType: 'TASK_ASSIGNMENT',
  priority: 'HIGH',
  payload: {
    taskId: 'task_3_1',
    taskRef: 'Task 3.1 - Protocol Design',
    taskDescription: 'Design comprehensive inter-agent communication protocol',
    memoryLogPath: '.apm/Memory/Phase_03_Communication_Protocol/Task_3_1.md',
    executionType: 'multi-step',
    dependencies: [
      {
        taskId: 'task_2_4',
        status: 'completed',
        outputs: ['config_schema.json']
      }
    ],
    context: {
      relatedFiles: ['src/protocol/types.ts'],
      requiresAdHoc: true,
      estimatedDuration: 3600
    }
  },
  metadata: {
    retryCount: 0,
    ttl: 3600,
    tags: ['protocol', 'design']
  }
};
```

**Serialized (Compact):**
```json
{"version":"1.0.0","messageId":"msg_20251112_103045_abc123","correlationId":"req_20251112_103045_xyz789","timestamp":"2025-11-12T10:30:45.123Z","sender":{"agentId":"manager_001","type":"Manager"},"receiver":{"agentId":"impl_001","type":"Implementation"},"messageType":"TASK_ASSIGNMENT","priority":"HIGH","payload":{"taskId":"task_3_1","taskRef":"Task 3.1 - Protocol Design","taskDescription":"Design comprehensive inter-agent communication protocol","memoryLogPath":".apm/Memory/Phase_03_Communication_Protocol/Task_3_1.md","executionType":"multi-step","dependencies":[{"taskId":"task_2_4","status":"completed","outputs":["config_schema.json"]}],"context":{"relatedFiles":["src/protocol/types.ts"],"requiresAdHoc":true,"estimatedDuration":3600}},"metadata":{"retryCount":0,"ttl":3600,"tags":["protocol","design"]}}
```

**NDJSON (with newline):**
```
{"version":"1.0.0","messageId":"msg_20251112_103045_abc123",...}\n
```

### 8.2 Compressed Message Example

**Large Payload (>10KB):**
```json
{
  "version": "1.0.0",
  "messageId": "msg_123",
  "payload": {
    "data": "... very large data ..."
  }
}
```

**After Compression:**
```json
{
  "compressed": true,
  "data": "H4sIAAAAAAAA/+2dW3LbOBaG9z4F5r0tUZREypLc3ZO0nGRmJskk7mQqVfsCkpBEhiRYACWrKp1n7GP0SfYyWchF5EUkQBKgZMvfVKUsiQTw4wA4OAf49+d/AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOBr8u+vX79+/foVfwEAAAAAAF+h/7x+/Xrz+vXNm7///e9f8BcAAAAAAPD1+c+bN29ubm5u/vGPf+AvAAAAAADga/Gft2/fIi0AAAAAAOAr9p+3b9++efPm7du3b9++/Yq/AgAAAACAr8V/EBYAAAAAAPDVQlgAAAAAAMBXC2EBAAAAAABfLYQFAAAAAAB8tRAWAAAAAADw1UJYAAAAAADAVwthAQAAAAAAXy2EBQAAAAAAfLUQFgAAAAAA8NVCWAAAAAAAwFcLYQEAAAAAAF8thAUAAAAAAHy1EBYAAAAAAPDVQlgAAAAAAMBXC2EBAAAAAABfLYQFAAAAAAB8tRAWAAAAAADw1UJYAAAAAADAVwthAQAAAAAAXy2EBQAAAAAAfLUQFgAAAAAA8NVCWAAAAAAAwFcLYQEAAAAAAF8thAUAAAAAAHy1EBYAAAAAAPDVQlgAAAAAAMBXC2EBAAAAAABfLYQFAAAAAAB8tRAWAAAAAADw1fo/2IjJ8NccAgA="
}
```

---

## 9. Best Practices

### 9.1 Serialization Best Practices

✅ **DO:**
- Use compact JSON (no pretty-printing for production)
- Validate messages before serialization
- Check size limits before writing
- Use UTF-8 encoding exclusively
- Generate unique message IDs
- Include correlation IDs for requests

❌ **DON'T:**
- Pretty-print messages in production logs
- Include sensitive data in plain text
- Exceed 1 MB size limit
- Use non-UTF-8 encoding
- Reuse message IDs
- Omit required fields

### 9.2 Deserialization Best Practices

✅ **DO:**
- Validate schema before processing
- Check protocol version compatibility
- Handle malformed JSON gracefully
- Implement timeout for parsing
- Log validation errors for debugging

❌ **DON'T:**
- Process unvalidated messages
- Ignore version mismatches
- Crash on malformed input
- Block indefinitely on parsing
- Silently ignore validation errors

---

## 10. Summary

This serialization specification defines:

✅ **NDJSON format** for message streams
✅ **UTF-8 encoding** for all messages
✅ **1 MB size limit** with optional compression
✅ **Semantic versioning** for protocol evolution
✅ **TypeScript type definitions** for type safety
✅ **Zod schemas** for runtime validation
✅ **Error codes** for validation failures

**Implementation Files:**
- `src/protocol/types.ts` - TypeScript type definitions
- `src/protocol/schemas.ts` - Zod validation schemas
- `src/protocol/serialization.ts` - Serialization utilities

---

**End of Serialization Specification**
