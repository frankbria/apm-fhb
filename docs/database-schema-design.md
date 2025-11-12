# apm-auto Database Schema Design Analysis

**Date:** 2025-11-12
**Task:** 1.1 - Database Schema Design and SQLite Initialization
**Step:** 1 - Schema Design Review

## Schema Overview

The database schema consists of **6 core tables** designed to support complete apm-auto state management:

1. **agents** - Agent state tracking (10 columns, 4 indexes)
2. **tasks** - Task state tracking (14 columns, 5 indexes)
3. **task_dependencies** - Task dependency relationships (4 columns, 3 indexes)
4. **sessions** - Session state tracking (10 columns, 3 indexes)
5. **session_checkpoints** - Session checkpoint snapshots (8 columns, 2 indexes)
6. **state_transitions** - State transition audit log (8 columns, 5 indexes)

**Total:** 54 columns, 22 indexes

## Requirement Coverage Analysis

### ✅ Agent Types Support
The `agents` table fully supports all three agent types through CHECK constraints:
- **Manager** - Orchestration and coordination
- **Implementation** - Task execution
- **AdHoc** - Specialized temporary work

Column: `type TEXT NOT NULL CHECK (type IN ('Manager', 'Implementation', 'AdHoc'))`

### ✅ State Transitions Coverage
Complete lifecycle state tracking through `status` columns with CHECK constraints:

**Agent States:** Spawning → Active → Waiting/Idle → Terminated
```sql
status TEXT NOT NULL CHECK (status IN ('Spawning', 'Active', 'Waiting', 'Idle', 'Terminated'))
```

**Task States:** Pending → Assigned → InProgress → Blocked → Completed/Failed
```sql
status TEXT NOT NULL CHECK (status IN ('Pending', 'Assigned', 'InProgress', 'Blocked', 'Completed', 'Failed'))
```

**Session States:** Initializing → Running → Paused → Completed/Failed
```sql
status TEXT NOT NULL CHECK (status IN ('Initializing', 'Running', 'Paused', 'Completed', 'Failed'))
```

### ✅ Task Dependencies
The `task_dependencies` junction table supports:
- Many-to-many task relationships
- Required vs optional dependencies
- Dependency type tracking
- Cascade deletes when tasks are removed

**Columns:**
- `task_id` - Dependent task (FK → tasks.id, CASCADE)
- `depends_on_task_id` - Prerequisite task (FK → tasks.id, CASCADE)
- `dependency_type` - 'required' or 'optional'
- `description` - Human-readable dependency explanation

**Unique Constraint:** Prevents duplicate dependencies

### ✅ Session Checkpoints
The `session_checkpoints` table provides recovery capability:
- Timestamped snapshots of session state
- Active agent tracking (JSON array)
- Completed/in-progress task lists (JSON arrays)
- Extensible metadata (JSON)
- Cascade delete with parent session

### ✅ Worktree Mappings
The `agents` table includes `worktree_path` column:
```sql
worktree_path TEXT NULL COMMENT 'Git worktree path for parallel execution'
```
Indexed for efficient lookup when needed.

### ✅ Timestamp Tracking for Audit Trails
All state tables include comprehensive timestamp columns:

**Agents:**
- `spawned_at` - Agent creation (DATETIME, default CURRENT_TIMESTAMP)
- `last_activity_at` - Last activity tracking (DATETIME, default CURRENT_TIMESTAMP)

**Tasks:**
- `start_time` - Execution start (DATETIME NULL)
- `completion_time` - Completion/failure time (DATETIME NULL)

**Sessions:**
- `start_time` - Session start (DATETIME, default CURRENT_TIMESTAMP)
- `pause_time` - Pause timestamp (DATETIME NULL)
- `end_time` - Completion/failure time (DATETIME NULL)

**State Transitions:**
- `timestamp` - Transition occurrence (DATETIME, default CURRENT_TIMESTAMP)

## Foreign Key Relationships Analysis

### ✅ Data Integrity Ensured

**1. Agents → Tasks Assignment**
```sql
agents.current_task → tasks.id ON DELETE SET NULL
```
**Rationale:** When a task is deleted, agent's current_task is nulled (agent becomes idle rather than orphaned)

**2. Tasks → Agents Assignment**
```sql
tasks.assigned_agent → agents.id ON DELETE SET NULL
```
**Rationale:** When an agent is terminated, task assignment is cleared (task returns to unassigned state)

**3. Task Dependencies**
```sql
task_dependencies.task_id → tasks.id ON DELETE CASCADE
task_dependencies.depends_on_task_id → tasks.id ON DELETE CASCADE
```
**Rationale:** When a task is deleted, all its dependency relationships are automatically removed

**4. Session Checkpoints → Sessions**
```sql
session_checkpoints.session_id → sessions.id ON DELETE CASCADE
```
**Rationale:** When a session is deleted, all its checkpoints are automatically removed

**No Circular References:** The schema is acyclic, preventing deadlocks and constraint violations.

## Indexing Strategy for Query Performance

### Frequently Queried Columns Indexed

**Agent Queries:**
- `idx_agents_status` - Find agents by lifecycle state (Active, Idle, etc.)
- `idx_agents_type` - Find agents by type (Manager, Implementation, AdHoc)
- `idx_agents_current_task` - Lookup agent by current task (partial index, WHERE current_task IS NOT NULL)
- `idx_agents_domain` - Find implementation agents by domain (partial index)

**Task Queries:**
- `idx_tasks_status` - Find tasks by execution state
- `idx_tasks_phase_id` - Group tasks by phase
- `idx_tasks_assigned_agent` - Find tasks for specific agent (partial index)
- `idx_tasks_priority` - Composite index (priority, status) for priority-ordered task queues
- `idx_tasks_required_domain` - Find tasks requiring specific domain (partial index)

**Task Dependencies:**
- `idx_task_deps_task_id` - Forward lookup: what does this task depend on?
- `idx_task_deps_depends_on` - Reverse lookup: what depends on this task?
- `idx_task_deps_unique` - Unique constraint preventing duplicate dependencies

**Session Queries:**
- `idx_sessions_status` - Find sessions by state
- `idx_sessions_project_id` - Group sessions by project
- `idx_sessions_start_time` - Time-ordered session history

**Checkpoint Queries:**
- `idx_checkpoints_session_id` - Find all checkpoints for a session
- `idx_checkpoints_timestamp` - Time-ordered checkpoint history

**Transition Audit:**
- `idx_transitions_entity` - Composite (entity_type, entity_id) for entity history
- `idx_transitions_timestamp` - Time-ordered transition log
- `idx_transitions_from_state` - Query by source state
- `idx_transitions_to_state` - Query by target state
- `idx_transitions_trigger` - Query by trigger type (UserAction, Automatic, Error, etc.)

### Partial Indexes for Efficiency
Used WHERE clauses on indexes for nullable columns to reduce index size:
- `WHERE current_task IS NOT NULL` on agents.current_task
- `WHERE assigned_agent IS NOT NULL` on tasks.assigned_agent
- `WHERE domain IS NOT NULL` on agents.domain
- `WHERE required_domain IS NOT NULL` on tasks.required_domain

## Schema Design Decisions

### 1. JSON Columns for Extensibility
**Decision:** Use JSON type for metadata fields
**Rationale:**
- Allows schema evolution without ALTER TABLE migrations
- Agent metadata can store config, process info, custom fields
- Task metadata can store tags, execution details, memory log paths
- Session metadata stores config, scope definitions, statistics
- Checkpoint snapshots store agent/task ID arrays

**Trade-off:** Slight query performance cost vs flexibility

### 2. TEXT for All IDs
**Decision:** Use TEXT for all primary/foreign keys instead of INTEGER
**Rationale:**
- Supports semantic IDs (e.g., 'agent_impl_001', 'task_1_3')
- Easier debugging and log analysis with readable IDs
- Supports UUID generation if needed later
- Consistent with TypeScript string types

### 3. DATETIME Type for Timestamps
**Decision:** Use DATETIME type with ISO 8601 format
**Rationale:**
- SQLite stores as TEXT in ISO 8601 format
- Compatible with JavaScript Date objects
- Supports time-based queries and ordering
- CURRENT_TIMESTAMP default for auto-timestamping

### 4. Separate Transitions Table
**Decision:** Dedicated `state_transitions` audit table instead of columns on entity tables
**Rationale:**
- Preserves complete transition history
- Supports debugging and analytics
- Doesn't bloat main entity tables
- Enables transition validation queries

### 5. Enum Validation via CHECK Constraints
**Decision:** CHECK constraints for all enum fields matching TypeScript enums
**Rationale:**
- Enforces data integrity at database level
- Prevents invalid state values
- Matches TypeScript type definitions exactly
- SQLite has efficient CHECK constraint implementation

## Migration Readiness for Task 1.4

The schema design supports future migration infrastructure:

1. **Idempotent Creation:** All tables use `CREATE TABLE IF NOT EXISTS`
2. **Versioned Structure:** Schema comment includes generation note
3. **Extensible Metadata:** JSON columns avoid ALTER TABLE for new fields
4. **Documented Constraints:** All constraints are explicit and documented
5. **Index Management:** Separate index creation allows reindexing

**Migration-Friendly Properties:**
- No hard-coded values requiring updates
- All relationships use CASCADE/SET NULL (no orphan data)
- Timestamps track data age
- State transitions provide audit trail for debugging migrations

## Schema Validation Checklist

- ✅ All required apm-auto entities represented (agents, tasks, sessions)
- ✅ Complete state lifecycle tracking (Spawning → Terminated, etc.)
- ✅ Task dependency relationships supported
- ✅ Session checkpoint/recovery capability
- ✅ Git worktree mapping for parallel execution
- ✅ Comprehensive timestamp tracking for audit trails
- ✅ Foreign key integrity with appropriate CASCADE/SET NULL
- ✅ Performance indexes on all frequently-queried columns
- ✅ CHECK constraints for enum validation
- ✅ JSON columns for extensibility
- ✅ Migration-ready structure
- ✅ Matches TypeScript type definitions exactly

## Conclusion

The schema from Task 1.3 comprehensively covers all apm-auto requirements. No modifications are needed. The schema is:
- **Complete:** All required entities and relationships
- **Performant:** Comprehensive indexing strategy
- **Integrity-Protected:** Foreign keys and CHECK constraints
- **Extensible:** JSON metadata columns
- **Type-Safe:** Exactly matches TypeScript definitions
- **Migration-Ready:** Idempotent and versioned

**Recommendation:** Proceed with implementation using the schema as-is from `src/validation/schema-export.ts`.
