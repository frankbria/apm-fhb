/**
 * Database Migration Framework
 *
 * Provides migration runner for executing schema changes with:
 * - TypeScript migration file format
 * - Transaction-based atomic execution
 * - Forward (up) and rollback (down) support
 * - Dry-run mode for testing
 */

import { ConnectionManager } from '../connection.js';
import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import Database from 'better-sqlite3';

/**
 * Migration interface
 * Represents a single database migration with up/down functions
 */
export interface Migration {
  /** Unique migration name (filename without extension) */
  name: string;
  /** Timestamp for ordering (extracted from filename) */
  timestamp: number;
  /** Forward migration function */
  up: (db: Database.Database) => void | Promise<void>;
  /** Rollback migration function */
  down: (db: Database.Database) => void | Promise<void>;
  /** Optional description */
  description?: string;
}

/**
 * Migration file interface
 * Represents a migration file on disk
 */
export interface MigrationFile {
  /** Full path to migration file */
  filepath: string;
  /** Migration filename */
  filename: string;
  /** Migration name (filename without extension) */
  name: string;
  /** Timestamp extracted from filename */
  timestamp: number;
  /** Migration module (loaded TypeScript/JavaScript) */
  module?: Migration;
}

/**
 * Migration execution options
 */
export interface MigrationOptions {
  /** Dry-run mode (don't execute, just log) */
  dryRun?: boolean;
  /** Verbose logging */
  verbose?: boolean;
  /** Target migration (apply up to this migration) */
  target?: string;
}

/**
 * Migration execution result
 */
export interface MigrationResult {
  /** Migration name */
  name: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Error if execution failed */
  error?: Error;
  /** SQL statements executed (in dry-run mode) */
  sqlStatements?: string[];
}

/**
 * Migration Runner
 * Manages discovery, execution, and rollback of migrations
 */
export class MigrationRunner {
  private connectionManager: ConnectionManager;
  private migrationsDirectory: string;
  private discoveredMigrations: MigrationFile[] = [];

  constructor(
    connectionManager: ConnectionManager,
    migrationsDirectory: string = './migrations'
  ) {
    this.connectionManager = connectionManager;
    this.migrationsDirectory = resolve(migrationsDirectory);
  }

  /**
   * Discover migrations from filesystem
   * Scans migrations directory and loads TypeScript files
   */
  async discoverMigrations(directory?: string): Promise<MigrationFile[]> {
    const migrationsDir = directory ? resolve(directory) : this.migrationsDirectory;

    try {
      // Check if directory exists
      try {
        const stat = statSync(migrationsDir);
        if (!stat.isDirectory()) {
          throw new Error(`Migrations path is not a directory: ${migrationsDir}`);
        }
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // Directory doesn't exist - return empty array
          this.discoveredMigrations = [];
          return [];
        }
        throw error;
      }

      // Read directory contents
      const files = readdirSync(migrationsDir);

      // Filter for TypeScript/JavaScript files matching migration pattern
      const migrationFiles: MigrationFile[] = [];

      for (const filename of files) {
        // Match pattern: YYYYMMDDHHMMSS_description.ts or .js
        const match = filename.match(/^(\d{14})_(.+)\.(ts|js)$/);
        if (!match) continue;

        const [, timestampStr] = match;
        const timestamp = parseInt(timestampStr, 10);
        const name = filename.replace(/\.(ts|js)$/, '');
        const filepath = join(migrationsDir, filename);

        migrationFiles.push({
          filepath,
          filename,
          name,
          timestamp
        });
      }

      // Sort by timestamp (oldest first)
      migrationFiles.sort((a, b) => a.timestamp - b.timestamp);

      // Load migration modules
      for (const file of migrationFiles) {
        try {
          // Dynamic import for ES modules
          const module = await import(file.filepath);

          // Validate migration has up and down functions
          if (typeof module.up !== 'function') {
            throw new Error(`Migration ${file.name} missing up() function`);
          }
          if (typeof module.down !== 'function') {
            throw new Error(`Migration ${file.name} missing down() function`);
          }

          file.module = {
            name: file.name,
            timestamp: file.timestamp,
            up: module.up,
            down: module.down,
            description: module.description
          };
        } catch (error) {
          console.error(`Failed to load migration ${file.name}:`, error);
          throw new Error(
            `Failed to load migration ${file.name}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      this.discoveredMigrations = migrationFiles;
      return migrationFiles;
    } catch (error) {
      throw new Error(
        `Failed to discover migrations: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get pending migrations
   * Compares discovered migrations with applied migrations from database
   */
  async getPendingMigrations(
    appliedMigrations: string[]
  ): Promise<Migration[]> {
    // Ensure migrations are discovered
    if (this.discoveredMigrations.length === 0) {
      await this.discoverMigrations();
    }

    // Filter out already applied migrations
    const pending = this.discoveredMigrations
      .filter(file => !appliedMigrations.includes(file.name))
      .map(file => file.module!)
      .filter(module => module !== undefined);

    return pending;
  }

  /**
   * Apply a single migration
   * Executes migration.up() within a transaction
   */
  async applyMigration(
    migration: Migration,
    options: MigrationOptions = {}
  ): Promise<MigrationResult> {
    const { dryRun = false, verbose = false } = options;
    const startTime = Date.now();

    if (verbose) {
      console.log(`Applying migration: ${migration.name}`);
    }

    if (dryRun) {
      if (verbose) {
        console.log('[DRY RUN] Would execute migration.up()');
      }

      return {
        name: migration.name,
        success: true,
        durationMs: Date.now() - startTime,
        sqlStatements: ['[DRY RUN] Migration up() execution']
      };
    }

    try {
      await this.connectionManager.transaction(async (db) => {
        try {
          // Execute migration up function
          await migration.up(db);

          if (verbose) {
            console.log(`✓ Migration ${migration.name} applied successfully`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Migration ${migration.name} failed during up(): ${errorMessage}`
          );
        }
      });

      const durationMs = Date.now() - startTime;

      return {
        name: migration.name,
        success: true,
        durationMs
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      if (verbose) {
        console.error(`✗ Migration ${migration.name} failed:`, error);
      }

      return {
        name: migration.name,
        success: false,
        durationMs,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * Rollback a single migration
   * Executes migration.down() within a transaction
   */
  async rollbackMigration(
    migration: Migration,
    options: MigrationOptions = {}
  ): Promise<MigrationResult> {
    const { dryRun = false, verbose = false } = options;
    const startTime = Date.now();

    if (verbose) {
      console.log(`Rolling back migration: ${migration.name}`);
    }

    if (dryRun) {
      if (verbose) {
        console.log('[DRY RUN] Would execute migration.down()');
      }

      return {
        name: migration.name,
        success: true,
        durationMs: Date.now() - startTime,
        sqlStatements: ['[DRY RUN] Migration down() execution']
      };
    }

    try {
      await this.connectionManager.transaction(async (db) => {
        try {
          // Execute migration down function
          await migration.down(db);

          if (verbose) {
            console.log(`✓ Migration ${migration.name} rolled back successfully`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Migration ${migration.name} failed during down(): ${errorMessage}`
          );
        }
      });

      const durationMs = Date.now() - startTime;

      return {
        name: migration.name,
        success: true,
        durationMs
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      if (verbose) {
        console.error(`✗ Migration ${migration.name} rollback failed:`, error);
      }

      return {
        name: migration.name,
        success: false,
        durationMs,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * Apply all pending migrations
   * Executes migrations in order, stops on first failure
   */
  async applyAll(
    appliedMigrations: string[],
    options: MigrationOptions = {}
  ): Promise<MigrationResult[]> {
    const { verbose = false } = options;
    const pending = await this.getPendingMigrations(appliedMigrations);

    if (pending.length === 0) {
      if (verbose) {
        console.log('No pending migrations to apply');
      }
      return [];
    }

    if (verbose) {
      console.log(`Applying ${pending.length} pending migration(s)...`);
    }

    const results: MigrationResult[] = [];

    for (let i = 0; i < pending.length; i++) {
      const migration = pending[i];

      if (verbose) {
        console.log(`[${i + 1}/${pending.length}] ${migration.name}`);
      }

      const result = await this.applyMigration(migration, options);
      results.push(result);

      // Stop on first failure
      if (!result.success) {
        if (verbose) {
          console.error('Migration failed, stopping execution');
        }
        break;
      }
    }

    return results;
  }

  /**
   * Rollback the last N migrations
   * Executes rollbacks in reverse order
   */
  async rollbackLast(
    appliedMigrations: string[],
    steps: number = 1,
    options: MigrationOptions = {}
  ): Promise<MigrationResult[]> {
    const { verbose = false } = options;

    if (appliedMigrations.length === 0) {
      if (verbose) {
        console.log('No migrations to rollback');
      }
      return [];
    }

    // Get migrations to rollback (last N applied)
    const toRollback = appliedMigrations.slice(-steps).reverse();

    if (verbose) {
      console.log(`Rolling back ${toRollback.length} migration(s)...`);
    }

    // Load migration modules
    if (this.discoveredMigrations.length === 0) {
      await this.discoverMigrations();
    }

    const results: MigrationResult[] = [];

    for (let i = 0; i < toRollback.length; i++) {
      const migrationName = toRollback[i];

      // Find migration module
      const migrationFile = this.discoveredMigrations.find(
        file => file.name === migrationName
      );

      if (!migrationFile || !migrationFile.module) {
        const error = new Error(`Migration file not found: ${migrationName}`);
        results.push({
          name: migrationName,
          success: false,
          durationMs: 0,
          error
        });

        if (verbose) {
          console.error(`✗ ${error.message}`);
        }

        break;
      }

      if (verbose) {
        console.log(`[${i + 1}/${toRollback.length}] ${migrationName}`);
      }

      const result = await this.rollbackMigration(migrationFile.module, options);
      results.push(result);

      // Stop on first failure
      if (!result.success) {
        if (verbose) {
          console.error('Rollback failed, stopping execution');
        }
        break;
      }
    }

    return results;
  }

  /**
   * Get discovered migrations
   */
  getDiscoveredMigrations(): MigrationFile[] {
    return this.discoveredMigrations;
  }
}

/**
 * Parse migration filename to extract timestamp and description
 */
export function parseMigrationFilename(filename: string): {
  timestamp: number;
  description: string;
  name: string;
} | null {
  const match = filename.match(/^(\d{14})_(.+)\.(?:ts|js)$/);
  if (!match) return null;

  const [, timestampStr, description] = match;
  const timestamp = parseInt(timestampStr, 10);
  const name = filename.replace(/\.(ts|js)$/, '');

  return { timestamp, description, name };
}

/**
 * Generate migration filename from timestamp and description
 */
export function generateMigrationFilename(description: string, timestamp?: Date): string {
  const ts = timestamp || new Date();

  // Format: YYYYMMDDHHMMSS
  const year = ts.getFullYear();
  const month = String(ts.getMonth() + 1).padStart(2, '0');
  const day = String(ts.getDate()).padStart(2, '0');
  const hours = String(ts.getHours()).padStart(2, '0');
  const minutes = String(ts.getMinutes()).padStart(2, '0');
  const seconds = String(ts.getSeconds()).padStart(2, '0');

  const timestampStr = `${year}${month}${day}${hours}${minutes}${seconds}`;

  // Slugify description
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `${timestampStr}_${slug}.ts`;
}
