/**
 * Migration Framework Tests
 *
 * Tests for migration runner, discovery, and execution
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from '../../../src/db/connection.js';
import {
  MigrationRunner,
  parseMigrationFilename,
  generateMigrationFilename,
  type Migration
} from '../../../src/db/migrations/framework.js';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';

describe('Migration Framework', () => {
  let connectionManager: ConnectionManager;
  let testDbPath: string;
  let testMigrationsDir: string;

  beforeEach(() => {
    // Create test database
    testDbPath = join(process.cwd(), 'tests', 'db', 'migrations', 'test.db');
    testMigrationsDir = join(process.cwd(), 'tests', 'db', 'migrations', 'test_migrations');

    // Remove existing test database and migrations
    if (existsSync(testDbPath)) {
      rmSync(testDbPath);
    }
    if (existsSync(testMigrationsDir)) {
      rmSync(testMigrationsDir, { recursive: true });
    }

    // Create fresh directories
    mkdirSync(testMigrationsDir, { recursive: true });

    // Initialize connection manager
    connectionManager = new ConnectionManager(testDbPath);
    connectionManager.connect();
  });

  afterEach(async () => {
    // Cleanup
    await connectionManager.disconnect();
    if (existsSync(testDbPath)) {
      rmSync(testDbPath);
    }
    if (existsSync(testMigrationsDir)) {
      rmSync(testMigrationsDir, { recursive: true });
    }
  });

  describe('parseMigrationFilename', () => {
    it('should parse valid migration filename', () => {
      const result = parseMigrationFilename('20240101120000_create_users_table.ts');
      expect(result).toEqual({
        timestamp: 20240101120000,
        description: 'create_users_table',
        name: '20240101120000_create_users_table'
      });
    });

    it('should parse JavaScript migration filename', () => {
      const result = parseMigrationFilename('20240101120000_add_index.js');
      expect(result).toEqual({
        timestamp: 20240101120000,
        description: 'add_index',
        name: '20240101120000_add_index'
      });
    });

    it('should return null for invalid filename', () => {
      expect(parseMigrationFilename('invalid.ts')).toBeNull();
      expect(parseMigrationFilename('20240101_no_time.ts')).toBeNull();
      expect(parseMigrationFilename('not_a_migration.txt')).toBeNull();
    });
  });

  describe('generateMigrationFilename', () => {
    it('should generate migration filename with timestamp', () => {
      const timestamp = new Date('2024-01-01T12:00:00Z');
      const filename = generateMigrationFilename('create users table', timestamp);
      expect(filename).toMatch(/^20240101\d{6}_create_users_table\.ts$/);
    });

    it('should slugify description correctly', () => {
      const timestamp = new Date('2024-01-01T12:00:00Z');
      const filename = generateMigrationFilename('Create Users & Posts Table!', timestamp);
      expect(filename).toMatch(/_create_users_posts_table\.ts$/);
    });

    it('should handle empty spaces and special characters', () => {
      const timestamp = new Date('2024-01-01T12:00:00Z');
      const filename = generateMigrationFilename('  add   index   on   users  ', timestamp);
      expect(filename).toMatch(/_add_index_on_users\.ts$/);
    });
  });

  describe('MigrationRunner - Discovery', () => {
    it('should discover migrations in directory', async () => {
      // Create test migration files
      const migration1 = join(testMigrationsDir, '20240101120000_first_migration.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_second_migration.ts');

      writeFileSync(
        migration1,
        `
        export async function up(db) {
          db.exec('CREATE TABLE test1 (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE test1');
        }
        `
      );

      writeFileSync(
        migration2,
        `
        export async function up(db) {
          db.exec('CREATE TABLE test2 (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE test2');
        }
        `
      );

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      const migrations = await runner.discoverMigrations();

      expect(migrations).toHaveLength(2);
      expect(migrations[0].name).toBe('20240101120000_first_migration');
      expect(migrations[1].name).toBe('20240101130000_second_migration');
      expect(migrations[0].timestamp).toBe(20240101120000);
      expect(migrations[1].timestamp).toBe(20240101130000);
    });

    it('should sort migrations by timestamp', async () => {
      // Create migrations in reverse order
      const migration1 = join(testMigrationsDir, '20240101130000_second.ts');
      const migration2 = join(testMigrationsDir, '20240101120000_first.ts');

      writeFileSync(
        migration1,
        'export async function up(db) {} export async function down(db) {}'
      );
      writeFileSync(
        migration2,
        'export async function up(db) {} export async function down(db) {}'
      );

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      const migrations = await runner.discoverMigrations();

      expect(migrations[0].name).toBe('20240101120000_first');
      expect(migrations[1].name).toBe('20240101130000_second');
    });

    it('should return empty array for non-existent directory', async () => {
      const runner = new MigrationRunner(connectionManager, '/non/existent/path');
      const migrations = await runner.discoverMigrations();

      expect(migrations).toEqual([]);
    });

    it('should throw error for invalid migration (missing up)', async () => {
      const migration = join(testMigrationsDir, '20240101120000_invalid.ts');
      writeFileSync(
        migration,
        'export async function down(db) {}'
      );

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      await expect(runner.discoverMigrations()).rejects.toThrow(/missing up\(\) function/);
    });

    it('should throw error for invalid migration (missing down)', async () => {
      const migration = join(testMigrationsDir, '20240101120000_invalid.ts');
      writeFileSync(
        migration,
        'export async function up(db) {}'
      );

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      await expect(runner.discoverMigrations()).rejects.toThrow(/missing down\(\) function|Failed to discover migrations/);
    });
  });

  describe('MigrationRunner - Apply Migration', () => {
    it('should apply migration successfully', async () => {
      const migration: Migration = {
        name: '20240101120000_create_test_table',
        timestamp: 20240101120000,
        up: async (db: Database.Database) => {
          db.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)');
        },
        down: async (db: Database.Database) => {
          db.exec('DROP TABLE test_table');
        }
      };

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      const result = await runner.applyMigration(migration);

      expect(result.success).toBe(true);
      expect(result.name).toBe('20240101120000_create_test_table');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();

      // Verify table was created
      const tables = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'"
      );
      expect(tables).toHaveLength(1);
    });

    it('should rollback on migration error', async () => {
      const migration: Migration = {
        name: '20240101120000_failing_migration',
        timestamp: 20240101120000,
        up: async (db: Database.Database) => {
          db.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY)');
          // Intentional error - duplicate table
          db.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY)');
        },
        down: async (db: Database.Database) => {
          db.exec('DROP TABLE test_table');
        }
      };

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      const result = await runner.applyMigration(migration);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('20240101120000_failing_migration');

      // Verify table was NOT created (rollback worked)
      const tables = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'"
      );
      expect(tables).toHaveLength(0);
    });

    it('should support dry-run mode', async () => {
      const migration: Migration = {
        name: '20240101120000_dry_run_test',
        timestamp: 20240101120000,
        up: async (db: Database.Database) => {
          db.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY)');
        },
        down: async (db: Database.Database) => {
          db.exec('DROP TABLE test_table');
        }
      };

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      const result = await runner.applyMigration(migration, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.sqlStatements).toBeDefined();

      // Verify table was NOT created in dry-run
      const tables = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'"
      );
      expect(tables).toHaveLength(0);
    });
  });

  describe('MigrationRunner - Rollback Migration', () => {
    it('should rollback migration successfully', async () => {
      // First, create a table
      await connectionManager.execute(
        'CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)'
      );

      const migration: Migration = {
        name: '20240101120000_create_test_table',
        timestamp: 20240101120000,
        up: async (db: Database.Database) => {
          db.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY)');
        },
        down: async (db: Database.Database) => {
          db.exec('DROP TABLE test_table');
        }
      };

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      const result = await runner.rollbackMigration(migration);

      expect(result.success).toBe(true);
      expect(result.name).toBe('20240101120000_create_test_table');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // Verify table was dropped
      const tables = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'"
      );
      expect(tables).toHaveLength(0);
    });

    it('should handle rollback errors', async () => {
      const migration: Migration = {
        name: '20240101120000_failing_rollback',
        timestamp: 20240101120000,
        up: async (db: Database.Database) => {
          db.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY)');
        },
        down: async (db: Database.Database) => {
          // Intentional error - table doesn't exist
          db.exec('DROP TABLE non_existent_table');
        }
      };

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      const result = await runner.rollbackMigration(migration);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('20240101120000_failing_rollback');
    });

    it('should support dry-run mode for rollback', async () => {
      // Create table first
      await connectionManager.execute(
        'CREATE TABLE test_table (id INTEGER PRIMARY KEY)'
      );

      const migration: Migration = {
        name: '20240101120000_dry_run_rollback',
        timestamp: 20240101120000,
        up: async (db: Database.Database) => {
          db.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY)');
        },
        down: async (db: Database.Database) => {
          db.exec('DROP TABLE test_table');
        }
      };

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      const result = await runner.rollbackMigration(migration, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.sqlStatements).toBeDefined();

      // Verify table still exists (dry-run didn't drop it)
      const tables = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'"
      );
      expect(tables).toHaveLength(1);
    });
  });

  describe('MigrationRunner - Pending Migrations', () => {
    it('should identify pending migrations', async () => {
      // Create test migrations
      const migration1 = join(testMigrationsDir, '20240101120000_first.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_second.ts');
      const migration3 = join(testMigrationsDir, '20240101140000_third.ts');

      const migrationCode = `
        export async function up(db) {
          db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE test');
        }
      `;

      writeFileSync(migration1, migrationCode);
      writeFileSync(migration2, migrationCode);
      writeFileSync(migration3, migrationCode);

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      await runner.discoverMigrations();

      // Simulate that first migration was already applied
      const appliedMigrations = ['20240101120000_first'];
      const pending = await runner.getPendingMigrations(appliedMigrations);

      expect(pending).toHaveLength(2);
      expect(pending[0].name).toBe('20240101130000_second');
      expect(pending[1].name).toBe('20240101140000_third');
    });

    it('should return all migrations if none applied', async () => {
      const migration1 = join(testMigrationsDir, '20240101120000_first.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_second.ts');

      const migrationCode = `
        export async function up(db) {}
        export async function down(db) {}
      `;

      writeFileSync(migration1, migrationCode);
      writeFileSync(migration2, migrationCode);

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      await runner.discoverMigrations();

      const pending = await runner.getPendingMigrations([]);

      expect(pending).toHaveLength(2);
    });

    it('should return empty array if all applied', async () => {
      const migration1 = join(testMigrationsDir, '20240101120000_first.ts');

      writeFileSync(
        migration1,
        'export async function up(db) {} export async function down(db) {}'
      );

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      await runner.discoverMigrations();

      const pending = await runner.getPendingMigrations(['20240101120000_first']);

      expect(pending).toHaveLength(0);
    });
  });

  describe('MigrationRunner - Apply All', () => {
    it('should apply all pending migrations', async () => {
      const migration1 = join(testMigrationsDir, '20240101120000_first.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_second.ts');

      writeFileSync(
        migration1,
        `
        export async function up(db) {
          db.exec('CREATE TABLE table1 (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE table1');
        }
        `
      );

      writeFileSync(
        migration2,
        `
        export async function up(db) {
          db.exec('CREATE TABLE table2 (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE table2');
        }
        `
      );

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      const results = await runner.applyAll([]);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);

      // Verify both tables created
      const table1 = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='table1'"
      );
      const table2 = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='table2'"
      );
      expect(table1).toHaveLength(1);
      expect(table2).toHaveLength(1);
    });

    it('should stop on first failure', async () => {
      const migration1 = join(testMigrationsDir, '20240101120000_first.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_failing.ts');
      const migration3 = join(testMigrationsDir, '20240101140000_third.ts');

      writeFileSync(
        migration1,
        `
        export async function up(db) {
          db.exec('CREATE TABLE table1 (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE table1');
        }
        `
      );

      writeFileSync(
        migration2,
        `
        export async function up(db) {
          throw new Error('Intentional failure');
        }
        export async function down(db) {}
        `
      );

      writeFileSync(
        migration3,
        `
        export async function up(db) {
          db.exec('CREATE TABLE table3 (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {}
        `
      );

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      const results = await runner.applyAll([]);

      expect(results).toHaveLength(2); // Stopped after failure
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);

      // Verify only first table created
      const table1 = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='table1'"
      );
      const table3 = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='table3'"
      );
      expect(table1).toHaveLength(1);
      expect(table3).toHaveLength(0); // Never executed
    });
  });

  describe('MigrationRunner - Rollback Last', () => {
    it('should rollback last N migrations', async () => {
      // Create tables
      await connectionManager.execute('CREATE TABLE table1 (id INTEGER PRIMARY KEY)');
      await connectionManager.execute('CREATE TABLE table2 (id INTEGER PRIMARY KEY)');
      await connectionManager.execute('CREATE TABLE table3 (id INTEGER PRIMARY KEY)');

      // Create migration files
      const migration1 = join(testMigrationsDir, '20240101120000_first.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_second.ts');
      const migration3 = join(testMigrationsDir, '20240101140000_third.ts');

      writeFileSync(
        migration1,
        `
        export async function up(db) {}
        export async function down(db) {
          db.exec('DROP TABLE table1');
        }
        `
      );

      writeFileSync(
        migration2,
        `
        export async function up(db) {}
        export async function down(db) {
          db.exec('DROP TABLE table2');
        }
        `
      );

      writeFileSync(
        migration3,
        `
        export async function up(db) {}
        export async function down(db) {
          db.exec('DROP TABLE table3');
        }
        `
      );

      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      const appliedMigrations = [
        '20240101120000_first',
        '20240101130000_second',
        '20240101140000_third'
      ];

      const results = await runner.rollbackLast(appliedMigrations, 2);

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('20240101140000_third');
      expect(results[1].name).toBe('20240101130000_second');
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);

      // Verify tables dropped
      const table1 = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='table1'"
      );
      const table2 = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='table2'"
      );
      const table3 = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='table3'"
      );

      expect(table1).toHaveLength(1); // Not rolled back
      expect(table2).toHaveLength(0); // Rolled back
      expect(table3).toHaveLength(0); // Rolled back
    });
  });
});
