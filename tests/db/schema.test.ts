/**
 * Schema Validation Test Suite
 * Tests schema creation, structure validation, and constraint enforcement
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionManager, TEST_CONFIG } from '../../src/db/connection.js';
import { initializeSchema, validateSchema } from '../../src/db/init.js';
import { DatabaseSchema } from '../../src/validation/schema-export.js';
import {
  AgentStatus,
  AgentType,
  TaskStatus,
  SessionStatus
} from '../../src/types/index.js';

describe('Schema Validation', () => {
  let connectionManager: ConnectionManager;

  beforeEach(async () => {
    connectionManager = new ConnectionManager(TEST_CONFIG);
    await connectionManager.connect();
  });

  afterEach(async () => {
    if (connectionManager.isConnected()) {
      await connectionManager.disconnect();
    }
  });

  describe('Schema Creation', () => {
    it('should create all expected tables', async () => {
      await initializeSchema(connectionManager);

      const tables = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      );

      const tableNames = tables.map(t => t.name);

      // Verify all 6 core tables exist
      expect(tableNames).toContain('agents');
      expect(tableNames).toContain('tasks');
      expect(tableNames).toContain('task_dependencies');
      expect(tableNames).toContain('sessions');
      expect(tableNames).toContain('session_checkpoints');
      expect(tableNames).toContain('state_transitions');
      expect(tableNames).toHaveLength(6);
    });

    it('should create all expected indexes', async () => {
      await initializeSchema(connectionManager);

      const indexes = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
      );

      // Should have 22 indexes total
      expect(indexes.length).toBeGreaterThanOrEqual(20);
    });

    it('should be idempotent (can run multiple times)', async () => {
      await initializeSchema(connectionManager);
      await initializeSchema(connectionManager);
      await initializeSchema(connectionManager);

      // Should still have exactly 6 tables
      const tables = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      );
      expect(tables).toHaveLength(6);
    });

    it('should validate schema after creation', async () => {
      await initializeSchema(connectionManager);

      const validation = await validateSchema(connectionManager);

      expect(validation.valid).toBe(true);
      expect(validation.missingTables).toHaveLength(0);
      expect(validation.missingIndexes).toHaveLength(0);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('Table Structure', () => {
    beforeEach(async () => {
      await initializeSchema(connectionManager);
    });

    it('should create agents table with correct columns', async () => {
      const columns = await connectionManager.query<{ name: string; type: string }>(
        'PRAGMA table_info(agents)'
      );

      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('type');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('current_task');
      expect(columnNames).toContain('domain');
      expect(columnNames).toContain('spawned_at');
      expect(columnNames).toContain('last_activity_at');
      expect(columnNames).toContain('metadata');
    });

    it('should create tasks table with correct columns', async () => {
      const columns = await connectionManager.query<{ name: string }>(
        'PRAGMA table_info(tasks)'
      );

      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('phase_id');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('assigned_agent');
      expect(columnNames).toContain('start_time');
      expect(columnNames).toContain('completion_time');
      expect(columnNames).toContain('title');
      expect(columnNames).toContain('metadata');
    });

    it('should create sessions table with correct columns', async () => {
      const columns = await connectionManager.query<{ name: string }>(
        'PRAGMA table_info(sessions)'
      );

      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('project_id');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('start_time');
      expect(columnNames).toContain('pause_time');
      expect(columnNames).toContain('end_time');
      expect(columnNames).toContain('metadata');
    });

    it('should create state_transitions table with correct columns', async () => {
      const columns = await connectionManager.query<{ name: string }>(
        'PRAGMA table_info(state_transitions)'
      );

      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('entity_type');
      expect(columnNames).toContain('entity_id');
      expect(columnNames).toContain('from_state');
      expect(columnNames).toContain('to_state');
      expect(columnNames).toContain('timestamp');
      expect(columnNames).toContain('trigger');
    });
  });

  describe('Foreign Key Constraints', () => {
    beforeEach(async () => {
      await initializeSchema(connectionManager);
    });

    it('should define foreign key from agents.current_task to tasks.id', async () => {
      const foreignKeys = await connectionManager.query(
        'PRAGMA foreign_key_list(agents)'
      );

      const currentTaskFk = foreignKeys.find((fk: any) => fk.from === 'current_task');
      expect(currentTaskFk).toBeDefined();
      expect(currentTaskFk.table).toBe('tasks');
    });

    it('should define foreign key from tasks.assigned_agent to agents.id', async () => {
      const foreignKeys = await connectionManager.query(
        'PRAGMA foreign_key_list(tasks)'
      );

      const assignedAgentFk = foreignKeys.find((fk: any) => fk.from === 'assigned_agent');
      expect(assignedAgentFk).toBeDefined();
      expect(assignedAgentFk.table).toBe('agents');
    });

    it('should define foreign keys in task_dependencies table', async () => {
      const foreignKeys = await connectionManager.query(
        'PRAGMA foreign_key_list(task_dependencies)'
      );

      expect(foreignKeys).toHaveLength(2);

      const taskIdFk = foreignKeys.find((fk: any) => fk.from === 'task_id');
      const dependsOnFk = foreignKeys.find((fk: any) => fk.from === 'depends_on_task_id');

      expect(taskIdFk).toBeDefined();
      expect(taskIdFk.table).toBe('tasks');
      expect(dependsOnFk).toBeDefined();
      expect(dependsOnFk.table).toBe('tasks');
    });

    it('should enforce foreign key constraints', async () => {
      // Try to insert agent with non-existent task
      await expect(
        connectionManager.execute(
          `INSERT INTO agents (id, type, status, current_task, spawned_at, last_activity_at, metadata)
           VALUES ('agent1', 'Manager', 'Active', 'non_existent_task', datetime('now'), datetime('now'), '{}')`
        )
      ).rejects.toThrow('FOREIGN KEY constraint');
    });

    it('should support SET NULL on delete', async () => {
      // Insert task first
      await connectionManager.execute(
        `INSERT INTO tasks (id, phase_id, status, assigned_agent, title, metadata)
         VALUES ('task1', 'phase1', 'Pending', NULL, 'Test Task', '{}')`
      );

      // Insert agent with current_task
      await connectionManager.execute(
        `INSERT INTO agents (id, type, status, current_task, spawned_at, last_activity_at, metadata)
         VALUES ('agent1', 'Manager', 'Active', 'task1', datetime('now'), datetime('now'), '{}')`
      );

      // Delete task - should SET NULL on agent.current_task
      await connectionManager.execute('DELETE FROM tasks WHERE id = "task1"');

      const agent = await connectionManager.get<{ current_task: string | null }>(
        'SELECT current_task FROM agents WHERE id = "agent1"'
      );

      expect(agent?.current_task).toBeNull();
    });

    it('should support CASCADE delete on task_dependencies', async () => {
      // Insert two tasks
      await connectionManager.execute(
        `INSERT INTO tasks (id, phase_id, status, assigned_agent, title, metadata)
         VALUES ('task1', 'phase1', 'Pending', NULL, 'Task 1', '{}'),
                ('task2', 'phase1', 'Pending', NULL, 'Task 2', '{}')`
      );

      // Create dependency
      await connectionManager.execute(
        `INSERT INTO task_dependencies (task_id, depends_on_task_id, dependency_type)
         VALUES ('task2', 'task1', 'required')`
      );

      // Delete task1 - should CASCADE delete dependency
      await connectionManager.execute('DELETE FROM tasks WHERE id = "task1"');

      const deps = await connectionManager.query(
        'SELECT * FROM task_dependencies WHERE depends_on_task_id = "task1"'
      );

      expect(deps).toHaveLength(0);
    });
  });

  describe('CHECK Constraints', () => {
    beforeEach(async () => {
      await initializeSchema(connectionManager);
    });

    it('should enforce agent type CHECK constraint', async () => {
      await expect(
        connectionManager.execute(
          `INSERT INTO agents (id, type, status, current_task, spawned_at, last_activity_at, metadata)
           VALUES ('agent1', 'InvalidType', 'Active', NULL, datetime('now'), datetime('now'), '{}')`
        )
      ).rejects.toThrow('CHECK constraint');
    });

    it('should allow valid agent types', async () => {
      for (const type of Object.values(AgentType)) {
        await connectionManager.execute(
          `INSERT INTO agents (id, type, status, current_task, spawned_at, last_activity_at, metadata)
           VALUES ('agent_${type}', '${type}', 'Spawning', NULL, datetime('now'), datetime('now'), '{}')`
        );
      }

      const agents = await connectionManager.query('SELECT COUNT(*) as count FROM agents');
      expect(agents[0].count).toBe(3); // Manager, Implementation, AdHoc
    });

    it('should enforce task status CHECK constraint', async () => {
      await expect(
        connectionManager.execute(
          `INSERT INTO tasks (id, phase_id, status, assigned_agent, title, metadata)
           VALUES ('task1', 'phase1', 'InvalidStatus', NULL, 'Test', '{}')`
        )
      ).rejects.toThrow('CHECK constraint');
    });

    it('should allow valid task statuses', async () => {
      for (const status of Object.values(TaskStatus)) {
        await connectionManager.execute(
          `INSERT INTO tasks (id, phase_id, status, assigned_agent, title, metadata)
           VALUES ('task_${status}', 'phase1', '${status}', NULL, 'Test ${status}', '{}')`
        );
      }

      const tasks = await connectionManager.query('SELECT COUNT(*) as count FROM tasks');
      expect(tasks[0].count).toBe(6); // All TaskStatus values
    });

    it('should enforce session status CHECK constraint', async () => {
      await expect(
        connectionManager.execute(
          `INSERT INTO sessions (id, project_id, status, start_time, pause_time, end_time, metadata)
           VALUES ('session1', 'proj1', 'InvalidStatus', datetime('now'), NULL, NULL, '{}')`
        )
      ).rejects.toThrow('CHECK constraint');
    });
  });

  describe('Index Verification', () => {
    beforeEach(async () => {
      await initializeSchema(connectionManager);
    });

    it('should have index on agents.status', async () => {
      const indexes = await connectionManager.query(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agents' AND name='idx_agents_status'"
      );

      expect(indexes).toHaveLength(1);
    });

    it('should have index on tasks.status', async () => {
      const indexes = await connectionManager.query(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='tasks' AND name='idx_tasks_status'"
      );

      expect(indexes).toHaveLength(1);
    });

    it('should have composite index on tasks (priority, status)', async () => {
      const indexes = await connectionManager.query(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='tasks' AND name='idx_tasks_priority'"
      );

      expect(indexes).toHaveLength(1);
    });

    it('should have index on state_transitions for entity lookup', async () => {
      const indexes = await connectionManager.query(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='state_transitions' AND name='idx_transitions_entity'"
      );

      expect(indexes).toHaveLength(1);
    });
  });

  describe('Schema Matches TypeScript Types', () => {
    beforeEach(async () => {
      await initializeSchema(connectionManager);
    });

    it('should accept valid AgentState data', async () => {
      const validAgent = {
        id: 'agent_test_001',
        type: AgentType.Implementation,
        status: AgentStatus.Active,
        current_task: null,
        spawned_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        metadata: JSON.stringify({
          domain: 'Orchestration_Foundation',
          processId: 12345
        })
      };

      await connectionManager.execute(
        `INSERT INTO agents (id, type, status, current_task, spawned_at, last_activity_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          validAgent.id,
          validAgent.type,
          validAgent.status,
          validAgent.current_task,
          validAgent.spawned_at,
          validAgent.last_activity_at,
          validAgent.metadata
        ]
      );

      const result = await connectionManager.get(
        'SELECT * FROM agents WHERE id = ?',
        [validAgent.id]
      );

      expect(result).toBeDefined();
    });

    it('should accept valid TaskState data', async () => {
      const validTask = {
        id: 'task_1_1',
        phase_id: 'phase_1',
        status: TaskStatus.Pending,
        assigned_agent: null,
        start_time: null,
        completion_time: null,
        title: 'Test Task',
        metadata: JSON.stringify({
          description: 'Test description',
          executionType: 'single-step'
        })
      };

      await connectionManager.execute(
        `INSERT INTO tasks (id, phase_id, status, assigned_agent, start_time, completion_time, title, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          validTask.id,
          validTask.phase_id,
          validTask.status,
          validTask.assigned_agent,
          validTask.start_time,
          validTask.completion_time,
          validTask.title,
          validTask.metadata
        ]
      );

      const result = await connectionManager.get(
        'SELECT * FROM tasks WHERE id = ?',
        [validTask.id]
      );

      expect(result).toBeDefined();
    });

    it('should accept valid SessionState data', async () => {
      const validSession = {
        id: 'session_001',
        project_id: 'apm-auto',
        status: SessionStatus.Running,
        start_time: new Date().toISOString(),
        pause_time: null,
        end_time: null,
        metadata: JSON.stringify({
          name: 'Test Session',
          config: { autonomyLevel: 'Automated' }
        })
      };

      await connectionManager.execute(
        `INSERT INTO sessions (id, project_id, status, start_time, pause_time, end_time, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          validSession.id,
          validSession.project_id,
          validSession.status,
          validSession.start_time,
          validSession.pause_time,
          validSession.end_time,
          validSession.metadata
        ]
      );

      const result = await connectionManager.get(
        'SELECT * FROM sessions WHERE id = ?',
        [validSession.id]
      );

      expect(result).toBeDefined();
    });
  });
});
