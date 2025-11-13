/**
 * Migration Integration Tests
 *
 * End-to-end tests for complete migration workflows
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from '../../../src/db/connection.js';
import { MigrationRunner } from '../../../src/db/migrations/framework.js';
import { MigrationStateManager, calculateChecksum } from '../../../src/db/migrations/state.js';
import { migrateUp, migrateDown, migrateList } from '../../../src/db/migrations/cli.js';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

describe('Migration Integration', () => {
  let connectionManager: ConnectionManager;
  let testDbPath: string;
  let testMigrationsDir: string;

  beforeEach(() => {
    // Create test database
    testDbPath = join(process.cwd(), 'tests', 'db', 'migrations', 'test_integration.db');
    testMigrationsDir = join(process.cwd(), 'tests', 'db', 'migrations', 'test_integration_migrations');

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

  describe('Complete Migration Workflow', () => {
    it('should handle full migration lifecycle', async () => {
      // Create migrations
      const migration1 = join(testMigrationsDir, '20240101120000_create_users.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_create_posts.ts');
      const migration3 = join(testMigrationsDir, '20240101140000_add_indexes.ts');

      writeFileSync(
        migration1,
        `
        export async function up(db) {
          db.exec(\`
            CREATE TABLE users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT UNIQUE NOT NULL,
              email TEXT UNIQUE NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          \`);
        }
        export async function down(db) {
          db.exec('DROP TABLE users');
        }
        export const description = 'Create users table';
        `
      );

      writeFileSync(
        migration2,
        `
        export async function up(db) {
          db.exec(\`
            CREATE TABLE posts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              title TEXT NOT NULL,
              content TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (user_id) REFERENCES users(id)
            )
          \`);
        }
        export async function down(db) {
          db.exec('DROP TABLE posts');
        }
        export const description = 'Create posts table';
        `
      );

      writeFileSync(
        migration3,
        `
        export async function up(db) {
          db.exec('CREATE INDEX idx_posts_user_id ON posts(user_id)');
          db.exec('CREATE INDEX idx_posts_created_at ON posts(created_at)');
        }
        export async function down(db) {
          db.exec('DROP INDEX idx_posts_user_id');
          db.exec('DROP INDEX idx_posts_created_at');
        }
        export const description = 'Add indexes on posts';
        `
      );

      // Apply all migrations
      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
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

      // Verify indexes created
      const indexes = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_posts_%'"
      );
      expect(indexes).toHaveLength(2);

      // Verify state recorded
      const stateManager = new MigrationStateManager(connectionManager);
      const applied = await stateManager.getAppliedMigrationNames();
      expect(applied).toEqual([
        '20240101120000_create_users',
        '20240101130000_create_posts',
        '20240101140000_add_indexes'
      ]);

      // Rollback last migration
      await migrateDown(connectionManager, {
        migrationsDir: testMigrationsDir,
        steps: 1,
        verbose: false
      });

      // Verify indexes removed
      const indexesAfterRollback = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_posts_%'"
      );
      expect(indexesAfterRollback).toHaveLength(0);

      // Verify tables still exist
      const usersAfterRollback = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
      );
      const postsAfterRollback = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='posts'"
      );
      expect(usersAfterRollback).toHaveLength(1);
      expect(postsAfterRollback).toHaveLength(1);

      // Verify state updated
      const appliedAfterRollback = await stateManager.getAppliedMigrationNames();
      expect(appliedAfterRollback).toEqual([
        '20240101120000_create_users',
        '20240101130000_create_posts'
      ]);

      // Rollback all remaining migrations
      await migrateDown(connectionManager, {
        migrationsDir: testMigrationsDir,
        steps: 2,
        verbose: false
      });

      // Verify all tables removed
      const tablesAfterFullRollback = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'posts')"
      );
      expect(tablesAfterFullRollback).toHaveLength(0);

      // Verify state cleared
      const appliedAfterFullRollback = await stateManager.getAppliedMigrationNames();
      expect(appliedAfterFullRollback).toEqual([]);
    });

    it('should handle data migrations', async () => {
      const migration1 = join(testMigrationsDir, '20240101120000_create_table.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_insert_data.ts');

      writeFileSync(
        migration1,
        `
        export async function up(db) {
          db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
        }
        export async function down(db) {
          db.exec('DROP TABLE settings');
        }
        `
      );

      writeFileSync(
        migration2,
        `
        export async function up(db) {
          const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
          stmt.run('app_name', 'Test App');
          stmt.run('version', '1.0.0');
          stmt.run('debug_mode', 'false');
        }
        export async function down(db) {
          db.exec('DELETE FROM settings');
        }
        `
      );

      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      // Verify data inserted
      const settings = await connectionManager.query<{ key: string; value: string }>(
        'SELECT * FROM settings ORDER BY key'
      );

      expect(settings).toHaveLength(3);
      expect(settings[0]).toEqual({ key: 'app_name', value: 'Test App' });
      expect(settings[1]).toEqual({ key: 'debug_mode', value: 'false' });
      expect(settings[2]).toEqual({ key: 'version', value: '1.0.0' });

      // Rollback data migration
      await migrateDown(connectionManager, {
        migrationsDir: testMigrationsDir,
        steps: 1,
        verbose: false
      });

      // Verify data removed
      const settingsAfterRollback = await connectionManager.query<{ key: string }>(
        'SELECT * FROM settings'
      );
      expect(settingsAfterRollback).toHaveLength(0);
    });

    it('should handle schema alterations', async () => {
      const migration1 = join(testMigrationsDir, '20240101120000_create_users.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_add_column.ts');

      writeFileSync(
        migration1,
        `
        export async function up(db) {
          db.exec(\`
            CREATE TABLE users (
              id INTEGER PRIMARY KEY,
              username TEXT NOT NULL
            )
          \`);
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
          // SQLite requires table recreation for adding NOT NULL column
          db.exec(\`
            CREATE TABLE users_new (
              id INTEGER PRIMARY KEY,
              username TEXT NOT NULL,
              email TEXT NOT NULL DEFAULT ''
            )
          \`);
          db.exec('INSERT INTO users_new (id, username) SELECT id, username FROM users');
          db.exec('DROP TABLE users');
          db.exec('ALTER TABLE users_new RENAME TO users');
        }
        export async function down(db) {
          db.exec(\`
            CREATE TABLE users_new (
              id INTEGER PRIMARY KEY,
              username TEXT NOT NULL
            )
          \`);
          db.exec('INSERT INTO users_new (id, username) SELECT id, username FROM users');
          db.exec('DROP TABLE users');
          db.exec('ALTER TABLE users_new RENAME TO users');
        }
        `
      );

      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      // Verify schema
      const schema = await connectionManager.query<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
      );

      expect(schema[0].sql).toContain('email TEXT NOT NULL');

      // Insert test data
      await connectionManager.execute(
        "INSERT INTO users (username, email) VALUES ('test', 'test@example.com')"
      );

      // Rollback schema change
      await migrateDown(connectionManager, {
        migrationsDir: testMigrationsDir,
        steps: 1,
        verbose: false
      });

      // Verify schema rolled back
      const schemaAfterRollback = await connectionManager.query<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
      );

      expect(schemaAfterRollback[0].sql).not.toContain('email');
    });
  });

  describe('Idempotency and Consistency', () => {
    it('should prevent duplicate migration application', async () => {
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

      // Apply migration first time
      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      // Try to apply again
      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      // Verify migration only applied once
      const stateManager = new MigrationStateManager(connectionManager);
      const applied = await stateManager.getAppliedMigrations();
      expect(applied).toHaveLength(1);
    });

    it('should detect modified migrations', async () => {
      const migrationPath = join(testMigrationsDir, '20240101120000_test.ts');

      const originalContent = `
        export async function up(db) {
          db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
        }
        export async function down(db) {
          db.exec('DROP TABLE test');
        }
      `;

      writeFileSync(migrationPath, originalContent);

      // Apply migration
      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      // Modify migration file
      const modifiedContent = `
        export async function up(db) {
          db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
        }
        export async function down(db) {
          db.exec('DROP TABLE test');
        }
      `;

      writeFileSync(migrationPath, modifiedContent);

      // Verify checksum validation detects change
      const runner = new MigrationRunner(connectionManager, testMigrationsDir);
      await runner.discoverMigrations();

      const stateManager = new MigrationStateManager(connectionManager);
      const migrationFile = runner.getDiscoveredMigrations()[0];
      const currentChecksum = calculateChecksum(migrationFile.filepath);

      await expect(
        stateManager.validateChecksum('20240101120000_test', currentChecksum)
      ).rejects.toThrow(/has been modified/);
    });

    it('should maintain database integrity on migration failure', async () => {
      const migration1 = join(testMigrationsDir, '20240101120000_success.ts');
      const migration2 = join(testMigrationsDir, '20240101130000_failing.ts');

      writeFileSync(
        migration1,
        `
        export async function up(db) {
          db.exec('CREATE TABLE success_table (id INTEGER PRIMARY KEY)');
          db.exec('INSERT INTO success_table (id) VALUES (1), (2), (3)');
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
          // Use existing success_table for DML operations to test transaction rollback
          // SQLite can only rollback DML (INSERT/UPDATE/DELETE) not DDL (CREATE TABLE)
          // Use prepared statements for proper transaction support
          const stmt1 = db.prepare('INSERT INTO success_table (id) VALUES (?)');
          stmt1.run(10);
          // This will fail due to duplicate primary key (id=1 already exists from migration1)
          const stmt2 = db.prepare('INSERT INTO success_table (id) VALUES (?)');
          stmt2.run(1);
        }
        export async function down(db) {
          const stmt = db.prepare('DELETE FROM success_table WHERE id = ?');
          stmt.run(10);
        }
        `
      );

      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      // Verify first migration succeeded
      const successTable = await connectionManager.query<{ id: number }>(
        'SELECT * FROM success_table'
      );
      expect(successTable).toHaveLength(3);

      // Verify second migration failed and rolled back (id=10 should not exist)
      const row10 = await connectionManager.query<{ id: number }>(
        'SELECT * FROM success_table WHERE id = 10'
      );
      expect(row10).toHaveLength(0);

      // Verify only first migration recorded
      const stateManager = new MigrationStateManager(connectionManager);
      const applied = await stateManager.getAppliedMigrationNames();
      expect(applied).toEqual(['20240101120000_success']);
    });
  });

  describe('Complex Schema Scenarios', () => {
    it('should handle foreign key constraints', async () => {
      const migration = join(testMigrationsDir, '20240101120000_foreign_keys.ts');

      writeFileSync(
        migration,
        `
        export async function up(db) {
          db.exec(\`
            CREATE TABLE authors (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL
            )
          \`);

          db.exec(\`
            CREATE TABLE books (
              id INTEGER PRIMARY KEY,
              title TEXT NOT NULL,
              author_id INTEGER NOT NULL,
              FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE
            )
          \`);

          // Insert test data
          const stmt1 = db.prepare('INSERT INTO authors (id, name) VALUES (?, ?)');
          stmt1.run(1, 'Author 1');

          const stmt2 = db.prepare('INSERT INTO books (id, title, author_id) VALUES (?, ?, ?)');
          stmt2.run(1, 'Book 1', 1);
          stmt2.run(2, 'Book 2', 1);
        }

        export async function down(db) {
          db.exec('DROP TABLE books');
          db.exec('DROP TABLE authors');
        }
        `
      );

      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      // Verify tables and data
      const authors = await connectionManager.query<{ id: number; name: string }>(
        'SELECT * FROM authors'
      );
      const books = await connectionManager.query<{ id: number; title: string; author_id: number }>(
        'SELECT * FROM books'
      );

      expect(authors).toHaveLength(1);
      expect(books).toHaveLength(2);

      // Verify foreign key constraint works (cascade delete)
      await connectionManager.execute('PRAGMA foreign_keys = ON');
      await connectionManager.execute('DELETE FROM authors WHERE id = 1');

      const booksAfterDelete = await connectionManager.query<{ id: number }>(
        'SELECT * FROM books'
      );
      expect(booksAfterDelete).toHaveLength(0);
    });

    it('should handle multiple indexes and unique constraints', async () => {
      const migration = join(testMigrationsDir, '20240101120000_complex_indexes.ts');

      writeFileSync(
        migration,
        `
        export async function up(db) {
          db.exec(\`
            CREATE TABLE products (
              id INTEGER PRIMARY KEY,
              sku TEXT UNIQUE NOT NULL,
              name TEXT NOT NULL,
              category TEXT NOT NULL,
              price REAL NOT NULL,
              stock INTEGER DEFAULT 0,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          \`);

          db.exec('CREATE INDEX idx_products_category ON products(category)');
          db.exec('CREATE INDEX idx_products_price ON products(price)');
          db.exec('CREATE INDEX idx_products_created ON products(created_at)');
          db.exec('CREATE UNIQUE INDEX idx_products_sku_unique ON products(sku)');
        }

        export async function down(db) {
          db.exec('DROP INDEX idx_products_category');
          db.exec('DROP INDEX idx_products_price');
          db.exec('DROP INDEX idx_products_created');
          db.exec('DROP INDEX idx_products_sku_unique');
          db.exec('DROP TABLE products');
        }
        `
      );

      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      // Verify indexes created
      const indexes = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_products_%'"
      );
      expect(indexes).toHaveLength(4);

      // Verify unique constraint works
      await connectionManager.execute(
        "INSERT INTO products (sku, name, category, price) VALUES ('SKU001', 'Product 1', 'Category A', 9.99)"
      );

      await expect(
        connectionManager.execute(
          "INSERT INTO products (sku, name, category, price) VALUES ('SKU001', 'Product 2', 'Category B', 19.99)"
        )
      ).rejects.toThrow();

      // Rollback migration
      await migrateDown(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      // Verify all indexes removed
      const indexesAfterRollback = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_products_%'"
      );
      expect(indexesAfterRollback).toHaveLength(0);
    });

    it('should handle views and triggers', async () => {
      const migration = join(testMigrationsDir, '20240101120000_views_triggers.ts');

      writeFileSync(
        migration,
        `
        export async function up(db) {
          db.exec(\`
            CREATE TABLE orders (
              id INTEGER PRIMARY KEY,
              customer_name TEXT NOT NULL,
              total REAL NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          \`);

          db.exec(\`
            CREATE TABLE order_audit (
              id INTEGER PRIMARY KEY,
              order_id INTEGER,
              action TEXT,
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          \`);

          db.exec(\`
            CREATE TRIGGER order_audit_trigger
            AFTER INSERT ON orders
            BEGIN
              INSERT INTO order_audit (order_id, action) VALUES (NEW.id, 'created');
            END
          \`);

          db.exec(\`
            CREATE VIEW recent_orders AS
            SELECT * FROM orders WHERE created_at >= datetime('now', '-7 days')
          \`);
        }

        export async function down(db) {
          db.exec('DROP VIEW recent_orders');
          db.exec('DROP TRIGGER order_audit_trigger');
          db.exec('DROP TABLE order_audit');
          db.exec('DROP TABLE orders');
        }
        `
      );

      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      // Test trigger
      await connectionManager.execute(
        "INSERT INTO orders (customer_name, total) VALUES ('John Doe', 99.99)"
      );

      const auditRecords = await connectionManager.query<{ action: string }>(
        'SELECT * FROM order_audit'
      );
      expect(auditRecords).toHaveLength(1);
      expect(auditRecords[0].action).toBe('created');

      // Test view
      const recentOrders = await connectionManager.query<{ customer_name: string }>(
        'SELECT * FROM recent_orders'
      );
      expect(recentOrders).toHaveLength(1);

      // Rollback
      await migrateDown(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      // Verify view and trigger removed
      const views = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='view' AND name='recent_orders'"
      );
      const triggers = await connectionManager.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name='order_audit_trigger'"
      );

      expect(views).toHaveLength(0);
      expect(triggers).toHaveLength(0);
    });
  });

  describe('Migration Status Integration', () => {
    it('should accurately reflect migration status', async () => {
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

      // Initially all pending
      let statuses = await migrateList(connectionManager, {
        migrationsDir: testMigrationsDir
      });

      expect(statuses.filter(s => s.status === 'pending')).toHaveLength(3);
      expect(statuses.filter(s => s.status === 'applied')).toHaveLength(0);

      // Apply first migration
      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        target: '20240101120000_first',
        verbose: false
      });

      statuses = await migrateList(connectionManager, {
        migrationsDir: testMigrationsDir
      });

      expect(statuses.filter(s => s.status === 'pending')).toHaveLength(2);
      expect(statuses.filter(s => s.status === 'applied')).toHaveLength(1);
      expect(statuses[0].status).toBe('applied');
      expect(statuses[1].status).toBe('pending');
      expect(statuses[2].status).toBe('pending');

      // Apply all remaining
      await migrateUp(connectionManager, {
        migrationsDir: testMigrationsDir,
        verbose: false
      });

      statuses = await migrateList(connectionManager, {
        migrationsDir: testMigrationsDir
      });

      expect(statuses.filter(s => s.status === 'applied')).toHaveLength(3);
      expect(statuses.filter(s => s.status === 'pending')).toHaveLength(0);
    });
  });
});
