/**
 * Scope Module - Barrel Export
 *
 * Provides scope parsing, definition, and filtering functionality for Implementation Plans.
 */

// Frontmatter parsing
export {
  RawScopeFrontmatter,
  ParsedFrontmatter,
  parseFrontmatter,
  validateParsedScope,
  hasScopeDefinition,
} from './frontmatter.js';

// Scope definition
export {
  PhaseRange,
  ScopeDefinition,
  parsePhaseRange,
  normalizeTaskId,
  normalizeAgentFilters,
  matchesAgentPattern,
  extractScopeDefinition,
  getScopeSummary,
} from './definition.js';

// Task filtering
export {
  TaskMetadata,
  ImplementationPlan,
  PhaseInfo,
  FilterOptions,
  FilterResult,
  parseImplementationPlan,
  filterByPhaseRange,
  filterByTaskList,
  filterByAgentAssignment,
  resolveDependencies,
  filterTasks,
} from './filter.js';
