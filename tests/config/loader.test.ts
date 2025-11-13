/**
 * Configuration Loader Tests
 *
 * Tests for configuration file loading, merging, and validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  loadConfigFile,
  loadEnvironmentConfig,
  deepMerge,
  deepClone,
  validateConfigFile,
  loadConfig,
  getConfig,
  reloadConfig,
  clearConfigCache,
} from '../../src/config/loader.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';

describe('Configuration Loader', () => {
  // Temporary test directory
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalCwd: string;

  beforeEach(() => {
    // Create temporary test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));

    // Save original environment and cwd
    originalEnv = { ...process.env };
    originalCwd = process.cwd();

    // Clear config cache
    clearConfigCache();

    // Clear APM_AUTO_ environment variables
    for (const key in process.env) {
      if (key.startsWith('APM_AUTO_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    // Restore environment and cwd
    process.env = originalEnv;
    process.chdir(originalCwd);

    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('loadConfigFile', () => {
    it('should load valid YAML config file', () => {
      const configPath = path.join(testDir, 'config.yml');
      const configContent = `
autonomy:
  level: "Automated"
resources:
  maxAgents: 20
`;
      fs.writeFileSync(configPath, configContent);

      const result = loadConfigFile(configPath);
      expect(result).not.toBeNull();
      expect(result?.autonomy?.level).toBe('Automated');
      expect(result?.resources?.maxAgents).toBe(20);
    });

    it('should return null for non-existent file', () => {
      const result = loadConfigFile('/non/existent/path.yml');
      expect(result).toBeNull();
    });

    it('should throw error for invalid YAML syntax', () => {
      const configPath = path.join(testDir, 'invalid.yml');
      const invalidYaml = `
autonomy:
  level: "Automated"
  invalid: [unclosed array
`;
      fs.writeFileSync(configPath, invalidYaml);

      expect(() => loadConfigFile(configPath)).toThrow(/YAML parsing error/);
    });

    it('should load empty config file', () => {
      const configPath = path.join(testDir, 'empty.yml');
      fs.writeFileSync(configPath, '');

      const result = loadConfigFile(configPath);
      expect(result).toBeNull();
    });

    it('should load partial config with only one section', () => {
      const configPath = path.join(testDir, 'partial.yml');
      const configContent = `
logging:
  level: "debug"
`;
      fs.writeFileSync(configPath, configContent);

      const result = loadConfigFile(configPath);
      expect(result).not.toBeNull();
      expect(result?.logging?.level).toBe('debug');
      expect(result?.autonomy).toBeUndefined();
    });
  });

  describe('loadEnvironmentConfig', () => {
    it('should load autonomy level from environment', () => {
      process.env.APM_AUTO_AUTONOMY_LEVEL = 'YOLO';

      const result = loadEnvironmentConfig();
      expect(result).not.toBeNull();
      expect(result?.autonomy?.level).toBe('YOLO');
    });

    it('should load resource limits from environment', () => {
      process.env.APM_AUTO_MAX_AGENTS = '50';
      process.env.APM_AUTO_MAX_WORKTREES = '30';
      process.env.APM_AUTO_TOKEN_BUDGET = '200000';

      const result = loadEnvironmentConfig();
      expect(result).not.toBeNull();
      expect(result?.resources?.maxAgents).toBe(50);
      expect(result?.resources?.maxWorktrees).toBe(30);
      expect(result?.resources?.tokenBudget).toBe(200000);
    });

    it('should load logging config from environment', () => {
      process.env.APM_AUTO_LOG_LEVEL = 'debug';
      process.env.APM_AUTO_LOG_FILE = '/tmp/test.log';
      process.env.APM_AUTO_CONSOLE_OUTPUT = 'false';

      const result = loadEnvironmentConfig();
      expect(result).not.toBeNull();
      expect(result?.logging?.level).toBe('debug');
      expect(result?.logging?.filePath).toBe('/tmp/test.log');
      expect(result?.logging?.consoleOutput).toBe(false);
    });

    it('should load notification config from environment', () => {
      process.env.APM_AUTO_NOTIFICATIONS_ENABLED = 'true';

      const result = loadEnvironmentConfig();
      expect(result).not.toBeNull();
      expect(result?.notifications?.enabled).toBe(true);
    });

    it('should load database config from environment', () => {
      process.env.APM_AUTO_DATABASE_PATH = '/custom/path/db.sqlite';
      process.env.APM_AUTO_BACKUP_ENABLED = 'false';

      const result = loadEnvironmentConfig();
      expect(result).not.toBeNull();
      expect(result?.database?.path).toBe('/custom/path/db.sqlite');
      expect(result?.database?.backupEnabled).toBe(false);
    });

    it('should return null when no environment variables set', () => {
      const result = loadEnvironmentConfig();
      expect(result).toBeNull();
    });

    it('should handle partial environment config', () => {
      process.env.APM_AUTO_MAX_AGENTS = '25';

      const result = loadEnvironmentConfig();
      expect(result).not.toBeNull();
      expect(result?.resources?.maxAgents).toBe(25);
      expect(result?.autonomy).toBeUndefined();
    });
  });

  describe('deepMerge', () => {
    it('should merge nested objects', () => {
      const target = {
        a: { b: 1, c: 2 },
        d: 3,
      };
      const source = {
        a: { b: 10 },
        e: 4,
      };

      const result = deepMerge(target, source);
      expect(result.a.b).toBe(10);
      expect(result.a.c).toBe(2);
      expect(result.d).toBe(3);
      expect(result.e).toBe(4);
    });

    it('should replace arrays entirely', () => {
      const target = {
        arr: [1, 2, 3],
      };
      const source = {
        arr: [4, 5],
      };

      const result = deepMerge(target, source);
      expect(result.arr).toEqual([4, 5]);
    });

    it('should handle undefined values in source', () => {
      const target = {
        a: 1,
        b: 2,
      };
      const source = {
        a: undefined,
        c: 3,
      };

      const result = deepMerge(target, source);
      expect(result.a).toBe(1); // Undefined is skipped
      expect(result.b).toBe(2);
      expect(result.c).toBe(3);
    });

    it('should handle deeply nested objects', () => {
      const target = {
        level1: {
          level2: {
            level3: {
              value: 'old',
            },
          },
        },
      };
      const source = {
        level1: {
          level2: {
            level3: {
              value: 'new',
            },
          },
        },
      };

      const result = deepMerge(target, source);
      expect(result.level1.level2.level3.value).toBe('new');
    });

    it('should not mutate original objects', () => {
      const target = { a: 1 };
      const source = { b: 2 };

      const result = deepMerge(target, source);
      expect(target).toEqual({ a: 1 });
      expect(source).toEqual({ b: 2 });
      expect(result).toEqual({ a: 1, b: 2 });
    });
  });

  describe('deepClone', () => {
    it('should clone simple object', () => {
      const obj = { a: 1, b: 2 };
      const cloned = deepClone(obj);

      expect(cloned).toEqual(obj);
      expect(cloned).not.toBe(obj);
    });

    it('should clone nested object', () => {
      const obj = { a: { b: { c: 1 } } };
      const cloned = deepClone(obj);

      expect(cloned).toEqual(obj);
      expect(cloned.a).not.toBe(obj.a);
    });

    it('should clone arrays', () => {
      const obj = { arr: [1, 2, 3] };
      const cloned = deepClone(obj);

      expect(cloned).toEqual(obj);
      expect(cloned.arr).not.toBe(obj.arr);
    });
  });

  describe('validateConfigFile', () => {
    it('should validate correct config file', () => {
      const configPath = path.join(testDir, 'valid.yml');
      const configContent = `
autonomy:
  level: "Cautious"
  approvalThresholds:
    fileChanges: 5
    gitOperations: true
    schemaChanges: true
    externalAPICalls: true
resources:
  maxAgents: 10
  maxWorktrees: 20
  tokenBudget: 100000
logging:
  level: "info"
  consoleOutput: true
notifications:
  enabled: false
  channels: []
database:
  path: ".apm-auto/state.db"
  backupEnabled: true
  backupInterval: 24
`;
      fs.writeFileSync(configPath, configContent);

      const result = validateConfigFile(configPath);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should validate partial config file merged with defaults', () => {
      const configPath = path.join(testDir, 'partial.yml');
      const configContent = `
autonomy:
  level: "Automated"
`;
      fs.writeFileSync(configPath, configContent);

      const result = validateConfigFile(configPath);
      expect(result.valid).toBe(true);
    });

    it('should reject config file with invalid values', () => {
      const configPath = path.join(testDir, 'invalid.yml');
      const configContent = `
autonomy:
  level: "InvalidLevel"
`;
      fs.writeFileSync(configPath, configContent);

      const result = validateConfigFile(configPath);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors).toContain('autonomy.level');
    });

    it('should return error for non-existent file', () => {
      const result = validateConfigFile('/non/existent/path.yml');
      expect(result.valid).toBe(false);
      expect(result.errors).toBe('Configuration file not found');
    });
  });

  describe('loadConfig integration', () => {
    it('should load and merge config with precedence', () => {
      // Create project config
      const projectConfigDir = path.join(testDir, '.apm-auto');
      fs.mkdirSync(projectConfigDir, { recursive: true });
      const projectConfigPath = path.join(projectConfigDir, 'config.yml');
      fs.writeFileSync(
        projectConfigPath,
        `
autonomy:
  level: "Automated"
resources:
  maxAgents: 30
`
      );

      // Change to test directory
      process.chdir(testDir);

      // Set environment variable (highest priority)
      process.env.APM_AUTO_MAX_AGENTS = '50';

      const config = loadConfig();

      // Should use environment variable (highest priority)
      expect(config.resources.maxAgents).toBe(50);

      // Should use project config
      expect(config.autonomy.level).toBe('Automated');

      // Should use defaults for unspecified values
      expect(config.logging.level).toBe(DEFAULT_CONFIG.logging.level);
    });

    it('should cache config on subsequent calls', () => {
      const config1 = getConfig();
      const config2 = getConfig();

      // Should return same reference (cached)
      expect(config1).toBe(config2);
    });

    it('should reload config when requested', () => {
      const config1 = loadConfig();

      // Modify environment
      process.env.APM_AUTO_MAX_AGENTS = '75';

      const config2 = reloadConfig();

      // Should reflect new environment variable
      expect(config2.resources.maxAgents).toBe(75);
      expect(config1).not.toBe(config2);
    });
  });
});
