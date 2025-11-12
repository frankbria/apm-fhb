/**
 * Zod Validation Schemas for apm-auto Type System
 *
 * This module provides runtime type validation using zod schemas that match
 * the TypeScript type definitions. These schemas are used for validating
 * data at system boundaries (database operations, API inputs, file parsing).
 */

import { z } from 'zod';
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

// ============================================================================
// Agent Schemas
// ============================================================================

/**
 * Agent Type Schema
 */
export const AgentTypeSchema = z.nativeEnum(AgentType);

/**
 * Agent Status Schema
 */
export const AgentStatusSchema = z.nativeEnum(AgentStatus);

/**
 * Agent Domain Schema
 */
export const AgentDomainSchema = z.nativeEnum(AgentDomain);

/**
 * Agent Metadata Schema
 */
export const AgentMetadataSchema = z.object({
  domain: AgentDomainSchema.optional(),
  spawnedAt: z.coerce.date(),
  lastActivityAt: z.coerce.date(),
  processId: z.number().optional(),
  worktreePath: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional()
}).catchall(z.unknown());

/**
 * Agent State Schema
 */
export const AgentStateSchema = z.object({
  id: z.string().min(1, 'Agent ID cannot be empty'),
  type: AgentTypeSchema,
  status: AgentStatusSchema,
  currentTask: z.string().nullable(),
  metadata: AgentMetadataSchema
});

/**
 * Agent Spawn Request Schema
 */
export const AgentSpawnRequestSchema = z.object({
  type: AgentTypeSchema,
  domain: AgentDomainSchema.optional(),
  initialTask: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional()
});

/**
 * Agent Spawn Result Schema
 */
export const AgentSpawnResultSchema = z.object({
  success: z.boolean(),
  agentState: AgentStateSchema.optional(),
  error: z.string().optional()
});

// ============================================================================
// Task Schemas
// ============================================================================

/**
 * Task Status Schema
 */
export const TaskStatusSchema = z.nativeEnum(TaskStatus);

/**
 * Task Priority Schema
 */
export const TaskPrioritySchema = z.nativeEnum(TaskPriority);

/**
 * Task Execution Type Schema
 */
export const TaskExecutionTypeSchema = z.nativeEnum(TaskExecutionType);

/**
 * Task Dependency Schema
 */
export const TaskDependencySchema = z.object({
  taskId: z.string().min(1, 'Task ID cannot be empty'),
  type: z.enum(['required', 'optional']),
  description: z.string().optional()
});

/**
 * Task Metadata Schema
 */
export const TaskMetadataSchema = z.object({
  title: z.string().min(1, 'Task title cannot be empty'),
  description: z.string().optional(),
  executionType: TaskExecutionTypeSchema.optional(),
  estimatedHours: z.number().positive().optional(),
  actualHours: z.number().positive().optional(),
  tags: z.array(z.string()).optional(),
  memoryLogPath: z.string().optional()
}).catchall(z.unknown());

/**
 * Task State Schema
 */
export const TaskStateSchema = z.object({
  id: z.string().min(1, 'Task ID cannot be empty'),
  phaseId: z.string().min(1, 'Phase ID cannot be empty'),
  status: TaskStatusSchema,
  assignedAgent: z.string().nullable(),
  requiredDomain: AgentDomainSchema.optional(),
  dependencies: z.array(TaskDependencySchema),
  startTime: z.coerce.date().nullable(),
  completionTime: z.coerce.date().nullable(),
  priority: TaskPrioritySchema.optional(),
  metadata: TaskMetadataSchema
});

/**
 * Task Assignment Request Schema
 */
export const TaskAssignmentRequestSchema = z.object({
  taskId: z.string().min(1, 'Task ID cannot be empty'),
  agentId: z.string().min(1, 'Agent ID cannot be empty'),
  config: z.record(z.string(), z.unknown()).optional()
});

/**
 * Task Assignment Result Schema
 */
export const TaskAssignmentResultSchema = z.object({
  success: z.boolean(),
  taskState: TaskStateSchema.optional(),
  error: z.string().optional()
});

/**
 * Task Execution Result Schema
 */
export const TaskExecutionResultSchema = z.object({
  taskId: z.string().min(1, 'Task ID cannot be empty'),
  success: z.boolean(),
  status: z.union([
    z.literal(TaskStatus.Completed),
    z.literal(TaskStatus.Failed)
  ]),
  durationMs: z.number().nonnegative(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  artifacts: z.array(z.string()).optional()
});

/**
 * Task Dependency Check Schema
 */
export const TaskDependencyCheckSchema = z.object({
  satisfied: z.boolean(),
  unsatisfiedDependencies: z.array(z.string()),
  blockedDependencies: z.array(z.string())
});

// ============================================================================
// Session Schemas
// ============================================================================

/**
 * Session Status Schema
 */
export const SessionStatusSchema = z.nativeEnum(SessionStatus);

/**
 * Session Checkpoint Schema
 */
export const SessionCheckpointSchema = z.object({
  id: z.string().min(1, 'Checkpoint ID cannot be empty'),
  timestamp: z.coerce.date(),
  description: z.string(),
  activeAgents: z.array(z.string()),
  completedTasks: z.array(z.string()),
  inProgressTasks: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).optional()
});

/**
 * Session Config Schema
 */
export const SessionConfigSchema = z.object({
  autonomyLevel: z.enum(['Cautious', 'Automated', 'YOLO']).optional(),
  maxConcurrentAgents: z.number().positive().optional(),
  autoCheckpoint: z.boolean().optional(),
  checkpointIntervalMinutes: z.number().positive().optional(),
  autoRecovery: z.boolean().optional(),
  maxRecoveryAttempts: z.number().positive().optional()
}).catchall(z.unknown());

/**
 * Session Scope Schema
 */
export const SessionScopeSchema = z.object({
  phaseRange: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  taskIds: z.array(z.string()).optional(),
  agentDomains: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional()
});

/**
 * Session Metadata Schema
 */
export const SessionMetadataSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  initiatedBy: z.string().optional(),
  scope: SessionScopeSchema.optional(),
  config: SessionConfigSchema,
  totalTasks: z.number().nonnegative().optional(),
  completedTasksCount: z.number().nonnegative().optional(),
  failedTasksCount: z.number().nonnegative().optional()
}).catchall(z.unknown());

/**
 * Session State Schema
 */
export const SessionStateSchema = z.object({
  id: z.string().min(1, 'Session ID cannot be empty'),
  projectId: z.string().min(1, 'Project ID cannot be empty'),
  status: SessionStatusSchema,
  startTime: z.coerce.date(),
  pauseTime: z.coerce.date().nullable(),
  endTime: z.coerce.date().nullable(),
  checkpoints: z.array(SessionCheckpointSchema),
  activeAgents: z.array(z.string()),
  metadata: SessionMetadataSchema
});

/**
 * Session Start Request Schema
 */
export const SessionStartRequestSchema = z.object({
  projectId: z.string().min(1, 'Project ID cannot be empty'),
  name: z.string().optional(),
  scope: SessionScopeSchema.optional(),
  config: SessionConfigSchema.optional()
});

/**
 * Session Start Result Schema
 */
export const SessionStartResultSchema = z.object({
  success: z.boolean(),
  sessionState: SessionStateSchema.optional(),
  error: z.string().optional()
});

/**
 * Session Resume Request Schema
 */
export const SessionResumeRequestSchema = z.object({
  sessionId: z.string().min(1, 'Session ID cannot be empty'),
  checkpointId: z.string().optional()
});

/**
 * Session Resume Result Schema
 */
export const SessionResumeResultSchema = z.object({
  success: z.boolean(),
  sessionState: SessionStateSchema.optional(),
  error: z.string().optional()
});

/**
 * Session Checkpoint Request Schema
 */
export const SessionCheckpointRequestSchema = z.object({
  sessionId: z.string().min(1, 'Session ID cannot be empty'),
  description: z.string().min(1, 'Checkpoint description cannot be empty'),
  metadata: z.record(z.string(), z.unknown()).optional()
});

/**
 * Session Checkpoint Result Schema
 */
export const SessionCheckpointResultSchema = z.object({
  success: z.boolean(),
  checkpoint: SessionCheckpointSchema.optional(),
  error: z.string().optional()
});

/**
 * Session Recovery Request Schema
 */
export const SessionRecoveryRequestSchema = z.object({
  sessionId: z.string().min(1, 'Session ID cannot be empty'),
  checkpointId: z.string().optional(),
  strategy: z.enum(['retry', 'skip', 'manual']).optional()
});

/**
 * Session Recovery Result Schema
 */
export const SessionRecoveryResultSchema = z.object({
  success: z.boolean(),
  sessionState: SessionStateSchema.optional(),
  error: z.string().optional()
});

/**
 * Session Summary Schema
 */
export const SessionSummarySchema = z.object({
  sessionId: z.string().min(1, 'Session ID cannot be empty'),
  status: SessionStatusSchema,
  durationMs: z.number().nonnegative(),
  tasksCompleted: z.number().nonnegative(),
  tasksFailed: z.number().nonnegative(),
  agentsSpawned: z.number().nonnegative(),
  checkpointsCreated: z.number().nonnegative(),
  successRate: z.number().min(0).max(100)
});

// ============================================================================
// State Transition Schemas
// ============================================================================

/**
 * Transition Trigger Schema
 */
export const TransitionTriggerSchema = z.nativeEnum(TransitionTrigger);

/**
 * State Entity Type Schema
 */
export const StateEntityTypeSchema = z.nativeEnum(StateEntityType);

/**
 * State Transition Metadata Schema
 */
export const StateTransitionMetadataSchema = z.object({
  reason: z.string().optional(),
  userId: z.string().optional(),
  processId: z.number().optional(),
  errorDetails: z.object({
    message: z.string(),
    code: z.string().optional(),
    stack: z.string().optional()
  }).optional(),
  relatedEntities: z.array(z.string()).optional()
}).catchall(z.unknown());

/**
 * Base State Transition Schema (generic)
 */
const BaseStateTransitionSchema = z.object({
  id: z.string().min(1, 'Transition ID cannot be empty'),
  entityType: StateEntityTypeSchema,
  entityId: z.string().min(1, 'Entity ID cannot be empty'),
  fromState: z.string(),
  toState: z.string(),
  timestamp: z.coerce.date(),
  trigger: TransitionTriggerSchema,
  metadata: StateTransitionMetadataSchema.optional()
});

/**
 * Agent State Transition Schema
 */
export const AgentStateTransitionSchema = BaseStateTransitionSchema.extend({
  entityType: z.literal(StateEntityType.Agent),
  fromState: AgentStatusSchema,
  toState: AgentStatusSchema,
  taskId: z.string().optional()
});

/**
 * Task State Transition Schema
 */
export const TaskStateTransitionSchema = BaseStateTransitionSchema.extend({
  entityType: z.literal(StateEntityType.Task),
  fromState: TaskStatusSchema,
  toState: TaskStatusSchema,
  agentId: z.string().optional()
});

/**
 * Session State Transition Schema
 */
export const SessionStateTransitionSchema = BaseStateTransitionSchema.extend({
  entityType: z.literal(StateEntityType.Session),
  fromState: SessionStatusSchema,
  toState: SessionStatusSchema,
  activeAgentCount: z.number().nonnegative().optional(),
  completedTaskCount: z.number().nonnegative().optional()
});

/**
 * State Transition Union Schema
 */
export const AnyStateTransitionSchema = z.discriminatedUnion('entityType', [
  AgentStateTransitionSchema,
  TaskStateTransitionSchema,
  SessionStateTransitionSchema
]);

/**
 * State Transition Request Schema
 */
export const StateTransitionRequestSchema = z.object({
  entityType: StateEntityTypeSchema,
  entityId: z.string().min(1, 'Entity ID cannot be empty'),
  toState: z.string(),
  trigger: TransitionTriggerSchema,
  metadata: StateTransitionMetadataSchema.optional()
});

/**
 * State Transition Result Schema
 */
export const StateTransitionResultSchema = z.object({
  success: z.boolean(),
  transition: BaseStateTransitionSchema.optional(),
  error: z.string().optional(),
  wasValidTransition: z.boolean().optional()
});

/**
 * State Transition Validation Schema
 */
export const StateTransitionValidationSchema = z.object({
  isValid: z.boolean(),
  reason: z.string().optional(),
  suggestedAlternatives: z.array(z.string()).optional()
});

/**
 * State Transition History Query Schema
 */
export const StateTransitionHistoryQuerySchema = z.object({
  entityType: StateEntityTypeSchema.optional(),
  entityId: z.string().optional(),
  fromState: z.string().optional(),
  toState: z.string().optional(),
  trigger: TransitionTriggerSchema.optional(),
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional(),
  limit: z.number().positive().optional(),
  offset: z.number().nonnegative().optional()
});

/**
 * State Transition History Result Schema
 */
export const StateTransitionHistoryResultSchema = z.object({
  transitions: z.array(AnyStateTransitionSchema),
  totalCount: z.number().nonnegative(),
  hasMore: z.boolean()
});

/**
 * State Snapshot Schema
 */
export const StateSnapshotSchema = z.object({
  id: z.string().min(1, 'Snapshot ID cannot be empty'),
  timestamp: z.coerce.date(),
  agents: z.record(z.string(), z.unknown()),
  tasks: z.record(z.string(), z.unknown()),
  session: z.unknown(),
  description: z.string().optional()
});

/**
 * State Rollback Request Schema
 */
export const StateRollbackRequestSchema = z.object({
  snapshotId: z.string().min(1, 'Snapshot ID cannot be empty'),
  createCheckpoint: z.boolean().optional()
});

/**
 * State Rollback Result Schema
 */
export const StateRollbackResultSchema = z.object({
  success: z.boolean(),
  checkpointId: z.string().optional(),
  error: z.string().optional()
});

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validation Result Type
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; issues: z.ZodIssue[] };

/**
 * Generic validation function
 */
function validate<T>(schema: z.ZodSchema<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    const errorMessage = result.error.issues
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    return {
      success: false,
      error: errorMessage,
      issues: result.error.issues
    };
  }
}

/**
 * Validate Agent State
 * @param data - Data to validate as AgentState
 * @returns Validation result with typed data or error details
 */
export function validateAgentState(data: unknown): ValidationResult<z.infer<typeof AgentStateSchema>> {
  return validate(AgentStateSchema, data);
}

/**
 * Validate Task State
 * @param data - Data to validate as TaskState
 * @returns Validation result with typed data or error details
 */
export function validateTaskState(data: unknown): ValidationResult<z.infer<typeof TaskStateSchema>> {
  return validate(TaskStateSchema, data);
}

/**
 * Validate Session State
 * @param data - Data to validate as SessionState
 * @returns Validation result with typed data or error details
 */
export function validateSessionState(data: unknown): ValidationResult<z.infer<typeof SessionStateSchema>> {
  return validate(SessionStateSchema, data);
}

/**
 * Validate State Transition
 * @param data - Data to validate as StateTransition
 * @returns Validation result with typed data or error details
 */
export function validateStateTransition(data: unknown): ValidationResult<z.infer<typeof AnyStateTransitionSchema>> {
  return validate(AnyStateTransitionSchema, data);
}

/**
 * Validate Agent Spawn Request
 * @param data - Data to validate as AgentSpawnRequest
 * @returns Validation result with typed data or error details
 */
export function validateAgentSpawnRequest(data: unknown): ValidationResult<z.infer<typeof AgentSpawnRequestSchema>> {
  return validate(AgentSpawnRequestSchema, data);
}

/**
 * Validate Task Assignment Request
 * @param data - Data to validate as TaskAssignmentRequest
 * @returns Validation result with typed data or error details
 */
export function validateTaskAssignmentRequest(data: unknown): ValidationResult<z.infer<typeof TaskAssignmentRequestSchema>> {
  return validate(TaskAssignmentRequestSchema, data);
}

/**
 * Validate Session Start Request
 * @param data - Data to validate as SessionStartRequest
 * @returns Validation result with typed data or error details
 */
export function validateSessionStartRequest(data: unknown): ValidationResult<z.infer<typeof SessionStartRequestSchema>> {
  return validate(SessionStartRequestSchema, data);
}

/**
 * Validate State Transition Request
 * @param data - Data to validate as StateTransitionRequest
 * @returns Validation result with typed data or error details
 */
export function validateStateTransitionRequest(data: unknown): ValidationResult<z.infer<typeof StateTransitionRequestSchema>> {
  return validate(StateTransitionRequestSchema, data);
}
