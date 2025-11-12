/**
 * Type Guard Functions for apm-auto Type System
 *
 * This module provides type guard functions for safe type narrowing in
 * conditional logic. Type guards enable TypeScript to narrow types at
 * compile time based on runtime checks.
 */

import {
  AgentState,
  AgentStatus,
  AgentType,
  ActiveAgentState,
  SpawningAgentState,
  WaitingAgentState,
  IdleAgentState,
  TerminatedAgentState,
  TaskState,
  TaskStatus,
  PendingTaskState,
  AssignedTaskState,
  InProgressTaskState,
  BlockedTaskState,
  CompletedTaskState,
  FailedTaskState,
  SessionState,
  SessionStatus,
  InitializingSessionState,
  RunningSessionState,
  PausedSessionState,
  CompletedSessionState,
  FailedSessionState,
  StateTransition,
  AgentStateTransition,
  TaskStateTransition,
  SessionStateTransition,
  StateEntityType
} from '../types/index.js';

// ============================================================================
// Agent Type Guards
// ============================================================================

/**
 * Type guard to check if value is an AgentState
 */
export function isAgentState(value: unknown): value is AgentState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'type' in value &&
    'status' in value &&
    'currentTask' in value &&
    'metadata' in value &&
    typeof (value as AgentState).id === 'string' &&
    Object.values(AgentType).includes((value as AgentState).type) &&
    Object.values(AgentStatus).includes((value as AgentState).status)
  );
}

/**
 * Type guard to check if agent is in Spawning state
 */
export function isSpawningAgent(agent: AgentState): agent is SpawningAgentState {
  return agent.status === AgentStatus.Spawning;
}

/**
 * Type guard to check if agent is in Active state
 */
export function isActiveAgent(agent: AgentState): agent is ActiveAgentState {
  return agent.status === AgentStatus.Active;
}

/**
 * Type guard to check if agent is in Waiting state
 */
export function isWaitingAgent(agent: AgentState): agent is WaitingAgentState {
  return agent.status === AgentStatus.Waiting;
}

/**
 * Type guard to check if agent is in Idle state
 */
export function isIdleAgent(agent: AgentState): agent is IdleAgentState {
  return agent.status === AgentStatus.Idle;
}

/**
 * Type guard to check if agent is in Terminated state
 */
export function isTerminatedAgent(agent: AgentState): agent is TerminatedAgentState {
  return agent.status === AgentStatus.Terminated;
}

/**
 * Type guard to check if agent is a Manager agent
 */
export function isManagerAgent(agent: AgentState): boolean {
  return agent.type === AgentType.Manager;
}

/**
 * Type guard to check if agent is an Implementation agent
 */
export function isImplementationAgent(agent: AgentState): boolean {
  return agent.type === AgentType.Implementation;
}

/**
 * Type guard to check if agent is an AdHoc agent
 */
export function isAdHocAgent(agent: AgentState): boolean {
  return agent.type === AgentType.AdHoc;
}

/**
 * Type guard to check if agent can execute tasks (Active or Waiting)
 */
export function isExecutingAgent(agent: AgentState): agent is ActiveAgentState | WaitingAgentState {
  return agent.status === AgentStatus.Active || agent.status === AgentStatus.Waiting;
}

/**
 * Type guard to check if agent is available for new work (Idle)
 */
export function isAvailableAgent(agent: AgentState): agent is IdleAgentState {
  return agent.status === AgentStatus.Idle;
}

// ============================================================================
// Task Type Guards
// ============================================================================

/**
 * Type guard to check if value is a TaskState
 */
export function isTaskState(value: unknown): value is TaskState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'phaseId' in value &&
    'status' in value &&
    'assignedAgent' in value &&
    'dependencies' in value &&
    'startTime' in value &&
    'completionTime' in value &&
    'metadata' in value &&
    typeof (value as TaskState).id === 'string' &&
    Object.values(TaskStatus).includes((value as TaskState).status)
  );
}

/**
 * Type guard to check if task is in Pending state
 */
export function isPendingTask(task: TaskState): task is PendingTaskState {
  return task.status === TaskStatus.Pending;
}

/**
 * Type guard to check if task is in Assigned state
 */
export function isAssignedTask(task: TaskState): task is AssignedTaskState {
  return task.status === TaskStatus.Assigned;
}

/**
 * Type guard to check if task is in InProgress state
 */
export function isInProgressTask(task: TaskState): task is InProgressTaskState {
  return task.status === TaskStatus.InProgress;
}

/**
 * Type guard to check if task is in Blocked state
 */
export function isBlockedTask(task: TaskState): task is BlockedTaskState {
  return task.status === TaskStatus.Blocked;
}

/**
 * Type guard to check if task is in Completed state
 */
export function isCompletedTask(task: TaskState): task is CompletedTaskState {
  return task.status === TaskStatus.Completed;
}

/**
 * Type guard to check if task is in Failed state
 */
export function isFailedTask(task: TaskState): task is FailedTaskState {
  return task.status === TaskStatus.Failed;
}

/**
 * Type guard to check if task is terminal (Completed or Failed)
 */
export function isTerminalTask(task: TaskState): task is CompletedTaskState | FailedTaskState {
  return task.status === TaskStatus.Completed || task.status === TaskStatus.Failed;
}

/**
 * Type guard to check if task is active (Assigned, InProgress, or Blocked)
 */
export function isActiveTask(task: TaskState): task is AssignedTaskState | InProgressTaskState | BlockedTaskState {
  return (
    task.status === TaskStatus.Assigned ||
    task.status === TaskStatus.InProgress ||
    task.status === TaskStatus.Blocked
  );
}

/**
 * Type guard to check if task is executable (not Pending, Blocked, Completed, or Failed)
 */
export function isExecutableTask(task: TaskState): boolean {
  return (
    task.status !== TaskStatus.Pending &&
    task.status !== TaskStatus.Blocked &&
    task.status !== TaskStatus.Completed &&
    task.status !== TaskStatus.Failed
  );
}

// ============================================================================
// Session Type Guards
// ============================================================================

/**
 * Type guard to check if value is a SessionState
 */
export function isSessionState(value: unknown): value is SessionState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'projectId' in value &&
    'status' in value &&
    'startTime' in value &&
    'pauseTime' in value &&
    'endTime' in value &&
    'checkpoints' in value &&
    'activeAgents' in value &&
    'metadata' in value &&
    typeof (value as SessionState).id === 'string' &&
    Object.values(SessionStatus).includes((value as SessionState).status)
  );
}

/**
 * Type guard to check if session is in Initializing state
 */
export function isInitializingSession(session: SessionState): session is InitializingSessionState {
  return session.status === SessionStatus.Initializing;
}

/**
 * Type guard to check if session is in Running state
 */
export function isRunningSession(session: SessionState): session is RunningSessionState {
  return session.status === SessionStatus.Running;
}

/**
 * Type guard to check if session is in Paused state
 */
export function isPausedSession(session: SessionState): session is PausedSessionState {
  return session.status === SessionStatus.Paused;
}

/**
 * Type guard to check if session is in Completed state
 */
export function isCompletedSession(session: SessionState): session is CompletedSessionState {
  return session.status === SessionStatus.Completed;
}

/**
 * Type guard to check if session is in Failed state
 */
export function isFailedSession(session: SessionState): session is FailedSessionState {
  return session.status === SessionStatus.Failed;
}

/**
 * Type guard to check if session is terminal (Completed or Failed)
 */
export function isTerminalSession(session: SessionState): session is CompletedSessionState | FailedSessionState {
  return session.status === SessionStatus.Completed || session.status === SessionStatus.Failed;
}

/**
 * Type guard to check if session is active (Running or Paused)
 */
export function isActiveSession(session: SessionState): session is RunningSessionState | PausedSessionState {
  return session.status === SessionStatus.Running || session.status === SessionStatus.Paused;
}

/**
 * Type guard to check if session can be resumed (Paused or Failed)
 */
export function isResumableSession(session: SessionState): boolean {
  return session.status === SessionStatus.Paused || session.status === SessionStatus.Failed;
}

// ============================================================================
// State Transition Type Guards
// ============================================================================

/**
 * Type guard to check if value is a StateTransition
 */
export function isStateTransition(value: unknown): value is StateTransition {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'entityType' in value &&
    'entityId' in value &&
    'fromState' in value &&
    'toState' in value &&
    'timestamp' in value &&
    'trigger' in value &&
    typeof (value as StateTransition).id === 'string' &&
    Object.values(StateEntityType).includes((value as StateTransition).entityType)
  );
}

/**
 * Type guard to check if transition is an AgentStateTransition
 */
export function isAgentStateTransition(transition: StateTransition): transition is AgentStateTransition {
  return transition.entityType === StateEntityType.Agent;
}

/**
 * Type guard to check if transition is a TaskStateTransition
 */
export function isTaskStateTransition(transition: StateTransition): transition is TaskStateTransition {
  return transition.entityType === StateEntityType.Task;
}

/**
 * Type guard to check if transition is a SessionStateTransition
 */
export function isSessionStateTransition(transition: StateTransition): transition is SessionStateTransition {
  return transition.entityType === StateEntityType.Session;
}

// ============================================================================
// Composite Type Guards
// ============================================================================

/**
 * Type guard to check if agent has an assigned task
 */
export function hasAssignedTask(agent: AgentState): agent is ActiveAgentState | WaitingAgentState {
  return agent.currentTask !== null && (
    agent.status === AgentStatus.Active ||
    agent.status === AgentStatus.Waiting
  );
}

/**
 * Type guard to check if task has an assigned agent
 */
export function hasAssignedAgent(task: TaskState): task is AssignedTaskState | InProgressTaskState | BlockedTaskState | CompletedTaskState | FailedTaskState {
  return task.assignedAgent !== null && task.status !== TaskStatus.Pending;
}

/**
 * Type guard to check if task has started execution
 */
export function hasStartedExecution(task: TaskState): task is InProgressTaskState | BlockedTaskState | CompletedTaskState | FailedTaskState {
  return task.startTime !== null && (
    task.status === TaskStatus.InProgress ||
    task.status === TaskStatus.Blocked ||
    task.status === TaskStatus.Completed ||
    task.status === TaskStatus.Failed
  );
}

/**
 * Type guard to check if task has completed execution
 */
export function hasCompletedExecution(task: TaskState): task is CompletedTaskState | FailedTaskState {
  return task.completionTime !== null && (
    task.status === TaskStatus.Completed ||
    task.status === TaskStatus.Failed
  );
}

/**
 * Type guard to check if session has active agents
 */
export function hasActiveAgents(session: SessionState): boolean {
  return session.activeAgents.length > 0;
}

/**
 * Type guard to check if session has checkpoints
 */
export function hasCheckpoints(session: SessionState): boolean {
  return session.checkpoints.length > 0;
}

// ============================================================================
// Utility Type Guards
// ============================================================================

/**
 * Type guard to check if value is a valid Date object
 */
export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !isNaN(value.getTime());
}

/**
 * Type guard to check if value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Type guard to check if value is a positive number
 */
export function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && value > 0 && !isNaN(value);
}

/**
 * Type guard to check if value is a non-negative number
 */
export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && !isNaN(value);
}

/**
 * Type guard to check if value is a valid record
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard to check if value is a valid array
 */
export function isArray<T>(value: unknown): value is T[] {
  return Array.isArray(value);
}
