/**
 * Database Migrations Module
 *
 * Barrel export for migration framework, state management, and CLI handlers
 */

// Framework exports
export {
  Migration,
  MigrationFile,
  MigrationOptions,
  MigrationResult,
  MigrationRunner,
  parseMigrationFilename,
  generateMigrationFilename
} from './framework.js';

// State management exports
export {
  AppliedMigration,
  MigrationLock,
  MigrationStateManager,
  calculateChecksum,
  calculateChecksumFromContent,
  validateAllMigrations
} from './state.js';

// CLI command handlers (for Phase 2 integration)
export {
  MigrateOptions,
  MigrationStatus,
  migrateUp,
  migrateDown,
  migrateList,
  migrateCreate
} from './cli.js';

// Template generator
export {
  generateMigrationFile,
  getMigrationTemplate
} from './template.js';
