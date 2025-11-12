/**
 * apm-auto Type System - Barrel Export
 *
 * This module provides a central export point for all apm-auto type definitions,
 * enabling convenient imports throughout the codebase.
 *
 * @example
 * ```typescript
 * import {
 *   AgentState,
 *   AgentStatus,
 *   TaskState,
 *   TaskStatus,
 *   SessionState,
 *   SessionStatus,
 *   StateTransition
 * } from './types/index.js';
 * ```
 */

// Agent Types
export {
  AgentType,
  AgentStatus,
  AgentDomain,
  type AgentMetadata,
  type AgentState,
  type AgentStateByStatus,
  type SpawningAgentState,
  type ActiveAgentState,
  type WaitingAgentState,
  type IdleAgentState,
  type TerminatedAgentState,
  type AgentSpawnRequest,
  type AgentSpawnResult
} from './agent.js';

// Task Types
export {
  TaskStatus,
  TaskPriority,
  TaskExecutionType,
  type TaskDependency,
  type TaskMetadata,
  type TaskState,
  type TaskStateByStatus,
  type PendingTaskState,
  type AssignedTaskState,
  type InProgressTaskState,
  type BlockedTaskState,
  type CompletedTaskState,
  type FailedTaskState,
  type TaskAssignmentRequest,
  type TaskAssignmentResult,
  type TaskExecutionResult,
  type TaskDependencyCheck
} from './task.js';

// Session Types
export {
  SessionStatus,
  type SessionCheckpoint,
  type SessionConfig,
  type SessionScope,
  type SessionMetadata,
  type SessionState,
  type SessionStateByStatus,
  type InitializingSessionState,
  type RunningSessionState,
  type PausedSessionState,
  type CompletedSessionState,
  type FailedSessionState,
  type SessionStartRequest,
  type SessionStartResult,
  type SessionResumeRequest,
  type SessionResumeResult,
  type SessionCheckpointRequest,
  type SessionCheckpointResult,
  type SessionRecoveryRequest,
  type SessionRecoveryResult,
  type SessionSummary
} from './session.js';

// State Transition Types
export {
  TransitionTrigger,
  StateEntityType,
  type StateTransitionMetadata,
  type StateTransition,
  type AgentStateTransition,
  type TaskStateTransition,
  type SessionStateTransition,
  type AnyStateTransition,
  type ValidAgentTransition,
  type ValidTaskTransition,
  type ValidSessionTransition,
  type StateTransitionRequest,
  type StateTransitionResult,
  type StateTransitionValidation,
  type StateTransitionEvent,
  type StateTransitionHistoryQuery,
  type StateTransitionHistoryResult,
  type StateSnapshot,
  type StateRollbackRequest,
  type StateRollbackResult
} from './state.js';
