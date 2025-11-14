/**
 * Completion Detection Module
 *
 * Exports all completion detection components for Task 4.4.
 */

// Completion Poller
export {
  CompletionPoller,
  PollingState,
  PollingConfig,
  TaskPollingState,
  createCompletionPoller,
} from './completion-poller';

// Completion Parser
export {
  CompletionParser,
  CompletionStatus,
  TestResults,
  QualityGateResults,
  CompletionResult,
  createCompletionParser,
} from './completion-parser';

// Log Validator
export {
  LogValidator,
  ValidationStrictness,
  ValidationError,
  ValidationResult,
  LogValidatorConfig,
  createLogValidator,
} from './log-validator';

// State Updater
export {
  StateUpdater,
  TaskUpdateData,
  TaskCompletionData,
  createStateUpdater,
} from './state-updater';
