/**
 * Migration CLI Tests
 *
 * Tests for CLI command handlers (migrateUp, migrateDown, migrateList, migrateCreate)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConnectionManager } from '../../../src/db/connection.js';
import {
  migrateUp,
  migrateDown,
  migrateList,
  migrateCreate
} from '../../../src/db/migrations/cli.js';
import { MigrationStateManager } from '../../../src/db/migrations/state.js';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('Migration CLI Commands', () => {
  let connectionManager: ConnectionManager;
  let testDbPath: string;
  let testMigrationsDir: string;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    // Create test database
    testDbPath = join(process.cwd(), 'tests', 'db', 'migrations', 'test_cli.db');
    testMigrationsDir = join(process.cwd(), 'tests', 'db', 'migrations', 'test_cli_migrations');

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

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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

    // Restore console
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('migrateUp', () => {
    it('should apply pending migrations', async () => {
      const migration1 = join(testMigrationsDir, '20240101120000_create_users.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_create_posts.ts');

      writeFileSync(
        migration1,
        `
        export async function up(db) {
          db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
        }
        export async function down(db) {
          db.exec('DROP TABLE users');
        }
        `
      );

      writeFileSync(
        migration2,
        `
        export async function up(db) {
          db.exec('CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)');
        }
        export async function down(db) {
          db.exec('DROP TABLE posts');
        }
        `
      );

      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: true
      });

      // Verify tables created
      const users = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
      );
      const posts = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='posts'"
      );

      expect(users).toHaveLength(1);
      expect(posts).toHaveLength(1);

      // Verify console output
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Applying 2 migration(s)')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Migrations complete')
      );
    });

    it('should handle no pending migrations', async () => {
      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: true
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No pending migrations')
      );
    });

    it('should support dry-run mode', async () => {
      const migration = join(testMigrationsDir, '20240101120000_test.ts');

      writeFileSync(
        migration,
        `
        export async function up(db) {
          db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE test');
        }
        `
      );

      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        dryRun: true,
        verbose: true
      });

      // Verify table NOT created in dry-run
      const tables = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test'"
      );
      expect(tables).toHaveLength(0);

      // Verify dry-run message
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN]')
      );
    });

    it('should apply up to target migration', async () => {
      const migration1 = join(testMigrationsDir, '20240101120000_first.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_second.ts');
      const migration3 = join(testMigrationsDir, '20240101140000_third.ts');

      const migrationCode = (tableName: string) => `
        export async function up(db) {
          db.exec('CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE ${tableName}');
        }
      `;

      writeFileSync(migration1, migrationCode('table1'));
      writeFileSync(migration2, migrationCode('table2'));
      writeFileSync(migration3, migrationCode('table3'));

      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        target: '20240101130000_second',
        verbose: true
      });

      // Verify only first two tables created
      const table1 = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='table1'"
      );
      const table2 = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='table2'"
      );
      const table3 = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='table3'"
      );

      expect(table1).toHaveLength(1);
      expect(table2).toHaveLength(1);
      expect(table3).toHaveLength(0);
    });

    it('should stop on migration failure', async () => {
      const migration1 = join(testMigrationsDir, '20240101120000_success.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_failing.ts');
      const migration3 = join(testMigrationsDir, '20240101140000_never_run.ts');

      writeFileSync(
        migration1,
        `
        export async function up(db) {
          db.exec('CREATE TABLE success_table (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE success_table');
        }
        `
      );

      writeFileSync(
        migration2,
        `
        export async function up(db) {
          throw new Error('Migration intentionally failed');
        }
        export async function down(db) {}
        `
      );

      writeFileSync(
        migration3,
        `
        export async function up(db) {
          db.exec('CREATE TABLE never_created (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {}
        `
      );

      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: true
      });

      // Verify only first migration applied
      const successTable = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='success_table'"
      );
      const neverCreated = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='never_created'"
      );

      expect(successTable).toHaveLength(1);
      expect(neverCreated).toHaveLength(0);

      // Verify error message
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Migration failed! Stopping execution')
      );
    });

    it('should record migrations in state', async () => {
      const migration = join(testMigrationsDir, '20240101120000_test.ts');

      writeFileSync(
        migration,
        `
        export async function up(db) {
          db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE test');
        }
        `
      );

      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: true
      });

      const stateManager = new MigrationStateManager(connectionManager);
      const applied = await stateManager.getAppliedMigrationNames();

      expect(applied).toEqual(['20240101120000_test']);
    });

    it('should handle invalid target migration', async () => {
      const migration = join(testMigrationsDir, '20240101120000_test.ts');

      writeFileSync(
        migration,
        `
        export async function up(db) {}
        export async function down(db) {}
        `
      );

      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        target: 'non_existent_migration',
        verbose: true
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Target migration not found')
      );
    });
  });

  describe('migrateDown', () => {
    it('should rollback last migration', async () => {
      const migration = join(testMigrationsDir, '20240101120000_test.ts');

      writeFileSync(
        migration,
        `
        export async function up(db) {
          db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE test');
        }
        `
      );

      // Apply migration first
      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      // Verify table exists
      let tables = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test'"
      );
      expect(tables).toHaveLength(1);

      // Rollback migration
      await migrateDown(connectionManager, {
        migrationsDir: testMigrationsDir,
        steps: 1,
        verbose: true
      });

      // Verify table removed
      tables = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test'"
      );
      expect(tables).toHaveLength(0);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Rollback complete')
      );
    });

    it('should rollback multiple migrations', async () => {
      const migration1 = join(testMigrationsDir, '20240101120000_first.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_second.ts');
      const migration3 = join(testMigrationsDir, '20240101140000_third.ts');

      const migrationCode = (tableName: string) => `
        export async function up(db) {
          db.exec('CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE ${tableName}');
        }
      `;

      writeFileSync(migration1, migrationCode('table1'));
      writeFileSync(migration2, migrationCode('table2'));
      writeFileSync(migration3, migrationCode('table3'));

      // Apply all migrations
      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      // Rollback last 2
      await migrateDown(connectionManager, {
        migrationsDir: testMigrationsDir,
        steps: 2,
        verbose: true
      });

      // Verify only table1 remains
      const table1 = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='table1'"
      );
      const table2 = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='table2'"
      );
      const table3 = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='table3'"
      );

      expect(table1).toHaveLength(1);
      expect(table2).toHaveLength(0);
      expect(table3).toHaveLength(0);
    });

    it('should handle no migrations to rollback', async () => {
      await migrateDown(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: true
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No migrations to rollback')
      );
    });

    it('should support dry-run mode', async () => {
      const migration = join(testMigrationsDir, '20240101120000_test.ts');

      writeFileSync(
        migration,
        `
        export async function up(db) {
          db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE test');
        }
        `
      );

      // Apply migration
      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      // Dry-run rollback
      await migrateDown(connectionManager, {
        migrationsDir: testMigrationsDir,
        dryRun: true,
        verbose: true
      });

      // Verify table still exists (not rolled back in dry-run)
      const tables = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test'"
      );
      expect(tables).toHaveLength(1);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN]')
      );
    });

    it('should remove migration from state on rollback', async () => {
      const migration = join(testMigrationsDir, '20240101120000_test.ts');

      writeFileSync(
        migration,
        `
        export async function up(db) {
          db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE test');
        }
        `
      );

      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      const stateManager = new MigrationStateManager(connectionManager);
      let applied = await stateManager.getAppliedMigrationNames();
      expect(applied).toEqual(['20240101120000_test']);

      await migrateDown(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      applied = await stateManager.getAppliedMigrationNames();
      expect(applied).toEqual([]);
    });
  });

  describe('migrateList', () => {
    it('should list migration status', async () => {
      const migration1 = join(testMigrationsDir, '20240101120000_applied.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_pending.ts');

      const migrationCode = (tableName: string) => `
        export async function up(db) {
          db.exec('CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE ${tableName}');
        }
      `;

      writeFileSync(migration1, migrationCode('table1'));
      writeFileSync(migration2, migrationCode('table2'));

      // Apply first migration only
      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        target: '20240101120000_applied',
        verbose: false
      });

      const statuses = await migrateList(connectionManager, {
        migrationsDir: testMigrationsDir
      });

      expect(statuses).toHaveLength(2);
      expect(statuses[0].name).toBe('20240101120000_applied');
      expect(statuses[0].status).toBe('applied');
      expect(statuses[0].appliedAt).toBeDefined();
      expect(statuses[0].durationMs).toBeDefined();

      expect(statuses[1].name).toBe('20240101130000_pending');
      expect(statuses[1].status).toBe('pending');
      expect(statuses[1].appliedAt).toBeUndefined();

      // Verify console output
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Migration Status')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Applied: 1')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pending: 1')
      );
    });

    it('should handle no migrations', async () => {
      const statuses = await migrateList(connectionManager, {
        migrationsDir: testMigrationsDir
      });

      expect(statuses).toEqual([]);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No migrations found')
      );
    });

    it('should show all pending migrations', async () => {
      const migration1 = join(testMigrationsDir, '20240101120000_first.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_second.ts');

      const migrationCode = `
        export async function up(db) {}
        export async function down(db) {}
      `;

      writeFileSync(migration1, migrationCode);
      writeFileSync(migration2, migrationCode);

      const statuses = await migrateList(connectionManager, {
        migrationsDir: testMigrationsDir
      });

      expect(statuses).toHaveLength(2);
      expect(statuses[0].status).toBe('pending');
      expect(statuses[1].status).toBe('pending');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Applied: 0')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pending: 2')
      );
    });

    it('should show all applied migrations', async () => {
      const migration1 = join(testMigrationsDir, '20240101120000_first.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_second.ts');

      const migrationCode = (tableName: string) => `
        export async function up(db) {
          db.exec('CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE ${tableName}');
        }
      `;

      writeFileSync(migration1, migrationCode('table1'));
      writeFileSync(migration2, migrationCode('table2'));

      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      const statuses = await migrateList(connectionManager, {
        migrationsDir: testMigrationsDir
      });

      expect(statuses).toHaveLength(2);
      expect(statuses[0].status).toBe('applied');
      expect(statuses[1].status).toBe('applied');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Applied: 2')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pending: 0')
      );
    });
  });

  describe('migrateCreate', () => {
    it('should create migration file from template', async () => {
      const filepath = await migrateCreate('create_users_table', {
        migrationsDir: testMigrationsDir
      });

      expect(filepath).toMatch(/\d{14}_create_users_table\.ts$/);
      expect(existsSync(filepath)).toBe(true);

      const content = readFileSync(filepath, 'utf-8');
      expect(content).toContain('Migration: ');
      expect(content).toContain('export async function up(db: Database.Database)');
      expect(content).toContain('export async function down(db: Database.Database)');
      expect(content).toContain('Create Users Table');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Created migration')
      );
    });

    it('should slugify migration name', async () => {
      const filepath = await migrateCreate('Add Index & Constraints!', {
        migrationsDir: testMigrationsDir
      });

      expect(filepath).toMatch(/_add_index_constraints\.ts$/);
    });

    it('should create migrations directory if not exists', async () => {
      const newMigrationsDir = join(testMigrationsDir, 'new_dir');

      expect(existsSync(newMigrationsDir)).toBe(false);

      await migrateCreate('test_migration', {
        migrationsDir: newMigrationsDir
      });

      expect(existsSync(newMigrationsDir)).toBe(true);

      // Cleanup
      rmSync(newMigrationsDir, { recursive: true });
    });

    it('should throw error for duplicate migration file', async () => {
      const name = 'duplicate_migration';
      const filepath = await migrateCreate(name, {
        migrationsDir: testMigrationsDir
      });

      // Try to create same file again (manually)
      await expect(
        migrateCreate(name, {
          migrationsDir: testMigrationsDir
        })
      ).rejects.toThrow(/already exists/);
    });

    it('should generate valid TypeScript migration', async () => {
      const filepath = await migrateCreate('test_migration', {
        migrationsDir: testMigrationsDir
      });

      const content = readFileSync(filepath, 'utf-8');

      // Verify imports
      expect(content).toContain("import type Database from 'better-sqlite3'");

      // Verify function signatures
      expect(content).toContain('export async function up(db: Database.Database): Promise<void>');
      expect(content).toContain('export async function down(db: Database.Database): Promise<void>');

      // Verify description export
      expect(content).toContain("export const description = 'Test Migration'");
    });
  });
});
