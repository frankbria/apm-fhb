# Research: File-Based Inter-Agent Communication Patterns

**Research Date:** 2025-11-12
**Project:** APM (Agentic Project Management) System
**Focus:** Communication protocol for coordinating Manager and Implementation agents via file-based messaging

---

## Executive Summary

File-based inter-agent communication can effectively simulate WebSocket-like semantics through a combination of **append-only log patterns**, **file watching mechanisms**, and **atomic write operations**. The recommended approach combines:

1. **NDJSON append-only logs** for message streams (inspired by Kafka's architecture)
2. **File watching with inotify/chokidar** for low-latency message delivery (preferred over polling)
3. **Atomic write-tmp-rename patterns** for safe concurrent operations
4. **Correlation IDs and message envelopes** for request-response coordination
5. **Heartbeat files with timestamps** for connection state simulation

This approach provides durability, crash recovery, and bidirectional communication while maintaining simplicity and reliability. The key trade-off is slightly higher latency (50-200ms) compared to true WebSockets, but this is acceptable for agent coordination use cases.

---

## 1. WebSocket-like Patterns for File-Based Systems

### Overview

WebSocket semantics (persistent connections, bidirectional messaging, event-driven communication) can be effectively adapted to file-based systems through virtual connection patterns and event-driven file watching.

### Simulating Persistent Connections

**Virtual Connection Pattern:**
- Each agent pair maintains a "connection directory" with dedicated message channels
- Connection state tracked via heartbeat files with periodic timestamp updates
- Connection lifecycle: `CONNECTING` → `CONNECTED` → `DISCONNECTED`

**Directory Structure:**
```
.apm/channels/
├── manager_to_impl_001/
│   ├── messages.ndjson          # Append-only message log
│   ├── acks.ndjson              # Acknowledgment log
│   └── heartbeat.json           # Last heartbeat timestamp
└── impl_001_to_manager/
    ├── messages.ndjson
    ├── acks.ndjson
    └── heartbeat.json
```

### File Watching vs Polling Trade-offs

| Aspect | File Watching (inotify/chokidar) | Polling |
|--------|----------------------------------|---------|
| **Latency** | 10-50ms (event-driven) | 100-1000ms (depends on interval) |
| **CPU Usage** | Very low (kernel events) | Higher (constant checking) |
| **Reliability** | High (OS guarantees) | High (simpler logic) |
| **Cross-platform** | Good (inotify/FSEvents/kqueue) | Excellent (universal) |
| **Complexity** | Moderate (event handling) | Low (simple loops) |
| **Scalability** | Excellent (kernel-managed) | Poor (polling overhead) |

**Recommendation:** Use file watching as primary mechanism with polling as fallback for unsupported filesystems (NFS, some remote mounts).

### File Watching Implementation Details

**Linux (inotify):**
- Native kernel support for file system events
- Events: `IN_MODIFY`, `IN_CREATE`, `IN_DELETE`, `IN_MOVED_TO`
- Low overhead, highly efficient

**macOS (FSEvents):**
- Coalesces events for better performance
- May have slight delays (100-200ms) due to coalescing

**Cross-platform (Python watchdog / Node.js chokidar):**
```python
# Python example with watchdog
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

class MessageHandler(FileSystemEventHandler):
    def on_modified(self, event):
        if event.src_path.endswith('messages.ndjson'):
            self.process_new_messages(event.src_path)

    def process_new_messages(self, filepath):
        # Read new lines since last position
        pass

observer = Observer()
observer.schedule(MessageHandler(), path='.apm/channels/', recursive=True)
observer.start()
```

**Best Practices:**
- Debounce rapid events (50-100ms window) to avoid duplicate processing
- Use recursive watching for directory hierarchies
- Implement exponential backoff if events fail to process
- Handle race conditions where file is modified during read

### Heartbeat Mechanisms

**Push-based Heartbeat Pattern:**
```json
{
  "agent_id": "impl_001",
  "timestamp": "2025-11-12T10:30:45.123Z",
  "status": "healthy",
  "last_message_id": "msg_12345"
}
```

**Heartbeat Strategy:**
- Agents write heartbeat every 5-10 seconds
- Monitor considers agent dead after 3 missed heartbeats (15-30s timeout)
- Heartbeat files use atomic write-tmp-rename pattern
- Include last processed message ID for recovery

**Connection State Management:**
```python
class VirtualConnection:
    def __init__(self, channel_dir):
        self.heartbeat_interval = 10  # seconds
        self.timeout = 30  # 3 missed heartbeats
        self.last_heartbeat = None

    def is_alive(self):
        if not self.last_heartbeat:
            return False
        age = time.time() - self.last_heartbeat
        return age < self.timeout

    def send_heartbeat(self):
        heartbeat = {
            "timestamp": datetime.utcnow().isoformat(),
            "agent_id": self.agent_id,
            "status": "healthy"
        }
        atomic_write(self.heartbeat_file, json.dumps(heartbeat))
```

### Bidirectional Messaging

**Dual Channel Pattern:**
- Each direction has dedicated message log (no file locking conflicts)
- `manager_to_impl/messages.ndjson` and `impl_to_manager/messages.ndjson`
- Each agent watches counterpart's directory, writes to own

**Benefits:**
- No write contention (each file has single writer)
- Simple append-only pattern
- Clear message ownership

---

## 2. Log-Styled Messaging Architectures

### Append-Only Log Pattern (Kafka-Inspired)

**Core Principles:**
- Messages are immutable once written
- Each message has monotonically increasing offset/ID
- Consumers track their read position
- Log segments can be compacted or rotated

**Message Log Structure:**
```ndjson
{"id":"msg_0001","type":"task_request","timestamp":"2025-11-12T10:00:00Z","payload":{...}}
{"id":"msg_0002","type":"task_ack","timestamp":"2025-11-12T10:00:01Z","payload":{...}}
{"id":"msg_0003","type":"status_update","timestamp":"2025-11-12T10:00:05Z","payload":{...}}
```

### NDJSON (Newline-Delimited JSON) Best Practices

**Format Specification:**
- One complete JSON object per line
- Lines separated by `\n` (newline character)
- No trailing commas or extra whitespace
- Each line must be valid JSON independently

**Advantages:**
- Stream-friendly (process line-by-line)
- Memory efficient (no need to load entire file)
- Append-friendly (just add new lines)
- Human-readable and debuggable
- Language-agnostic parsing

**Reading NDJSON Streams:**
```python
def read_ndjson_stream(filepath, start_offset=0):
    """Read NDJSON file from specific offset"""
    with open(filepath, 'r') as f:
        f.seek(start_offset)
        for line in f:
            if line.strip():
                yield json.loads(line)

# Track consumer position
class MessageConsumer:
    def __init__(self, logfile):
        self.logfile = logfile
        self.position = 0  # byte offset

    def consume_new(self):
        messages = []
        with open(self.logfile, 'r') as f:
            f.seek(self.position)
            for line in f:
                if line.strip():
                    messages.append(json.loads(line))
            self.position = f.tell()  # Save new position
        return messages
```

**Writing NDJSON (Atomic Appends):**
```python
def append_message(filepath, message):
    """Atomically append message to NDJSON log"""
    line = json.dumps(message, separators=(',', ':')) + '\n'

    # Open in append mode with buffering disabled for durability
    with open(filepath, 'a', buffering=1) as f:
        # File locks ensure atomic append on POSIX systems
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            f.write(line)
            f.flush()
            os.fsync(f.fileno())  # Force to disk
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
```

### Log Compaction Strategies

**Time-Based Rotation:**
- Rotate logs daily/hourly based on timestamp
- Archive old segments to `.archive/` directory
- Keep recent segments hot for active consumption

```python
def rotate_log_if_needed(logfile, max_age_hours=24):
    """Rotate log file if older than max_age"""
    if not os.path.exists(logfile):
        return

    age = time.time() - os.path.getmtime(logfile)
    if age > max_age_hours * 3600:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        archive_name = f"{logfile}.{timestamp}"
        os.rename(logfile, archive_name)
        # Compress old log
        compress_file(archive_name)
```

**Size-Based Rotation:**
- Rotate when log exceeds size threshold (e.g., 10MB)
- Useful for high-volume messaging scenarios

**Kafka-Style Log Compaction:**
- Keep only latest message for each key
- Useful for state updates (e.g., agent status)
- Reduces log size while preserving latest state

```python
def compact_log(logfile, key_field='correlation_id'):
    """Compact log keeping only latest message per key"""
    latest = {}

    # Read all messages
    with open(logfile, 'r') as f:
        for line in f:
            msg = json.loads(line.strip())
            key = msg.get(key_field)
            if key:
                latest[key] = msg

    # Write compacted log
    tmp_file = f"{logfile}.compact"
    with open(tmp_file, 'w') as f:
        for msg in latest.values():
            f.write(json.dumps(msg) + '\n')

    os.rename(tmp_file, logfile)
```

**Retention Policies:**
- Delete segments older than N days
- Keep minimum number of recent segments
- Archive important messages before deletion

### Handling Concurrent Appends

**File Locking Approach:**
- Use `fcntl.flock()` (POSIX) for advisory locks
- Lock before append, unlock after
- Brief lock duration (microseconds) minimizes contention

**Lock-Free Approach (Advanced):**
- Each writer has dedicated segment file
- Background merger consolidates segments
- Higher complexity, better concurrency

**Recommendation:** Use file locking for simplicity and reliability. Lock contention is minimal for append-only operations.

---

## 3. Message Queue Designs with File Persistence

### File-Backed Queue Implementations

**Queue Directory Structure:**
```
.apm/queues/
├── tasks/
│   ├── pending/
│   │   ├── task_001.json
│   │   ├── task_002.json
│   │   └── task_003.json
│   ├── processing/
│   │   └── task_001.json
│   └── completed/
│       └── task_000.json
└── dlq/  # Dead letter queue
    └── task_failed_001.json
```

**Queue Operations:**

1. **Enqueue:** Write task to `pending/` directory
2. **Dequeue:** Move task from `pending/` to `processing/` atomically
3. **Complete:** Move from `processing/` to `completed/`
4. **Fail:** Move to `dlq/` after max retries

**Atomic Dequeue Pattern:**
```python
def dequeue_task(queue_dir):
    """Atomically dequeue next task"""
    pending_dir = os.path.join(queue_dir, 'pending')
    processing_dir = os.path.join(queue_dir, 'processing')

    # List pending tasks
    tasks = sorted(os.listdir(pending_dir))
    if not tasks:
        return None

    task_file = tasks[0]
    src = os.path.join(pending_dir, task_file)
    dst = os.path.join(processing_dir, task_file)

    try:
        # Atomic move marks task as processing
        os.rename(src, dst)
        with open(dst, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        # Another consumer grabbed it
        return dequeue_task(queue_dir)  # Try next
```

### Durability Guarantees and Crash Recovery

**Write-Ahead Logging:**
- Write task to durable storage before acknowledging
- Use `fsync()` to force to disk
- Ensures no message loss on crash

**Crash Recovery Process:**
```python
def recover_after_crash(queue_dir):
    """Move stale processing tasks back to pending"""
    processing_dir = os.path.join(queue_dir, 'processing')
    pending_dir = os.path.join(queue_dir, 'pending')

    for task_file in os.listdir(processing_dir):
        task_path = os.path.join(processing_dir, task_file)

        # Check if task was being processed at crash
        age = time.time() - os.path.getmtime(task_path)
        if age > PROCESSING_TIMEOUT:
            # Move back to pending for retry
            dst = os.path.join(pending_dir, task_file)
            os.rename(task_path, dst)
```

**Durability Levels:**

| Level | Method | Latency | Durability |
|-------|--------|---------|------------|
| **None** | Write without sync | ~1ms | Lost on crash |
| **Buffered** | Write + flush | ~5ms | Lost on power loss |
| **Synced** | Write + fsync | ~10-50ms | Survives crash/power loss |

**Recommendation:** Use buffered writes for most messages, synced writes for critical state changes.

### Message Ordering and Priority

**FIFO Ordering:**
- Use filename prefixes with timestamps: `20251112_100000_task.json`
- Sort directory listings to get chronological order
- Atomic rename preserves order

**Priority Queues:**
```
queues/tasks/
├── high/
├── medium/
└── low/
```

**Priority Processing:**
```python
def dequeue_with_priority(queue_dir):
    """Dequeue from highest priority first"""
    for priority in ['high', 'medium', 'low']:
        task = dequeue_task(os.path.join(queue_dir, priority))
        if task:
            task['priority'] = priority
            return task
    return None
```

### Acknowledgment Patterns

**At-Least-Once Delivery:**
- Task stays in `processing/` until acknowledged
- Timeout moves back to `pending/` for retry
- May deliver duplicates (consumer must be idempotent)

**Exactly-Once Delivery (Best Effort):**
- Use unique task IDs and deduplication
- Track processed IDs in separate log
- Check before processing

```python
class DeduplicatingConsumer:
    def __init__(self):
        self.processed = set()
        self.load_processed_ids()

    def process_task(self, task):
        task_id = task['id']
        if task_id in self.processed:
            return  # Skip duplicate

        # Process task
        result = self.do_work(task)

        # Mark as processed
        self.processed.add(task_id)
        self.save_processed_id(task_id)

        return result
```

### Dead Letter Queue Pattern

**DLQ Strategy:**
- Move messages to DLQ after max retry attempts
- Preserve original message + error metadata
- Manual review/reprocessing required

```python
def handle_failed_task(task, error, queue_dir):
    """Move failed task to dead letter queue"""
    dlq_dir = os.path.join(queue_dir, 'dlq')

    dlq_entry = {
        'original_task': task,
        'error': str(error),
        'timestamp': datetime.utcnow().isoformat(),
        'retry_count': task.get('retry_count', 0)
    }

    filename = f"failed_{task['id']}.json"
    filepath = os.path.join(dlq_dir, filename)

    with open(filepath, 'w') as f:
        json.dump(dlq_entry, f, indent=2)
```

**DLQ Monitoring:**
- Periodic checks for DLQ entries
- Alert on threshold (e.g., >10 failed tasks)
- Automated retry with exponential backoff

---

## 4. Inter-Process Communication Best Practices

### IPC Patterns for Loosely-Coupled Agents

**Shared Directory Pattern:**
- Each agent owns dedicated directories
- Read from shared locations, write to owned locations
- No cross-process file locking needed

**Mailbox Pattern:**
```
.apm/mailboxes/
├── manager/
│   ├── inbox/
│   └── outbox/
└── impl_001/
    ├── inbox/
    └── outbox/
```

Agents write to recipient's `inbox/`, read from own `inbox/`.

**Event Bus Pattern:**
```
.apm/events/
└── events.ndjson  # Shared event log
```

All agents append events, consumers filter by type/target.

### File Locking Strategies

**Advisory Locks (fcntl.flock):**
```python
import fcntl

def with_file_lock(filepath, mode='r'):
    """Context manager for file locking"""
    with open(filepath, mode) as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)  # Exclusive lock
        try:
            yield f
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)  # Unlock

# Usage
with with_file_lock('data.json', 'w') as f:
    f.write(json.dumps(data))
```

**Lock-Free Atomic Write Pattern:**
```python
def atomic_write(filepath, content):
    """Write file atomically using tmp-rename pattern"""
    tmp_path = f"{filepath}.tmp.{os.getpid()}.{time.time()}"

    # Write to temporary file
    with open(tmp_path, 'w') as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())

    # Atomic rename (POSIX guarantees atomicity)
    os.rename(tmp_path, filepath)
```

**Comparison:**

| Approach | Pros | Cons |
|----------|------|------|
| **Advisory Locks** | Simple, prevents concurrent writes | Requires cooperation, may block |
| **Atomic Rename** | Lock-free, guaranteed atomic | Overwrites entire file, no appends |
| **Append with Lock** | Supports incremental writes | Slight overhead per append |

**Recommendation:** Use atomic rename for full-file updates, append with lock for log files.

### Handling Split-Brain Scenarios

**Prevention Strategies:**

1. **Single Writer Principle:**
   - Only one process writes to each file
   - Readers can be many, writer is one
   - Eliminates split-brain by design

2. **Leader Election via PID File:**
```python
def acquire_leadership(lockfile):
    """Become leader by acquiring lock file"""
    try:
        # Try to create lock file exclusively
        fd = os.open(lockfile, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return True
    except FileExistsError:
        # Another process is leader
        return False

def release_leadership(lockfile):
    """Release leadership"""
    try:
        # Verify we're the leader
        with open(lockfile, 'r') as f:
            pid = int(f.read().strip())
        if pid == os.getpid():
            os.unlink(lockfile)
    except FileNotFoundError:
        pass
```

3. **Fencing Tokens:**
   - Monotonically increasing generation numbers
   - Each write includes generation token
   - Reject writes from older generations

```python
class FencedWriter:
    def __init__(self, filepath):
        self.filepath = filepath
        self.generation = self.read_generation()

    def write_fenced(self, data):
        """Write with generation check"""
        self.generation += 1
        fenced_data = {
            'generation': self.generation,
            'data': data,
            'timestamp': datetime.utcnow().isoformat()
        }
        atomic_write(self.filepath, json.dumps(fenced_data))
```

### Process Discovery and Registration

**Service Registry Pattern:**
```python
# .apm/registry/agents.json
{
    "agents": [
        {
            "id": "manager_001",
            "type": "manager",
            "pid": 12345,
            "started_at": "2025-11-12T10:00:00Z",
            "heartbeat": "2025-11-12T10:30:00Z",
            "status": "healthy"
        },
        {
            "id": "impl_001",
            "type": "implementation",
            "pid": 12346,
            "started_at": "2025-11-12T10:01:00Z",
            "heartbeat": "2025-11-12T10:30:00Z",
            "status": "healthy"
        }
    ]
}
```

**Registration Process:**
```python
class AgentRegistry:
    def __init__(self, registry_file):
        self.registry_file = registry_file

    def register(self, agent_info):
        """Register new agent"""
        with with_file_lock(self.registry_file, 'r+') as f:
            registry = json.load(f)

            # Remove stale entries for this agent ID
            registry['agents'] = [
                a for a in registry['agents']
                if a['id'] != agent_info['id']
            ]

            # Add new entry
            registry['agents'].append({
                **agent_info,
                'registered_at': datetime.utcnow().isoformat()
            })

            f.seek(0)
            f.truncate()
            json.dump(registry, f, indent=2)

    def discover(self, agent_type=None):
        """Discover active agents"""
        with open(self.registry_file, 'r') as f:
            registry = json.load(f)

        agents = registry['agents']
        if agent_type:
            agents = [a for a in agents if a['type'] == agent_type]

        # Filter out stale entries
        return [a for a in agents if self.is_alive(a)]

    def is_alive(self, agent_info):
        """Check if agent is still alive"""
        heartbeat_age = time.time() - datetime.fromisoformat(
            agent_info['heartbeat']
        ).timestamp()
        return heartbeat_age < 30  # 30 second timeout
```

### Graceful Degradation

**Timeout and Retry Policies:**

```python
class RobustMessageSender:
    def __init__(self):
        self.max_retries = 3
        self.base_delay = 1  # seconds
        self.max_delay = 30

    def send_message(self, channel, message):
        """Send message with exponential backoff retry"""
        for attempt in range(self.max_retries):
            try:
                self.write_message(channel, message)
                return True
            except Exception as e:
                if attempt == self.max_retries - 1:
                    # Final attempt failed
                    self.handle_send_failure(message, e)
                    return False

                # Exponential backoff
                delay = min(
                    self.base_delay * (2 ** attempt),
                    self.max_delay
                )
                time.sleep(delay)

        return False

    def handle_send_failure(self, message, error):
        """Handle permanent send failure"""
        # Log to DLQ, raise alert, etc.
        pass
```

**Circuit Breaker Pattern:**
```python
class CircuitBreaker:
    def __init__(self, failure_threshold=5, timeout=60):
        self.failure_threshold = failure_threshold
        self.timeout = timeout
        self.failures = 0
        self.last_failure_time = None
        self.state = 'CLOSED'  # CLOSED, OPEN, HALF_OPEN

    def call(self, func, *args, **kwargs):
        """Execute function with circuit breaker"""
        if self.state == 'OPEN':
            if time.time() - self.last_failure_time > self.timeout:
                self.state = 'HALF_OPEN'
            else:
                raise Exception("Circuit breaker is OPEN")

        try:
            result = func(*args, **kwargs)
            self.on_success()
            return result
        except Exception as e:
            self.on_failure()
            raise

    def on_success(self):
        self.failures = 0
        self.state = 'CLOSED'

    def on_failure(self):
        self.failures += 1
        self.last_failure_time = time.time()
        if self.failures >= self.failure_threshold:
            self.state = 'OPEN'
```

---

## Pattern Recommendations

### Top 5 Recommended Patterns for APM System

#### 1. **Dual-Channel NDJSON Append-Only Logs**

**Description:** Each agent pair has bidirectional channels using NDJSON append-only logs.

**Pros:**
- Simple, proven pattern (used by Kafka, event sourcing systems)
- Excellent durability and crash recovery
- Easy debugging (human-readable logs)
- No write contention (single writer per file)
- Stream-friendly (process line-by-line)

**Cons:**
- Log growth over time (requires rotation)
- Slightly higher disk usage than binary formats
- Need to track consumer position

**Applicability:** **Highly Recommended** for APM system. Perfect for agent coordination with durability guarantees.

**Implementation Guidance:**
```python
# Message producer
def send_message(channel_dir, message):
    logfile = os.path.join(channel_dir, 'messages.ndjson')
    message['id'] = generate_message_id()
    message['timestamp'] = datetime.utcnow().isoformat()

    line = json.dumps(message) + '\n'
    with open(logfile, 'a') as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        f.write(line)
        f.flush()
        fcntl.flock(f.fileno(), fcntl.LOCK_UN)

# Message consumer
class MessageConsumer:
    def __init__(self, channel_dir):
        self.logfile = os.path.join(channel_dir, 'messages.ndjson')
        self.position = 0

    def poll_messages(self):
        if not os.path.exists(self.logfile):
            return []

        messages = []
        with open(self.logfile, 'r') as f:
            f.seek(self.position)
            for line in f:
                if line.strip():
                    messages.append(json.loads(line))
            self.position = f.tell()
        return messages
```

---

#### 2. **File Watching with Chokidar/Watchdog**

**Description:** Use OS-level file watching for event-driven message delivery.

**Pros:**
- Low latency (10-50ms)
- Very low CPU usage (kernel events)
- Scalable (no polling overhead)
- Cross-platform support

**Cons:**
- Slightly more complex than polling
- May not work on some network filesystems
- Requires event debouncing

**Applicability:** **Highly Recommended**. Use as primary notification mechanism with polling fallback.

**Implementation Guidance:**
```python
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

class ChannelWatcher(FileSystemEventHandler):
    def __init__(self, consumer):
        self.consumer = consumer
        self.debounce_timer = None

    def on_modified(self, event):
        if event.src_path.endswith('messages.ndjson'):
            # Debounce rapid events
            if self.debounce_timer:
                self.debounce_timer.cancel()

            self.debounce_timer = threading.Timer(
                0.05,  # 50ms debounce
                self.process_messages
            )
            self.debounce_timer.start()

    def process_messages(self):
        messages = self.consumer.poll_messages()
        for msg in messages:
            self.consumer.handle_message(msg)

# Setup watcher
observer = Observer()
observer.schedule(
    ChannelWatcher(consumer),
    path=channel_dir,
    recursive=False
)
observer.start()
```

---

#### 3. **Atomic Write-Tmp-Rename Pattern**

**Description:** Write to temporary file, then atomically rename to final name.

**Pros:**
- Guaranteed atomic updates (POSIX)
- No partial reads
- No file locking needed for full-file updates
- Simple and reliable

**Cons:**
- Overwrites entire file (not suitable for appends)
- Creates temporary files
- Slightly higher I/O for large files

**Applicability:** **Recommended** for state files (heartbeats, registry, configuration).

**Implementation Guidance:**
```python
import os
import tempfile

def atomic_write(filepath, content):
    """Atomic write using tmp-rename pattern"""
    # Create temp file in same directory (same filesystem)
    dir_path = os.path.dirname(filepath)
    fd, tmp_path = tempfile.mkstemp(
        dir=dir_path,
        prefix='.tmp_',
        suffix='.json'
    )

    try:
        # Write content
        os.write(fd, content.encode('utf-8'))
        os.fsync(fd)  # Force to disk
        os.close(fd)

        # Atomic rename
        os.rename(tmp_path, filepath)
    except:
        # Cleanup on error
        try:
            os.close(fd)
        except:
            pass
        try:
            os.unlink(tmp_path)
        except:
            pass
        raise
```

---

#### 4. **Correlation ID Request-Response Pattern**

**Description:** Use correlation IDs to match requests with responses in asynchronous communication.

**Pros:**
- Enables request-response over one-way channels
- Simple to implement
- Works with async/event-driven systems
- Easy to trace request flows

**Cons:**
- Requires response timeout handling
- Need to track pending requests
- Possible memory growth if responses lost

**Applicability:** **Essential** for APM system. Manager needs to correlate task requests with agent responses.

**Implementation Guidance:**
```python
import uuid
from typing import Dict, Callable
import threading

class RequestResponseCoordinator:
    def __init__(self):
        self.pending: Dict[str, Callable] = {}
        self.timeout = 30  # seconds

    def send_request(self, channel, request_data, callback):
        """Send request and register callback for response"""
        correlation_id = str(uuid.uuid4())

        message = {
            'type': 'request',
            'correlation_id': correlation_id,
            'payload': request_data
        }

        # Register callback
        self.pending[correlation_id] = {
            'callback': callback,
            'timestamp': time.time()
        }

        # Send message
        send_message(channel, message)

        # Setup timeout
        threading.Timer(
            self.timeout,
            self.handle_timeout,
            args=[correlation_id]
        ).start()

    def handle_response(self, response_message):
        """Handle incoming response"""
        correlation_id = response_message.get('correlation_id')

        if correlation_id in self.pending:
            entry = self.pending.pop(correlation_id)
            entry['callback'](response_message['payload'])

    def handle_timeout(self, correlation_id):
        """Handle request timeout"""
        if correlation_id in self.pending:
            entry = self.pending.pop(correlation_id)
            entry['callback'](None)  # Or raise timeout error

# Usage
coordinator = RequestResponseCoordinator()

def handle_result(result):
    if result is None:
        print("Request timed out")
    else:
        print(f"Got response: {result}")

coordinator.send_request(
    channel_dir,
    {'action': 'run_test', 'suite': 'unit'},
    handle_result
)
```

---

#### 5. **Heartbeat + Timeout-Based Liveness Detection**

**Description:** Agents periodically write heartbeat timestamps; monitors detect failures via timeout.

**Pros:**
- Simple and effective
- Low overhead
- Works across process boundaries
- Easy to debug (just check file timestamp)

**Cons:**
- Slight delay in failure detection (timeout period)
- Requires periodic writes (disk I/O)
- Clock synchronization issues possible

**Applicability:** **Highly Recommended** for detecting agent crashes and coordinating recovery.

**Implementation Guidance:**
```python
class HeartbeatManager:
    def __init__(self, heartbeat_file, interval=10):
        self.heartbeat_file = heartbeat_file
        self.interval = interval
        self.running = False
        self.thread = None

    def start(self):
        """Start sending heartbeats"""
        self.running = True
        self.thread = threading.Thread(target=self._heartbeat_loop)
        self.thread.daemon = True
        self.thread.start()

    def stop(self):
        """Stop heartbeat"""
        self.running = False
        if self.thread:
            self.thread.join()

    def _heartbeat_loop(self):
        """Periodic heartbeat sender"""
        while self.running:
            self.send_heartbeat()
            time.sleep(self.interval)

    def send_heartbeat(self):
        """Write heartbeat timestamp"""
        heartbeat = {
            'timestamp': datetime.utcnow().isoformat(),
            'pid': os.getpid(),
            'status': 'healthy'
        }
        atomic_write(
            self.heartbeat_file,
            json.dumps(heartbeat, indent=2)
        )

class HeartbeatMonitor:
    def __init__(self, heartbeat_file, timeout=30):
        self.heartbeat_file = heartbeat_file
        self.timeout = timeout

    def is_alive(self):
        """Check if agent is alive based on heartbeat"""
        try:
            with open(self.heartbeat_file, 'r') as f:
                heartbeat = json.load(f)

            last_beat = datetime.fromisoformat(heartbeat['timestamp'])
            age = (datetime.utcnow() - last_beat).total_seconds()

            return age < self.timeout
        except (FileNotFoundError, json.JSONDecodeError, KeyError):
            return False

# Usage
# In agent process
hb_manager = HeartbeatManager('.apm/agent_001/heartbeat.json')
hb_manager.start()

# In monitor process
monitor = HeartbeatMonitor('.apm/agent_001/heartbeat.json')
if not monitor.is_alive():
    print("Agent is dead!")
```

---

## Trade-Off Analysis

### Polling vs File Watching

| Aspect | Polling | File Watching (inotify/chokidar) |
|--------|---------|----------------------------------|
| **Latency** | 100-1000ms (depends on poll interval) | 10-50ms (event-driven) |
| **CPU Usage** | Higher (constant checking) | Very low (kernel events) |
| **Reliability** | Very high (simple logic) | High (OS-dependent) |
| **Implementation** | Simple (single loop) | Moderate (event handlers) |
| **Cross-platform** | Universal | Good (platform-specific APIs) |
| **Network FS Support** | Works everywhere | May not work on NFS/CIFS |
| **Scalability** | Poor (N agents = N polls) | Excellent (kernel-managed) |
| **Debugging** | Easy (predictable behavior) | Moderate (event timing) |

**Recommendation:**
- **Primary:** File watching (chokidar/watchdog) for low latency
- **Fallback:** Polling (1-2 second interval) if file watching unavailable
- **Hybrid:** File watching with periodic polling as safety net

---

### Message Ordering Guarantees

| Approach | Ordering | Complexity | Performance | Durability |
|----------|----------|------------|-------------|------------|
| **Single append-only log** | Strict total order | Low | High (sequential writes) | Excellent |
| **Per-key ordering** | Partial order | Medium | Very high (parallel writes) | Excellent |
| **Timestamp-based** | Best-effort | Low | High | Good (clock skew risk) |
| **No guarantees** | None | Very low | Highest | Varies |

**Recommendation:**
- Use **single append-only log per channel** for APM system
- Provides strict ordering within each agent-to-agent channel
- Simple to implement and reason about
- Acceptable performance for agent coordination (not high-frequency trading)

---

### Concurrent Write Handling

| Approach | Consistency | Performance | Complexity | Use Case |
|----------|-------------|-------------|------------|----------|
| **Advisory locks (flock)** | Strong | Good | Low | Shared log appends |
| **Atomic rename** | Strong | Excellent | Low | Full-file updates |
| **Single writer (by design)** | Perfect | Excellent | Very low | Dedicated channels |
| **Lock-free algorithms** | Eventually consistent | Excellent | High | High-concurrency scenarios |

**Recommendation:**
- **Preferred:** Single writer by design (each agent owns its outbox)
- **Fallback:** Advisory locks for shared logs
- **State files:** Atomic rename pattern

---

### Durability vs Performance

| Durability Level | Method | Write Latency | Crash Safety |
|------------------|--------|---------------|--------------|
| **None** | Write only | ~1ms | Data lost on crash |
| **Buffered** | Write + flush | ~5ms | Data lost on power loss |
| **Synced** | Write + fsync | ~10-50ms | Survives all failures |
| **Replicated** | Write to multiple locations | ~50-200ms | Survives disk failure |

**Recommendation for APM:**
- **Regular messages:** Buffered writes (flush but no fsync)
- **Critical state:** Synced writes (fsync)
- **Non-critical logs:** No sync (accept potential loss)

**Implementation:**
```python
def write_message(filepath, message, durability='buffered'):
    """Write message with configurable durability"""
    line = json.dumps(message) + '\n'

    with open(filepath, 'a', buffering=1) as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            f.write(line)

            if durability in ['buffered', 'synced']:
                f.flush()

            if durability == 'synced':
                os.fsync(f.fileno())
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
```

---

## Example Message Formats

### Message Envelope Structure

```json
{
  "id": "msg_20251112_103045_001",
  "type": "task_request",
  "correlation_id": "req_abc123",
  "timestamp": "2025-11-12T10:30:45.123Z",
  "sender": "manager_001",
  "recipient": "impl_001",
  "priority": "normal",
  "payload": {
    "action": "run_tests",
    "suite": "integration",
    "timeout": 300
  }
}
```

### Message Types

**Task Request:**
```json
{
  "id": "msg_001",
  "type": "task_request",
  "correlation_id": "req_001",
  "timestamp": "2025-11-12T10:00:00Z",
  "sender": "manager_001",
  "recipient": "impl_001",
  "payload": {
    "task_type": "implement_feature",
    "description": "Add user authentication",
    "context": {
      "files": ["auth.py", "models.py"],
      "requirements": ["OAuth2 support", "JWT tokens"]
    }
  }
}
```

**Task Acknowledgment:**
```json
{
  "id": "msg_002",
  "type": "task_ack",
  "correlation_id": "req_001",
  "timestamp": "2025-11-12T10:00:01Z",
  "sender": "impl_001",
  "recipient": "manager_001",
  "payload": {
    "status": "accepted",
    "estimated_duration": 600
  }
}
```

**Status Update:**
```json
{
  "id": "msg_003",
  "type": "status_update",
  "correlation_id": "req_001",
  "timestamp": "2025-11-12T10:05:00Z",
  "sender": "impl_001",
  "recipient": "manager_001",
  "payload": {
    "progress": 0.3,
    "current_step": "Writing authentication logic",
    "files_modified": ["auth.py"]
  }
}
```

**Task Completion:**
```json
{
  "id": "msg_004",
  "type": "task_complete",
  "correlation_id": "req_001",
  "timestamp": "2025-11-12T10:10:00Z",
  "sender": "impl_001",
  "recipient": "manager_001",
  "payload": {
    "status": "success",
    "result": {
      "files_created": ["auth.py", "tests/test_auth.py"],
      "tests_passed": true,
      "test_results": {
        "total": 15,
        "passed": 15,
        "failed": 0
      }
    }
  }
}
```

**Error Message:**
```json
{
  "id": "msg_005",
  "type": "error",
  "correlation_id": "req_001",
  "timestamp": "2025-11-12T10:10:00Z",
  "sender": "impl_001",
  "recipient": "manager_001",
  "payload": {
    "error_type": "TestFailure",
    "error_message": "3 tests failed",
    "details": {
      "failed_tests": ["test_login", "test_logout", "test_token_refresh"],
      "logs": "..."
    },
    "recoverable": true
  }
}
```

**Heartbeat:**
```json
{
  "id": "hb_001",
  "type": "heartbeat",
  "timestamp": "2025-11-12T10:15:00Z",
  "sender": "impl_001",
  "payload": {
    "status": "healthy",
    "last_message_processed": "msg_003",
    "tasks_in_progress": 1,
    "system_info": {
      "cpu_percent": 45.2,
      "memory_mb": 512
    }
  }
}
```

### Acknowledgment Format

**Delivery Acknowledgment:**
```json
{
  "id": "ack_001",
  "type": "ack",
  "correlation_id": "msg_001",
  "timestamp": "2025-11-12T10:00:00.150Z",
  "sender": "impl_001",
  "payload": {
    "ack_type": "delivered",
    "message_id": "msg_001"
  }
}
```

**Processing Acknowledgment:**
```json
{
  "id": "ack_002",
  "type": "ack",
  "correlation_id": "msg_001",
  "timestamp": "2025-11-12T10:00:05Z",
  "sender": "impl_001",
  "payload": {
    "ack_type": "processed",
    "message_id": "msg_001",
    "result": "success"
  }
}
```

---

## Communication Flow Examples

### Request-Response Flow

```
Manager                                    Implementation Agent
   |                                              |
   |-- task_request (correlation_id: req_001) -->|
   |                                              |
   |<---- task_ack (correlation_id: req_001) -----|
   |                                              |
   |                                              | (Processing...)
   |                                              |
   |<- status_update (correlation_id: req_001) ---|
   |                                              |
   |                                              | (More processing...)
   |                                              |
   |<- task_complete (correlation_id: req_001) ---|
   |                                              |
```

**File Operations:**
1. Manager writes to `manager_to_impl/messages.ndjson`
2. Impl agent's file watcher detects change
3. Impl reads new message, processes it
4. Impl writes ack to `impl_to_manager/messages.ndjson`
5. Manager's file watcher detects ack
6. Manager matches ack to pending request via correlation_id

### Broadcast Pattern

```
Manager                  Impl_001         Impl_002         Impl_003
   |                        |                |                |
   |-- broadcast: "status?" -->              |                |
   |                        |                |                |
   |<---- status: "idle" ---|                |                |
   |                        |                |                |
   |<---------------------- status: "busy" --|                |
   |                        |                |                |
   |<-------------------------------------- status: "idle" ----|
   |                        |                |                |
```

**Implementation:**
```python
def broadcast_message(message, agent_ids):
    """Send message to multiple agents"""
    correlation_id = str(uuid.uuid4())

    for agent_id in agent_ids:
        channel = f".apm/channels/manager_to_{agent_id}"
        send_message(channel, {
            **message,
            'correlation_id': correlation_id,
            'broadcast': True
        })

    return correlation_id

# Wait for all responses
def collect_responses(correlation_id, expected_count, timeout=10):
    """Collect responses from broadcast"""
    responses = []
    deadline = time.time() + timeout

    while len(responses) < expected_count:
        if time.time() > deadline:
            break

        # Check for new responses
        new_responses = consumer.poll_messages()
        for resp in new_responses:
            if resp.get('correlation_id') == correlation_id:
                responses.append(resp)

        time.sleep(0.1)

    return responses
```

### Error Handling Flow

```
Manager                                    Implementation Agent
   |                                              |
   |-- task_request (correlation_id: req_001) -->|
   |                                              |
   |<---- task_ack (correlation_id: req_001) -----|
   |                                              |
   |                                              | (Error occurs)
   |                                              |
   |<----- error (correlation_id: req_001) -------|
   |                                              |
   |-- retry_task (correlation_id: req_002) ----->|
   |                                              |
   |<---- task_ack (correlation_id: req_002) -----|
   |                                              |
   |<- task_complete (correlation_id: req_002) ---|
   |                                              |
```

**Error Handler:**
```python
def handle_error_message(error_msg):
    """Handle error from agent"""
    correlation_id = error_msg['correlation_id']

    if correlation_id not in pending_requests:
        return

    original_request = pending_requests[correlation_id]
    retry_count = original_request.get('retry_count', 0)

    if retry_count < MAX_RETRIES:
        # Retry with exponential backoff
        delay = 2 ** retry_count
        time.sleep(delay)

        retry_request = {
            **original_request,
            'retry_count': retry_count + 1,
            'correlation_id': generate_correlation_id()
        }

        send_request(channel, retry_request)
    else:
        # Max retries exceeded, move to DLQ
        handle_permanent_failure(original_request, error_msg)
```

### Heartbeat Monitoring Flow

```
Manager                                    Implementation Agent
   |                                              |
   |                                              | (Every 10s)
   |<------------ heartbeat (status: healthy) ----|
   |                                              |
   |                                              | (10s later)
   |<------------ heartbeat (status: healthy) ----|
   |                                              |
   |                                              | [CRASH]
   |                                              |
   | (30s timeout)                                |
   | Detect agent failure                         |
   | Reassign tasks                               |
   |                                              |
```

**Monitor Implementation:**
```python
class AgentMonitor:
    def __init__(self):
        self.agents = {}
        self.check_interval = 5
        self.timeout = 30

    def start_monitoring(self):
        """Start monitoring all agents"""
        while True:
            self.check_all_agents()
            time.sleep(self.check_interval)

    def check_all_agents(self):
        """Check health of all registered agents"""
        for agent_id, info in list(self.agents.items()):
            heartbeat_file = f".apm/channels/{agent_id}/heartbeat.json"

            if not self.is_agent_alive(heartbeat_file):
                self.handle_agent_failure(agent_id)

    def is_agent_alive(self, heartbeat_file):
        """Check if agent heartbeat is recent"""
        try:
            with open(heartbeat_file, 'r') as f:
                hb = json.load(f)

            age = time.time() - datetime.fromisoformat(
                hb['timestamp']
            ).timestamp()

            return age < self.timeout
        except:
            return False

    def handle_agent_failure(self, agent_id):
        """Handle detected agent failure"""
        print(f"Agent {agent_id} has failed!")

        # Reassign pending tasks
        pending = self.get_pending_tasks(agent_id)
        for task in pending:
            self.reassign_task(task, agent_id)

        # Remove from active agents
        self.agents.pop(agent_id, None)
```

---

## Technology and Pattern References

### Key Systems and Technologies

**Kafka (Distributed Event Streaming):**
- URL: https://kafka.apache.org/
- Key concepts: Append-only logs, partitions, consumer groups, log compaction
- Relevant for: Message log architecture, durability guarantees, ordering

**Event Sourcing:**
- Martin Fowler's Event Sourcing: https://martinfowler.com/eaaDev/EventSourcing.html
- Immutable event logs as source of truth
- State reconstruction from events
- Relevant for: Agent state tracking, audit trails

**File-Based Queues:**
- persist-queue (Python): https://github.com/peter-wangxu/persist-queue
- Disk-backed queues with crash recovery
- Relevant for: Task queue implementation

**File Watching Libraries:**
- Chokidar (Node.js): https://github.com/paulmillr/chokidar
- Watchdog (Python): https://github.com/gorakhargosh/watchdog
- Cross-platform file system events
- Relevant for: Low-latency message notification

**POSIX File Operations:**
- POSIX rename atomicity guarantees
- Advisory file locking (fcntl.flock)
- Relevant for: Atomic writes, concurrent access

### Academic Papers and Articles

**File System Semantics:**
- "All File Systems Are Not Created Equal" (OSDI 2014)
- Discusses atomicity guarantees across filesystems
- https://www.usenix.org/conference/osdi14/technical-sessions/presentation/pillai

**Distributed Systems Patterns:**
- "Patterns of Distributed Systems" by Martin Kleppmann
- Leader election, heartbeats, fencing tokens
- https://martinfowler.com/articles/patterns-of-distributed-systems/

**Message Queue Patterns:**
- "Enterprise Integration Patterns" by Hohpe & Woolf
- Message channels, correlation identifiers, dead letter queues
- https://www.enterpriseintegrationpatterns.com/

### Code Examples

**Python File-Based Message Queue:**
```python
# Complete example combining patterns
import os
import json
import fcntl
import time
from datetime import datetime
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

class MessageChannel:
    """File-based message channel with NDJSON logs"""

    def __init__(self, channel_dir):
        self.channel_dir = channel_dir
        self.messages_file = os.path.join(channel_dir, 'messages.ndjson')
        self.acks_file = os.path.join(channel_dir, 'acks.ndjson')
        self.position = 0

        os.makedirs(channel_dir, exist_ok=True)

    def send(self, message):
        """Send message (append to log)"""
        message['id'] = self._generate_id()
        message['timestamp'] = datetime.utcnow().isoformat()

        self._append_to_log(self.messages_file, message)
        return message['id']

    def receive(self):
        """Receive new messages since last read"""
        if not os.path.exists(self.messages_file):
            return []

        messages = []
        with open(self.messages_file, 'r') as f:
            f.seek(self.position)
            for line in f:
                if line.strip():
                    messages.append(json.loads(line))
            self.position = f.tell()

        return messages

    def acknowledge(self, message_id):
        """Acknowledge message processing"""
        ack = {
            'message_id': message_id,
            'timestamp': datetime.utcnow().isoformat()
        }
        self._append_to_log(self.acks_file, ack)

    def _append_to_log(self, filepath, data):
        """Atomically append to NDJSON log"""
        line = json.dumps(data, separators=(',', ':')) + '\n'

        with open(filepath, 'a', buffering=1) as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            try:
                f.write(line)
                f.flush()
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)

    def _generate_id(self):
        """Generate unique message ID"""
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')
        return f"msg_{timestamp}"

class ChannelWatcher(FileSystemEventHandler):
    """Watch channel for new messages"""

    def __init__(self, channel, callback):
        self.channel = channel
        self.callback = callback

    def on_modified(self, event):
        if event.src_path == self.channel.messages_file:
            messages = self.channel.receive()
            for msg in messages:
                self.callback(msg)

# Usage
def handle_message(message):
    print(f"Received: {message}")
    # Process message...
    channel.acknowledge(message['id'])

# Setup channel
channel = MessageChannel('.apm/channels/agent_001')

# Start watching
observer = Observer()
observer.schedule(
    ChannelWatcher(channel, handle_message),
    path=channel.channel_dir,
    recursive=False
)
observer.start()

# Send messages
channel.send({
    'type': 'task_request',
    'payload': {'action': 'test'}
})
```

---

## Implementation Guidance for APM System

### Recommended Architecture

```
.apm/
├── channels/                    # Agent-to-agent communication
│   ├── manager_to_impl_001/
│   │   ├── messages.ndjson
│   │   ├── acks.ndjson
│   │   └── heartbeat.json
│   ├── impl_001_to_manager/
│   │   ├── messages.ndjson
│   │   ├── acks.ndjson
│   │   └── heartbeat.json
│   └── ...
├── registry/
│   └── agents.json              # Active agent registry
├── queues/                      # Task queues
│   └── tasks/
│       ├── pending/
│       ├── processing/
│       ├── completed/
│       └── dlq/
└── logs/                        # System logs
    ├── manager.log
    └── impl_001.log
```

### Key Design Decisions

**1. Communication Pattern:**
- **Decision:** Use dual-channel NDJSON append-only logs
- **Rationale:** Simple, durable, debuggable, no write contention
- **Trade-off:** Slightly higher disk usage vs binary formats

**2. Message Notification:**
- **Decision:** File watching (watchdog/chokidar) with polling fallback
- **Rationale:** Low latency, low CPU, scalable
- **Trade-off:** Slightly more complex than pure polling

**3. Atomic Operations:**
- **Decision:** Write-tmp-rename for state files, append-with-lock for logs
- **Rationale:** POSIX guarantees, no partial reads/writes
- **Trade-off:** Extra I/O for temp files

**4. Request-Response:**
- **Decision:** Correlation IDs with pending request tracking
- **Rationale:** Enables async req-resp over one-way channels
- **Trade-off:** Need timeout handling, memory for pending requests

**5. Liveness Detection:**
- **Decision:** Heartbeat files with 10s interval, 30s timeout
- **Rationale:** Simple, reliable, easy to debug
- **Trade-off:** 30s delay in failure detection

### Potential Pitfalls to Avoid

**1. Log Growth:**
- **Problem:** NDJSON logs grow unbounded
- **Solution:** Implement log rotation (daily or size-based)
- **Mitigation:** Archive old logs, implement compaction for state logs

**2. File Watching on Network FS:**
- **Problem:** inotify may not work on NFS/CIFS
- **Solution:** Implement polling fallback
- **Detection:** Test file watching, fall back on errors

**3. Clock Skew:**
- **Problem:** Timestamp-based ordering fails with clock drift
- **Solution:** Use message sequence numbers within each channel
- **Mitigation:** Sync clocks with NTP

**4. Split-Brain:**
- **Problem:** Two managers both think they're active
- **Solution:** Leader election via PID file
- **Prevention:** Single writer principle per channel

**5. Message Loss on Crash:**
- **Problem:** Buffered writes lost on power failure
- **Solution:** Use fsync for critical messages
- **Trade-off:** Higher latency for critical operations

**6. Memory Leaks:**
- **Problem:** Pending requests accumulate if responses lost
- **Solution:** Implement timeout cleanup
- **Prevention:** Periodic sweep of old pending requests

**7. Race Conditions:**
- **Problem:** Read-modify-write on shared files
- **Solution:** Use atomic operations, advisory locks
- **Prevention:** Design for single writer per file

### Implementation Checklist

- [ ] Create channel directory structure
- [ ] Implement NDJSON append functions with locking
- [ ] Implement atomic write-tmp-rename for state files
- [ ] Setup file watching with watchdog/chokidar
- [ ] Implement polling fallback
- [ ] Create message envelope format
- [ ] Implement correlation ID tracking
- [ ] Setup heartbeat sender and monitor
- [ ] Implement log rotation
- [ ] Create agent registry
- [ ] Implement crash recovery logic
- [ ] Add timeout handling for requests
- [ ] Implement dead letter queue
- [ ] Add comprehensive logging
- [ ] Write integration tests

### Testing Strategy

**Unit Tests:**
- Message serialization/deserialization
- Atomic write operations
- Log rotation logic
- Correlation ID matching

**Integration Tests:**
- End-to-end message flow
- Request-response coordination
- Heartbeat and timeout detection
- Crash recovery
- Concurrent message handling

**Stress Tests:**
- High message volume
- Many concurrent agents
- Large log files
- Rapid agent start/stop

**Failure Tests:**
- Agent crashes
- File corruption
- Disk full scenarios
- Network filesystem issues

---

## Further Reading

**Distributed Systems:**
- "Designing Data-Intensive Applications" by Martin Kleppmann
- Covers event logs, replication, consistency

**Event Sourcing:**
- Greg Young's Event Sourcing talks
- CQRS and Event Sourcing patterns

**File System Internals:**
- "Operating Systems: Three Easy Pieces" (OSTEP)
- File system implementation details

**Message Queues:**
- RabbitMQ, Apache Kafka documentation
- Message queue patterns and best practices

**Python-Specific:**
- Watchdog documentation for file watching
- fcntl module for file locking
- Threading and multiprocessing for concurrent operations

---

## Conclusion

File-based inter-agent communication is a viable and robust approach for the APM system. By combining:

1. **NDJSON append-only logs** for message persistence
2. **File watching** for low-latency notifications
3. **Atomic operations** for consistency
4. **Correlation IDs** for request-response
5. **Heartbeats** for liveness detection

We can achieve WebSocket-like semantics with excellent durability, debuggability, and simplicity. The slightly higher latency (50-200ms) compared to true WebSockets is acceptable for agent coordination use cases.

The recommended patterns are battle-tested (Kafka, event sourcing) and leverage OS-level guarantees (POSIX atomicity) for reliability. With careful implementation of log rotation, crash recovery, and timeout handling, this architecture will provide a solid foundation for multi-agent coordination.

---

**End of Research Document**
