/**
 * Beads Integration Module
 *
 * Barrel export for beads CLI wrapper and integration utilities
 */

// CLI wrapper exports
export {
  // Functions
  isBeadsAvailable,
  getBeadsReady,
  getBeadsList,
  getBeadsShow,
  getBeadsDependencyTree,
  getBeadsDependencies,

  // Types
  BeadsCommandConfig,
  BeadsIssue,
  BeadsDependency,
  BeadsDependencyNode,
  BeadsReadyResult,
  BeadsListResult,

  // Enums
  BeadsStatus,
  BeadsDependencyType,
  BeadsErrorType,

  // Error class
  BeadsError,

  // Constants
  DEFAULT_BEADS_CONFIG,

  // Schemas
  schemas
} from './cli.js';

// Query functions exports
export {
  // Query functions
  getReadyTasks,
  getAllIssues,
  getIssueDetails,
  getDependencies,
  getBlockers,

  // Mapping functions
  mapBeadsIssueToTaskState,
  mapBeadsDependencyToTaskDependency,

  // Cache management
  invalidateQueryCache,
  getQueryCacheStats,
  queryCache,

  // Types
  BlockerInfo,
  QueryOptions,

  // Constants
  DEFAULT_CACHE_TTL_MS
} from './queries.js';

// Integration exports
export {
  // Sync functions
  syncBeadsToDatabase,
  syncDependencies,
  determineReadyTasks,
  startPeriodicSync,
  getReadyTasksFromDatabase,

  // Types
  SyncOptions,
  SyncResult,
  ReadyTasksResult,
  PeriodicSyncHandle
} from './integration.js';
