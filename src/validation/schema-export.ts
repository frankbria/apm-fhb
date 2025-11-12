/**
 * Database Schema Export Utilities for apm-auto
 *
 * This module provides utilities to generate SQLite database column type
 * definitions from TypeScript types. These exports will inform Task 1.1
 * database schema design.
 *
 * The exports provide:
 * 1. Column type mappings (TypeScript -> SQLite)
 * 2. Table structure definitions
 * 3. Foreign key relationships
 * 4. Index recommendations
 */

import {
  AgentType,
  AgentStatus,
  AgentDomain,
  TaskStatus,
  TaskPriority,
  TaskExecutionType,
  SessionStatus,
  TransitionTrigger,
  StateEntityType
} from '../types/index.js';

/**
 * SQLite Column Type
 */
export type SQLiteType =
  | 'TEXT'
  | 'INTEGER'
  | 'REAL'
  | 'BLOB'
  | 'NULL'
  | 'BOOLEAN'
  | 'DATETIME'
  | 'JSON';

/**
 * Column Definition for SQLite
 */
export interface ColumnDefinition {
  /** Column name */
  name: string;
  /** SQLite data type */
  type: SQLiteType;
  /** Whether column can be NULL */
  nullable: boolean;
  /** Primary key flag */
  primaryKey?: boolean;
  /** Unique constraint flag */
  unique?: boolean;
  /** Default value */
  defaultValue?: string | number | boolean | null;
  /** Foreign key reference */
  foreignKey?: {
    table: string;
    column: string;
    onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
    onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  };
  /** Check constraint */
  check?: string;
  /** Column comment */
  comment?: string;
}

/**
 * Index Definition for SQLite
 */
export interface IndexDefinition {
  /** Index name */
  name: string;
  /** Columns included in index */
  columns: string[];
  /** Unique index flag */
  unique?: boolean;
  /** Partial index WHERE clause */
  where?: string;
}

/**
 * Table Definition for SQLite
 */
export interface TableDefinition {
  /** Table name */
  name: string;
  /** Column definitions */
  columns: ColumnDefinition[];
  /** Index definitions */
  indexes?: IndexDefinition[];
  /** Table comment */
  comment?: string;
}

/**
 * Get enum values as CHECK constraint
 */
function enumToCheckConstraint(enumName: string, enumObj: Record<string, string>): string {
  const values = Object.values(enumObj).map(v => `'${v}'`).join(', ');
  return `${enumName} IN (${values})`;
}

/**
 * Agents Table Schema
 * Maps to AgentState interface
 */
export const AgentsTableSchema: TableDefinition = {
  name: 'agents',
  comment: 'Agent state tracking table',
  columns: [
    {
      name: 'id',
      type: 'TEXT',
      nullable: false,
      primaryKey: true,
      comment: 'Unique agent identifier'
    },
    {
      name: 'type',
      type: 'TEXT',
      nullable: false,
      check: enumToCheckConstraint('type', AgentType),
      comment: 'Agent type (Manager, Implementation, AdHoc)'
    },
    {
      name: 'status',
      type: 'TEXT',
      nullable: false,
      check: enumToCheckConstraint('status', AgentStatus),
      comment: 'Current agent lifecycle status'
    },
    {
      name: 'current_task',
      type: 'TEXT',
      nullable: true,
      foreignKey: {
        table: 'tasks',
        column: 'id',
        onDelete: 'SET NULL'
      },
      comment: 'ID of currently executing task'
    },
    {
      name: 'domain',
      type: 'TEXT',
      nullable: true,
      check: enumToCheckConstraint('domain', AgentDomain),
      comment: 'Agent domain specialization'
    },
    {
      name: 'spawned_at',
      type: 'DATETIME',
      nullable: false,
      defaultValue: 'CURRENT_TIMESTAMP',
      comment: 'Agent spawn timestamp'
    },
    {
      name: 'last_activity_at',
      type: 'DATETIME',
      nullable: false,
      defaultValue: 'CURRENT_TIMESTAMP',
      comment: 'Last activity timestamp'
    },
    {
      name: 'process_id',
      type: 'INTEGER',
      nullable: true,
      comment: 'Process ID if applicable'
    },
    {
      name: 'worktree_path',
      type: 'TEXT',
      nullable: true,
      comment: 'Git worktree path for parallel execution'
    },
    {
      name: 'metadata',
      type: 'JSON',
      nullable: false,
      defaultValue: '{}',
      comment: 'Additional agent metadata (JSON)'
    }
  ],
  indexes: [
    {
      name: 'idx_agents_status',
      columns: ['status']
    },
    {
      name: 'idx_agents_type',
      columns: ['type']
    },
    {
      name: 'idx_agents_current_task',
      columns: ['current_task'],
      where: 'current_task IS NOT NULL'
    },
    {
      name: 'idx_agents_domain',
      columns: ['domain'],
      where: 'domain IS NOT NULL'
    }
  ]
};

/**
 * Tasks Table Schema
 * Maps to TaskState interface
 */
export const TasksTableSchema: TableDefinition = {
  name: 'tasks',
  comment: 'Task state tracking table',
  columns: [
    {
      name: 'id',
      type: 'TEXT',
      nullable: false,
      primaryKey: true,
      comment: 'Unique task identifier'
    },
    {
      name: 'phase_id',
      type: 'TEXT',
      nullable: false,
      comment: 'Phase identifier'
    },
    {
      name: 'status',
      type: 'TEXT',
      nullable: false,
      check: enumToCheckConstraint('status', TaskStatus),
      comment: 'Current task execution status'
    },
    {
      name: 'assigned_agent',
      type: 'TEXT',
      nullable: true,
      foreignKey: {
        table: 'agents',
        column: 'id',
        onDelete: 'SET NULL'
      },
      comment: 'ID of assigned agent'
    },
    {
      name: 'required_domain',
      type: 'TEXT',
      nullable: true,
      check: enumToCheckConstraint('required_domain', AgentDomain),
      comment: 'Required agent domain'
    },
    {
      name: 'priority',
      type: 'TEXT',
      nullable: true,
      check: enumToCheckConstraint('priority', TaskPriority),
      defaultValue: "Normal",
      comment: 'Task priority level'
    },
    {
      name: 'start_time',
      type: 'DATETIME',
      nullable: true,
      comment: 'Task execution start timestamp'
    },
    {
      name: 'completion_time',
      type: 'DATETIME',
      nullable: true,
      comment: 'Task completion timestamp'
    },
    {
      name: 'title',
      type: 'TEXT',
      nullable: false,
      comment: 'Task title'
    },
    {
      name: 'description',
      type: 'TEXT',
      nullable: true,
      comment: 'Task description'
    },
    {
      name: 'execution_type',
      type: 'TEXT',
      nullable: true,
      check: enumToCheckConstraint('execution_type', TaskExecutionType),
      comment: 'Execution pattern (single-step or multi-step)'
    },
    {
      name: 'estimated_hours',
      type: 'REAL',
      nullable: true,
      comment: 'Estimated effort in hours'
    },
    {
      name: 'actual_hours',
      type: 'REAL',
      nullable: true,
      comment: 'Actual effort in hours'
    },
    {
      name: 'memory_log_path',
      type: 'TEXT',
      nullable: true,
      comment: 'Path to memory log file'
    },
    {
      name: 'metadata',
      type: 'JSON',
      nullable: false,
      defaultValue: '{}',
      comment: 'Additional task metadata (JSON)'
    }
  ],
  indexes: [
    {
      name: 'idx_tasks_status',
      columns: ['status']
    },
    {
      name: 'idx_tasks_phase_id',
      columns: ['phase_id']
    },
    {
      name: 'idx_tasks_assigned_agent',
      columns: ['assigned_agent'],
      where: 'assigned_agent IS NOT NULL'
    },
    {
      name: 'idx_tasks_priority',
      columns: ['priority', 'status']
    },
    {
      name: 'idx_tasks_required_domain',
      columns: ['required_domain'],
      where: 'required_domain IS NOT NULL'
    }
  ]
};

/**
 * Task Dependencies Table Schema
 * Maps to TaskDependency interface (many-to-many relationship)
 */
export const TaskDependenciesTableSchema: TableDefinition = {
  name: 'task_dependencies',
  comment: 'Task dependency relationships',
  columns: [
    {
      name: 'task_id',
      type: 'TEXT',
      nullable: false,
      foreignKey: {
        table: 'tasks',
        column: 'id',
        onDelete: 'CASCADE'
      },
      comment: 'Dependent task ID'
    },
    {
      name: 'depends_on_task_id',
      type: 'TEXT',
      nullable: false,
      foreignKey: {
        table: 'tasks',
        column: 'id',
        onDelete: 'CASCADE'
      },
      comment: 'Task that must be completed first'
    },
    {
      name: 'dependency_type',
      type: 'TEXT',
      nullable: false,
      check: "dependency_type IN ('required', 'optional')",
      comment: 'Type of dependency'
    },
    {
      name: 'description',
      type: 'TEXT',
      nullable: true,
      comment: 'Dependency description'
    }
  ],
  indexes: [
    {
      name: 'idx_task_deps_task_id',
      columns: ['task_id']
    },
    {
      name: 'idx_task_deps_depends_on',
      columns: ['depends_on_task_id']
    },
    {
      name: 'idx_task_deps_unique',
      columns: ['task_id', 'depends_on_task_id'],
      unique: true
    }
  ]
};

/**
 * Sessions Table Schema
 * Maps to SessionState interface
 */
export const SessionsTableSchema: TableDefinition = {
  name: 'sessions',
  comment: 'Automation session state tracking',
  columns: [
    {
      name: 'id',
      type: 'TEXT',
      nullable: false,
      primaryKey: true,
      comment: 'Unique session identifier'
    },
    {
      name: 'project_id',
      type: 'TEXT',
      nullable: false,
      comment: 'Project identifier'
    },
    {
      name: 'status',
      type: 'TEXT',
      nullable: false,
      check: enumToCheckConstraint('status', SessionStatus),
      comment: 'Current session status'
    },
    {
      name: 'start_time',
      type: 'DATETIME',
      nullable: false,
      defaultValue: 'CURRENT_TIMESTAMP',
      comment: 'Session start timestamp'
    },
    {
      name: 'pause_time',
      type: 'DATETIME',
      nullable: true,
      comment: 'Session pause timestamp'
    },
    {
      name: 'end_time',
      type: 'DATETIME',
      nullable: true,
      comment: 'Session end timestamp'
    },
    {
      name: 'name',
      type: 'TEXT',
      nullable: true,
      comment: 'Session name'
    },
    {
      name: 'description',
      type: 'TEXT',
      nullable: true,
      comment: 'Session description'
    },
    {
      name: 'initiated_by',
      type: 'TEXT',
      nullable: true,
      comment: 'User who initiated session'
    },
    {
      name: 'metadata',
      type: 'JSON',
      nullable: false,
      defaultValue: '{}',
      comment: 'Additional session metadata including config (JSON)'
    }
  ],
  indexes: [
    {
      name: 'idx_sessions_status',
      columns: ['status']
    },
    {
      name: 'idx_sessions_project_id',
      columns: ['project_id']
    },
    {
      name: 'idx_sessions_start_time',
      columns: ['start_time']
    }
  ]
};

/**
 * Session Checkpoints Table Schema
 * Maps to SessionCheckpoint interface
 */
export const SessionCheckpointsTableSchema: TableDefinition = {
  name: 'session_checkpoints',
  comment: 'Session checkpoint snapshots',
  columns: [
    {
      name: 'id',
      type: 'TEXT',
      nullable: false,
      primaryKey: true,
      comment: 'Unique checkpoint identifier'
    },
    {
      name: 'session_id',
      type: 'TEXT',
      nullable: false,
      foreignKey: {
        table: 'sessions',
        column: 'id',
        onDelete: 'CASCADE'
      },
      comment: 'Session this checkpoint belongs to'
    },
    {
      name: 'timestamp',
      type: 'DATETIME',
      nullable: false,
      defaultValue: 'CURRENT_TIMESTAMP',
      comment: 'Checkpoint creation timestamp'
    },
    {
      name: 'description',
      type: 'TEXT',
      nullable: false,
      comment: 'Checkpoint description'
    },
    {
      name: 'active_agents',
      type: 'JSON',
      nullable: false,
      comment: 'Snapshot of active agent IDs (JSON array)'
    },
    {
      name: 'completed_tasks',
      type: 'JSON',
      nullable: false,
      comment: 'Snapshot of completed task IDs (JSON array)'
    },
    {
      name: 'in_progress_tasks',
      type: 'JSON',
      nullable: false,
      comment: 'Snapshot of in-progress task IDs (JSON array)'
    },
    {
      name: 'metadata',
      type: 'JSON',
      nullable: true,
      comment: 'Additional checkpoint metadata (JSON)'
    }
  ],
  indexes: [
    {
      name: 'idx_checkpoints_session_id',
      columns: ['session_id']
    },
    {
      name: 'idx_checkpoints_timestamp',
      columns: ['timestamp']
    }
  ]
};

/**
 * State Transitions Table Schema
 * Maps to StateTransition interface
 */
export const StateTransitionsTableSchema: TableDefinition = {
  name: 'state_transitions',
  comment: 'State transition audit log',
  columns: [
    {
      name: 'id',
      type: 'TEXT',
      nullable: false,
      primaryKey: true,
      comment: 'Unique transition identifier'
    },
    {
      name: 'entity_type',
      type: 'TEXT',
      nullable: false,
      check: enumToCheckConstraint('entity_type', StateEntityType),
      comment: 'Type of entity transitioning'
    },
    {
      name: 'entity_id',
      type: 'TEXT',
      nullable: false,
      comment: 'ID of entity transitioning'
    },
    {
      name: 'from_state',
      type: 'TEXT',
      nullable: false,
      comment: 'Previous state'
    },
    {
      name: 'to_state',
      type: 'TEXT',
      nullable: false,
      comment: 'New state'
    },
    {
      name: 'timestamp',
      type: 'DATETIME',
      nullable: false,
      defaultValue: 'CURRENT_TIMESTAMP',
      comment: 'Transition timestamp'
    },
    {
      name: 'trigger',
      type: 'TEXT',
      nullable: false,
      check: enumToCheckConstraint('trigger', TransitionTrigger),
      comment: 'What triggered the transition'
    },
    {
      name: 'metadata',
      type: 'JSON',
      nullable: true,
      comment: 'Additional transition context (JSON)'
    }
  ],
  indexes: [
    {
      name: 'idx_transitions_entity',
      columns: ['entity_type', 'entity_id']
    },
    {
      name: 'idx_transitions_timestamp',
      columns: ['timestamp']
    },
    {
      name: 'idx_transitions_from_state',
      columns: ['from_state']
    },
    {
      name: 'idx_transitions_to_state',
      columns: ['to_state']
    },
    {
      name: 'idx_transitions_trigger',
      columns: ['trigger']
    }
  ]
};

/**
 * Complete Database Schema Export
 * All tables for apm-auto state machine
 */
export const DatabaseSchema: TableDefinition[] = [
  AgentsTableSchema,
  TasksTableSchema,
  TaskDependenciesTableSchema,
  SessionsTableSchema,
  SessionCheckpointsTableSchema,
  StateTransitionsTableSchema
];

/**
 * Generate CREATE TABLE SQL statement from table definition
 */
export function generateCreateTableSQL(table: TableDefinition): string {
  const columns = table.columns.map(col => {
    const parts: string[] = [`  ${col.name} ${col.type}`];

    if (col.primaryKey) parts.push('PRIMARY KEY');
    if (!col.nullable) parts.push('NOT NULL');
    if (col.unique) parts.push('UNIQUE');
    if (col.defaultValue !== undefined) {
      parts.push(`DEFAULT ${typeof col.defaultValue === 'string' ? `'${col.defaultValue}'` : col.defaultValue}`);
    }
    if (col.check) parts.push(`CHECK (${col.check})`);

    return parts.join(' ');
  });

  const foreignKeys = table.columns
    .filter(col => col.foreignKey)
    .map(col => {
      const fk = col.foreignKey!;
      let fkDef = `  FOREIGN KEY (${col.name}) REFERENCES ${fk.table}(${fk.column})`;
      if (fk.onDelete) fkDef += ` ON DELETE ${fk.onDelete}`;
      if (fk.onUpdate) fkDef += ` ON UPDATE ${fk.onUpdate}`;
      return fkDef;
    });

  const allConstraints = [...columns, ...foreignKeys];

  return `CREATE TABLE IF NOT EXISTS ${table.name} (\n${allConstraints.join(',\n')}\n);`;
}

/**
 * Generate CREATE INDEX SQL statements from table definition
 */
export function generateCreateIndexSQL(table: TableDefinition): string[] {
  if (!table.indexes) return [];

  return table.indexes.map(idx => {
    let sql = `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${idx.name}`;
    sql += ` ON ${table.name} (${idx.columns.join(', ')})`;
    if (idx.where) sql += ` WHERE ${idx.where}`;
    return sql + ';';
  });
}

/**
 * Generate complete SQL schema script
 */
export function generateSchemaSQL(): string {
  const statements: string[] = [
    '-- apm-auto Database Schema',
    '-- Generated from TypeScript type definitions',
    '-- DO NOT EDIT MANUALLY - Update types and regenerate',
    '',
    '-- Enable foreign key constraints',
    'PRAGMA foreign_keys = ON;',
    '',
    '-- Enable WAL mode for concurrent reads',
    'PRAGMA journal_mode = WAL;',
    ''
  ];

  for (const table of DatabaseSchema) {
    if (table.comment) {
      statements.push(`-- ${table.comment}`);
    }
    statements.push(generateCreateTableSQL(table));
    statements.push('');

    const indexes = generateCreateIndexSQL(table);
    if (indexes.length > 0) {
      statements.push(...indexes);
      statements.push('');
    }
  }

  return statements.join('\n');
}
