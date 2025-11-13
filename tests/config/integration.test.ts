/**
 * Configuration Integration Tests
 *
 * End-to-end tests for complete configuration system workflows.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getConfig, reloadConfig, validateConfigFile, clearConfigCache } from '../../src/config/loader.js';
import { validateConfig, getConfigSummary } from '../../src/config/validation.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';

describe('Configuration Integration', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalCwd: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-integration-'));
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
    process.env = originalEnv;
    process.chdir(originalCwd);

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('End-to-end configuration workflows', () => {
    it('should load defaults when no config files exist', () => {
      process.chdir(testDir);

      const config = getConfig();

      expect(config.autonomy.level).toBe(DEFAULT_CONFIG.autonomy.level);
      expect(config.resources.maxAgents).toBe(DEFAULT_CONFIG.resources.maxAgents);
      expect(config.logging.level).toBe(DEFAULT_CONFIG.logging.level);
    });

    it('should load and merge project config', () => {
      const configDir = path.join(testDir, '.apm-auto');
      fs.mkdirSync(configDir, { recursive: true });

      const projectConfig = `
autonomy:
  level: "Automated"
resources:
  maxAgents: 30
`;
      fs.writeFileSync(path.join(configDir, 'config.yml'), projectConfig);

      process.chdir(testDir);

      const config = getConfig();

      expect(config.autonomy.level).toBe('Automated');
      expect(config.resources.maxAgents).toBe(30);
      // Should use defaults for other values
      expect(config.logging.level).toBe(DEFAULT_CONFIG.logging.level);
    });

    it('should apply environment variable overrides', () => {
      const configDir = path.join(testDir, '.apm-auto');
      fs.mkdirSync(configDir, { recursive: true });

      const projectConfig = `
autonomy:
  level: "Automated"
resources:
  maxAgents: 30
`;
      fs.writeFileSync(path.join(configDir, 'config.yml'), projectConfig);

      process.chdir(testDir);

      // Environment variable should override project config
      process.env.APM_AUTO_MAX_AGENTS = '50';
      process.env.APM_AUTO_AUTONOMY_LEVEL = 'YOLO';

      const config = reloadConfig();

      expect(config.autonomy.level).toBe('YOLO');
      expect(config.resources.maxAgents).toBe(50);
    });

    it('should validate complete workflow with invalid config', () => {
      const configDir = path.join(testDir, '.apm-auto');
      fs.mkdirSync(configDir, { recursive: true });

      const invalidConfig = `
autonomy:
  level: "InvalidLevel"
resources:
  maxAgents: 150
`;
      const configPath = path.join(configDir, 'config.yml');
      fs.writeFileSync(configPath, invalidConfig);

      const validationResult = validateConfigFile(configPath);

      expect(validationResult.valid).toBe(false);
      expect(validationResult.errors).toBeDefined();
      expect(validationResult.errors).toContain('autonomy.level');
    });

    it('should generate config summary', () => {
      const configDir = path.join(testDir, '.apm-auto');
      fs.mkdirSync(configDir, { recursive: true });

      const projectConfig = `
autonomy:
  level: "Automated"
resources:
  maxAgents: 30
logging:
  level: "debug"
`;
      fs.writeFileSync(path.join(configDir, 'config.yml'), projectConfig);

      process.chdir(testDir);

      const config = getConfig();
      const summary = getConfigSummary(config);

      expect(summary).toContain('Level: Automated');
      expect(summary).toContain('Max Agents: 30');
      expect(summary).toContain('Level: debug');
    });

    it('should validate loaded config', () => {
      process.chdir(testDir);

      const config = getConfig();
      const validationResult = validateConfig(config, false);

      expect(validationResult.valid).toBe(true);
      expect(validationResult.errors).toHaveLength(0);
    });

    it('should handle complex precedence scenario', () => {
      // Create global config
      const globalConfigDir = path.join(os.homedir(), '.apm-auto');
      const globalConfigPath = path.join(globalConfigDir, 'config.yml');
      let globalConfigExisted = false;

      if (fs.existsSync(globalConfigPath)) {
        globalConfigExisted = true;
      }

      // Create project config
      const projectConfigDir = path.join(testDir, '.apm-auto');
      fs.mkdirSync(projectConfigDir, { recursive: true });

      const projectConfig = `
autonomy:
  level: "Automated"
resources:
  maxAgents: 30
  maxWorktrees: 25
`;
      fs.writeFileSync(path.join(projectConfigDir, 'config.yml'), projectConfig);

      process.chdir(testDir);

      // Set environment variable
      process.env.APM_AUTO_MAX_AGENTS = '50';

      const config = reloadConfig();

      // Environment variable (highest priority)
      expect(config.resources.maxAgents).toBe(50);

      // Project config
      expect(config.autonomy.level).toBe('Automated');
      expect(config.resources.maxWorktrees).toBe(25);

      // Defaults for unspecified values
      expect(config.logging.level).toBe(DEFAULT_CONFIG.logging.level);
      expect(config.notifications.enabled).toBe(DEFAULT_CONFIG.notifications.enabled);
    });

    it('should reload config when requested', () => {
      const configDir = path.join(testDir, '.apm-auto');
      fs.mkdirSync(configDir, { recursive: true });

      const config1Path = path.join(configDir, 'config.yml');
      fs.writeFileSync(
        config1Path,
        `
autonomy:
  level: "Cautious"
`
      );

      process.chdir(testDir);

      const config1 = getConfig();
      expect(config1.autonomy.level).toBe('Cautious');

      // Modify config file
      fs.writeFileSync(
        config1Path,
        `
autonomy:
  level: "Automated"
`
      );

      // Reload should pick up changes
      const config2 = reloadConfig();
      expect(config2.autonomy.level).toBe('Automated');
    });

    it('should handle partial config with nested objects', () => {
      const configDir = path.join(testDir, '.apm-auto');
      fs.mkdirSync(configDir, { recursive: true });

      const partialConfig = `
autonomy:
  approvalThresholds:
    fileChanges: 10
`;
      fs.writeFileSync(path.join(configDir, 'config.yml'), partialConfig);

      process.chdir(testDir);

      const config = getConfig();

      // Should use partial override
      expect(config.autonomy.approvalThresholds.fileChanges).toBe(10);

      // Should use defaults for other thresholds
      expect(config.autonomy.approvalThresholds.gitOperations).toBe(
        DEFAULT_CONFIG.autonomy.approvalThresholds.gitOperations
      );

      // Should use default autonomy level
      expect(config.autonomy.level).toBe(DEFAULT_CONFIG.autonomy.level);
    });

    it('should handle YAML with comments', () => {
      const configDir = path.join(testDir, '.apm-auto');
      fs.mkdirSync(configDir, { recursive: true });

      const configWithComments = `
# This is a comment
autonomy:
  level: "Automated" # Inline comment
  approvalThresholds:
    fileChanges: 10 # More comments
    gitOperations: true
    schemaChanges: true
    externalAPICalls: false

# Another comment
resources:
  maxAgents: 25
`;
      fs.writeFileSync(path.join(configDir, 'config.yml'), configWithComments);

      process.chdir(testDir);

      const config = getConfig();

      expect(config.autonomy.level).toBe('Automated');
      expect(config.autonomy.approvalThresholds.fileChanges).toBe(10);
      expect(config.autonomy.approvalThresholds.externalAPICalls).toBe(false);
      expect(config.resources.maxAgents).toBe(25);
    });
  });
});
