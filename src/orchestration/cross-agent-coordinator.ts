/**
 * Cross-Agent Coordination Logic
 *
 * Handles coordination between different agents, manages cross-agent handoffs,
 * tracks dependencies across agent boundaries, and ensures proper task sequencing
 * when multiple agents are involved.
 */

import { AgentStatus, type AgentState } from '../types/agent.js';
import { type AgentPersistenceManager } from '../state/persistence.js';
import { type DependencyResolver } from './dependency-resolver.js';

/**
 * Handoff status
 */
export enum HandoffStatus {
  /** Waiting for dependency to complete */
  Pending = 'Pending',
  /** Dependency completed, ready for handoff */
  Ready = 'Ready',
  /** Handoff completed */
  Completed = 'Completed',
  /** Handoff failed or blocked */
  Failed = 'Failed',
}

/**
 * Cross-agent handoff information
 */
export interface CrossAgentHandoff {
  /** Handoff ID */
  handoffId: string;
  /** Task requesting the dependency */
  requestingTask: string;
  /** Agent requesting the dependency */
  requestingAgent: string;
  /** Task being depended on */
  dependencyTask: string;
  /** Agent providing the dependency */
  providingAgent: string;
  /** Current status of handoff */
  status: HandoffStatus;
  /** Timestamp when handoff was created */
  createdAt: Date;
  /** Timestamp when dependency completed (if ready/completed) */
  readyAt?: Date;
  /** Timestamp when handoff completed */
  completedAt?: Date;
  /** Error message if failed */
  error?: string;
}

/**
 * Agent coordination state
 */
export interface AgentCoordinationState {
  /** Agent ID */
  agentId: string;
  /** Tasks currently blocked waiting for other agents */
  blockedTasks: string[];
  /** Tasks this agent has completed that others depend on */
  completedOutputs: string[];
  /** Pending handoffs this agent is waiting for */
  pendingHandoffs: CrossAgentHandoff[];
  /** Handoffs this agent provides */
  providingHandoffs: CrossAgentHandoff[];
}

/**
 * Coordination event
 */
export interface CoordinationEvent {
  /** Event type */
  type: 'handoff-created' | 'handoff-ready' | 'handoff-completed' | 'task-blocked' | 'task-unblocked';
  /** Timestamp */
  timestamp: Date;
  /** Related handoff (if applicable) */
  handoff?: CrossAgentHandoff;
  /** Task ID */
  taskId?: string;
  /** Agent ID */
  agentId?: string;
  /** Additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Cross-Agent Coordinator Configuration
 */
export interface CrossAgentCoordinatorConfig {
  /** Dependency resolver for dependency analysis */
  dependencyResolver: DependencyResolver;
  /** Agent persistence manager for state tracking */
  persistence: AgentPersistenceManager;
}

/**
 * Cross-Agent Coordinator
 * Manages coordination between agents for tasks with cross-agent dependencies
 */
export class CrossAgentCoordinator {
  private config: CrossAgentCoordinatorConfig;
  private handoffs: Map<string, CrossAgentHandoff> = new Map();
  private events: CoordinationEvent[] = [];
  private completedTasks: Set<string> = new Set();

  constructor(config: CrossAgentCoordinatorConfig) {
    this.config = config;
  }

  /**
   * Initialize coordinator with current state
   *
   * @param completedTasks - Set of already completed task IDs
   */
  initialize(completedTasks: Set<string>): void {
    this.completedTasks = new Set(completedTasks);

    // Create handoffs for all cross-agent dependencies
    const crossAgentDeps = this.config.dependencyResolver.findCrossAgentDependencies();

    for (const dep of crossAgentDeps) {
      // Only create handoffs for incomplete tasks
      if (!this.completedTasks.has(dep.taskId)) {
        this.createHandoff(dep.taskId, dep.fromAgent, dep.dependsOn, dep.toAgent);
      }
    }
  }

  /**
   * Create a cross-agent handoff
   *
   * @param requestingTask - Task that needs the dependency
   * @param requestingAgent - Agent requesting the dependency
   * @param dependencyTask - Task being depended on
   * @param providingAgent - Agent providing the dependency
   * @returns Created handoff
   */
  createHandoff(
    requestingTask: string,
    requestingAgent: string,
    dependencyTask: string,
    providingAgent: string
  ): CrossAgentHandoff {
    const handoffId = `${dependencyTask}->${requestingTask}`;

    // Check if dependency is already completed
    const status = this.completedTasks.has(dependencyTask)
      ? HandoffStatus.Ready
      : HandoffStatus.Pending;

    const handoff: CrossAgentHandoff = {
      handoffId,
      requestingTask,
      requestingAgent,
      dependencyTask,
      providingAgent,
      status,
      createdAt: new Date(),
      readyAt: status === HandoffStatus.Ready ? new Date() : undefined,
    };

    this.handoffs.set(handoffId, handoff);

    this.emitEvent({
      type: 'handoff-created',
      timestamp: new Date(),
      handoff,
      taskId: requestingTask,
      agentId: requestingAgent,
    });

    return handoff;
  }

  /**
   * Mark a task as completed and update related handoffs
   *
   * @param taskId - Task that was completed
   * @param agentId - Agent that completed the task
   */
  markTaskCompleted(taskId: string, agentId: string): void {
    this.completedTasks.add(taskId);

    // Find all handoffs waiting for this task
    const affectedHandoffs = Array.from(this.handoffs.values()).filter(
      h => h.dependencyTask === taskId && h.status === HandoffStatus.Pending
    );

    // Update handoffs to Ready
    for (const handoff of affectedHandoffs) {
      handoff.status = HandoffStatus.Ready;
      handoff.readyAt = new Date();

      this.emitEvent({
        type: 'handoff-ready',
        timestamp: new Date(),
        handoff,
        taskId: handoff.requestingTask,
        agentId: handoff.requestingAgent,
      });

      // Check if requesting task can now proceed
      const canProceed = this.canTaskProceed(handoff.requestingTask);
      if (canProceed) {
        this.emitEvent({
          type: 'task-unblocked',
          timestamp: new Date(),
          taskId: handoff.requestingTask,
          agentId: handoff.requestingAgent,
        });
      }
    }
  }

  /**
   * Complete a handoff (acknowledge receipt)
   *
   * @param handoffId - Handoff ID
   */
  completeHandoff(handoffId: string): void {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) {
      throw new Error(`Handoff ${handoffId} not found`);
    }

    if (handoff.status !== HandoffStatus.Ready) {
      throw new Error(
        `Cannot complete handoff ${handoffId} with status ${handoff.status}`
      );
    }

    handoff.status = HandoffStatus.Completed;
    handoff.completedAt = new Date();

    this.emitEvent({
      type: 'handoff-completed',
      timestamp: new Date(),
      handoff,
      taskId: handoff.requestingTask,
      agentId: handoff.requestingAgent,
    });
  }

  /**
   * Check if a task can proceed (all cross-agent dependencies met)
   *
   * @param taskId - Task to check
   * @returns True if all cross-agent dependencies are ready
   */
  canTaskProceed(taskId: string): boolean {
    const taskHandoffs = Array.from(this.handoffs.values()).filter(
      h => h.requestingTask === taskId
    );

    // All handoffs must be Ready or Completed
    return taskHandoffs.every(
      h => h.status === HandoffStatus.Ready || h.status === HandoffStatus.Completed
    );
  }

  /**
   * Get blocked tasks for an agent
   *
   * @param agentId - Agent ID
   * @returns Array of task IDs blocked by cross-agent dependencies
   */
  getBlockedTasks(agentId: string): string[] {
    const blockedTasks: string[] = [];

    for (const handoff of this.handoffs.values()) {
      if (
        handoff.requestingAgent === agentId &&
        handoff.status === HandoffStatus.Pending &&
        !blockedTasks.includes(handoff.requestingTask)
      ) {
        blockedTasks.push(handoff.requestingTask);
      }
    }

    return blockedTasks;
  }

  /**
   * Get coordination state for an agent
   *
   * @param agentId - Agent ID
   * @returns Coordination state
   */
  getAgentCoordinationState(agentId: string): AgentCoordinationState {
    const pendingHandoffs = Array.from(this.handoffs.values()).filter(
      h => h.requestingAgent === agentId && h.status !== HandoffStatus.Completed
    );

    const providingHandoffs = Array.from(this.handoffs.values()).filter(
      h => h.providingAgent === agentId
    );

    const blockedTasks = this.getBlockedTasks(agentId);

    const completedOutputs = Array.from(this.completedTasks).filter(taskId => {
      // Check if any handoff is waiting for this task from this agent
      return providingHandoffs.some(h => h.dependencyTask === taskId);
    });

    return {
      agentId,
      blockedTasks,
      completedOutputs,
      pendingHandoffs,
      providingHandoffs,
    };
  }

  /**
   * Get all handoffs
   *
   * @returns Array of all handoffs
   */
  getAllHandoffs(): CrossAgentHandoff[] {
    return Array.from(this.handoffs.values());
  }

  /**
   * Get handoffs by status
   *
   * @param status - Handoff status
   * @returns Array of handoffs with given status
   */
  getHandoffsByStatus(status: HandoffStatus): CrossAgentHandoff[] {
    return Array.from(this.handoffs.values()).filter(h => h.status === status);
  }

  /**
   * Get handoff by ID
   *
   * @param handoffId - Handoff ID
   * @returns Handoff or undefined
   */
  getHandoff(handoffId: string): CrossAgentHandoff | undefined {
    return this.handoffs.get(handoffId);
  }

  /**
   * Get coordination events
   *
   * @param limit - Maximum number of events to return (most recent first)
   * @returns Array of coordination events
   */
  getEvents(limit?: number): CoordinationEvent[] {
    const events = [...this.events].reverse(); // Most recent first
    return limit ? events.slice(0, limit) : events;
  }

  /**
   * Get events for a specific task
   *
   * @param taskId - Task ID
   * @returns Array of events related to task
   */
  getEventsForTask(taskId: string): CoordinationEvent[] {
    return this.events.filter(e => e.taskId === taskId);
  }

  /**
   * Get events for a specific agent
   *
   * @param agentId - Agent ID
   * @returns Array of events related to agent
   */
  getEventsForAgent(agentId: string): CoordinationEvent[] {
    return this.events.filter(e => e.agentId === agentId);
  }

  /**
   * Check if task is blocked by cross-agent dependencies
   *
   * @param taskId - Task ID
   * @returns True if task is blocked
   */
  isTaskBlocked(taskId: string): boolean {
    const taskHandoffs = Array.from(this.handoffs.values()).filter(
      h => h.requestingTask === taskId
    );

    return taskHandoffs.some(h => h.status === HandoffStatus.Pending);
  }

  /**
   * Get blocking dependencies for a task
   *
   * @param taskId - Task ID
   * @returns Array of task IDs blocking this task
   */
  getBlockingDependencies(taskId: string): string[] {
    const blockingDeps: string[] = [];

    for (const handoff of this.handoffs.values()) {
      if (
        handoff.requestingTask === taskId &&
        handoff.status === HandoffStatus.Pending
      ) {
        blockingDeps.push(handoff.dependencyTask);
      }
    }

    return blockingDeps;
  }

  /**
   * Emit a coordination event
   *
   * @param event - Event to emit
   */
  private emitEvent(event: CoordinationEvent): void {
    this.events.push(event);
  }

  /**
   * Clear all state (for testing)
   */
  reset(): void {
    this.handoffs.clear();
    this.events = [];
    this.completedTasks.clear();
  }
}

/**
 * Create a CrossAgentCoordinator instance
 */
export function createCrossAgentCoordinator(
  config: CrossAgentCoordinatorConfig
): CrossAgentCoordinator {
  return new CrossAgentCoordinator(config);
}
