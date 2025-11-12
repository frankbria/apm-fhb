/**
 * Migration State Management
 *
 * Manages migration version tracking, checksum validation, and locking:
 * - schema_migrations table for applied migration history
 * - Checksum validation to detect modified migrations
 * - Migration locking to prevent concurrent execution
 */

import { ConnectionManager } from '../connection.js';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

/**
 * Applied migration record
 */
export interface AppliedMigration {
  /** Record ID */
  id: number;
  /** Migration name (filename without extension) */
  migration_name: string;
  /** Timestamp when migration was applied */
  applied_at: string;
  /** Execution duration in milliseconds */
  execution_duration_ms: number;
  /** SHA-256 checksum of migration file content */
  checksum: string;
}

/**
 * Migration lock record
 */
export interface MigrationLock {
  /** Lock ID (always 1 - single lock) */
  id: number;
  /** Timestamp when lock was acquired */
  locked_at: string;
  /** Process ID that acquired lock */
  locked_by: string;
}

/**
 * Migration State Manager
 * Manages migration version tracking and locking
 */
export class MigrationStateManager {
  private connectionManager: ConnectionManager;

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  /**
   * Ensure schema_migrations table exists
   * Creates table if not present
   */
  async ensureSchemaTable(): Promise<void> {
    await this.connectionManager.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_name TEXT UNIQUE NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        execution_duration_ms INTEGER NOT NULL,
        checksum TEXT NOT NULL
      )
    `);

    // Create index on migration_name for fast lookups
    await this.connectionManager.execute(`
      CREATE INDEX IF NOT EXISTS idx_schema_migrations_name
      ON schema_migrations(migration_name)
    `);
  }

  /**
   * Ensure migration_lock table exists
   * Creates table if not present
   */
  async ensureLockTable(): Promise<void> {
    await this.connectionManager.execute(`
      CREATE TABLE IF NOT EXISTS migration_lock (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        locked_at DATETIME NOT NULL,
        locked_by TEXT NOT NULL
      )
    `);
  }

  /**
   * Get all applied migrations
   * Returns migrations sorted by applied_at (oldest first)
   */
  async getAppliedMigrations(): Promise<AppliedMigration[]> {
    await this.ensureSchemaTable();

    const rows = await this.connectionManager.query<AppliedMigration>(
      'SELECT * FROM schema_migrations ORDER BY applied_at ASC'
    );

    return rows;
  }

  /**
   * Get applied migration names
   * Returns array of migration names for quick lookup
   */
  async getAppliedMigrationNames(): Promise<string[]> {
    await this.ensureSchemaTable();

    const rows = await this.connectionManager.query<{ migration_name: string }>(
      'SELECT migration_name FROM schema_migrations ORDER BY applied_at ASC'
    );

    return rows.map(row => row.migration_name);
  }

  /**
   * Record a migration as applied
   * Inserts record into schema_migrations table
   */
  async recordMigration(
    name: string,
    durationMs: number,
    checksum: string
  ): Promise<void> {
    await this.ensureSchemaTable();

    await this.connectionManager.execute(
      `INSERT INTO schema_migrations (migration_name, execution_duration_ms, checksum)
       VALUES (?, ?, ?)`,
      [name, durationMs, checksum]
    );
  }

  /**
   * Remove a migration record
   * Deletes record from schema_migrations table (used during rollback)
   */
  async removeMigration(name: string): Promise<void> {
    await this.ensureSchemaTable();

    await this.connectionManager.execute(
      'DELETE FROM schema_migrations WHERE migration_name = ?',
      [name]
    );
  }

  /**
   * Validate migration checksum
   * Compares stored checksum with current file checksum
   * Throws error if mismatch detected
   */
  async validateChecksum(name: string, expectedChecksum: string): Promise<void> {
    await this.ensureSchemaTable();

    const row = await this.connectionManager.get<{ checksum: string }>(
      'SELECT checksum FROM schema_migrations WHERE migration_name = ?',
      [name]
    );

    if (!row) {
      // Migration not applied yet - no checksum to validate
      return;
    }

    if (row.checksum !== expectedChecksum) {
      throw new Error(
        `Migration ${name} has been modified after being applied!\n` +
        `Expected checksum: ${expectedChecksum}\n` +
        `Stored checksum:   ${row.checksum}\n` +
        `This migration has already been applied and should not be modified.\n` +
        `Create a new migration instead.`
      );
    }
  }

  /**
   * Acquire migration lock
   * Prevents concurrent migration execution
   * Throws error if lock cannot be acquired
   */
  async acquireLock(): Promise<void> {
    await this.ensureLockTable();

    const processId = process.pid.toString();
    const now = new Date().toISOString();

    try {
      // Try to insert lock
      await this.connectionManager.execute(
        'INSERT INTO migration_lock (id, locked_at, locked_by) VALUES (1, ?, ?)',
        [now, processId]
      );
    } catch (error: any) {
      // Lock already exists - check if stale
      if (error.message?.includes('UNIQUE constraint')) {
        const lock = await this.connectionManager.get<MigrationLock>(
          'SELECT * FROM migration_lock WHERE id = 1'
        );

        if (lock) {
          const lockedAt = new Date(lock.locked_at);
          const lockAge = Date.now() - lockedAt.getTime();
          const STALE_LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes

          if (lockAge > STALE_LOCK_TIMEOUT) {
            // Stale lock - force acquire
            await this.connectionManager.execute(
              'UPDATE migration_lock SET locked_at = ?, locked_by = ? WHERE id = 1',
              [now, processId]
            );
            return;
          }

          throw new Error(
            `Migration lock is held by process ${lock.locked_by} since ${lock.locked_at}.\n` +
            `Another migration may be in progress.\n` +
            `If you're sure no migration is running, wait ${Math.ceil((STALE_LOCK_TIMEOUT - lockAge) / 1000)}s for lock to expire.`
          );
        }
      }

      throw error;
    }
  }

  /**
   * Release migration lock
   * Removes lock record
   */
  async releaseLock(): Promise<void> {
    await this.ensureLockTable();

    await this.connectionManager.execute('DELETE FROM migration_lock WHERE id = 1');
  }

  /**
   * Check if migration lock is held
   */
  async isLocked(): Promise<boolean> {
    await this.ensureLockTable();

    const lock = await this.connectionManager.get<MigrationLock>(
      'SELECT * FROM migration_lock WHERE id = 1'
    );

    if (!lock) {
      return false;
    }

    // Check if lock is stale
    const lockedAt = new Date(lock.locked_at);
    const lockAge = Date.now() - lockedAt.getTime();
    const STALE_LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes

    return lockAge <= STALE_LOCK_TIMEOUT;
  }

  /**
   * Get current lock info
   */
  async getLock(): Promise<MigrationLock | null> {
    await this.ensureLockTable();

    const lock = await this.connectionManager.get<MigrationLock>(
      'SELECT * FROM migration_lock WHERE id = 1'
    );

    return lock || null;
  }
}

/**
 * Calculate SHA-256 checksum of file content
 */
export function calculateChecksum(filepath: string): string {
  try {
    const content = readFileSync(filepath, 'utf-8');
    const hash = createHash('sha256');
    hash.update(content);
    return hash.digest('hex');
  } catch (error) {
    throw new Error(
      `Failed to calculate checksum for ${filepath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Calculate checksum from string content
 */
export function calculateChecksumFromContent(content: string): string {
  const hash = createHash('sha256');
  hash.update(content);
  return hash.digest('hex');
}

/**
 * Validate all applied migrations against current files
 * Returns array of validation errors (empty if all valid)
 */
export async function validateAllMigrations(
  stateManager: MigrationStateManager,
  migrationFiles: Array<{ name: string; filepath: string }>
): Promise<string[]> {
  const errors: string[] = [];
  const applied = await stateManager.getAppliedMigrations();

  for (const migration of applied) {
    const file = migrationFiles.find(f => f.name === migration.migration_name);

    if (!file) {
      errors.push(
        `Applied migration ${migration.migration_name} not found in migrations directory`
      );
      continue;
    }

    try {
      const currentChecksum = calculateChecksum(file.filepath);
      await stateManager.validateChecksum(migration.migration_name, currentChecksum);
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return errors;
}
