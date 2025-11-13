# APM Communication Protocol Specification (Draft)
**Version:** 1.0.0-draft
**Date:** 2025-11-12
**Status:** Draft - Pending Review

---

## 1. Message Envelope Format

### 1.1 Core Structure

All messages exchanged between agents MUST conform to the following envelope structure:

```json
{
  "version": "1.0.0",
  "messageId": "msg_20251112_103045_abc123",
  "correlationId": "req_xyz789",
  "timestamp": "2025-11-12T10:30:45.123Z",
  "sender": {
    "agentId": "impl_001",
    "type": "Implementation"
  },
  "receiver": {
    "agentId": "manager_001",
    "type": "Manager"
  },
  "messageType": "TASK_UPDATE",
  "priority": "NORMAL",
  "payload": {
    "taskId": "task_3_1",
    "progress": 0.5,
    "status": "in_progress"
  },
  "metadata": {
    "retryCount": 0,
    "ttl": 3600
  }
}
```

### 1.2 Field Definitions

#### Required Fields

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `version` | string | Protocol version (semver) | Must be "1.0.0" for this spec |
| `messageId` | string | Unique message identifier | Format: `msg_{timestamp}_{random}` |
| `timestamp` | string | ISO 8601 UTC timestamp | Must be valid ISO 8601 format |
| `sender` | object | Sender identification | See §1.3 Agent Identification |
| `receiver` | object | Receiver identification | See §1.3 Agent Identification |
| `messageType` | string | Message type identifier | Must be from defined types (§2) |
| `priority` | enum | Message priority | "HIGH" \| "NORMAL" \| "LOW" |
| `payload` | object | Message-type-specific data | Schema varies by messageType |

#### Optional Fields

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `correlationId` | string | Links request/response pairs | null |
| `metadata` | object | Additional metadata | {} |
| `metadata.retryCount` | number | Number of retry attempts | 0 |
| `metadata.ttl` | number | Time-to-live (seconds) | 3600 |
| `metadata.tags` | array | Categorization tags | [] |

### 1.3 Agent Identification

Agent objects have the following structure:

```json
{
  "agentId": "impl_001",
  "type": "Manager" | "Implementation" | "AdHoc"
}
```

**Special Receiver Values:**
- `agentId: "*"` - Broadcast to all agents
- `type: "*"` - Broadcast to all agent types

---

## 2. Message Types

### 2.1 Message Type Catalog

The protocol defines 7 core message types for Manager↔Implementation coordination:

| Message Type | Direction | Purpose | Requires Correlation |
|-------------|-----------|---------|---------------------|
| `TASK_ASSIGNMENT` | Manager → Implementation | Assign new task | Yes (new correlation ID) |
| `TASK_UPDATE` | Implementation → Manager | Report progress | Yes (matches assignment) |
| `STATE_SYNC` | Bi-directional | Replicate state changes | No |
| `ERROR_REPORT` | Any → Manager | Notify of failure | Optional (if error relates to task) |
| `HANDOFF_REQUEST` | Agent → Agent | Cross-agent coordination | Yes (new correlation ID) |
| `ACK` | Receiver → Sender | Message received confirmation | Yes (matches original message) |
| `NACK` | Receiver → Sender | Message rejected with reason | Yes (matches original message) |

### 2.2 TASK_ASSIGNMENT

**Direction:** Manager → Implementation
**Purpose:** Assign a new task to an Implementation agent
**Acknowledgment:** Implementation MUST respond with ACK or NACK

**Payload Schema:**
```json
{
  "taskId": "task_3_1",
  "taskRef": "Task 3.1 - Protocol Design & Specification",
  "taskDescription": "Design comprehensive inter-agent communication protocol...",
  "memoryLogPath": ".apm/Memory/Phase_03_Communication_Protocol/Task_3_1.md",
  "executionType": "multi-step",
  "dependencies": [
    {
      "taskId": "task_2_4",
      "status": "completed",
      "outputs": ["config_schema.json"]
    }
  ],
  "context": {
    "relatedFiles": ["src/protocol/types.ts"],
    "requiresAdHoc": true,
    "estimatedDuration": 3600
  }
}
```

**Required Payload Fields:**
- `taskId`: Unique task identifier
- `taskRef`: Human-readable task reference
- `taskDescription`: Detailed task instructions
- `memoryLogPath`: Path to memory log file
- `executionType`: "single-step" | "multi-step"

**Optional Payload Fields:**
- `dependencies`: Array of dependency objects
- `context`: Additional context information

**Example:**
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
  "payload": {
    "taskId": "task_3_1",
    "taskRef": "Task 3.1 - Protocol Design & Specification",
    "taskDescription": "Design comprehensive protocol...",
    "memoryLogPath": ".apm/Memory/Phase_03_Communication_Protocol/Task_3_1.md",
    "executionType": "multi-step"
  }
}
```

### 2.3 TASK_UPDATE

**Direction:** Implementation → Manager
**Purpose:** Report task progress, status changes, or intermediate results
**Acknowledgment:** Optional (Manager may send ACK)

**Payload Schema:**
```json
{
  "taskId": "task_3_1",
  "progress": 0.5,
  "status": "in_progress" | "blocked" | "pending_review" | "completed" | "failed",
  "currentStep": "Step 2 - Protocol Specification Design",
  "notes": "Completed research phase, now designing message types",
  "filesModified": [
    ".apm/specs/protocol-specification-draft.md"
  ],
  "blockers": [
    {
      "type": "dependency_missing",
      "description": "Awaiting schema validation library",
      "severity": "high"
    }
  ],
  "estimatedCompletion": "2025-11-12T12:00:00.000Z"
}
```

**Required Payload Fields:**
- `taskId`: Task identifier (matches TASK_ASSIGNMENT)
- `status`: Current task status
- `progress`: Progress percentage (0.0 - 1.0)

**Optional Payload Fields:**
- `currentStep`: Current step description
- `notes`: Progress notes
- `filesModified`: List of modified files
- `blockers`: Array of blocker objects
- `estimatedCompletion`: Estimated completion timestamp

### 2.4 STATE_SYNC

**Direction:** Bi-directional
**Purpose:** Synchronize state changes between agents
**Acknowledgment:** Recommended (ACK confirms sync)

**Payload Schema:**
```json
{
  "entityType": "agent" | "task" | "memory_log" | "configuration",
  "entityId": "impl_001",
  "operation": "create" | "update" | "delete",
  "state": {
    "status": "healthy",
    "lastHeartbeat": "2025-11-12T10:30:00.000Z",
    "tasksInProgress": 1,
    "memoryUsageMB": 512
  },
  "previousState": {
    "status": "idle",
    "tasksInProgress": 0
  },
  "syncTimestamp": "2025-11-12T10:30:00.000Z"
}
```

**Required Payload Fields:**
- `entityType`: Type of entity being synchronized
- `entityId`: Unique entity identifier
- `operation`: State change operation
- `state`: Current state object
- `syncTimestamp`: When state change occurred

**Optional Payload Fields:**
- `previousState`: Previous state (for update operations)

### 2.5 ERROR_REPORT

**Direction:** Any → Manager
**Purpose:** Report errors, failures, or exceptional conditions
**Acknowledgment:** Manager MUST send ACK

**Payload Schema:**
```json
{
  "errorType": "TaskFailure" | "ValidationError" | "SystemError" | "DependencyError",
  "errorCode": "E_TASK_003",
  "errorMessage": "Test suite failed with 3 failures",
  "severity": "critical" | "high" | "medium" | "low",
  "context": {
    "taskId": "task_3_1",
    "step": "Step 2",
    "file": "src/protocol/validator.ts",
    "line": 42
  },
  "stackTrace": "Error: Test failed\n  at runTest (test.ts:42)\n  ...",
  "recoverable": true,
  "suggestedAction": "Review test failures and fix validation logic",
  "metadata": {
    "failedTests": ["test_message_validation", "test_routing"],
    "logs": "path/to/error.log"
  }
}
```

**Required Payload Fields:**
- `errorType`: Category of error
- `errorMessage`: Human-readable error description
- `severity`: Error severity level

**Optional Payload Fields:**
- `errorCode`: Machine-readable error code
- `context`: Error context information
- `stackTrace`: Stack trace (for debugging)
- `recoverable`: Whether error is recoverable
- `suggestedAction`: Recommended remediation
- `metadata`: Additional error metadata

### 2.6 HANDOFF_REQUEST

**Direction:** Agent → Agent
**Purpose:** Request task handoff to another agent
**Acknowledgment:** Target agent MUST respond with ACK or NACK

**Payload Schema:**
```json
{
  "taskId": "task_3_1",
  "reason": "context_window_limit" | "specialization_required" | "load_balancing",
  "sourceAgent": {
    "agentId": "impl_001",
    "type": "Implementation"
  },
  "targetAgent": {
    "agentId": "impl_002",
    "type": "Implementation"
  },
  "handoffContext": {
    "completedSteps": ["Step 1", "Step 2"],
    "currentStep": "Step 3",
    "memoryLogPath": ".apm/Memory/Phase_03_Communication_Protocol/Task_3_1.md",
    "stateSnapshot": {
      "filesCreated": ["protocol-spec.md"],
      "pendingActions": ["Create validation schemas"]
    }
  }
}
```

**Required Payload Fields:**
- `taskId`: Task being handed off
- `reason`: Reason for handoff
- `sourceAgent`: Agent initiating handoff
- `targetAgent`: Agent receiving handoff
- `handoffContext`: Context for continuation

### 2.7 ACK (Acknowledgment)

**Direction:** Receiver → Sender
**Purpose:** Confirm message receipt and processing
**Acknowledgment:** None (ACK is not acknowledged)

**Payload Schema:**
```json
{
  "acknowledgedMessageId": "msg_20251112_100000_001",
  "status": "received" | "processed" | "queued",
  "timestamp": "2025-11-12T10:00:00.150Z",
  "processingTime": 150,
  "notes": "Message queued for processing"
}
```

**Required Payload Fields:**
- `acknowledgedMessageId`: ID of acknowledged message
- `status`: Acknowledgment status
- `timestamp`: When message was acknowledged

**Optional Payload Fields:**
- `processingTime`: Time taken to process (milliseconds)
- `notes`: Additional notes

### 2.8 NACK (Negative Acknowledgment)

**Direction:** Receiver → Sender
**Purpose:** Reject message with reason
**Acknowledgment:** None (NACK is not acknowledged)

**Payload Schema:**
```json
{
  "rejectedMessageId": "msg_20251112_100000_001",
  "reason": "Schema validation failed: missing required field 'taskId'",
  "errorCode": "E_VALIDATION_002",
  "timestamp": "2025-11-12T10:00:00.150Z",
  "canRetry": true,
  "suggestedFix": "Add 'taskId' field to payload"
}
```

**Required Payload Fields:**
- `rejectedMessageId`: ID of rejected message
- `reason`: Human-readable rejection reason
- `timestamp`: When message was rejected

**Optional Payload Fields:**
- `errorCode`: Machine-readable error code
- `canRetry`: Whether sender can retry
- `suggestedFix`: Suggested fix for sender

---

## 3. Routing Rules

### 3.1 Direct Routing

**Rule:** Messages with explicit `receiver.agentId` are routed to that specific agent.

**Algorithm:**
1. Check if `receiver.agentId` is not `"*"`
2. Lookup agent in registry by `agentId`
3. Write message to agent's inbox channel: `.apm/channels/{sender_id}_to_{receiver_id}/messages.ndjson`
4. If agent not found, send ERROR_REPORT back to sender

**Example:**
```json
{
  "receiver": {
    "agentId": "impl_001",
    "type": "Implementation"
  }
}
```
Routes to: `.apm/channels/manager_001_to_impl_001/messages.ndjson`

### 3.2 Broadcast Routing

**Rule:** Messages with `receiver.agentId = "*"` are sent to all registered agents.

**Algorithm:**
1. Check if `receiver.agentId` is `"*"`
2. Query agent registry for all active agents
3. Filter by `receiver.type` if specified (not `"*"`)
4. Write message to each agent's inbox channel
5. Track broadcast ID for response correlation

**Example:**
```json
{
  "receiver": {
    "agentId": "*",
    "type": "Implementation"
  }
}
```
Routes to all Implementation agents:
- `.apm/channels/manager_001_to_impl_001/messages.ndjson`
- `.apm/channels/manager_001_to_impl_002/messages.ndjson`
- ...

### 3.3 Type-Based Routing

**Rule:** Messages can target all agents of a specific type.

**Algorithm:**
1. Check `receiver.type`
2. Query registry for agents matching type
3. Write to all matching agents' channels

**Supported Types:**
- `"Manager"` - All Manager agents
- `"Implementation"` - All Implementation agents
- `"AdHoc"` - All Ad-Hoc agents
- `"*"` - All agents (combined with `agentId: "*"`)

### 3.4 Priority Handling

Messages have three priority levels affecting processing order:

| Priority | Processing Order | Use Case |
|----------|------------------|----------|
| `HIGH` | Process immediately | Critical errors, urgent task assignments |
| `NORMAL` | Standard queue order | Regular task updates, state sync |
| `LOW` | Process after normal | Background sync, housekeeping |

**Implementation:**
- Separate priority queues per channel (optional)
- Or: priority field used by consumer for ordering

### 3.5 Routing Failure Handling

If routing fails:

1. **Agent Not Found:**
   - Send ERROR_REPORT to sender: `E_ROUTING_001: Agent not found`
   - Log routing failure
   - Do NOT retry automatically

2. **Channel Unavailable:**
   - Retry up to 3 times with exponential backoff
   - If all retries fail, send ERROR_REPORT to sender
   - Move message to dead letter queue

3. **Invalid Receiver:**
   - Send NACK to sender: `E_ROUTING_002: Invalid receiver specification`
   - Log validation error

---

## 4. Message Lifecycle States

Every message transitions through defined lifecycle states:

### 4.1 State Definitions

```
PENDING → IN_TRANSIT → DELIVERED → [PROCESSED]
   ↓           ↓            ↓
FAILED ←────────────────────┘
```

| State | Description | Entry Condition | Exit Condition |
|-------|-------------|-----------------|----------------|
| `PENDING` | Created but not sent | Message created in sender | Written to channel |
| `IN_TRANSIT` | Sent, awaiting ACK | Written to channel | ACK/NACK received or timeout |
| `DELIVERED` | Acknowledged by receiver | ACK received | Message processed |
| `PROCESSED` | Processing complete | Task completed or response sent | N/A (terminal state) |
| `FAILED` | Max retries exceeded | Timeout or permanent error | Manual intervention or DLQ |

### 4.2 State Transitions

**PENDING → IN_TRANSIT:**
- Trigger: Message written to recipient's channel
- Actions:
  - Start timeout timer
  - Track in pending messages map
  - Log send event

**IN_TRANSIT → DELIVERED:**
- Trigger: ACK received from recipient
- Actions:
  - Cancel timeout timer
  - Remove from pending messages map
  - Log delivery confirmation

**IN_TRANSIT → FAILED:**
- Trigger:
  - NACK received with `canRetry: false`
  - Timeout expired after max retries (3 attempts)
  - Permanent error (e.g., invalid message format)
- Actions:
  - Move to dead letter queue
  - Send ERROR_REPORT to sender
  - Log failure with reason

**IN_TRANSIT → PENDING (Retry):**
- Trigger: NACK received with `canRetry: true` or timeout (retry < max)
- Actions:
  - Increment retry count
  - Apply exponential backoff (1s, 2s, 4s)
  - Re-enter PENDING state
  - Log retry attempt

**DELIVERED → PROCESSED:**
- Trigger:
  - Response message received (for requests)
  - Processing confirmation received
- Actions:
  - Mark correlation as complete
  - Clean up correlation tracking
  - Log completion

### 4.3 Timeout Behavior

| Message Type | Timeout Duration | Max Retries | Backoff Strategy |
|-------------|------------------|-------------|------------------|
| `TASK_ASSIGNMENT` | 30 seconds | 3 | Exponential (1s, 2s, 4s) |
| `TASK_UPDATE` | 15 seconds | 2 | Exponential (1s, 2s) |
| `STATE_SYNC` | 10 seconds | 2 | Exponential (1s, 2s) |
| `ERROR_REPORT` | 30 seconds | 3 | Exponential (1s, 2s, 4s) |
| `HANDOFF_REQUEST` | 60 seconds | 2 | Exponential (2s, 4s) |
| `ACK/NACK` | None | 0 | N/A (fire-and-forget) |

### 4.4 State Tracking Implementation

```typescript
interface MessageTracker {
  messageId: string;
  correlationId?: string;
  state: 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'PROCESSED' | 'FAILED';
  sentAt?: Date;
  deliveredAt?: Date;
  processedAt?: Date;
  retryCount: number;
  lastError?: string;
  timeoutHandle?: NodeJS.Timeout;
}

// Example state management
const pendingMessages = new Map<string, MessageTracker>();

function sendMessage(message: Message): void {
  const tracker: MessageTracker = {
    messageId: message.messageId,
    correlationId: message.correlationId,
    state: 'PENDING',
    retryCount: 0
  };

  pendingMessages.set(message.messageId, tracker);

  // Write to channel
  writeToChannel(message);

  // Update state
  tracker.state = 'IN_TRANSIT';
  tracker.sentAt = new Date();

  // Start timeout
  tracker.timeoutHandle = setTimeout(
    () => handleTimeout(message.messageId),
    getTimeout(message.messageType)
  );
}

function handleAck(ack: AckMessage): void {
  const tracker = pendingMessages.get(ack.payload.acknowledgedMessageId);
  if (tracker) {
    tracker.state = 'DELIVERED';
    tracker.deliveredAt = new Date();

    // Cancel timeout
    if (tracker.timeoutHandle) {
      clearTimeout(tracker.timeoutHandle);
    }
  }
}
```

---

## 5. Protocol Versioning

### 5.1 Semantic Versioning

Protocol versions follow semantic versioning (semver): `MAJOR.MINOR.PATCH`

- **MAJOR:** Breaking changes (incompatible message formats)
- **MINOR:** Backward-compatible additions (new message types, optional fields)
- **PATCH:** Bug fixes, clarifications (no message format changes)

**Current Version:** `1.0.0`

### 5.2 Backward Compatibility Guarantees

**Within MAJOR version (1.x.x):**
- ✅ New optional fields can be added to envelopes
- ✅ New message types can be added
- ✅ New enum values can be added
- ❌ Required fields cannot be removed or renamed
- ❌ Field types cannot change
- ❌ Existing message types cannot be removed

**MAJOR version changes (2.0.0):**
- May introduce breaking changes
- Requires migration plan
- All agents must upgrade simultaneously

### 5.3 Version Negotiation

When agent connects, it advertises supported protocol versions:

**Agent Registration Message:**
```json
{
  "messageType": "STATE_SYNC",
  "payload": {
    "entityType": "agent",
    "entityId": "impl_001",
    "operation": "create",
    "state": {
      "protocolVersion": "1.0.0",
      "supportedVersions": ["1.0.0", "1.1.0"],
      "capabilities": ["TASK_ASSIGNMENT", "STATE_SYNC", "ERROR_REPORT"]
    }
  }
}
```

**Version Selection Algorithm:**
1. Manager queries all agents for supported versions
2. Find highest common version across all agents
3. If no common version, reject agent registration
4. All communication uses selected version

### 5.4 Version Detection

Receivers MUST validate `version` field in message envelope:

```typescript
function validateProtocolVersion(message: Message): boolean {
  const supportedVersions = ['1.0.0', '1.1.0'];

  if (!supportedVersions.includes(message.version)) {
    sendNack(message.messageId, {
      reason: `Unsupported protocol version: ${message.version}`,
      errorCode: 'E_VERSION_001',
      canRetry: false
    });
    return false;
  }

  return true;
}
```

### 5.5 Migration Path (Future Versions)

When introducing version 2.0.0:

1. **Announcement Phase (1 month before):**
   - Document breaking changes
   - Provide migration guide
   - Release compatibility checker tool

2. **Transition Phase (2.0.0 release):**
   - Support dual-version operation (1.x and 2.0)
   - Agents negotiate best version
   - Gradual rollout

3. **Deprecation Phase (3 months after 2.0.0):**
   - Mark 1.x as deprecated
   - Warn on 1.x usage
   - Plan end-of-life date

4. **End-of-Life (6 months after 2.0.0):**
   - Remove 1.x support
   - All agents must use 2.0.0+

---

## 6. Delivery Guarantees

### 6.1 Delivery Semantics

The protocol provides **at-least-once delivery** semantics:

- Messages may be delivered multiple times (due to retries)
- Receivers MUST implement idempotent handling
- No messages are lost (barring catastrophic failures)

**Not Provided:**
- Exactly-once delivery (too complex for file-based system)
- Ordering guarantees across channels (only within single channel)

### 6.2 Idempotency Requirements

**All message handlers MUST be idempotent:**

```typescript
// Example: Idempotent task assignment handler
const processedTaskIds = new Set<string>();

function handleTaskAssignment(message: TaskAssignmentMessage): void {
  const taskId = message.payload.taskId;

  // Deduplication check
  if (processedTaskIds.has(taskId)) {
    console.log(`Task ${taskId} already processed, skipping`);
    sendAck(message.messageId); // Still acknowledge
    return;
  }

  // Process task
  processTask(message.payload);

  // Mark as processed
  processedTaskIds.add(taskId);
  persistProcessedIds(); // Persist to survive crashes

  sendAck(message.messageId);
}
```

### 6.3 Deduplication Strategy

Recommended deduplication approaches:

1. **Message ID Tracking:**
   - Maintain set of processed message IDs
   - Check before processing
   - Persist to file for crash recovery

2. **Correlation ID Tracking:**
   - Track processed correlation IDs (for requests)
   - Prevents duplicate task execution

3. **Entity State Comparison:**
   - For STATE_SYNC messages, compare incoming state with current
   - Skip if no changes detected

### 6.4 Ordering Guarantees

**Within Single Channel:**
- Messages are appended to NDJSON log in order
- Consumers read in append order
- **Strict ordering guaranteed** within sender→receiver channel

**Across Multiple Channels:**
- No ordering guarantees between different channels
- Use timestamps for best-effort ordering
- Use dependencies or barriers for strict ordering requirements

**Example:**
```
Channel manager_to_impl_001:
  msg_001 → msg_002 → msg_003  ✅ Ordered

Channel impl_001_to_manager:
  msg_101 → msg_102 → msg_103  ✅ Ordered

Across channels:
  msg_001 vs msg_101  ❌ No guarantee
```

---

## 7. Performance Characteristics

### 7.1 Expected Latency

| Operation | Expected Latency | Notes |
|-----------|------------------|-------|
| **Message Send** | 5-10ms | Write to NDJSON + flush |
| **Message Delivery (file watching)** | 10-50ms | OS file notification delay |
| **Message Delivery (polling)** | 100-1000ms | Depends on poll interval |
| **End-to-End (send + delivery)** | 50-200ms | File watching mode |
| **ACK roundtrip** | 100-400ms | Send + delivery + ACK + delivery |

### 7.2 Throughput Limits

**Per Channel:**
- ~100 messages/second (with fsync)
- ~500 messages/second (buffered writes, no fsync)
- ~1000 messages/second (no flush, high risk)

**System-Wide:**
- Scales linearly with number of channels
- 10 agents = ~1000 messages/second total
- Limited by disk I/O bandwidth

### 7.3 Scalability Considerations

**Vertical Scaling (Single Manager):**
- Up to 50 Implementation agents
- Beyond 50: manager becomes bottleneck
- Recommendation: Use message batching for high agent counts

**Horizontal Scaling (Multiple Managers):**
- Not supported in v1.0.0
- Requires leader election and partition assignment
- Planned for v2.0.0

**Log Growth Management:**
- Implement log rotation (daily or size-based)
- Archive old logs to reduce active set
- Compact state logs to remove obsolete entries

### 7.4 Resource Usage

**Disk Usage:**
- ~1KB per message (NDJSON overhead)
- 1000 messages/hour = ~24MB/day per channel
- 10 channels = ~240MB/day
- **Mitigation:** Daily log rotation and archival

**Memory Usage:**
- ~100 bytes per tracked message (pending map)
- 100 pending messages = ~10KB
- Minimal overhead

**CPU Usage:**
- File watching: <1% CPU (kernel-managed)
- Polling: 1-5% CPU (depends on interval)
- JSON parsing: 1-3% CPU (depends on message rate)

---

## 8. Extension Points

### 8.1 Adding New Message Types

To add a new message type in a MINOR version update:

1. **Define message type constant:**
   ```typescript
   export const MESSAGE_TYPES = {
     // ... existing types
     DIAGNOSTIC_REQUEST: 'DIAGNOSTIC_REQUEST'
   };
   ```

2. **Define payload schema:**
   ```typescript
   interface DiagnosticRequestPayload {
     diagnosticType: 'health' | 'performance' | 'memory';
     includeMetrics: boolean;
   }
   ```

3. **Document in specification:**
   - Add to §2 Message Type Catalog
   - Include payload schema
   - Specify routing rules
   - Define acknowledgment requirements

4. **Implement handlers:**
   - Sender: Create message constructor
   - Receiver: Implement message handler
   - Both: Update validation schemas

5. **Version bump:**
   - Increment MINOR version (e.g., 1.0.0 → 1.1.0)
   - Update changelog
   - Notify all agents of new capability

### 8.2 Adding Optional Fields

To add optional fields to existing messages:

1. **Define field in schema:**
   ```typescript
   interface TaskAssignmentPayload {
     // ... existing fields
     estimatedComplexity?: 'low' | 'medium' | 'high'; // New optional field
   }
   ```

2. **Update documentation:**
   - Mark as optional in specification
   - Document default behavior if field absent
   - Specify version introduced

3. **Backward compatibility check:**
   - Verify old agents can ignore new field
   - Test with mixed versions

4. **Version bump:**
   - Increment MINOR version
   - Update changelog

### 8.3 Custom Payload Schemas

Agents can define custom message types for specialized communication:

**Custom Message Type:**
```json
{
  "messageType": "CUSTOM_ANALYSIS_REQUEST",
  "payload": {
    "analysisType": "code_quality",
    "files": ["src/protocol/validator.ts"],
    "options": {
      "includeMetrics": true,
      "severity": "high"
    }
  },
  "metadata": {
    "tags": ["custom", "analysis"]
  }
}
```

**Guidelines:**
- Prefix custom types with `CUSTOM_`
- Document schema in agent-specific docs
- Use `metadata.tags` for categorization
- Do not expect other agents to understand custom types

---

## 9. Error Codes Catalog

### 9.1 Validation Errors (E_VALIDATION_xxx)

| Code | Description | Severity | Recoverable |
|------|-------------|----------|-------------|
| E_VALIDATION_001 | Missing required field | Medium | Yes (add field) |
| E_VALIDATION_002 | Invalid field type | Medium | Yes (fix type) |
| E_VALIDATION_003 | Invalid enum value | Medium | Yes (use valid value) |
| E_VALIDATION_004 | Schema validation failed | Medium | Yes (fix schema) |
| E_VALIDATION_005 | Message size exceeded limit (1MB) | High | No (reduce size) |

### 9.2 Routing Errors (E_ROUTING_xxx)

| Code | Description | Severity | Recoverable |
|------|-------------|----------|-------------|
| E_ROUTING_001 | Agent not found | Medium | No (check agent ID) |
| E_ROUTING_002 | Invalid receiver specification | Medium | Yes (fix receiver) |
| E_ROUTING_003 | Channel unavailable | High | Yes (retry) |
| E_ROUTING_004 | Broadcast failed (partial) | Medium | Yes (retry failed) |

### 9.3 Protocol Errors (E_PROTOCOL_xxx)

| Code | Description | Severity | Recoverable |
|------|-------------|----------|-------------|
| E_PROTOCOL_001 | Unsupported protocol version | High | No (upgrade agent) |
| E_PROTOCOL_002 | Malformed JSON | Critical | No (fix sender) |
| E_PROTOCOL_003 | Invalid correlation ID | Medium | Yes (use valid ID) |
| E_PROTOCOL_004 | Message timeout | Medium | Yes (retry) |

### 9.4 Task Errors (E_TASK_xxx)

| Code | Description | Severity | Recoverable |
|------|-------------|----------|-------------|
| E_TASK_001 | Task not found | Medium | No (check task ID) |
| E_TASK_002 | Task already assigned | Low | No (ignore) |
| E_TASK_003 | Task execution failed | High | Yes (retry/debug) |
| E_TASK_004 | Task dependency missing | High | Yes (wait/resolve) |

---

## 10. Security Considerations

### 10.1 Message Validation

**All messages MUST be validated before processing:**

1. **Syntax Validation:** Valid UTF-8 JSON
2. **Schema Validation:** Conforms to message type schema
3. **Semantic Validation:** Business rules (e.g., valid agent IDs)
4. **Size Validation:** Message ≤ 1MB uncompressed

**Reject invalid messages with NACK.**

### 10.2 Agent Authentication

**Current Version (1.0.0):**
- No authentication (agents trust each other)
- Suitable for single-user, local development

**Future Version (2.0.0):**
- Agent registration with shared secret
- Message signing with HMAC
- Certificate-based authentication (optional)

### 10.3 Message Integrity

**File-Level Integrity:**
- POSIX atomic operations prevent partial writes
- fsync ensures durability
- File checksums (future enhancement)

**Message-Level Integrity:**
- JSON parsing errors detected
- Schema validation catches malformed messages
- No encryption in v1.0.0 (add if needed)

---

## 11. Summary

This protocol specification defines:

✅ **7 message types** covering Manager↔Implementation coordination
✅ **Standard message envelope** with versioning, routing, and metadata
✅ **3 routing modes:** Direct, broadcast, type-based
✅ **5 lifecycle states:** Pending, in-transit, delivered, processed, failed
✅ **Semantic versioning** with backward compatibility guarantees
✅ **At-least-once delivery** with idempotency requirements
✅ **Expected latency:** 50-200ms end-to-end
✅ **Throughput:** ~100 messages/second per channel
✅ **Extension points** for new message types and custom schemas

**Next Steps:**
- Implement message format schemas with validation (Task 3.2)
- Design validation framework and error handling (Task 3.3)
- Create protocol documentation with sequence diagrams (Task 3.4)

---

**End of Protocol Specification Draft**
