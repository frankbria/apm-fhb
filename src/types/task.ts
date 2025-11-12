/**
 * Task Type Definitions for apm-auto State Machine
 *
 * This module defines comprehensive TypeScript types for task state management
 * including task status enums, dependency tracking, execution timing, and
 * task-agent assignment relationships.
 */

import { AgentDomain } from './agent.js';

/**
 * Task Status Enumeration
 * Represents all possible states in the task execution lifecycle
 */
export enum TaskStatus {
  /** Task is defined but not yet assigned to an agent */
  Pending = 'Pending',
  /** Task has been assigned to an agent but execution hasn't started */
  Assigned = 'Assigned',
  /** Task is currently being executed by an agent */
  InProgress = 'InProgress',
  /** Task execution is blocked by dependencies or external factors */
  Blocked = 'Blocked',
  /** Task has been successfully completed */
  Completed = 'Completed',
  /** Task execution failed and requires intervention */
  Failed = 'Failed'
}

/**
 * Task Priority Levels
 * Defines priority ordering for task execution scheduling
 */
export enum TaskPriority {
  /** Critical tasks that must be completed immediately */
  Critical = 'Critical',
  /** High priority tasks */
  High = 'High',
  /** Normal priority (default) */
  Normal = 'Normal',
  /** Low priority tasks that can be deferred */
  Low = 'Low'
}

/**
 * Task Execution Type
 * Defines the execution pattern for a task
 */
export enum TaskExecutionType {
  /** Complete all subtasks in one response */
  SingleStep = 'single-step',
  /** Complete work across multiple responses with user iteration */
  MultiStep = 'multi-step'
}

/**
 * Task Dependency
 * Represents a dependency relationship between tasks
 */
export interface TaskDependency {
  /** ID of the task that must be completed first */
  taskId: string;
  /** Type of dependency (hard block vs soft preference) */
  type: 'required' | 'optional';
  /** Human-readable description of the dependency relationship */
  description?: string;
}

/**
 * Task Metadata
 * Extensible metadata for task-specific information
 */
export interface TaskMetadata {
  /** Task title/name from Implementation Plan */
  title: string;
  /** Task description/objective */
  description?: string;
  /** Execution pattern (single-step or multi-step) */
  executionType?: TaskExecutionType;
  /** Estimated effort in hours */
  estimatedHours?: number;
  /** Actual effort in hours (after completion) */
  actualHours?: number;
  /** Tags for categorization and filtering */
  tags?: string[];
  /** Memory log file path for this task */
  memoryLogPath?: string;
  /** Custom metadata fields */
  [key: string]: unknown;
}

/**
 * Task State Interface
 * Comprehensive state representation for a task instance
 *
 * @example
 * ```typescript
 * const taskState: TaskState = {
 *   id: 'task_1_3',
 *   phaseId: 'phase_1',
 *   status: TaskStatus.InProgress,
 *   assignedAgent: 'agent_impl_001',
 *   dependencies: [
 *     { taskId: 'task_1_1', type: 'required', description: 'Requires database schema' }
 *   ],
 *   startTime: new Date('2025-01-01T10:00:00Z'),
 *   completionTime: null,
 *   metadata: {
 *     title: 'State Machine Models and TypeScript Types',
 *     executionType: TaskExecutionType.SingleStep,
 *     memoryLogPath: '.apm/Memory/Phase_01/Task_1_3.md'
 *   }
 * };
 * ```
 */
export interface TaskState {
  /** Unique identifier for the task (e.g., 'task_1_3') */
  id: string;
  /** Phase this task belongs to (e.g., 'phase_1') */
  phaseId: string;
  /** Current execution status of the task */
  status: TaskStatus;
  /** ID of the agent assigned to this task (null if unassigned) */
  assignedAgent: string | null;
  /** Agent domain required for this task */
  requiredDomain?: AgentDomain;
  /** List of task dependencies that must be satisfied */
  dependencies: TaskDependency[];
  /** Timestamp when task execution started (null if not started) */
  startTime: Date | null;
  /** Timestamp when task was completed or failed (null if in progress) */
  completionTime: Date | null;
  /** Task priority level */
  priority?: TaskPriority;
  /** Extensible metadata for task-specific information */
  metadata: TaskMetadata;
}

/**
 * Task State Discriminated Union
 * Enables exhaustive type checking based on task status
 */
export type TaskStateByStatus =
  | { status: TaskStatus.Pending; assignedAgent: null; startTime: null; completionTime: null }
  | { status: TaskStatus.Assigned; assignedAgent: string; startTime: null; completionTime: null }
  | { status: TaskStatus.InProgress; assignedAgent: string; startTime: Date; completionTime: null }
  | { status: TaskStatus.Blocked; assignedAgent: string; startTime: Date; completionTime: null }
  | { status: TaskStatus.Completed; assignedAgent: string; startTime: Date; completionTime: Date }
  | { status: TaskStatus.Failed; assignedAgent: string; startTime: Date; completionTime: Date };

/**
 * Pending Task State
 * Specialized state type for tasks not yet assigned
 */
export interface PendingTaskState extends Omit<TaskState, 'status' | 'assignedAgent' | 'startTime' | 'completionTime'> {
  status: TaskStatus.Pending;
  assignedAgent: null;
  startTime: null;
  completionTime: null;
}

/**
 * Assigned Task State
 * Specialized state type for tasks assigned but not started
 */
export interface AssignedTaskState extends Omit<TaskState, 'status' | 'startTime' | 'completionTime'> {
  status: TaskStatus.Assigned;
  assignedAgent: string;
  startTime: null;
  completionTime: null;
}

/**
 * In-Progress Task State
 * Specialized state type for tasks currently being executed
 */
export interface InProgressTaskState extends Omit<TaskState, 'status' | 'completionTime'> {
  status: TaskStatus.InProgress;
  assignedAgent: string;
  startTime: Date;
  completionTime: null;
}

/**
 * Blocked Task State
 * Specialized state type for tasks blocked by dependencies or issues
 */
export interface BlockedTaskState extends Omit<TaskState, 'status' | 'completionTime'> {
  status: TaskStatus.Blocked;
  assignedAgent: string;
  startTime: Date;
  completionTime: null;
  /** Reason for blocking */
  blockReason?: string;
}

/**
 * Completed Task State
 * Specialized state type for successfully completed tasks
 */
export interface CompletedTaskState extends Omit<TaskState, 'status'> {
  status: TaskStatus.Completed;
  assignedAgent: string;
  startTime: Date;
  completionTime: Date;
}

/**
 * Failed Task State
 * Specialized state type for tasks that failed execution
 */
export interface FailedTaskState extends Omit<TaskState, 'status'> {
  status: TaskStatus.Failed;
  assignedAgent: string;
  startTime: Date;
  completionTime: Date;
  /** Error message or failure reason */
  errorMessage?: string;
}

/**
 * Task Assignment Request
 * Configuration for assigning a task to an agent
 */
export interface TaskAssignmentRequest {
  /** ID of the task to assign */
  taskId: string;
  /** ID of the agent to assign the task to */
  agentId: string;
  /** Optional configuration for task execution */
  config?: Record<string, unknown>;
}

/**
 * Task Assignment Result
 * Response from assigning a task to an agent
 */
export interface TaskAssignmentResult {
  /** Whether assignment was successful */
  success: boolean;
  /** The updated task state (if successful) */
  taskState?: TaskState;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Task Execution Result
 * Result of task execution by an agent
 */
export interface TaskExecutionResult {
  /** ID of the executed task */
  taskId: string;
  /** Whether execution was successful */
  success: boolean;
  /** Final task status */
  status: TaskStatus.Completed | TaskStatus.Failed;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Output or result data from task execution */
  output?: unknown;
  /** Error message (if failed) */
  error?: string;
  /** Files created or modified during execution */
  artifacts?: string[];
}

/**
 * Task Dependency Check Result
 * Result of checking if task dependencies are satisfied
 */
export interface TaskDependencyCheck {
  /** Whether all dependencies are satisfied */
  satisfied: boolean;
  /** List of unsatisfied dependency task IDs */
  unsatisfiedDependencies: string[];
  /** List of blocked dependency task IDs */
  blockedDependencies: string[];
}
