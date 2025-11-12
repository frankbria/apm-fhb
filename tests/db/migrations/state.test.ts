/**
 * Migration State Management Tests
 *
 * Tests for schema_migrations table, checksum validation, and locking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from '../../../src/db/connection.js';
import {
  MigrationStateManager,
  calculateChecksum,
  calculateChecksumFromContent,
  validateAllMigrations
} from '../../../src/db/migrations/state.js';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

describe('Migration State Management', () => {
  let connectionManager: ConnectionManager;
  let stateManager: MigrationStateManager;
  let testDbPath: string;
  let testMigrationsDir: string;

  beforeEach(() => {
    // Create test database
    testDbPath = join(process.cwd(), 'tests', 'db', 'migrations', 'test_state.db');
    testMigrationsDir = join(process.cwd(), 'tests', 'db', 'migrations', 'test_state_migrations');

    // Remove existing test database and migrations
    if (existsSync(testDbPath)) {
      rmSync(testDbPath);
    }
    if (existsSync(testMigrationsDir)) {
      rmSync(testMigrationsDir, { recursive: true });
    }

    // Create fresh directories
    mkdirSync(testMigrationsDir, { recursive: true });

    // Initialize connection manager and state manager
    connectionManager = new ConnectionManager(testDbPath);
    connectionManager.connect();
    stateManager = new MigrationStateManager(connectionManager);
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

  describe('Schema Table Management', () => {
    it('should create schema_migrations table', async () => {
      await stateManager.ensureSchemaTable();

      const tables = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
      );

      expect(tables).toHaveLength(1);
    });

    it('should create index on migration_name', async () => {
      await stateManager.ensureSchemaTable();

      const indexes = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_schema_migrations_name'"
      );

      expect(indexes).toHaveLength(1);
    });

    it('should be idempotent (multiple calls safe)', async () => {
      await stateManager.ensureSchemaTable();
      await stateManager.ensureSchemaTable();
      await stateManager.ensureSchemaTable();

      const tables = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
      );

      expect(tables).toHaveLength(1);
    });
  });

  describe('Migration Recording', () => {
    it('should record migration with checksum', async () => {
      await stateManager.recordMigration('20240101120000_test', 150, 'abc123checksum');

      const migrations = await stateManager.getAppliedMigrations();

      expect(migrations).toHaveLength(1);
      expect(migrations[0].migration_name).toBe('20240101120000_test');
      expect(migrations[0].execution_duration_ms).toBe(150);
      expect(migrations[0].checksum).toBe('abc123checksum');
      expect(migrations[0].applied_at).toBeDefined();
    });

    it('should record multiple migrations', async () => {
      await stateManager.recordMigration('20240101120000_first', 100, 'checksum1');
      await stateManager.recordMigration('20240101130000_second', 200, 'checksum2');
      await stateManager.recordMigration('20240101140000_third', 150, 'checksum3');

      const migrations = await stateManager.getAppliedMigrations();

      expect(migrations).toHaveLength(3);
      expect(migrations[0].migration_name).toBe('20240101120000_first');
      expect(migrations[1].migration_name).toBe('20240101130000_second');
      expect(migrations[2].migration_name).toBe('20240101140000_third');
    });

    it('should enforce unique constraint on migration_name', async () => {
      await stateManager.recordMigration('20240101120000_duplicate', 100, 'checksum1');

      await expect(
        stateManager.recordMigration('20240101120000_duplicate', 200, 'checksum2')
      ).rejects.toThrow();
    });

    it('should sort migrations by applied_at', async () => {
      await stateManager.recordMigration('20240101140000_third', 150, 'checksum3');
      await stateManager.recordMigration('20240101120000_first', 100, 'checksum1');
      await stateManager.recordMigration('20240101130000_second', 200, 'checksum2');

      const migrations = await stateManager.getAppliedMigrations();

      expect(migrations[0].migration_name).toBe('20240101140000_third');
      expect(migrations[1].migration_name).toBe('20240101120000_first');
      expect(migrations[2].migration_name).toBe('20240101130000_second');
    });
  });

  describe('Migration Removal', () => {
    it('should remove migration record', async () => {
      await stateManager.recordMigration('20240101120000_test', 100, 'checksum');

      const beforeRemoval = await stateManager.getAppliedMigrations();
      expect(beforeRemoval).toHaveLength(1);

      await stateManager.removeMigration('20240101120000_test');

      const afterRemoval = await stateManager.getAppliedMigrations();
      expect(afterRemoval).toHaveLength(0);
    });

    it('should not throw if migration does not exist', async () => {
      await expect(
        stateManager.removeMigration('non_existent_migration')
      ).resolves.not.toThrow();
    });

    it('should only remove specified migration', async () => {
      await stateManager.recordMigration('20240101120000_first', 100, 'checksum1');
      await stateManager.recordMigration('20240101130000_second', 200, 'checksum2');
      await stateManager.recordMigration('20240101140000_third', 150, 'checksum3');

      await stateManager.removeMigration('20240101130000_second');

      const migrations = await stateManager.getAppliedMigrations();
      expect(migrations).toHaveLength(2);
      expect(migrations[0].migration_name).toBe('20240101120000_first');
      expect(migrations[1].migration_name).toBe('20240101140000_third');
    });
  });

  describe('Migration Names', () => {
    it('should get applied migration names', async () => {
      await stateManager.recordMigration('20240101120000_first', 100, 'checksum1');
      await stateManager.recordMigration('20240101130000_second', 200, 'checksum2');

      const names = await stateManager.getAppliedMigrationNames();

      expect(names).toEqual(['20240101120000_first', '20240101130000_second']);
    });

    it('should return empty array if no migrations applied', async () => {
      const names = await stateManager.getAppliedMigrationNames();
      expect(names).toEqual([]);
    });
  });

  describe('Checksum Calculation', () => {
    it('should calculate checksum from file content', () => {
      const filepath = join(testMigrationsDir, 'test_migration.ts');
      const content = 'export async function up(db) {}\nexport async function down(db) {}';

      writeFileSync(filepath, content);

      const checksum = calculateChecksum(filepath);

      expect(checksum).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
      expect(checksum.length).toBe(64);
    });

    it('should calculate checksum from string content', () => {
      const content = 'test content for checksum';
      const checksum = calculateChecksumFromContent(content);

      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(checksum.length).toBe(64);
    });

    it('should produce same checksum for identical content', () => {
      const content = 'identical content';
      const checksum1 = calculateChecksumFromContent(content);
      const checksum2 = calculateChecksumFromContent(content);

      expect(checksum1).toBe(checksum2);
    });

    it('should produce different checksums for different content', () => {
      const checksum1 = calculateChecksumFromContent('content 1');
      const checksum2 = calculateChecksumFromContent('content 2');

      expect(checksum1).not.toBe(checksum2);
    });

    it('should throw error for non-existent file', () => {
      expect(() => calculateChecksum('/non/existent/file.ts')).toThrow();
    });
  });

  describe('Checksum Validation', () => {
    it('should pass validation for matching checksum', async () => {
      const checksum = 'valid_checksum_hash';
      await stateManager.recordMigration('20240101120000_test', 100, checksum);

      await expect(
        stateManager.validateChecksum('20240101120000_test', checksum)
      ).resolves.not.toThrow();
    });

    it('should fail validation for mismatched checksum', async () => {
      await stateManager.recordMigration('20240101120000_test', 100, 'original_checksum');

      await expect(
        stateManager.validateChecksum('20240101120000_test', 'modified_checksum')
      ).rejects.toThrow(/has been modified/);
    });

    it('should not validate unapplied migration', async () => {
      await expect(
        stateManager.validateChecksum('20240101120000_unapplied', 'any_checksum')
      ).resolves.not.toThrow();
    });

    it('should provide detailed error message on mismatch', async () => {
      await stateManager.recordMigration('20240101120000_test', 100, 'abc123');

      try {
        await stateManager.validateChecksum('20240101120000_test', 'def456');
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain('20240101120000_test');
        expect(error.message).toContain('Expected checksum: def456');
        expect(error.message).toContain('Stored checksum:   abc123');
        expect(error.message).toContain('Create a new migration instead');
      }
    });
  });

  describe('Validate All Migrations', () => {
    it('should validate all applied migrations', async () => {
      const filepath1 = join(testMigrationsDir, '20240101120000_first.ts');
      const filepath2 = join(testMigrationsDir, '20240101130000_second.ts');

      const content1 = 'migration 1 content';
      const content2 = 'migration 2 content';

      writeFileSync(filepath1, content1);
      writeFileSync(filepath2, content2);

      const checksum1 = calculateChecksum(filepath1);
      const checksum2 = calculateChecksum(filepath2);

      await stateManager.recordMigration('20240101120000_first', 100, checksum1);
      await stateManager.recordMigration('20240101130000_second', 200, checksum2);

      const migrationFiles = [
        { name: '20240101120000_first', filepath: filepath1 },
        { name: '20240101130000_second', filepath: filepath2 }
      ];

      const errors = await validateAllMigrations(stateManager, migrationFiles);

      expect(errors).toEqual([]);
    });

    it('should detect modified migration', async () => {
      const filepath = join(testMigrationsDir, '20240101120000_test.ts');

      writeFileSync(filepath, 'original content');
      const originalChecksum = calculateChecksum(filepath);

      await stateManager.recordMigration('20240101120000_test', 100, originalChecksum);

      // Modify file
      writeFileSync(filepath, 'modified content');

      const migrationFiles = [{ name: '20240101120000_test', filepath }];
      const errors = await validateAllMigrations(stateManager, migrationFiles);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('has been modified');
    });

    it('should detect missing migration file', async () => {
      await stateManager.recordMigration('20240101120000_missing', 100, 'checksum');

      const migrationFiles: Array<{ name: string; filepath: string }> = [];
      const errors = await validateAllMigrations(stateManager, migrationFiles);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('20240101120000_missing');
      expect(errors[0]).toContain('not found in migrations directory');
    });
  });

  describe('Migration Locking', () => {
    it('should create lock table', async () => {
      await stateManager.ensureLockTable();

      const tables = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='migration_lock'"
      );

      expect(tables).toHaveLength(1);
    });

    it('should acquire lock successfully', async () => {
      await stateManager.acquireLock();

      const lock = await stateManager.getLock();

      expect(lock).toBeDefined();
      expect(lock?.id).toBe(1);
      expect(lock?.locked_by).toBe(process.pid.toString());
      expect(lock?.locked_at).toBeDefined();
    });

    it('should release lock successfully', async () => {
      await stateManager.acquireLock();
      await stateManager.releaseLock();

      const lock = await stateManager.getLock();
      expect(lock).toBeNull();
    });

    it('should prevent concurrent lock acquisition', async () => {
      await stateManager.acquireLock();

      const stateManager2 = new MigrationStateManager(connectionManager);
      await expect(stateManager2.acquireLock()).rejects.toThrow(/lock is held/);
    });

    it('should report isLocked correctly', async () => {
      expect(await stateManager.isLocked()).toBe(false);

      await stateManager.acquireLock();
      expect(await stateManager.isLocked()).toBe(true);

      await stateManager.releaseLock();
      expect(await stateManager.isLocked()).toBe(false);
    });

    it('should detect stale lock', async () => {
      await stateManager.ensureLockTable();

      // Insert old lock (6 minutes ago)
      const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      await connectionManager.execute(
        'INSERT INTO migration_lock (id, locked_at, locked_by) VALUES (1, ?, ?)',
        [staleTime, 'old_process']
      );

      // isLocked should return false for stale lock
      expect(await stateManager.isLocked()).toBe(false);
    });

    it('should force acquire stale lock', async () => {
      await stateManager.ensureLockTable();

      // Insert old lock (6 minutes ago)
      const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      await connectionManager.execute(
        'INSERT INTO migration_lock (id, locked_at, locked_by) VALUES (1, ?, ?)',
        [staleTime, 'old_process']
      );

      // Should successfully acquire stale lock
      await expect(stateManager.acquireLock()).resolves.not.toThrow();

      const lock = await stateManager.getLock();
      expect(lock?.locked_by).toBe(process.pid.toString());
    });

    it('should provide detailed error for active lock', async () => {
      await stateManager.acquireLock();

      const stateManager2 = new MigrationStateManager(connectionManager);

      try {
        await stateManager2.acquireLock();
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain('lock is held');
        expect(error.message).toContain(process.pid.toString());
        expect(error.message).toContain('Another migration may be in progress');
      }
    });

    it('should enforce single lock constraint', async () => {
      await stateManager.ensureLockTable();

      // Try to insert multiple locks directly
      await connectionManager.execute(
        'INSERT INTO migration_lock (id, locked_at, locked_by) VALUES (1, ?, ?)',
        [new Date().toISOString(), 'process1']
      );

      // Should fail due to CHECK constraint (id = 1)
      await expect(
        connectionManager.execute(
          'INSERT INTO migration_lock (id, locked_at, locked_by) VALUES (2, ?, ?)',
          [new Date().toISOString(), 'process2']
        )
      ).rejects.toThrow();
    });
  });

  describe('Lock Timeout Handling', () => {
    it('should calculate lock age correctly', async () => {
      await stateManager.ensureLockTable();

      const lockTime = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago
      await connectionManager.execute(
        'INSERT INTO migration_lock (id, locked_at, locked_by) VALUES (1, ?, ?)',
        [lockTime.toISOString(), 'test_process']
      );

      // Lock should still be active (< 5 minutes)
      expect(await stateManager.isLocked()).toBe(true);
    });

    it('should treat 5 minute old lock as stale', async () => {
      await stateManager.ensureLockTable();

      const staleTime = new Date(Date.now() - 5 * 60 * 1000 - 1000); // 5 minutes + 1 second ago
      await connectionManager.execute(
        'INSERT INTO migration_lock (id, locked_at, locked_by) VALUES (1, ?, ?)',
        [staleTime.toISOString(), 'old_process']
      );

      expect(await stateManager.isLocked()).toBe(false);
    });
  });
});
