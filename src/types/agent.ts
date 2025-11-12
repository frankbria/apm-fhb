/**
 * Agent Type Definitions for apm-auto State Machine
 *
 * This module defines comprehensive TypeScript types for agent state management
 * including agent types, status enums, state interfaces, and domain assignments.
 * All types use strict typing with no implicit any.
 */

/**
 * Agent Type Enumeration
 * Defines the three primary agent types in the apm-auto system
 */
export enum AgentType {
  /** Manager agent responsible for orchestration and coordination */
  Manager = 'Manager',
  /** Implementation agent for executing specific tasks */
  Implementation = 'Implementation',
  /** Ad-hoc agent for temporary specialized tasks like debugging or research */
  AdHoc = 'AdHoc'
}

/**
 * Agent Status Enumeration
 * Represents the complete lifecycle of an agent from creation to termination
 */
export enum AgentStatus {
  /** Agent is being initialized and spawned */
  Spawning = 'Spawning',
  /** Agent is actively executing tasks */
  Active = 'Active',
  /** Agent is waiting for external input or dependencies */
  Waiting = 'Waiting',
  /** Agent is idle with no current tasks but still running */
  Idle = 'Idle',
  /** Agent has been terminated and is no longer active */
  Terminated = 'Terminated'
}

/**
 * Agent Domain Types
 * Maps to Implementation Plan agent assignments for specialized domains.
 * These domains represent the areas of expertise for Implementation agents.
 */
export enum AgentDomain {
  /** Foundation work: database, state management, core infrastructure */
  Orchestration_Foundation = 'Orchestration_Foundation',
  /** CLI development: command structure, user interface */
  Orchestration_CLI = 'Orchestration_CLI',
  /** Communication protocols: file-based messaging, event handling */
  Communication = 'Communication',
  /** Agent automation: spawning, lifecycle management, coordination */
  Agent_Orchestration_Automation = 'Agent_Orchestration_Automation',
  /** Parallel execution: git worktree management, concurrent task handling */
  Parallel_Execution = 'Parallel_Execution',
  /** Quality assurance: constitutional gates, validation, testing */
  Quality_Assurance = 'Quality_Assurance',
  /** Monitoring and observability: TUI, logging, metrics */
  Monitoring = 'Monitoring',
  /** Session management: persistence, recovery, checkpointing */
  Session_Management = 'Session_Management',
  /** Configuration and settings management */
  Configuration = 'Configuration',
  /** Documentation and guides */
  Documentation = 'Documentation',
  /** General purpose ad-hoc work */
  General = 'General'
}

/**
 * Agent Metadata
 * Extensible metadata structure for agent-specific information
 */
export interface AgentMetadata {
  /** Agent domain specialization */
  domain?: AgentDomain;
  /** Spawn timestamp */
  spawnedAt: Date;
  /** Last activity timestamp */
  lastActivityAt: Date;
  /** Process ID if applicable */
  processId?: number;
  /** Git worktree path for parallel execution agents */
  worktreePath?: string;
  /** Configuration overrides specific to this agent */
  config?: Record<string, unknown>;
  /** Custom metadata fields */
  [key: string]: unknown;
}

/**
 * Agent State Interface
 * Comprehensive state representation for an agent instance
 *
 * @example
 * ```typescript
 * const agentState: AgentState = {
 *   id: 'agent_impl_001',
 *   type: AgentType.Implementation,
 *   status: AgentStatus.Active,
 *   currentTask: 'task_1_3',
 *   metadata: {
 *     domain: AgentDomain.Orchestration_Foundation,
 *     spawnedAt: new Date(),
 *     lastActivityAt: new Date()
 *   }
 * };
 * ```
 */
export interface AgentState {
  /** Unique identifier for the agent instance */
  id: string;
  /** Type of agent (Manager, Implementation, AdHoc) */
  type: AgentType;
  /** Current lifecycle status of the agent */
  status: AgentStatus;
  /** ID of the task currently being executed (null if idle) */
  currentTask: string | null;
  /** Extensible metadata for agent-specific information */
  metadata: AgentMetadata;
}

/**
 * Agent State Discriminated Union
 * Enables exhaustive type checking based on agent status
 */
export type AgentStateByStatus =
  | { status: AgentStatus.Spawning; currentTask: null }
  | { status: AgentStatus.Active; currentTask: string }
  | { status: AgentStatus.Waiting; currentTask: string }
  | { status: AgentStatus.Idle; currentTask: null }
  | { status: AgentStatus.Terminated; currentTask: null };

/**
 * Spawning Agent State
 * Specialized state type for agents being initialized
 */
export interface SpawningAgentState extends Omit<AgentState, 'status' | 'currentTask'> {
  status: AgentStatus.Spawning;
  currentTask: null;
}

/**
 * Active Agent State
 * Specialized state type for agents actively executing tasks
 */
export interface ActiveAgentState extends Omit<AgentState, 'status' | 'currentTask'> {
  status: AgentStatus.Active;
  currentTask: string;
}

/**
 * Waiting Agent State
 * Specialized state type for agents waiting for dependencies or input
 */
export interface WaitingAgentState extends Omit<AgentState, 'status' | 'currentTask'> {
  status: AgentStatus.Waiting;
  currentTask: string;
}

/**
 * Idle Agent State
 * Specialized state type for agents with no current work
 */
export interface IdleAgentState extends Omit<AgentState, 'status' | 'currentTask'> {
  status: AgentStatus.Idle;
  currentTask: null;
}

/**
 * Terminated Agent State
 * Specialized state type for agents that have been shut down
 */
export interface TerminatedAgentState extends Omit<AgentState, 'status' | 'currentTask'> {
  status: AgentStatus.Terminated;
  currentTask: null;
}

/**
 * Agent Spawn Request
 * Configuration for spawning a new agent instance
 */
export interface AgentSpawnRequest {
  /** Type of agent to spawn */
  type: AgentType;
  /** Domain specialization (required for Implementation agents) */
  domain?: AgentDomain;
  /** Initial task assignment (optional) */
  initialTask?: string;
  /** Custom configuration for the agent */
  config?: Record<string, unknown>;
}

/**
 * Agent Spawn Result
 * Response from spawning a new agent
 */
export interface AgentSpawnResult {
  /** Whether spawn was successful */
  success: boolean;
  /** The spawned agent's state (if successful) */
  agentState?: AgentState;
  /** Error message (if failed) */
  error?: string;
}
