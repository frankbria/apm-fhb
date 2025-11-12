/**
 * Session Type Definitions for apm-auto State Machine
 *
 * This module defines comprehensive TypeScript types for session management
 * including session status, checkpoint tracking, persistence, and recovery.
 */

/**
 * Session Status Enumeration
 * Represents all possible states in the session lifecycle
 */
export enum SessionStatus {
  /** Session is being initialized */
  Initializing = 'Initializing',
  /** Session is actively running with agents executing tasks */
  Running = 'Running',
  /** Session is paused and can be resumed */
  Paused = 'Paused',
  /** Session has completed all work successfully */
  Completed = 'Completed',
  /** Session has failed and requires intervention */
  Failed = 'Failed'
}

/**
 * Session Checkpoint
 * Represents a snapshot of session state for recovery purposes
 */
export interface SessionCheckpoint {
  /** Unique checkpoint identifier */
  id: string;
  /** Timestamp when checkpoint was created */
  timestamp: Date;
  /** Human-readable description of checkpoint */
  description: string;
  /** Snapshot of active agent IDs at checkpoint time */
  activeAgents: string[];
  /** Snapshot of completed task IDs at checkpoint time */
  completedTasks: string[];
  /** Snapshot of in-progress task IDs at checkpoint time */
  inProgressTasks: string[];
  /** Additional checkpoint metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Session Configuration
 * Configuration options for a session
 */
export interface SessionConfig {
  /** Autonomy level for the session */
  autonomyLevel?: 'Cautious' | 'Automated' | 'YOLO';
  /** Maximum number of concurrent agents */
  maxConcurrentAgents?: number;
  /** Enable automatic checkpointing */
  autoCheckpoint?: boolean;
  /** Checkpoint interval in minutes */
  checkpointIntervalMinutes?: number;
  /** Enable automatic error recovery */
  autoRecovery?: boolean;
  /** Maximum recovery attempts before failing */
  maxRecoveryAttempts?: number;
  /** Custom configuration fields */
  [key: string]: unknown;
}

/**
 * Session Scope Definition
 * Defines the scope of work for a session
 */
export interface SessionScope {
  /** Phase range (e.g., [1, 3] for phases 1-3) */
  phaseRange?: [number, number];
  /** Specific task IDs to include */
  taskIds?: string[];
  /** Agent domain filters */
  agentDomains?: string[];
  /** Custom tags for filtering */
  tags?: string[];
}

/**
 * Session Metadata
 * Extensible metadata for session-specific information
 */
export interface SessionMetadata {
  /** Session name or title */
  name?: string;
  /** Session description */
  description?: string;
  /** User who initiated the session */
  initiatedBy?: string;
  /** Session scope definition */
  scope?: SessionScope;
  /** Session configuration */
  config: SessionConfig;
  /** Total number of tasks in session */
  totalTasks?: number;
  /** Number of completed tasks */
  completedTasksCount?: number;
  /** Number of failed tasks */
  failedTasksCount?: number;
  /** Custom metadata fields */
  [key: string]: unknown;
}

/**
 * Session State Interface
 * Comprehensive state representation for an automation session
 *
 * @example
 * ```typescript
 * const sessionState: SessionState = {
 *   id: 'session_001',
 *   projectId: 'apm-auto',
 *   status: SessionStatus.Running,
 *   startTime: new Date('2025-01-01T10:00:00Z'),
 *   pauseTime: null,
 *   endTime: null,
 *   checkpoints: [
 *     {
 *       id: 'checkpoint_001',
 *       timestamp: new Date('2025-01-01T10:30:00Z'),
 *       description: 'Phase 1 foundation complete',
 *       activeAgents: ['agent_impl_001'],
 *       completedTasks: ['task_1_1', 'task_1_2'],
 *       inProgressTasks: ['task_1_3']
 *     }
 *   ],
 *   activeAgents: ['agent_impl_001'],
 *   metadata: {
 *     name: 'Phase 1 Foundation',
 *     config: { autonomyLevel: 'Automated', maxConcurrentAgents: 3 }
 *   }
 * };
 * ```
 */
export interface SessionState {
  /** Unique identifier for the session */
  id: string;
  /** Project identifier this session belongs to */
  projectId: string;
  /** Current status of the session */
  status: SessionStatus;
  /** Timestamp when session started */
  startTime: Date;
  /** Timestamp when session was paused (null if not paused) */
  pauseTime: Date | null;
  /** Timestamp when session ended (null if still running) */
  endTime: Date | null;
  /** List of checkpoints for recovery */
  checkpoints: SessionCheckpoint[];
  /** IDs of currently active agents */
  activeAgents: string[];
  /** Extensible metadata for session-specific information */
  metadata: SessionMetadata;
}

/**
 * Session State Discriminated Union
 * Enables exhaustive type checking based on session status
 */
export type SessionStateByStatus =
  | { status: SessionStatus.Initializing; pauseTime: null; endTime: null }
  | { status: SessionStatus.Running; pauseTime: null; endTime: null }
  | { status: SessionStatus.Paused; pauseTime: Date; endTime: null }
  | { status: SessionStatus.Completed; pauseTime: null; endTime: Date }
  | { status: SessionStatus.Failed; pauseTime: null; endTime: Date };

/**
 * Initializing Session State
 * Specialized state type for sessions being set up
 */
export interface InitializingSessionState extends Omit<SessionState, 'status' | 'pauseTime' | 'endTime'> {
  status: SessionStatus.Initializing;
  pauseTime: null;
  endTime: null;
}

/**
 * Running Session State
 * Specialized state type for active sessions
 */
export interface RunningSessionState extends Omit<SessionState, 'status' | 'pauseTime' | 'endTime'> {
  status: SessionStatus.Running;
  pauseTime: null;
  endTime: null;
}

/**
 * Paused Session State
 * Specialized state type for paused sessions
 */
export interface PausedSessionState extends Omit<SessionState, 'status' | 'endTime'> {
  status: SessionStatus.Paused;
  pauseTime: Date;
  endTime: null;
}

/**
 * Completed Session State
 * Specialized state type for successfully completed sessions
 */
export interface CompletedSessionState extends Omit<SessionState, 'status' | 'pauseTime'> {
  status: SessionStatus.Completed;
  pauseTime: null;
  endTime: Date;
}

/**
 * Failed Session State
 * Specialized state type for failed sessions
 */
export interface FailedSessionState extends Omit<SessionState, 'status' | 'pauseTime'> {
  status: SessionStatus.Failed;
  pauseTime: null;
  endTime: Date;
  /** Error message or failure reason */
  errorMessage?: string;
}

/**
 * Session Start Request
 * Configuration for starting a new session
 */
export interface SessionStartRequest {
  /** Project identifier */
  projectId: string;
  /** Session name */
  name?: string;
  /** Session scope definition */
  scope?: SessionScope;
  /** Session configuration */
  config?: SessionConfig;
}

/**
 * Session Start Result
 * Response from starting a new session
 */
export interface SessionStartResult {
  /** Whether session start was successful */
  success: boolean;
  /** The created session state (if successful) */
  sessionState?: SessionState;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Session Resume Request
 * Configuration for resuming a paused session
 */
export interface SessionResumeRequest {
  /** ID of the session to resume */
  sessionId: string;
  /** Optional checkpoint ID to resume from */
  checkpointId?: string;
}

/**
 * Session Resume Result
 * Response from resuming a session
 */
export interface SessionResumeResult {
  /** Whether resume was successful */
  success: boolean;
  /** The resumed session state (if successful) */
  sessionState?: SessionState;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Session Checkpoint Request
 * Configuration for creating a checkpoint
 */
export interface SessionCheckpointRequest {
  /** ID of the session to checkpoint */
  sessionId: string;
  /** Description of the checkpoint */
  description: string;
  /** Additional checkpoint metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Session Checkpoint Result
 * Response from creating a checkpoint
 */
export interface SessionCheckpointResult {
  /** Whether checkpoint creation was successful */
  success: boolean;
  /** The created checkpoint (if successful) */
  checkpoint?: SessionCheckpoint;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Session Recovery Request
 * Configuration for recovering a failed session
 */
export interface SessionRecoveryRequest {
  /** ID of the session to recover */
  sessionId: string;
  /** Checkpoint ID to recover from */
  checkpointId?: string;
  /** Recovery strategy */
  strategy?: 'retry' | 'skip' | 'manual';
}

/**
 * Session Recovery Result
 * Response from recovering a session
 */
export interface SessionRecoveryResult {
  /** Whether recovery was successful */
  success: boolean;
  /** The recovered session state (if successful) */
  sessionState?: SessionState;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Session Summary
 * High-level summary of session execution
 */
export interface SessionSummary {
  /** Session ID */
  sessionId: string;
  /** Session status */
  status: SessionStatus;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Number of tasks completed */
  tasksCompleted: number;
  /** Number of tasks failed */
  tasksFailed: number;
  /** Number of agents spawned */
  agentsSpawned: number;
  /** Number of checkpoints created */
  checkpointsCreated: number;
  /** Success rate (percentage) */
  successRate: number;
}
