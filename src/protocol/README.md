# APM Communication Protocol

**Version:** 1.0.0
**Status:** Design Complete - Ready for Implementation

---

## Overview

This directory contains the complete implementation of the APM Communication Protocol, a file-based inter-agent communication system with WebSocket-like semantics designed for coordinating Manager and Implementation agents.

---

## Files

### Type Definitions
- **`types.ts`** - TypeScript type definitions for all message types, enums, and interfaces
  - Message envelopes
  - Payload types for all 7 message types
  - Agent identifiers
  - Type guards and utility types

### Validation Schemas
- **`schemas.ts`** - Zod schemas for runtime validation
  - Message envelope schema
  - Payload schemas for each message type
  - Custom validators for business rules
  - Error code definitions

### Serialization
- **`serialization.ts`** - Serialization and deserialization utilities
  - NDJSON serialization/deserialization
  - Compression support (gzip)
  - Message validation
  - ID generation utilities
  - Message builder helpers

### Entry Point
- **`index.ts`** - Main export file
  - Re-exports all types, schemas, and utilities
  - Protocol version information
  - Protocol metadata

---

## Usage

### Installation

```bash
# Install dependencies (Zod for validation)
npm install zod
# or
pnpm add zod
```

### Basic Usage

```typescript
import {
  MessageType,
  AgentType,
  TaskAssignmentPayload,
  createMessageEnvelope,
  serializeMessage,
  deserializeMessage,
  validateMessage
} from './protocol';

// Create a message
const payload: TaskAssignmentPayload = {
  taskId: 'task_3_1',
  taskRef: 'Task 3.1 - Protocol Design',
  taskDescription: 'Design communication protocol',
  memoryLogPath: '.apm/Memory/task_3_1.md',
  executionType: 'multi-step'
};

const message = createMessageEnvelope(
  MessageType.TASK_ASSIGNMENT,
  { agentId: 'manager_001', type: 'Manager' },
  { agentId: 'impl_001', type: 'Implementation' },
  payload,
  {
    correlationId: 'req_123',
    priority: 'HIGH'
  }
);

// Validate message
const validation = validateMessage(message);
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}

// Serialize to NDJSON
const ndjson = serializeMessage(message);
console.log('Serialized:', ndjson);

// Deserialize from NDJSON
const result = deserializeMessage(ndjson);
if (result.success) {
  console.log('Deserialized:', result.message);
} else {
  console.error('Deserialization error:', result.error);
}
```

### Message Types

The protocol supports 7 message types:

1. **TASK_ASSIGNMENT** - Manager → Implementation (assign task)
2. **TASK_UPDATE** - Implementation → Manager (report progress)
3. **STATE_SYNC** - Bi-directional (synchronize state)
4. **ERROR_REPORT** - Any → Manager (report errors)
5. **HANDOFF_REQUEST** - Agent → Agent (task handoff)
6. **ACK** - Receiver → Sender (acknowledge)
7. **NACK** - Receiver → Sender (reject)

### Validation

```typescript
import { validateMessage, ValidationResult } from './protocol';

const validation: ValidationResult = validateMessage(message);

if (validation.valid) {
  // Process message
} else {
  // Handle validation errors
  validation.errors?.forEach(error => {
    console.error(`${error.code}: ${error.message}`);
    if (error.field) {
      console.error(`  Field: ${error.field}`);
    }
    if (error.suggestions) {
      console.error(`  Suggestions: ${error.suggestions.join(', ')}`);
    }
  });
}
```

### Type Guards

```typescript
import {
  isTaskAssignmentMessage,
  isTaskUpdateMessage,
  ProtocolMessage
} from './protocol';

function handleMessage(message: ProtocolMessage) {
  if (isTaskAssignmentMessage(message)) {
    // TypeScript knows message is TaskAssignmentMessage
    console.log('Task ID:', message.payload.taskId);
  } else if (isTaskUpdateMessage(message)) {
    // TypeScript knows message is TaskUpdateMessage
    console.log('Progress:', message.payload.progress);
  }
}
```

---

## Specifications

Detailed specifications are available in `.apm/specs/`:

- **`protocol-specification-draft.md`** - Complete protocol specification
  - Message types and payload schemas
  - Routing rules
  - Message lifecycle states
  - Protocol versioning
  - Performance characteristics

- **`serialization-specification.md`** - Serialization format specification
  - NDJSON format rules
  - UTF-8 encoding requirements
  - Size constraints and compression
  - Schema versioning
  - Error handling

---

## Message Format

### Envelope Structure

All messages conform to this envelope:

```typescript
{
  version: string;           // "1.0.0"
  messageId: string;        // "msg_20251112_103045_abc123"
  correlationId?: string;   // "req_xyz789" (optional)
  timestamp: string;        // "2025-11-12T10:30:45.123Z"
  sender: {
    agentId: string;       // "manager_001"
    type: AgentType;       // "Manager"
  };
  receiver: {
    agentId: string;       // "impl_001" or "*" for broadcast
    type: AgentType;       // "Implementation"
  };
  messageType: MessageType; // "TASK_ASSIGNMENT"
  priority: MessagePriority; // "HIGH" | "NORMAL" | "LOW"
  payload: T;               // Message-specific payload
  metadata?: {              // Optional metadata
    retryCount?: number;
    ttl?: number;
    tags?: string[];
  };
}
```

### Serialization Format

**NDJSON (Newline-Delimited JSON):**
- One JSON object per line
- Lines separated by `\n`
- UTF-8 encoding
- Max size: 1 MB
- Optional gzip compression for payloads > 10 KB

```ndjson
{"version":"1.0.0","messageId":"msg_001",...}\n
{"version":"1.0.0","messageId":"msg_002",...}\n
```

---

## Error Codes

### Validation Errors (E_VALIDATION_xxx)

- `E_VALIDATION_001` - Missing required field
- `E_VALIDATION_002` - Invalid field type
- `E_VALIDATION_003` - Invalid enum value
- `E_VALIDATION_004` - Schema validation failed
- `E_VALIDATION_005` - Message size exceeded limit (1MB)

### Protocol Errors (E_PROTOCOL_xxx)

- `E_PROTOCOL_001` - Unsupported protocol version
- `E_PROTOCOL_002` - Malformed JSON
- `E_PROTOCOL_003` - Invalid correlation ID
- `E_PROTOCOL_004` - Message timeout

### Routing Errors (E_ROUTING_xxx)

- `E_ROUTING_001` - Agent not found
- `E_ROUTING_002` - Invalid receiver specification
- `E_ROUTING_003` - Channel unavailable
- `E_ROUTING_004` - Broadcast failed (partial)

---

## Design Principles

1. **File-Based Architecture** - Messages persisted as NDJSON logs
2. **At-Least-Once Delivery** - Retries with exponential backoff
3. **Correlation IDs** - Request-response pairing
4. **Schema Validation** - Runtime validation with Zod
5. **Type Safety** - TypeScript types for compile-time checking
6. **Versioning** - Semantic versioning with compatibility guarantees
7. **Debuggability** - Human-readable NDJSON format

---

## Performance Characteristics

- **Latency:** 50-200ms end-to-end (file-watching mode)
- **Throughput:** ~100 messages/second per channel
- **Message Size:** Up to 1 MB uncompressed
- **Scalability:** Up to 50 agents per Manager

---

## Next Steps

**Implementation Tasks:**

1. **Task 3.2** - Message Routing Implementation
   - Channel management
   - File watching
   - Message delivery

2. **Task 3.3** - Validation Framework
   - Error handling
   - Dead letter queue
   - Retry logic

3. **Task 3.4** - Protocol Documentation
   - Sequence diagrams
   - Integration tests
   - Usage examples

---

## References

- Research findings: `.apm/research/communication-patterns-research.md`
- Protocol spec: `.apm/specs/protocol-specification-draft.md`
- Serialization spec: `.apm/specs/serialization-specification.md`

---

**Protocol Design Complete - Ready for Implementation**
