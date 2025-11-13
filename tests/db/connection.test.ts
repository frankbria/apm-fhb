/**
 * Connection Manager Test Suite
 * Tests connection pooling, lifecycle management, and transaction support
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionManager, TEST_CONFIG } from '../../src/db/connection.js';

describe('ConnectionManager', () => {
  let connectionManager: ConnectionManager;

  beforeEach(async () => {
    connectionManager = new ConnectionManager(TEST_CONFIG);
  });

  afterEach(async () => {
    if (connectionManager.isConnected()) {
      await connectionManager.disconnect();
    }
  });

  describe('Connection Lifecycle', () => {
    it('should initialize connection pool successfully', async () => {
      await connectionManager.connect();
      expect(connectionManager.isConnected()).toBe(true);
    });

    it('should throw error if connecting twice', async () => {
      await connectionManager.connect();
      await expect(connectionManager.connect()).rejects.toThrow('already initialized');
    });

    it('should disconnect successfully', async () => {
      await connectionManager.connect();
      await connectionManager.disconnect();
      expect(connectionManager.isConnected()).toBe(false);
    });

    it('should throw error when operating without connection', async () => {
      await expect(
        connectionManager.query('SELECT 1')
      ).rejects.toThrow('not initialized');
    });

    it('should throw error when reconnecting after close', async () => {
      await connectionManager.connect();
      await connectionManager.disconnect();
      await expect(connectionManager.connect()).rejects.toThrow('has been closed');
    });
  });

  describe('Connection Pooling', () => {
    beforeEach(async () => {
      await connectionManager.connect();
    });

    it('should create pool with correct size', () => {
      const stats = connectionManager.getPoolStats();
      expect(stats.total).toBe(TEST_CONFIG.poolSize);
      expect(stats.idle).toBe(TEST_CONFIG.poolSize);
      expect(stats.active).toBe(0);
    });

    it('should track active connections', async () => {
      // Execute query to use a connection
      const promise = connectionManager.query('SELECT 1');

      // Give it a moment to acquire connection
      await new Promise(resolve => setTimeout(resolve, 10));

      await promise;

      // Connection should be released
      const stats = connectionManager.getPoolStats();
      expect(stats.active).toBe(0);
      expect(stats.idle).toBe(TEST_CONFIG.poolSize);
    });

    it('should handle pool exhaustion with queue', async () => {
      const poolSize = TEST_CONFIG.poolSize!;

      // Start operations equal to pool size
      const operations = Array(poolSize).fill(null).map(() =>
        connectionManager.query('SELECT 1')
      );

      // All should complete
      await Promise.all(operations);

      const stats = connectionManager.getPoolStats();
      expect(stats.idle).toBe(poolSize);
    });

    it('should timeout on connection acquisition', async () => {
      // Create a manager with very small pool and timeout
      const smallPoolManager = new ConnectionManager({
        ...TEST_CONFIG,
        poolSize: 1,
        timeout: 100
      });

      await smallPoolManager.connect();

      try {
        // Hold one connection
        const db = await smallPoolManager.getDirectConnection();

        // Try to get another - should timeout
        await expect(
          smallPoolManager.query('SELECT 1')
        ).rejects.toThrow('timeout');

        smallPoolManager.releaseDirectConnection(db);
      } finally {
        await smallPoolManager.disconnect();
      }
    });
  });

  describe('Query Operations', () => {
    beforeEach(async () => {
      await connectionManager.connect();
    });

    it('should execute SELECT queries', async () => {
      const result = await connectionManager.query<{ num: number }>('SELECT 1 as num');
      expect(result).toHaveLength(1);
      expect(result[0].num).toBe(1);
    });

    it('should execute queries with parameters', async () => {
      await connectionManager.execute(
        'CREATE TEMP TABLE test_params (id INTEGER, name TEXT)'
      );
      await connectionManager.execute(
        'INSERT INTO test_params VALUES (?, ?)',
        [1, 'test']
      );

      const result = await connectionManager.query<{ id: number; name: string }>(
        'SELECT * FROM test_params WHERE id = ?',
        [1]
      );

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test');
    });

    it('should execute INSERT/UPDATE/DELETE statements', async () => {
      await connectionManager.execute('CREATE TEMP TABLE test_exec (id INTEGER)');

      const insertResult = await connectionManager.execute(
        'INSERT INTO test_exec VALUES (1)'
      );
      expect(insertResult.changes).toBe(1);

      const updateResult = await connectionManager.execute(
        'UPDATE test_exec SET id = 2'
      );
      expect(updateResult.changes).toBe(1);

      const deleteResult = await connectionManager.execute(
        'DELETE FROM test_exec'
      );
      expect(deleteResult.changes).toBe(1);
    });

    it('should get single row with get()', async () => {
      await connectionManager.execute('CREATE TEMP TABLE test_get (id INTEGER)');
      await connectionManager.execute('INSERT INTO test_get VALUES (1), (2)');

      const result = await connectionManager.get<{ id: number }>(
        'SELECT * FROM test_get WHERE id = ?',
        [1]
      );

      expect(result).toBeDefined();
      expect(result?.id).toBe(1);
    });

    it('should return undefined for non-existent row', async () => {
      await connectionManager.execute('CREATE TEMP TABLE test_empty (id INTEGER)');

      const result = await connectionManager.get<{ id: number }>(
        'SELECT * FROM test_empty WHERE id = 999'
      );

      expect(result).toBeUndefined();
    });
  });

  describe('Transaction Support', () => {
    beforeEach(async () => {
      await connectionManager.connect();
      await connectionManager.execute('CREATE TEMP TABLE test_txn (id INTEGER, value TEXT)');
    });

    it('should commit successful transactions', async () => {
      await connectionManager.transaction((db) => {
        db.prepare("INSERT INTO test_txn VALUES (1, 'test')").run();
        db.prepare("INSERT INTO test_txn VALUES (2, 'test2')").run();
      });

      const result = await connectionManager.query('SELECT COUNT(*) as count FROM test_txn');
      expect(result[0].count).toBe(2);
    });

    it('should rollback failed transactions', async () => {
      try {
        await connectionManager.transaction((db) => {
          db.prepare("INSERT INTO test_txn VALUES (1, 'test')").run();
          throw new Error('Simulated error');
        });
      } catch (error) {
        // Expected error
      }

      const result = await connectionManager.query('SELECT COUNT(*) as count FROM test_txn');
      expect(result[0].count).toBe(0);
    });

    it('should support IMMEDIATE transaction mode', async () => {
      await connectionManager.transaction((db) => {
        db.prepare("INSERT INTO test_txn VALUES (1, 'test')").run();
      }, { mode: 'IMMEDIATE' });

      const result = await connectionManager.query('SELECT COUNT(*) as count FROM test_txn');
      expect(result[0].count).toBe(1);
    });

    it('should support EXCLUSIVE transaction mode', async () => {
      await connectionManager.transaction((db) => {
        db.prepare("INSERT INTO test_txn VALUES (1, 'test')").run();
      }, { mode: 'EXCLUSIVE' });

      const result = await connectionManager.query('SELECT COUNT(*) as count FROM test_txn');
      expect(result[0].count).toBe(1);
    });

    it('should handle errors within transactions', async () => {
      await expect(
        connectionManager.transaction((db) => {
          db.prepare("INSERT INTO test_txn VALUES (1, 'test')").run();
          db.prepare('INSERT INTO non_existent_table VALUES (1)').run();
        })
      ).rejects.toThrow();

      // First insert should be rolled back
      const result = await connectionManager.query('SELECT COUNT(*) as count FROM test_txn');
      expect(result[0].count).toBe(0);
    });
  });

  describe('Error Handling and Retry', () => {
    beforeEach(async () => {
      await connectionManager.connect();
    });

    it('should retry on transient errors', async () => {
      let attempts = 0;

      await connectionManager.withRetry((db) => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Temporary error');
        }
        return db.prepare('SELECT 1').get();
      });

      expect(attempts).toBe(2);
    });

    it('should not retry on constraint violations', async () => {
      await connectionManager.execute('CREATE TEMP TABLE test_unique (id INTEGER PRIMARY KEY)');
      await connectionManager.execute('INSERT INTO test_unique VALUES (1)');

      let attempts = 0;

      await expect(
        connectionManager.withRetry((db) => {
          attempts++;
          return db.prepare('INSERT INTO test_unique VALUES (1)').run();
        })
      ).rejects.toThrow('UNIQUE constraint');

      expect(attempts).toBe(1); // Should not retry
    });

    it('should respect max retry attempts', async () => {
      const manager = new ConnectionManager({
        ...TEST_CONFIG,
        maxRetries: 2
      });

      await manager.connect();

      let attempts = 0;

      try {
        await manager.withRetry((db) => {
          attempts++;
          throw new Error('Persistent error');
        });
      } catch (error) {
        // Expected
      }

      expect(attempts).toBe(3); // Initial + 2 retries

      await manager.disconnect();
    });
  });

  describe('PRAGMA Configuration', () => {
    beforeEach(async () => {
      await connectionManager.connect();
    });

    it('should enable foreign keys', async () => {
      const result = await connectionManager.get<{ foreign_keys: number }>(
        'PRAGMA foreign_keys'
      );
      expect(result?.foreign_keys).toBe(1);
    });

    it('should use WAL journal mode (or memory for in-memory DB)', async () => {
      const result = await connectionManager.get<{ journal_mode: string }>(
        'PRAGMA journal_mode'
      );
      const mode = result?.journal_mode.toLowerCase();
      // In-memory databases use 'memory' mode, file-based use 'wal'
      expect(['wal', 'memory']).toContain(mode);
    });

    it('should have appropriate synchronous mode', async () => {
      const result = await connectionManager.get<{ synchronous: number }>(
        'PRAGMA synchronous'
      );
      expect(result?.synchronous).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Concurrent Access', () => {
    beforeEach(async () => {
      await connectionManager.connect();
      await connectionManager.execute('CREATE TEMP TABLE test_concurrent (id INTEGER, value TEXT)');
    });

    it('should handle concurrent reads', async () => {
      // Insert test data
      await connectionManager.execute('INSERT INTO test_concurrent VALUES (1, \'test\')');

      // Execute 10 concurrent reads
      const reads = Array(10).fill(null).map(() =>
        connectionManager.query('SELECT * FROM test_concurrent')
      );

      const results = await Promise.all(reads);

      // All should succeed
      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result).toHaveLength(1);
      });
    });

    it('should handle concurrent writes', async () => {
      // Execute 5 concurrent inserts
      const writes = Array(5).fill(null).map((_, i) =>
        connectionManager.execute(
          'INSERT INTO test_concurrent VALUES (?, ?)',
          [i, `test${i}`]
        )
      );

      await Promise.all(writes);

      // Verify all writes succeeded
      const result = await connectionManager.query('SELECT COUNT(*) as count FROM test_concurrent');
      expect(result[0].count).toBe(5);
    });

    it('should handle mixed read/write operations', async () => {
      const operations = [];

      // Mix of reads and writes
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          operations.push(
            connectionManager.execute(
              'INSERT INTO test_concurrent VALUES (?, ?)',
              [i, `test${i}`]
            )
          );
        } else {
          operations.push(
            connectionManager.query('SELECT COUNT(*) FROM test_concurrent')
          );
        }
      }

      await Promise.all(operations);

      // Verify all writes succeeded
      const result = await connectionManager.query('SELECT COUNT(*) as count FROM test_concurrent');
      expect(result[0].count).toBe(5);
    });
  });
});
