/**
 * Agent State Management Module - Barrel Export
 *
 * Provides centralized exports for agent lifecycle state management,
 * including state machine definitions, database persistence, event handling,
 * and recovery logic.
 */

// State Machine
export {
  VALID_TRANSITIONS,
  isValidTransition,
  validateTransition,
  canTransition,
  getValidNextStates,
  isFinalState,
  getTransitionDescription,
  getStateMachineStats,
  type TransitionValidation,
  type TransitionGuard,
  type StateMachineStats
} from './agent-lifecycle.js';

// Persistence Layer
export {
  AgentPersistenceManager,
  createAgentPersistence,
  type AgentStateUpdateOptions,
  type AgentStatistics
} from './persistence.js';

// Event System
export {
  LifecycleEventType,
  LifecycleEventManager,
  createLifecycleEventManager,
  createEventPayload,
  type LifecycleEventPayload,
  type LifecycleEventHandler,
  type EventBufferConfig
} from './events.js';

// Recovery System
export {
  AgentRecoveryManager,
  createAgentRecovery,
  type RecoveryConfig,
  type RecoveryResult,
  type CrashedAgentInfo,
  type RecoveryStatistics
} from './recovery.js';
