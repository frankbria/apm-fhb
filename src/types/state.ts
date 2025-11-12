/**
 * State Transition Type Definitions for apm-auto State Machine
 *
 * This module defines comprehensive TypeScript types for state transitions,
 * event handling, and state change tracking across the entire system.
 */

import { AgentStatus } from './agent.js';
import { TaskStatus } from './task.js';
import { SessionStatus } from './session.js';

/**
 * Transition Trigger Type
 * Represents what caused a state transition
 */
export enum TransitionTrigger {
  /** User-initiated action (command, button click, etc.) */
  UserAction = 'UserAction',
  /** System-initiated automatic transition */
  Automatic = 'Automatic',
  /** Timeout-triggered transition */
  Timeout = 'Timeout',
  /** Error-triggered transition */
  Error = 'Error',
  /** Dependency satisfaction triggered transition */
  Dependency = 'Dependency',
  /** Recovery process triggered transition */
  Recovery = 'Recovery'
}

/**
 * State Entity Type
 * Identifies which type of entity is transitioning
 */
export enum StateEntityType {
  /** Agent state transition */
  Agent = 'Agent',
  /** Task state transition */
  Task = 'Task',
  /** Session state transition */
  Session = 'Session'
}

/**
 * State Transition Metadata
 * Additional context about a state transition
 */
export interface StateTransitionMetadata {
  /** Reason for the transition */
  reason?: string;
  /** User ID if triggered by user action */
  userId?: string;
  /** Process ID if relevant */
  processId?: number;
  /** Error details if transition was error-triggered */
  errorDetails?: {
    message: string;
    code?: string;
    stack?: string;
  };
  /** Related entity IDs (e.g., dependent tasks) */
  relatedEntities?: string[];
  /** Custom metadata fields */
  [key: string]: unknown;
}

/**
 * Base State Transition Interface
 * Core structure for all state transitions
 */
export interface StateTransition<TState = string> {
  /** Unique identifier for this transition */
  id: string;
  /** Type of entity transitioning */
  entityType: StateEntityType;
  /** ID of the entity transitioning */
  entityId: string;
  /** Previous state */
  fromState: TState;
  /** New state */
  toState: TState;
  /** Timestamp when transition occurred */
  timestamp: Date;
  /** What triggered this transition */
  trigger: TransitionTrigger;
  /** Additional context about the transition */
  metadata?: StateTransitionMetadata;
}

/**
 * Agent State Transition
 * Specialized transition for agent state changes
 */
export interface AgentStateTransition extends StateTransition<AgentStatus> {
  entityType: StateEntityType.Agent;
  /** Task ID if agent is transitioning to/from task execution */
  taskId?: string;
}

/**
 * Task State Transition
 * Specialized transition for task state changes
 */
export interface TaskStateTransition extends StateTransition<TaskStatus> {
  entityType: StateEntityType.Task;
  /** Agent ID assigned to the task */
  agentId?: string;
}

/**
 * Session State Transition
 * Specialized transition for session state changes
 */
export interface SessionStateTransition extends StateTransition<SessionStatus> {
  entityType: StateEntityType.Session;
  /** Number of active agents at transition time */
  activeAgentCount?: number;
  /** Number of completed tasks at transition time */
  completedTaskCount?: number;
}

/**
 * State Transition Union
 * Discriminated union of all transition types
 */
export type AnyStateTransition =
  | AgentStateTransition
  | TaskStateTransition
  | SessionStateTransition;

/**
 * Valid Agent State Transitions
 * Defines the allowed state transitions for agents
 */
export type ValidAgentTransition =
  | { from: AgentStatus.Spawning; to: AgentStatus.Active | AgentStatus.Terminated }
  | { from: AgentStatus.Active; to: AgentStatus.Waiting | AgentStatus.Idle | AgentStatus.Terminated }
  | { from: AgentStatus.Waiting; to: AgentStatus.Active | AgentStatus.Terminated }
  | { from: AgentStatus.Idle; to: AgentStatus.Active | AgentStatus.Terminated }
  | { from: AgentStatus.Terminated; to: never };

/**
 * Valid Task State Transitions
 * Defines the allowed state transitions for tasks
 */
export type ValidTaskTransition =
  | { from: TaskStatus.Pending; to: TaskStatus.Assigned | TaskStatus.Blocked }
  | { from: TaskStatus.Assigned; to: TaskStatus.InProgress | TaskStatus.Blocked | TaskStatus.Pending }
  | { from: TaskStatus.InProgress; to: TaskStatus.Completed | TaskStatus.Failed | TaskStatus.Blocked }
  | { from: TaskStatus.Blocked; to: TaskStatus.InProgress | TaskStatus.Failed }
  | { from: TaskStatus.Completed; to: never }
  | { from: TaskStatus.Failed; to: TaskStatus.Pending };

/**
 * Valid Session State Transitions
 * Defines the allowed state transitions for sessions
 */
export type ValidSessionTransition =
  | { from: SessionStatus.Initializing; to: SessionStatus.Running | SessionStatus.Failed }
  | { from: SessionStatus.Running; to: SessionStatus.Paused | SessionStatus.Completed | SessionStatus.Failed }
  | { from: SessionStatus.Paused; to: SessionStatus.Running | SessionStatus.Failed }
  | { from: SessionStatus.Completed; to: never }
  | { from: SessionStatus.Failed; to: SessionStatus.Running };

/**
 * State Transition Request
 * Configuration for requesting a state transition
 */
export interface StateTransitionRequest<TState = string> {
  /** Type of entity to transition */
  entityType: StateEntityType;
  /** ID of the entity to transition */
  entityId: string;
  /** Target state */
  toState: TState;
  /** What is triggering this transition */
  trigger: TransitionTrigger;
  /** Additional metadata */
  metadata?: StateTransitionMetadata;
}

/**
 * State Transition Result
 * Response from a state transition request
 */
export interface StateTransitionResult<TState = string> {
  /** Whether transition was successful */
  success: boolean;
  /** The created transition record (if successful) */
  transition?: StateTransition<TState>;
  /** Error message (if failed) */
  error?: string;
  /** Whether the transition was valid according to state machine rules */
  wasValidTransition?: boolean;
}

/**
 * State Transition Validation Result
 * Result of validating a proposed state transition
 */
export interface StateTransitionValidation {
  /** Whether the transition is valid */
  isValid: boolean;
  /** Reason if transition is invalid */
  reason?: string;
  /** Suggested alternative transitions if current is invalid */
  suggestedAlternatives?: string[];
}

/**
 * State Transition Event
 * Event emitted when a state transition occurs
 */
export interface StateTransitionEvent<TState = string> {
  /** Type of event */
  type: 'state_transition';
  /** The transition that occurred */
  transition: StateTransition<TState>;
  /** Timestamp of event emission */
  emittedAt: Date;
}

/**
 * State Transition History Query
 * Query parameters for retrieving transition history
 */
export interface StateTransitionHistoryQuery {
  /** Filter by entity type */
  entityType?: StateEntityType;
  /** Filter by entity ID */
  entityId?: string;
  /** Filter by source state */
  fromState?: string;
  /** Filter by target state */
  toState?: string;
  /** Filter by trigger type */
  trigger?: TransitionTrigger;
  /** Start time for time range filter */
  startTime?: Date;
  /** End time for time range filter */
  endTime?: Date;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * State Transition History Result
 * Response from querying transition history
 */
export interface StateTransitionHistoryResult {
  /** List of transitions matching the query */
  transitions: AnyStateTransition[];
  /** Total count of matching transitions */
  totalCount: number;
  /** Whether there are more results available */
  hasMore: boolean;
}

/**
 * State Snapshot
 * Complete snapshot of system state at a point in time
 */
export interface StateSnapshot {
  /** Unique identifier for the snapshot */
  id: string;
  /** Timestamp when snapshot was taken */
  timestamp: Date;
  /** Snapshot of all agent states */
  agents: Record<string, unknown>;
  /** Snapshot of all task states */
  tasks: Record<string, unknown>;
  /** Snapshot of session state */
  session: unknown;
  /** Description of snapshot */
  description?: string;
}

/**
 * State Rollback Request
 * Configuration for rolling back to a previous state
 */
export interface StateRollbackRequest {
  /** Snapshot ID to rollback to */
  snapshotId: string;
  /** Whether to create a checkpoint before rollback */
  createCheckpoint?: boolean;
}

/**
 * State Rollback Result
 * Response from a rollback operation
 */
export interface StateRollbackResult {
  /** Whether rollback was successful */
  success: boolean;
  /** Checkpoint ID if checkpoint was created */
  checkpointId?: string;
  /** Error message (if failed) */
  error?: string;
}
