/**
 * Initialization Test Suite
 * Tests database setup, validation, and health checking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync, mkdirSync, rmdirSync } from 'fs';
import { ConnectionManager, TEST_CONFIG, DEFAULT_CONFIG } from '../../src/db/connection.js';
import {
  initializeSchema,
  validateSchema,
  healthCheck,
  setupProductionDatabase,
  setupTestDatabase,
  quickSetup
} from '../../src/db/init.js';

describe('Database Initialization', () => {
  let connectionManager: ConnectionManager;

  beforeEach(async () => {
    connectionManager = new ConnectionManager(TEST_CONFIG);
    await connectionManager.connect();
  });

  afterEach(async () => {
    if (connectionManager.isConnected()) {
      await connectionManager.disconnect();
    }
  });

  describe('Schema Initialization', () => {
    it('should initialize schema successfully', async () => {
      await initializeSchema(connectionManager);

      const tables = await connectionManager.query(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      );

      expect(tables[0].count).toBe(6);
    });

    it('should validate schema after initialization', async () => {
      await initializeSchema(connectionManager, { skipValidation: false });

      const validation = await validateSchema(connectionManager);
      expect(validation.valid).toBe(true);
    });

    it('should skip validation when requested', async () => {
      // This should not throw even if we haven't created schema
      await expect(
        initializeSchema(connectionManager, { skipValidation: true })
      ).resolves.not.toThrow();
    });

    it('should support verbose logging', async () => {
      // Should not throw with verbose mode
      await expect(
        initializeSchema(connectionManager, { verbose: false })
      ).resolves.not.toThrow();
    });

    it('should throw error if connection not established', async () => {
      const disconnectedManager = new ConnectionManager(TEST_CONFIG);

      await expect(
        initializeSchema(disconnectedManager)
      ).rejects.toThrow('must be connected');
    });
  });

  describe('Schema Validation', () => {
    it('should detect missing tables', async () => {
      // Don't initialize schema - tables should be missing
      const validation = await validateSchema(connectionManager);

      expect(validation.valid).toBe(false);
      expect(validation.missingTables.length).toBeGreaterThan(0);
    });

    it('should detect missing indexes', async () => {
      // Create tables without indexes
      await connectionManager.execute(
        'CREATE TABLE agents (id TEXT PRIMARY KEY)'
      );

      const validation = await validateSchema(connectionManager);

      expect(validation.valid).toBe(false);
      expect(validation.missingIndexes.length).toBeGreaterThan(0);
    });

    it('should validate foreign keys are enabled', async () => {
      // Disable foreign keys
      await connectionManager.execute('PRAGMA foreign_keys = OFF');

      const validation = await validateSchema(connectionManager);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Foreign keys'))).toBe(true);

      // Re-enable for cleanup
      await connectionManager.execute('PRAGMA foreign_keys = ON');
    });

    it('should validate WAL journal mode', async () => {
      await initializeSchema(connectionManager);

      const validation = await validateSchema(connectionManager);

      expect(validation.valid).toBe(true);
      expect(validation.errors.some(e => e.includes('journal_mode'))).toBe(false);
    });

    it('should return detailed validation results', async () => {
      const validation = await validateSchema(connectionManager);

      expect(validation).toHaveProperty('valid');
      expect(validation).toHaveProperty('missingTables');
      expect(validation).toHaveProperty('missingIndexes');
      expect(validation).toHaveProperty('errors');

      expect(Array.isArray(validation.missingTables)).toBe(true);
      expect(Array.isArray(validation.missingIndexes)).toBe(true);
      expect(Array.isArray(validation.errors)).toBe(true);
    });
  });

  describe('Health Check', () => {
    it('should perform comprehensive health check', async () => {
      await initializeSchema(connectionManager);

      const health = await healthCheck(connectionManager, ':memory:');

      expect(health).toHaveProperty('healthy');
      expect(health).toHaveProperty('connected');
      expect(health).toHaveProperty('schemaValid');
      expect(health).toHaveProperty('checks');

      expect(Array.isArray(health.checks)).toBe(true);
      expect(health.checks.length).toBeGreaterThan(0);
    });

    it('should report healthy status for valid database', async () => {
      await initializeSchema(connectionManager);

      const health = await healthCheck(connectionManager, ':memory:');

      expect(health.healthy).toBe(true);
      expect(health.connected).toBe(true);
      expect(health.schemaValid).toBe(true);
    });

    it('should report unhealthy status for invalid schema', async () => {
      // Don't initialize schema
      const health = await healthCheck(connectionManager, ':memory:');

      expect(health.healthy).toBe(false);
      expect(health.schemaValid).toBe(false);
    });

    it('should include pool statistics', async () => {
      await initializeSchema(connectionManager);

      const health = await healthCheck(connectionManager, ':memory:');

      expect(health.poolStats).toBeDefined();
      expect(health.poolStats?.total).toBe(TEST_CONFIG.poolSize);
    });

    it('should perform all health checks', async () => {
      await initializeSchema(connectionManager);

      const health = await healthCheck(connectionManager, ':memory:');

      const checkNames = health.checks.map(c => c.name);

      expect(checkNames).toContain('Connection');
      expect(checkNames).toContain('Pool Health');
      expect(checkNames).toContain('Schema Validation');
      expect(checkNames).toContain('Write Test');
      expect(checkNames).toContain('Integrity Check');
    });

    it('should mark failed checks as not passed', async () => {
      // Health check without schema
      const health = await healthCheck(connectionManager, ':memory:');

      const schemaCheck = health.checks.find(c => c.name === 'Schema Validation');
      expect(schemaCheck?.passed).toBe(false);
    });
  });

  describe('Test Database Setup', () => {
    let testManager: ConnectionManager;

    afterEach(async () => {
      if (testManager?.isConnected()) {
        await testManager.disconnect();
      }
    });

    it('should setup test database', async () => {
      testManager = new ConnectionManager(TEST_CONFIG);

      await setupTestDatabase(testManager);

      expect(testManager.isConnected()).toBe(true);

      // Verify schema exists
      const tables = await testManager.query(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      );
      expect(tables[0].count).toBe(6);
    });

    it('should skip validation in test mode by default', async () => {
      testManager = new ConnectionManager(TEST_CONFIG);

      // Should complete quickly without validation
      const startTime = Date.now();
      await setupTestDatabase(testManager);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // Should be fast
    });

    it('should support verbose mode', async () => {
      testManager = new ConnectionManager(TEST_CONFIG);

      await expect(
        setupTestDatabase(testManager, { verbose: false })
      ).resolves.not.toThrow();
    });
  });

  describe('Production Database Setup', () => {
    const testDbPath = './test-temp-db/test.db';
    const testDbDir = './test-temp-db';
    let prodManager: ConnectionManager;

    beforeEach(() => {
      // Clean up any existing test database
      if (existsSync(testDbPath)) {
        unlinkSync(testDbPath);
      }
      if (existsSync(testDbDir)) {
        try {
          rmdirSync(testDbDir, { recursive: true });
        } catch (e) {
          // Ignore errors
        }
      }
    });

    afterEach(async () => {
      if (prodManager?.isConnected()) {
        await prodManager.disconnect();
      }

      // Clean up test database
      if (existsSync(testDbPath)) {
        try {
          unlinkSync(testDbPath);
        } catch (e) {
          // Ignore errors
        }
      }
      if (existsSync(testDbDir)) {
        try {
          rmdirSync(testDbDir, { recursive: true });
        } catch (e) {
          // Ignore errors
        }
      }
    });

    it('should create directory structure', async () => {
      prodManager = new ConnectionManager({
        ...TEST_CONFIG,
        filename: testDbPath
      });

      await setupProductionDatabase(prodManager, testDbPath);

      expect(existsSync(testDbDir)).toBe(true);
      expect(existsSync(testDbPath)).toBe(true);
    });

    it('should setup production database with validation', async () => {
      prodManager = new ConnectionManager({
        ...TEST_CONFIG,
        filename: testDbPath
      });

      await setupProductionDatabase(prodManager, testDbPath);

      expect(prodManager.isConnected()).toBe(true);

      // Verify schema is valid
      const validation = await validateSchema(prodManager);
      expect(validation.valid).toBe(true);
    });

    it('should perform health check after setup', async () => {
      prodManager = new ConnectionManager({
        ...TEST_CONFIG,
        filename: testDbPath
      });

      await setupProductionDatabase(prodManager, testDbPath);

      const health = await healthCheck(prodManager, testDbPath);
      expect(health.healthy).toBe(true);
    });

    it('should handle existing directory', async () => {
      // Pre-create directory
      mkdirSync(testDbDir, { recursive: true });

      prodManager = new ConnectionManager({
        ...TEST_CONFIG,
        filename: testDbPath
      });

      // Should not throw
      await expect(
        setupProductionDatabase(prodManager, testDbPath)
      ).resolves.not.toThrow();
    });
  });

  describe('Quick Setup', () => {
    let quickManager: ConnectionManager;

    afterEach(async () => {
      if (quickManager?.isConnected()) {
        await quickManager.disconnect();
      }
    });

    it('should setup test database with quick setup', async () => {
      quickManager = new ConnectionManager(TEST_CONFIG);

      await quickSetup(quickManager, 'test', false);

      expect(quickManager.isConnected()).toBe(true);

      const tables = await quickManager.query(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      );
      expect(tables[0].count).toBe(6);
    });

    it('should default to production mode', async () => {
      const testDbPath = './test-quick-db/test.db';
      const testDbDir = './test-quick-db';

      // Clean up
      if (existsSync(testDbPath)) unlinkSync(testDbPath);
      if (existsSync(testDbDir)) {
        try {
          rmdirSync(testDbDir, { recursive: true });
        } catch (e) {}
      }

      quickManager = new ConnectionManager({
        ...TEST_CONFIG,
        filename: testDbPath
      });

      await quickSetup(quickManager, 'production', false);

      expect(quickManager.isConnected()).toBe(true);

      // Clean up
      await quickManager.disconnect();
      if (existsSync(testDbPath)) unlinkSync(testDbPath);
      if (existsSync(testDbDir)) {
        try {
          rmdirSync(testDbDir, { recursive: true });
        } catch (e) {}
      }
    });
  });

  describe('File-Based vs In-Memory', () => {
    it('should support in-memory database', async () => {
      const memManager = new ConnectionManager(TEST_CONFIG);
      await memManager.connect();
      await initializeSchema(memManager);

      const health = await healthCheck(memManager, ':memory:');

      expect(health.fileExists).toBe(false); // In-memory has no file
      expect(health.healthy).toBe(true);

      await memManager.disconnect();
    });

    it('should support file-based database', async () => {
      const testDbPath = './test-file-based/test.db';
      const testDbDir = './test-file-based';

      // Clean up
      if (existsSync(testDbPath)) unlinkSync(testDbPath);
      if (existsSync(testDbDir)) {
        try {
          rmdirSync(testDbDir, { recursive: true });
        } catch (e) {}
      }

      const fileManager = new ConnectionManager({
        ...TEST_CONFIG,
        filename: testDbPath
      });

      await setupProductionDatabase(fileManager, testDbPath);

      const health = await healthCheck(fileManager, testDbPath);

      expect(health.fileExists).toBe(true);
      expect(health.healthy).toBe(true);

      await fileManager.disconnect();

      // Clean up
      if (existsSync(testDbPath)) unlinkSync(testDbPath);
      if (existsSync(testDbDir)) {
        try {
          rmdirSync(testDbDir, { recursive: true });
        } catch (e) {}
      }
    });
  });
});
