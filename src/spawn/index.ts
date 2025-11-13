/**
 * Agent Spawning Module
 *
 * Provides comprehensive agent spawning capabilities including:
 * - Claude CLI integration for programmatic agent spawning
 * - Process lifecycle management with output capture
 * - Prompt template engine with variable substitution
 * - Database integration for process tracking
 * - Structured error handling with actionable guidance
 */

// Claude CLI Integration
export {
  ClaudeCLI,
  createClaudeCLI,
  type ClaudeSpawnOptions,
  type SpawnResult,
  type AvailabilityResult,
} from './claude-cli.js';

// Process Management
export {
  ProcessManager,
  createProcessManager,
  ProcessStatus,
  type ProcessInfo,
  type ProcessEvent,
  type OutputBuffer,
  type ProcessMetrics as ProcessManagerMetrics,
} from './process-manager.js';

// Prompt Templates
export {
  PromptTemplateEngine,
  createPromptTemplateEngine,
  type TemplateMetadata,
  type TemplateDefinition,
  type TaskContext,
  type ValidationResult,
  type TemplateListItem,
} from './prompt-templates.js';

// Process Tracking
export {
  ProcessTracker,
  createProcessTracker,
  type ProcessMetadata,
  type SpawnMetadata,
  type ProcessMetrics,
} from './process-tracker.js';

// Error Handling
export {
  SpawnErrorHandler,
  createSpawnErrorHandler,
  SpawnErrorCode,
  ErrorCategory,
  type ErrorContext,
} from './error-handler.js';
