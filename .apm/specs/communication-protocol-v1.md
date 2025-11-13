# APM Communication Protocol Specification v1.0.0

**Version:** 1.0.0
**Status:** Final
**Date:** 2025-11-12
**Authors:** APM Development Team

---

## Table of Contents

1. [Protocol Overview](#1-protocol-overview)
2. [Message Type Catalog](#2-message-type-catalog)
3. [Routing Algorithm Specification](#3-routing-algorithm-specification)
4. [Acknowledgment Semantics](#4-acknowledgment-semantics)
5. [Error Handling Procedures](#5-error-handling-procedures)
6. [Sequence Diagrams](#6-sequence-diagrams)
7. [Performance Characteristics](#7-performance-characteristics)
8. [Extension Points](#8-extension-points)
9. [Test Scenarios](#9-test-scenarios)
10. [Implementation Reference](#10-implementation-reference)

---

## 1. Protocol Overview

### 1.1 Goals and Design Principles

The APM Communication Protocol enables file-based inter-agent communication with WebSocket-like semantics for coordinating Manager and Implementation agents in the Agentic Project Management system.

**Design Goals:**
- ✅ **Durability:** Crash-safe message persistence
- ✅ **Reliability:** At-least-once delivery guarantees
- ✅ **Debuggability:** Human-readable message logs
- ✅ **Simplicity:** File-based, no external dependencies
- ✅ **Performance:** Low latency (50-200ms), high throughput (~100 msg/s)
- ✅ **Type Safety:** Strong typing with TypeScript

**Design Principles:**
1. **File-Based Architecture:** Messages persisted as NDJSON logs
2. **Event-Driven:** File watching for low-latency delivery
3. **Append-Only:** Immutable message logs (Kafka-inspired)
4. **Correlation IDs:** Request-response pairing over one-way channels
5. **Dual Channels:** Bidirectional communication via separate logs

### 1.2 Scope

**In Scope:**
- Manager ↔ Implementation agent coordination
- Task assignment and progress tracking
- State synchronization
- Error reporting and recovery
- Cross-agent task handoff
- Message acknowledgment

**Out of Scope:**
- Multi-manager coordination (v2.0.0+)
- Real-time streaming (not required for agent coordination)
- Encryption/authentication (v2.0.0+)
- External system integration

### 1.3 Architectural Context

```
APM System Architecture
┌─────────────────────────────────────────────────────┐
│                                                     │
│  ┌──────────┐              ┌──────────────────┐   │
│  │ Manager  │◄────────────►│ Implementation   │   │
│  │ Agent    │   Protocol   │ Agent (impl_001) │   │
│  │          │   Messages   │                  │   │
│  └────┬─────┘              └──────────────────┘   │
│       │                                            │
│       │                    ┌──────────────────┐   │
│       └───────────────────►│ Implementation   │   │
│          Protocol          │ Agent (impl_002) │   │
│          Messages          │                  │   │
│                            └──────────────────┘   │
│                                                     │
│  File System (.apm/channels/)                      │
│  ┌───────────────────────────────────────────┐    │
│  │ manager_to_impl_001/messages.ndjson       │    │
│  │ impl_001_to_manager/messages.ndjson       │    │
│  │ manager_to_impl_002/messages.ndjson       │    │
│  │ impl_002_to_manager/messages.ndjson       │    │
│  └───────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

**Communication Model:**
- **Dual-channel:** Each agent pair has two unidirectional channels
- **Single writer:** Each channel has one writer (no locking conflicts)
- **Multiple readers:** Any agent can read any channel (with permissions)
- **Persistent:** Messages survive agent crashes
- **Ordered:** Strict ordering within each channel

---

## 2. Message Type Catalog

### 2.1 Message Type Summary

| Type | Direction | Purpose | ACK Required | Correlation Required |
|------|-----------|---------|--------------|---------------------|
| **TASK_ASSIGNMENT** | Manager → Impl | Assign task | Yes | Yes (new) |
| **TASK_UPDATE** | Impl → Manager | Report progress | Optional | Yes (matches) |
| **STATE_SYNC** | Bi-directional | Sync state | Recommended | Optional |
| **ERROR_REPORT** | Any → Manager | Report error | Yes | Optional |
| **HANDOFF_REQUEST** | Agent → Agent | Request handoff | Yes | Yes (new) |
| **ACK** | Receiver → Sender | Acknowledge | No | Yes (matches) |
| **NACK** | Receiver → Sender | Reject | No | Yes (matches) |

### 2.2 TASK_ASSIGNMENT

**Purpose:** Manager assigns a new task to an Implementation agent.

**Direction:** Manager → Implementation

**Envelope:**
```json
{
  "version": "1.0.0",
  "messageId": "msg_20251112_100000_001",
  "correlationId": "req_task_3_1",
  "timestamp": "2025-11-12T10:00:00.000Z",
  "sender": {
    "agentId": "manager_001",
    "type": "Manager"
  },
  "receiver": {
    "agentId": "impl_001",
    "type": "Implementation"
  },
  "messageType": "TASK_ASSIGNMENT",
  "priority": "HIGH",
  "payload": { /* see below */ }
}
```

**Payload Schema:**
```typescript
{
  taskId: string;              // "task_3_1"
  taskRef: string;             // "Task 3.1 - Protocol Design"
  taskDescription: string;     // Detailed instructions
  memoryLogPath: string;       // ".apm/Memory/Phase_03/.../Task_3_1.md"
  executionType: "single-step" | "multi-step";
  dependencies?: Array<{       // Optional dependencies
    taskId: string;
    status: TaskStatus;
    outputs?: string[];
  }>;
  context?: {                  // Optional context
    relatedFiles?: string[];
    requiresAdHoc?: boolean;
    estimatedDuration?: number;
  };
}
```

**Usage:**
```typescript
const assignment: TaskAssignmentMessage = {
  version: "1.0.0",
  messageId: generateMessageId(),
  correlationId: generateCorrelationId(),
  timestamp: getCurrentTimestamp(),
  sender: { agentId: "manager_001", type: "Manager" },
  receiver: { agentId: "impl_001", type: "Implementation" },
  messageType: "TASK_ASSIGNMENT",
  priority: "HIGH",
  payload: {
    taskId: "task_3_1",
    taskRef: "Task 3.1 - Protocol Design & Specification",
    taskDescription: "Design comprehensive inter-agent communication protocol...",
    memoryLogPath: ".apm/Memory/Phase_03_Communication_Protocol/Task_3_1.md",
    executionType: "multi-step",
    context: {
      requiresAdHoc: true,
      estimatedDuration: 3600
    }
  }
};
```

**Expected Response:** ACK with status "received" or "queued"

### 2.3 TASK_UPDATE

**Purpose:** Implementation agent reports task progress to Manager.

**Direction:** Implementation → Manager

**Payload Schema:**
```typescript
{
  taskId: string;              // "task_3_1" (matches assignment)
  progress: number;            // 0.0 to 1.0
  status: "in_progress" | "blocked" | "pending_review" | "completed" | "failed";
  currentStep?: string;        // "Step 2 - Protocol Specification Design"
  notes?: string;              // Progress notes
  filesModified?: string[];    // [".apm/specs/protocol-spec.md"]
  blockers?: Array<{           // If status = "blocked"
    type: string;
    description: string;
    severity: "critical" | "high" | "medium" | "low";
  }>;
  estimatedCompletion?: string; // ISO 8601 timestamp
}
```

**Usage:**
```typescript
const update: TaskUpdateMessage = {
  version: "1.0.0",
  messageId: generateMessageId(),
  correlationId: "req_task_3_1", // Matches TASK_ASSIGNMENT
  timestamp: getCurrentTimestamp(),
  sender: { agentId: "impl_001", type: "Implementation" },
  receiver: { agentId: "manager_001", type: "Manager" },
  messageType: "TASK_UPDATE",
  priority: "NORMAL",
  payload: {
    taskId: "task_3_1",
    progress: 0.5,
    status: "in_progress",
    currentStep: "Step 2 - Protocol Specification Design",
    filesModified: [".apm/specs/protocol-specification-draft.md"],
    notes: "Completed research phase, designing message types"
  }
};
```

### 2.4 STATE_SYNC

**Purpose:** Synchronize state changes between agents.

**Direction:** Bi-directional

**Payload Schema:**
```typescript
{
  entityType: "agent" | "task" | "memory_log" | "configuration";
  entityId: string;            // Unique entity identifier
  operation: "create" | "update" | "delete";
  state: Record<string, unknown>; // Current state
  previousState?: Record<string, unknown>; // For updates
  syncTimestamp: string;       // ISO 8601
}
```

**Usage - Agent Heartbeat:**
```typescript
const heartbeat: StateSyncMessage = {
  version: "1.0.0",
  messageId: generateMessageId(),
  timestamp: getCurrentTimestamp(),
  sender: { agentId: "impl_001", type: "Implementation" },
  receiver: { agentId: "manager_001", type: "Manager" },
  messageType: "STATE_SYNC",
  priority: "LOW",
  payload: {
    entityType: "agent",
    entityId: "impl_001",
    operation: "update",
    state: {
      status: "healthy",
      lastHeartbeat: getCurrentTimestamp(),
      tasksInProgress: 1,
      memoryUsageMB: 512
    },
    syncTimestamp: getCurrentTimestamp()
  }
};
```

### 2.5 ERROR_REPORT

**Purpose:** Report errors or failures to Manager for coordination.

**Direction:** Any → Manager (typically)

**Payload Schema:**
```typescript
{
  errorType: string;           // "TaskFailure", "ValidationError", etc.
  errorCode?: string;          // "E_TASK_003"
  errorMessage: string;        // Human-readable description
  severity: "critical" | "high" | "medium" | "low";
  context?: {                  // Error context
    taskId?: string;
    step?: string;
    file?: string;
    line?: number;
  };
  stackTrace?: string;
  recoverable?: boolean;
  suggestedAction?: string;
  metadata?: Record<string, unknown>;
}
```

**Usage:**
```typescript
const errorReport: ErrorReportMessage = {
  version: "1.0.0",
  messageId: generateMessageId(),
  correlationId: "req_task_3_1", // Optional - if error relates to task
  timestamp: getCurrentTimestamp(),
  sender: { agentId: "impl_001", type: "Implementation" },
  receiver: { agentId: "manager_001", type: "Manager" },
  messageType: "ERROR_REPORT",
  priority: "HIGH",
  payload: {
    errorType: "TaskFailure",
    errorCode: "E_TASK_003",
    errorMessage: "Test suite failed with 3 failures",
    severity: "high",
    context: {
      taskId: "task_3_1",
      step: "Step 4",
      file: "src/protocol/validator.ts"
    },
    recoverable: true,
    suggestedAction: "Review test failures and fix validation logic",
    metadata: {
      failedTests: ["test_message_validation", "test_routing", "test_ack"]
    }
  }
};
```

### 2.6 HANDOFF_REQUEST

**Purpose:** Request task handoff to another agent (e.g., context window limit).

**Direction:** Agent → Agent

**Payload Schema:**
```typescript
{
  taskId: string;
  reason: "context_window_limit" | "specialization_required" | "load_balancing";
  sourceAgent: {
    agentId: string;
    type: AgentType;
  };
  targetAgent: {
    agentId: string;
    type: AgentType;
  };
  handoffContext: {
    completedSteps: string[];
    currentStep: string;
    memoryLogPath: string;
    stateSnapshot: {
      filesCreated?: string[];
      pendingActions?: string[];
    };
  };
}
```

### 2.7 ACK

**Purpose:** Acknowledge message receipt and processing status.

**Direction:** Receiver → Sender

**Payload Schema:**
```typescript
{
  acknowledgedMessageId: string; // ID of message being ACKed
  status: "received" | "processed" | "queued";
  timestamp: string;             // ISO 8601
  processingTime?: number;       // Milliseconds
  notes?: string;
}
```

**Usage:**
```typescript
const ack: AckMessage = {
  version: "1.0.0",
  messageId: generateMessageId(),
  correlationId: "req_task_3_1", // Matches original request
  timestamp: getCurrentTimestamp(),
  sender: { agentId: "impl_001", type: "Implementation" },
  receiver: { agentId: "manager_001", type: "Manager" },
  messageType: "ACK",
  priority: "NORMAL",
  payload: {
    acknowledgedMessageId: "msg_20251112_100000_001",
    status: "received",
    timestamp: getCurrentTimestamp(),
    processingTime: 50
  }
};
```

### 2.8 NACK

**Purpose:** Reject message with reason and suggested fix.

**Direction:** Receiver → Sender

**Payload Schema:**
```typescript
{
  rejectedMessageId: string;
  reason: string;               // Human-readable rejection reason
  timestamp: string;            // ISO 8601
  errorCode?: string;           // "E_VALIDATION_001"
  canRetry?: boolean;           // true if sender can retry after fix
  suggestedFix?: string;        // Actionable guidance
}
```

**Usage:**
```typescript
const nack: NackMessage = {
  version: "1.0.0",
  messageId: generateMessageId(),
  correlationId: "req_task_3_1",
  timestamp: getCurrentTimestamp(),
  sender: { agentId: "impl_001", type: "Implementation" },
  receiver: { agentId: "manager_001", type: "Manager" },
  messageType: "NACK",
  priority: "NORMAL",
  payload: {
    rejectedMessageId: "msg_20251112_100000_001",
    reason: "Schema validation failed: missing required field 'taskId'",
    errorCode: "E_VALIDATION_001",
    timestamp: getCurrentTimestamp(),
    canRetry: true,
    suggestedFix: "Add 'taskId' field to TASK_ASSIGNMENT payload"
  }
};
```

---

## 3. Routing Algorithm Specification

### 3.1 Channel Structure

**Directory Layout:**
```
.apm/channels/
├── manager_to_impl_001/
│   ├── messages.ndjson      # Manager → impl_001 messages
│   ├── acks.ndjson          # impl_001 → Manager ACKs (optional)
│   └── heartbeat.json       # impl_001 heartbeat (atomic updates)
├── impl_001_to_manager/
│   ├── messages.ndjson      # impl_001 → Manager messages
│   ├── acks.ndjson          # Manager → impl_001 ACKs (optional)
│   └── heartbeat.json       # Manager heartbeat (atomic updates)
└── ...
```

### 3.2 Routing Modes

#### 3.2.1 Direct Routing (Unicast)

**Rule:** Explicit receiver.agentId

**Algorithm:**
```
1. Validate receiver.agentId is not "*"
2. Lookup agent in registry by agentId
3. If not found:
   a. Send ERROR_REPORT to sender (E_ROUTING_001)
   b. Log routing failure
   c. STOP
4. Determine channel path:
   channel = `.apm/channels/{sender_id}_to_{receiver_id}/`
5. Write message to channel:
   a. Open `{channel}/messages.ndjson` in append mode
   b. Acquire file lock (fcntl.flock)
   c. Serialize message to NDJSON
   d. Write + flush
   e. fsync (if critical message)
   f. Release lock
6. Update message tracker:
   a. Set state = IN_TRANSIT
   b. Start timeout timer
7. Return success
```

**Example:**
```typescript
// Message routing
const message = {
  sender: { agentId: "manager_001", type: "Manager" },
  receiver: { agentId: "impl_001", type: "Implementation" },
  ...
};

// Routes to: .apm/channels/manager_001_to_impl_001/messages.ndjson
```

#### 3.2.2 Broadcast Routing (Multicast)

**Rule:** receiver.agentId = "*"

**Algorithm:**
```
1. Validate receiver.agentId === "*"
2. Query agent registry for all active agents
3. Filter by receiver.type if not "*":
   - If receiver.type = "Implementation", get all Implementation agents
   - If receiver.type = "*", get all agents
4. For each target agent:
   a. Create copy of message with specific receiver.agentId
   b. Route using direct routing algorithm
   c. Track delivery status per agent
5. If any delivery fails:
   a. Send ERROR_REPORT with failed agents list (E_ROUTING_004)
   b. Mark broadcast as partial success
6. Return broadcast result:
   - totalTargets: N
   - successfulDeliveries: M
   - failedDeliveries: N - M
```

**Example:**
```typescript
// Broadcast to all Implementation agents
const broadcast = {
  sender: { agentId: "manager_001", type: "Manager" },
  receiver: { agentId: "*", type: "Implementation" },
  messageType: "STATE_SYNC",
  payload: { /* shutdown notice */ }
};

// Routes to:
// - .apm/channels/manager_001_to_impl_001/messages.ndjson
// - .apm/channels/manager_001_to_impl_002/messages.ndjson
// - .apm/channels/manager_001_to_impl_003/messages.ndjson
```

#### 3.2.3 Type-Based Routing

**Rule:** receiver.type specifies agent type

**Algorithm:**
```
1. Query registry for agents matching receiver.type
2. If receiver.agentId = "*":
   - Route to all agents of specified type (broadcast)
3. Else:
   - Route to specific agent of specified type (direct)
```

### 3.3 Priority Handling

**Priority Levels:**
- **HIGH:** Process immediately (critical errors, urgent assignments)
- **NORMAL:** Standard queue order (regular updates, state sync)
- **LOW:** Process after normal (background sync, housekeeping)

**Implementation Options:**

**Option 1: Separate Priority Files**
```
.apm/channels/manager_to_impl_001/
├── messages_high.ndjson
├── messages_normal.ndjson
└── messages_low.ndjson
```

**Option 2: Single File with Consumer Prioritization**
```typescript
function consumeMessages(channel: string): Message[] {
  const all = readAllMessages(channel);

  // Sort by priority then timestamp
  return all.sort((a, b) => {
    const priorityOrder = { HIGH: 0, NORMAL: 1, LOW: 2 };
    const aPri = priorityOrder[a.priority];
    const bPri = priorityOrder[b.priority];

    if (aPri !== bPri) return aPri - bPri;
    return a.timestamp.localeCompare(b.timestamp);
  });
}
```

**Recommended:** Option 2 (single file, consumer prioritization) for simplicity.

### 3.4 Routing Failure Handling

**Agent Not Found (E_ROUTING_001):**
```
1. Log error with agent ID
2. Send ERROR_REPORT to sender
3. Do NOT retry
4. Move message to DLQ
```

**Channel Unavailable (E_ROUTING_003):**
```
1. Retry up to 3 times with exponential backoff (1s, 2s, 4s)
2. If all retries fail:
   a. Send ERROR_REPORT to sender
   b. Move message to DLQ
```

**Invalid Receiver (E_ROUTING_002):**
```
1. Send NACK to sender with error details
2. Log validation error
3. Do NOT retry
```

---

## 4. Acknowledgment Semantics

### 4.1 ACK/NACK Protocol

**Acknowledgment Flow:**
```
Sender                    Receiver
  |                          |
  |-- Message (msg_001) ---->|
  |                          | (Validate)
  |                          | (Process)
  |<---- ACK (msg_001) ------|
  |                          |
```

**Negative Acknowledgment Flow:**
```
Sender                    Receiver
  |                          |
  |-- Message (msg_001) ---->|
  |                          | (Validate)
  |                          | X (Validation failed)
  |<--- NACK (msg_001) ------|
  |                          |
```

### 4.2 ACK Types

| Status | Meaning | Receiver Action |
|--------|---------|-----------------|
| **received** | Message received, queued | Message in queue, not yet processed |
| **processed** | Message processed | Processing complete |
| **queued** | Message queued for async processing | Will process later |

### 4.3 Timeout Behavior

**Timeout Table:**

| Message Type | ACK Timeout | Max Retries | Backoff |
|-------------|-------------|-------------|---------|
| TASK_ASSIGNMENT | 30s | 3 | 1s, 2s, 4s |
| TASK_UPDATE | 15s | 2 | 1s, 2s |
| STATE_SYNC | 10s | 2 | 1s, 2s |
| ERROR_REPORT | 30s | 3 | 1s, 2s, 4s |
| HANDOFF_REQUEST | 60s | 2 | 2s, 4s |
| ACK | N/A | 0 | None (fire-and-forget) |
| NACK | N/A | 0 | None (fire-and-forget) |

**Timeout Handling:**
```typescript
class MessageSender {
  async sendWithAck(message: ProtocolMessage): Promise<AckMessage> {
    const timeout = getTimeout(message.messageType);

    // Send message
    await writeToChannel(message);

    // Wait for ACK
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`ACK timeout after ${timeout}ms`));
      }, timeout);

      // Listen for ACK
      this.on('ack', (ack: AckMessage) => {
        if (ack.payload.acknowledgedMessageId === message.messageId) {
          clearTimeout(timer);
          resolve(ack);
        }
      });
    });
  }
}
```

### 4.4 Delivery Guarantees

**At-Least-Once Delivery:**
- Messages may be delivered multiple times (due to retries)
- Receivers MUST implement idempotent handlers
- No messages lost (barring catastrophic failures)

**Idempotency Pattern:**
```typescript
const processedMessageIds = new Set<string>();

function handleMessage(message: ProtocolMessage): void {
  // Deduplication check
  if (processedMessageIds.has(message.messageId)) {
    console.log(`Duplicate message ${message.messageId}, skipping`);
    sendAck(message.messageId); // Still ACK
    return;
  }

  // Process message
  processTask(message.payload);

  // Mark as processed
  processedMessageIds.add(message.messageId);
  persistProcessedIds(); // Persist to survive crashes

  // Send ACK
  sendAck(message.messageId);
}
```

---

## 5. Error Handling Procedures

### 5.1 Three-Level Validation

**All messages undergo three validation levels:**

```
┌─────────────────────────┐
│ Level 1: Syntax         │ Valid UTF-8 JSON?
│ (Malformed detection)   │
└──────────┬──────────────┘
           │ Pass
           ↓
┌─────────────────────────┐
│ Level 2: Schema         │ Conforms to schema?
│ (Structure validation)  │
└──────────┬──────────────┘
           │ Pass
           ↓
┌─────────────────────────┐
│ Level 3: Semantic       │ Business rules OK?
│ (Business rules)        │
└──────────┬──────────────┘
           │ Pass
           ↓
      Process Message
```

**Validation Actions:**

| Level | Failure Action | Error Code |
|-------|----------------|------------|
| **Syntax** | Move to DLQ, do NOT proceed | E_PROTOCOL_002 |
| **Schema** | Send NACK, optionally retry | E_VALIDATION_00X |
| **Semantic** | Send NACK with business rule | E_VALIDATION_009 or E_PROTOCOL_00X |

### 5.2 Retry Policy

**Exponential Backoff Formula:**
```
delay = min(baseDelay × (2 ^ retryCount), maxDelay)
```

**Example (TASK_ASSIGNMENT: base=1000ms, max=8000ms):**
```
Attempt 1: 1000ms
Attempt 2: 2000ms
Attempt 3: 4000ms
Attempt 4: 8000ms (capped at maxDelay)
```

**Retry Decision Flow:**
```
Send Failed
    ↓
Circuit Breaker OPEN? ──Yes──> Move to DLQ
    │ No
    ↓
Recoverable Error? ──No──> Move to DLQ
    │ Yes
    ↓
Retry < Max? ──No──> Move to DLQ
    │ Yes
    ↓
Apply Backoff → Retry Send
```

### 5.3 Dead Letter Queue (DLQ)

**DLQ Structure:**
```
.apm/dlq/
├── failed_msg_20251112_100000_001_1731413400000.json
├── failed_msg_20251112_100001_002_1731413401000.json
├── malformed_1731413402000.json
└── ...
```

**DLQ Entry Format:**
```json
{
  "timestamp": "2025-11-12T10:00:00.000Z",
  "reason": "Max retries exceeded",
  "error": {
    "code": "E_ROUTING_003",
    "message": "Channel unavailable",
    "suggestions": ["Check filesystem permissions", "Verify channel exists"]
  },
  "originalMessage": { /* full message */ }
}
```

**DLQ Operations:**
- **Write:** Automatic on permanent failure
- **Monitor:** Check size periodically, alert if >10
- **Reprocess:** Manual retry after fixing issue
- **Archive:** Move entries >30 days to archive
- **Cleanup:** Delete archived entries >90 days

### 5.4 Circuit Breaker

**Purpose:** Prevent cascading failures

**States:**
```
CLOSED (normal) ──(5 failures)──> OPEN (fail fast)
     ↑                                  │
     │                             (60s timeout)
     │                                  ↓
     └──(success)── HALF_OPEN (test) <──┘
```

**Behavior:**
- **CLOSED:** Process normally, track failures
- **OPEN:** Reject immediately, move to DLQ
- **HALF_OPEN:** Allow one test message

---

## 6. Sequence Diagrams

### 6.1 Task Assignment Flow

```
Manager                 Channel                  Implementation
   │                       │                            │
   │                       │                            │
   │──TASK_ASSIGNMENT──>│                            │
   │  (msg_001)          │                            │
   │                       │                            │
   │                       │──file watch event──>│
   │                       │                            │
   │                       │<──read messages───────│
   │                       │                            │
   │                       │                            │ (Validate)
   │                       │                            │ (Queue task)
   │<──────────────────ACK (msg_001)─────────────│
   │                       │                            │
   │                       │                            │ (Process task)
   │<──────────────TASK_UPDATE (progress=0.3)──│
   │                       │                            │
   │<──────────────TASK_UPDATE (progress=0.6)──│
   │                       │                            │
   │<──────────────TASK_UPDATE (progress=1.0)──│
   │                       │                   (status=completed)
```

### 6.2 Error Reporting Flow

```
Implementation          Channel                  Manager
       │                   │                         │
       │                   │                         │
       │  (Error occurs)   │                         │
       │──ERROR_REPORT──>│                         │
       │  (msg_002)        │                         │
       │                   │──file watch──>│
       │                   │                         │
       │                   │<──read───────────│
       │                   │                         │
       │                   │                         │ (Analyze error)
       │                   │                         │ (Decide action)
       │<──────────────────ACK (msg_002)──────│
       │                   │                         │
       │<─────────retry or reassign task──────│
```

### 6.3 Handoff Flow

```
Impl_001            Manager            Impl_002
   │                   │                   │
   │                   │                   │
   │──HANDOFF_REQ──>│                   │
   │ (context_limit)   │                   │
   │                   │                   │
   │<────ACK─────────│                   │
   │                   │                   │
   │                   │──TASK_ASSIGN──>│
   │                   │  (with context)   │
   │                   │                   │
   │                   │<──────ACK───────│
   │                   │                   │
   │                   │<──TASK_UPDATE───│
   │                   │  (continuing)     │
```

### 6.4 Broadcast Flow

```
Manager               impl_001    impl_002    impl_003
   │                     │           │           │
   │                     │           │           │
   │──STATE_SYNC────>│           │           │
   │  (broadcast)        │           │           │
   ├───────────────────>│           │
   ├───────────────────────────>│
   ├───────────────────────────────────>│
   │                     │           │           │
   │<────ACK─────────────│           │           │
   │<──────────ACK───────────────│           │
   │<────────────ACK─────────────────────│
```

### 6.5 Retry with Exponential Backoff

```
Sender                                    Receiver
   │                                          │
   │────msg_001──────────X (channel error)   │
   │                                          │
   │ (wait 1s)                                │
   │────msg_001──────────X (channel error)   │
   │                                          │
   │ (wait 2s)                                │
   │────msg_001──────────X (channel error)   │
   │                                          │
   │ (wait 4s)                                │
   │────msg_001──────────────────────────>│
   │                                          │
   │<──────────────ACK─────────────────────│
```

---

## 7. Performance Characteristics

### 7.1 Latency

**End-to-End Latency (File Watching Mode):**

| Operation | Latency | Breakdown |
|-----------|---------|-----------|
| **Message Send** | 5-10ms | File write + flush |
| **File Watch Notification** | 10-50ms | OS kernel delay |
| **Message Read** | 5-10ms | File read + parse |
| **Total End-to-End** | 50-200ms | Send + notify + read |
| **ACK Roundtrip** | 100-400ms | Send + receive + ACK + receive |

**Polling Mode Latency:**
- Poll interval: 100-1000ms
- Total latency: interval + processing time

### 7.2 Throughput

**Per-Channel Throughput:**

| Write Mode | Messages/Second | Notes |
|------------|-----------------|-------|
| **With fsync** | ~100 msg/s | Durable, slow |
| **Buffered (no fsync)** | ~500 msg/s | Some risk of loss |
| **No flush** | ~1000 msg/s | High risk, not recommended |

**System-Wide Throughput:**
- Scales linearly with channels
- 10 agents × 100 msg/s = 1000 msg/s total

**Bottlenecks:**
- Disk I/O bandwidth
- File locking contention (minimal with single writer)
- JSON parsing CPU

### 7.3 Scalability

**Vertical Scaling (Single Manager):**
- Up to 50 Implementation agents
- Beyond 50: manager becomes bottleneck
- Mitigation: Message batching, async processing

**Resource Usage:**

| Resource | Usage | Notes |
|----------|-------|-------|
| **Disk (per channel/day)** | ~24MB | 1000 msg/hr × 1KB/msg |
| **Memory (per pending msg)** | ~100 bytes | Tracker overhead |
| **CPU (file watching)** | <1% | Kernel-managed |
| **CPU (polling)** | 1-5% | Depends on interval |

### 7.4 Performance Optimization

**Recommendations:**

1. **Use File Watching:** 10-50ms vs 100-1000ms polling
2. **Batch ACKs:** Send one ACK for multiple messages (optional)
3. **Log Rotation:** Daily rotation to keep logs <10MB
4. **Compression:** Enable for payloads >10KB
5. **Message Prioritization:** Process HIGH priority first

---

## 8. Extension Points

### 8.1 Adding New Message Types

**Process:**

1. **Define Message Type Constant:**
```typescript
export enum MessageType {
  // ... existing types
  DIAGNOSTIC_REQUEST = 'DIAGNOSTIC_REQUEST'
}
```

2. **Define Payload Interface:**
```typescript
export interface DiagnosticRequestPayload {
  diagnosticType: 'health' | 'performance' | 'memory';
  includeMetrics: boolean;
}
```

3. **Create Zod Schema:**
```typescript
export const DiagnosticRequestPayloadSchema = z.object({
  diagnosticType: z.enum(['health', 'performance', 'memory']),
  includeMetrics: z.boolean()
});
```

4. **Update Message Schema Map:**
```typescript
export const MessageSchemaMap = {
  // ... existing
  [MessageType.DIAGNOSTIC_REQUEST]: DiagnosticRequestMessageSchema
};
```

5. **Document in Specification:**
- Add to Message Type Catalog (§2)
- Specify routing rules
- Define ACK requirements

6. **Version Bump:**
- Increment MINOR version: 1.0.0 → 1.1.0

### 8.2 Adding Optional Fields

**Backward-Compatible Field Addition:**

```typescript
// v1.0.0
interface TaskAssignmentPayload {
  taskId: string;
  taskDescription: string;
  memoryLogPath: string;
  executionType: ExecutionType;
}

// v1.1.0 (backward compatible)
interface TaskAssignmentPayload {
  taskId: string;
  taskDescription: string;
  memoryLogPath: string;
  executionType: ExecutionType;
  estimatedComplexity?: 'low' | 'medium' | 'high'; // New optional field
}
```

**Requirements:**
- Field MUST be optional
- Old agents ignore new field
- New agents provide default if absent
- Version bump: MINOR (1.0.0 → 1.1.0)

### 8.3 Custom Payload Schemas

**Agents can define custom message types for specialized needs:**

```typescript
// Custom message type
const customMessage: MessageEnvelope<CustomPayload> = {
  version: "1.0.0",
  messageId: generateMessageId(),
  timestamp: getCurrentTimestamp(),
  sender: { agentId: "impl_001", type: "Implementation" },
  receiver: { agentId: "impl_002", type: "Implementation" },
  messageType: "CUSTOM_ANALYSIS_REQUEST" as any,
  priority: "NORMAL",
  payload: {
    analysisType: "code_quality",
    files: ["src/protocol/validator.ts"],
    options: { includeMetrics: true }
  },
  metadata: { tags: ["custom", "analysis"] }
};
```

**Guidelines:**
- Prefix with `CUSTOM_`
- Document in agent-specific docs
- Use `metadata.tags` for categorization
- Standard agents may ignore custom types

---

## 9. Test Scenarios

### 9.1 Happy Path Tests

**Test 1: Task Assignment and Completion**
```
Given: Manager with one Implementation agent
When: Manager sends TASK_ASSIGNMENT
Then:
  - Implementation receives message
  - Implementation sends ACK within 30s
  - Implementation sends TASK_UPDATE (progress=0.5)
  - Implementation sends TASK_UPDATE (progress=1.0, status=completed)
  - All messages validated successfully
```

**Test 2: State Synchronization**
```
Given: Manager and Implementation agent
When: Implementation sends STATE_SYNC every 10s
Then:
  - Manager receives heartbeats
  - Manager detects agent health status
  - No timeouts or errors
```

**Test 3: Broadcast Message**
```
Given: Manager with 3 Implementation agents
When: Manager broadcasts STATE_SYNC (receiver.agentId="*")
Then:
  - All 3 agents receive message
  - All 3 agents send ACK
  - No partial failures
```

### 9.2 Error Path Tests

**Test 4: Message Validation Failure**
```
Given: Implementation agent
When: Receiver gets message with missing 'messageId'
Then:
  - Syntax validation passes
  - Schema validation FAILS (E_VALIDATION_001)
  - NACK sent to sender
  - Message NOT processed
```

**Test 5: Retry with Exponential Backoff**
```
Given: Sender with channel temporarily unavailable
When: Send message fails 2 times
Then:
  - Retry after 1s (attempt 1)
  - Retry after 2s (attempt 2)
  - Retry after 4s (attempt 3)
  - Success on attempt 3
  - Message marked DELIVERED
```

**Test 6: Max Retries Exceeded**
```
Given: Sender with channel permanently unavailable
When: Send fails 3 times (max retries)
Then:
  - Message moved to DLQ
  - ERROR_REPORT sent to Manager
  - Message state = FAILED
```

### 9.3 Concurrent Messaging

**Test 7: Multiple Senders to Same Channel**
```
Given: Multiple agents writing to same channel concurrently
When: 10 messages sent simultaneously
Then:
  - All messages written without corruption
  - No partial writes
  - Messages can be parsed individually
  - File locking prevents conflicts
```

**Test 8: High Message Volume**
```
Given: Manager sending 1000 messages
When: Messages sent at max throughput (~100/s)
Then:
  - All messages delivered
  - No message loss
  - Average latency < 200ms
  - Log file < 1MB
```

### 9.4 Agent Crash Recovery

**Test 9: Sender Crash Before ACK**
```
Given: Message sent, ACK pending
When: Sender crashes before receiving ACK
Then:
  - On restart, sender loads pending messages
  - Sender retries unacked messages
  - Receiver deduplicates using messageId
  - Message processed once (idempotency)
```

**Test 10: Receiver Crash During Processing**
```
Given: Message received, being processed
When: Receiver crashes mid-processing
Then:
  - On restart, receiver reloads processedMessageIds
  - Message reprocessed if not in processedIds
  - Processing is idempotent
  - No state corruption
```

### 9.5 Circuit Breaker

**Test 11: Circuit Breaker Opens**
```
Given: Sender experiencing 5 consecutive failures
When: 5th failure occurs
Then:
  - Circuit breaker opens
  - All subsequent messages immediately moved to DLQ
  - No more send attempts
  - Circuit closes after 60s timeout
```

**Test 12: Circuit Breaker Half-Open**
```
Given: Circuit breaker in HALF_OPEN state
When: Test message sent successfully
Then:
  - Circuit breaker closes
  - Normal operation resumes
  - Failure count resets
```

---

## 10. Implementation Reference

### 10.1 File Locations

**Protocol Implementation:**
```
src/protocol/
├── types.ts              # Type definitions
├── schemas.ts            # Zod validation schemas
├── serialization.ts      # Serialization utilities
├── errors.ts             # Error codes & definitions
├── validator.ts          # Three-level validation
├── error-handler.ts      # Error handling & retry
├── index.ts              # Main exports
└── README.md             # Developer guide
```

**Specifications:**
```
.apm/specs/
├── communication-protocol-v1.md        # This document
├── protocol-specification-draft.md    # Initial draft (Step 2)
├── serialization-specification.md     # Serialization details
└── validation-and-error-handling.md   # Validation & errors
```

**Research:**
```
.apm/research/
└── communication-patterns-research.md  # Pattern research (Step 1)
```

### 10.2 Quick Start

**Installation:**
```bash
npm install zod  # For validation schemas
```

**Basic Usage:**
```typescript
import {
  MessageType,
  createMessageEnvelope,
  serializeMessage,
  deserializeMessage,
  validate,
  ProtocolErrorHandler
} from './protocol';

// Create message
const message = createMessageEnvelope(
  MessageType.TASK_ASSIGNMENT,
  { agentId: 'manager_001', type: 'Manager' },
  { agentId: 'impl_001', type: 'Implementation' },
  {
    taskId: 'task_3_1',
    taskRef: 'Task 3.1',
    taskDescription: 'Design protocol',
    memoryLogPath: '.apm/Memory/task_3_1.md',
    executionType: 'multi-step'
  },
  { correlationId: 'req_123', priority: 'HIGH' }
);

// Validate
const validation = validate(JSON.stringify(message));
if (!validation.valid) {
  console.error('Validation failed:', validation.errors);
}

// Serialize
const ndjson = serializeMessage(message);

// Write to channel
await fs.appendFile('.apm/channels/manager_to_impl_001/messages.ndjson', ndjson);

// Read from channel
const line = await readLine('.apm/channels/impl_001_to_manager/messages.ndjson');
const result = deserializeMessage(line);
if (result.success) {
  console.log('Received:', result.message);
}
```

**Error Handling:**
```typescript
const errorHandler = new ProtocolErrorHandler({
  dlqPath: '.apm/dlq',
  enableRetries: true
});

// Handle send failure
const shouldRetry = await errorHandler.handleSendFailure(
  message,
  error,
  tracker
);

if (!shouldRetry) {
  console.error('Message permanently failed');
}
```

### 10.3 Next Steps

**Task 3.2:** Message Routing Implementation
- Channel management
- File watching setup
- Message delivery

**Task 3.3:** Validation Framework Integration
- Wire validation into message handlers
- Implement error reporting
- DLQ monitoring

**Task 3.4:** Testing & Documentation
- Integration tests
- Performance tests
- API documentation

---

## Appendix A: Message Format Examples

### Complete TASK_ASSIGNMENT Example

```json
{
  "version": "1.0.0",
  "messageId": "msg_20251112_100000_abc123",
  "correlationId": "req_task_3_1_xyz789",
  "timestamp": "2025-11-12T10:00:00.000Z",
  "sender": {
    "agentId": "manager_001",
    "type": "Manager"
  },
  "receiver": {
    "agentId": "impl_001",
    "type": "Implementation"
  },
  "messageType": "TASK_ASSIGNMENT",
  "priority": "HIGH",
  "payload": {
    "taskId": "task_3_1",
    "taskRef": "Task 3.1 - Protocol Design & Specification",
    "taskDescription": "Design comprehensive inter-agent communication protocol specification enabling WebSocket-like log-styled messaging between Claude Code agent processes with message routing, acknowledgments, and reliable delivery semantics.",
    "memoryLogPath": ".apm/Memory/Phase_03_Communication_Protocol/Task_3_1_Protocol_Design_and_Specification.md",
    "executionType": "multi-step",
    "dependencies": [
      {
        "taskId": "task_2_4",
        "status": "completed",
        "outputs": ["config_schema.json", ".apm/specs/config-spec.md"]
      }
    ],
    "context": {
      "relatedFiles": [
        "src/protocol/types.ts",
        ".apm/research/communication-patterns-research.md"
      ],
      "requiresAdHoc": true,
      "estimatedDuration": 3600
    }
  },
  "metadata": {
    "retryCount": 0,
    "ttl": 3600,
    "tags": ["protocol", "design", "phase-3"]
  }
}
```

---

## Appendix B: Error Code Quick Reference

| Code | Category | Description | Recoverable |
|------|----------|-------------|-------------|
| E_VALIDATION_001 | Validation | Missing required field | Yes |
| E_VALIDATION_002 | Validation | Invalid field type | Yes |
| E_VALIDATION_003 | Validation | Invalid enum value | Yes |
| E_VALIDATION_004 | Validation | Schema validation failed | Yes |
| E_VALIDATION_005 | Validation | Message size exceeded 1MB | No |
| E_ROUTING_001 | Routing | Agent not found | No |
| E_ROUTING_002 | Routing | Invalid receiver | Yes |
| E_ROUTING_003 | Routing | Channel unavailable | Yes |
| E_ROUTING_004 | Routing | Broadcast failed (partial) | Yes |
| E_PROTOCOL_001 | Protocol | Unsupported version | No |
| E_PROTOCOL_002 | Protocol | Malformed JSON/UTF-8 | No |
| E_PROTOCOL_003 | Protocol | Invalid correlation ID | Yes |
| E_PROTOCOL_004 | Protocol | Message timeout | Yes |
| E_TASK_001 | Task | Task not found | No |
| E_TASK_003 | Task | Task execution failed | Yes |
| E_TASK_004 | Task | Dependency missing | Yes |
| E_SYSTEM_001 | System | Filesystem error | Yes |
| E_SYSTEM_002 | System | Disk full | No |
| E_SYSTEM_003 | System | Permission denied | No |

---

## Appendix C: Glossary

**Agent:** A Claude Code process (Manager, Implementation, or Ad-Hoc)

**Channel:** Bidirectional communication path between two agents

**Correlation ID:** Unique identifier linking request and response messages

**DLQ (Dead Letter Queue):** Storage for permanently failed messages

**NDJSON:** Newline-Delimited JSON format (one JSON object per line)

**Message Envelope:** Standard message wrapper with routing and metadata

**Payload:** Message-type-specific data

**At-Least-Once Delivery:** Messages may be delivered multiple times

**Idempotent:** Operation that produces same result if executed multiple times

**Circuit Breaker:** Pattern to prevent cascading failures

---

**End of APM Communication Protocol Specification v1.0.0**
