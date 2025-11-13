/**
 * Agent Lifecycle State Machine for apm-auto
 *
 * Defines the complete agent lifecycle with explicit state transitions,
 * validation rules, and transition guards.
 */

import { AgentStatus, AgentState } from '../types/agent.js';

/**
 * State Transition Map
 * Defines all valid state transitions in the agent lifecycle
 */
export const VALID_TRANSITIONS: ReadonlyMap<AgentStatus, readonly AgentStatus[]> = new Map([
  // From Spawning: Agent can become Active or Terminated
  // - Active: Successfully initialized and ready for work
  // - Terminated: Failed to spawn or initialization error
  [AgentStatus.Spawning, [AgentStatus.Active, AgentStatus.Terminated] as const],

  // From Active: Agent can transition to Waiting, Idle, or Terminated
  // - Waiting: Blocked on external input or dependencies
  // - Idle: Completed current work, no new tasks assigned
  // - Terminated: Shutdown, crash, or error
  [AgentStatus.Active, [AgentStatus.Waiting, AgentStatus.Idle, AgentStatus.Terminated] as const],

  // From Waiting: Agent can resume Active or be Terminated
  // - Active: Received input or dependency satisfied
  // - Terminated: Timeout or user cancellation
  [AgentStatus.Waiting, [AgentStatus.Active, AgentStatus.Terminated] as const],

  // From Idle: Agent can become Active or Terminated
  // - Active: New task assigned
  // - Terminated: Shutdown command
  [AgentStatus.Idle, [AgentStatus.Active, AgentStatus.Terminated] as const],

  // From Terminated: No transitions allowed (final state)
  [AgentStatus.Terminated, [] as const]
]);

/**
 * Transition Validation Result
 */
export interface TransitionValidation {
  /** Whether the transition is allowed */
  allowed: boolean;
  /** Reason if transition is not allowed */
  reason?: string;
}

/**
 * Check if a state transition is valid according to the state machine
 *
 * @param fromState - Current state (null for initial spawn)
 * @param toState - Target state
 * @returns True if transition is valid, false otherwise
 *
 * @example
 * ```typescript
 * isValidTransition(AgentStatus.Spawning, AgentStatus.Active); // true
 * isValidTransition(AgentStatus.Terminated, AgentStatus.Active); // false
 * isValidTransition(null, AgentStatus.Spawning); // true (initial spawn)
 * ```
 */
export function isValidTransition(
  fromState: AgentStatus | null,
  toState: AgentStatus
): boolean {
  // Special case: null → Spawning is the initial spawn transition
  if (fromState === null) {
    return toState === AgentStatus.Spawning;
  }

  // Check if target state is in the allowed transitions list
  const allowedTransitions = VALID_TRANSITIONS.get(fromState);
  if (!allowedTransitions) {
    return false;
  }

  return allowedTransitions.includes(toState);
}

/**
 * Validate a state transition with detailed error message
 *
 * @param fromState - Current state (null for initial spawn)
 * @param toState - Target state
 * @returns Validation result with reason if invalid
 *
 * @example
 * ```typescript
 * const result = validateTransition(AgentStatus.Terminated, AgentStatus.Active);
 * if (!result.allowed) {
 *   console.error(result.reason); // "Cannot transition from Terminated..."
 * }
 * ```
 */
export function validateTransition(
  fromState: AgentStatus | null,
  toState: AgentStatus
): TransitionValidation {
  // Special case: initial spawn
  if (fromState === null) {
    if (toState === AgentStatus.Spawning) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Initial agent state must be Spawning, got ${toState}`
    };
  }

  // Validate against state machine
  if (!isValidTransition(fromState, toState)) {
    const allowedTransitions = VALID_TRANSITIONS.get(fromState);
    const allowedStates = allowedTransitions?.join(', ') || 'none';
    return {
      allowed: false,
      reason: `Cannot transition from ${fromState} to ${toState}. Allowed transitions: ${allowedStates}`
    };
  }

  return { allowed: true };
}

/**
 * Transition Guard Result
 * Result of checking if an agent can transition to a new state
 */
export interface TransitionGuard {
  /** Whether the transition is allowed */
  allowed: boolean;
  /** Reason if transition is not allowed */
  reason?: string;
}

/**
 * Check if an agent can transition to a new state
 * Validates both state machine rules and agent-specific preconditions
 *
 * @param agent - Current agent state
 * @param toState - Target state
 * @returns Guard result with reason if transition not allowed
 *
 * @example
 * ```typescript
 * const agent: AgentState = { status: AgentStatus.Terminated, ... };
 * const guard = canTransition(agent, AgentStatus.Active);
 * if (!guard.allowed) {
 *   console.error(guard.reason); // "Agent is terminated and cannot be reactivated"
 * }
 * ```
 */
export function canTransition(
  agent: AgentState,
  toState: AgentStatus
): TransitionGuard {
  // Special guard checks that need more specific error messages
  // Check these before generic state machine validation

  // Cannot return to Spawning after initialization
  if (toState === AgentStatus.Spawning && agent.status !== null) {
    return {
      allowed: false,
      reason: 'Agent cannot return to Spawning state after initialization'
    };
  }

  // Terminated agents with crash cannot be reactivated
  if (agent.status === AgentStatus.Terminated && toState === AgentStatus.Active) {
    const metadata = agent.metadata as any;
    const crashReason = metadata?.terminationReason;
    if (crashReason === 'crash' || crashReason === 'error') {
      return {
        allowed: false,
        reason: 'Agent is terminated due to crash/error and cannot be reactivated without recovery'
      };
    }
  }

  // First, validate against state machine rules
  const validation = validateTransition(agent.status, toState);
  if (!validation.allowed) {
    return validation;
  }

  // Additional precondition checks based on target state
  switch (toState) {
    case AgentStatus.Active:

      // To become Active from Idle, must have a task assignment
      if (agent.status === AgentStatus.Idle && !agent.currentTask) {
        return {
          allowed: false,
          reason: 'Agent cannot transition to Active without a task assignment'
        };
      }
      break;

    case AgentStatus.Waiting:
      // Can only wait if currently active with a task
      if (agent.status === AgentStatus.Active && !agent.currentTask) {
        return {
          allowed: false,
          reason: 'Agent cannot wait without an active task'
        };
      }
      break;

    case AgentStatus.Idle:
      // To become Idle, must not have a current task
      if (agent.currentTask) {
        return {
          allowed: false,
          reason: 'Agent cannot become Idle while assigned to a task'
        };
      }
      break;

    case AgentStatus.Terminated:
      // Termination is always allowed (no preconditions)
      break;

    case AgentStatus.Spawning:
      // Spawning transitions are handled by special guard check above
      break;
  }

  return { allowed: true };
}

/**
 * Get all valid next states for an agent's current state
 *
 * @param currentState - Current agent state
 * @returns Array of valid next states
 *
 * @example
 * ```typescript
 * getValidNextStates(AgentStatus.Active);
 * // Returns: [AgentStatus.Waiting, AgentStatus.Idle, AgentStatus.Terminated]
 * ```
 */
export function getValidNextStates(
  currentState: AgentStatus | null
): readonly AgentStatus[] {
  if (currentState === null) {
    return [AgentStatus.Spawning];
  }
  return VALID_TRANSITIONS.get(currentState) ?? [];
}

/**
 * Check if a state is a final state (no transitions allowed)
 *
 * @param state - State to check
 * @returns True if state is final
 *
 * @example
 * ```typescript
 * isFinalState(AgentStatus.Terminated); // true
 * isFinalState(AgentStatus.Active); // false
 * ```
 */
export function isFinalState(state: AgentStatus): boolean {
  const nextStates = VALID_TRANSITIONS.get(state);
  return nextStates !== undefined && nextStates.length === 0;
}

/**
 * Get human-readable description of a state transition
 *
 * @param fromState - Source state (null for initial)
 * @param toState - Target state
 * @returns Description of the transition
 *
 * @example
 * ```typescript
 * getTransitionDescription(AgentStatus.Active, AgentStatus.Waiting);
 * // Returns: "Agent becomes waiting (blocked on input/dependencies)"
 * ```
 */
export function getTransitionDescription(
  fromState: AgentStatus | null,
  toState: AgentStatus
): string {
  if (fromState === null && toState === AgentStatus.Spawning) {
    return 'Agent is being spawned and initialized';
  }

  const transitionKey = `${fromState ?? 'null'} → ${toState}`;

  const descriptions: Record<string, string> = {
    // From Spawning
    'Spawning → Active': 'Agent successfully initialized and ready for work',
    'Spawning → Terminated': 'Agent failed to spawn or initialization error occurred',

    // From Active
    'Active → Waiting': 'Agent becomes waiting (blocked on input/dependencies)',
    'Active → Idle': 'Agent completed work and has no current task assignment',
    'Active → Terminated': 'Agent is being shut down or encountered a fatal error',

    // From Waiting
    'Waiting → Active': 'Agent resumed work (input received or dependency satisfied)',
    'Waiting → Terminated': 'Agent terminated while waiting (timeout or cancellation)',

    // From Idle
    'Idle → Active': 'Agent received new task assignment',
    'Idle → Terminated': 'Agent is being shut down'
  };

  return descriptions[transitionKey] ?? `Agent transitions from ${fromState} to ${toState}`;
}

/**
 * State Machine Statistics
 * Metadata about the state machine structure
 */
export interface StateMachineStats {
  /** Total number of states */
  totalStates: number;
  /** Number of possible transitions */
  totalTransitions: number;
  /** Number of final states */
  finalStates: number;
  /** Average transitions per state */
  avgTransitionsPerState: number;
}

/**
 * Get statistics about the state machine
 *
 * @returns State machine statistics
 */
export function getStateMachineStats(): StateMachineStats {
  const totalStates = VALID_TRANSITIONS.size;
  let totalTransitions = 0;
  let finalStates = 0;

  for (const [_state, transitions] of VALID_TRANSITIONS) {
    totalTransitions += transitions.length;
    if (transitions.length === 0) {
      finalStates++;
    }
  }

  return {
    totalStates,
    totalTransitions,
    finalStates,
    avgTransitionsPerState: totalTransitions / totalStates
  };
}
