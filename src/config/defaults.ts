/**
 * Default Configuration Values
 *
 * Defines sensible default configuration values for all settings.
 * These defaults prioritize safety and conservative resource usage.
 */

import type { AppConfig } from './schema.js';

/**
 * Default Application Configuration
 *
 * Sensible defaults prioritizing safety and conservative behavior:
 * - Cautious autonomy level (requires approval for significant operations)
 * - Conservative resource limits (10 agents, 20 worktrees, 100k token budget)
 * - Info-level logging with console output
 * - Notifications disabled by default
 * - Database in project directory with daily backups
 */
export const DEFAULT_CONFIG: AppConfig = {
  autonomy: {
    level: 'Cautious',
    approvalThresholds: {
      fileChanges: 5,
      gitOperations: true,
      schemaChanges: true,
      externalAPICalls: true,
    },
  },
  resources: {
    maxAgents: 10,
    maxWorktrees: 20,
    tokenBudget: 100000,
  },
  logging: {
    level: 'info',
    consoleOutput: true,
    filePath: undefined,
  },
  notifications: {
    enabled: false,
    channels: [],
  },
  database: {
    path: '.apm-auto/state.db',
    backupEnabled: true,
    backupInterval: 24,
  },
};
