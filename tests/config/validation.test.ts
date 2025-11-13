/**
 * Configuration Validation Tests
 *
 * Tests for validation utilities and error messaging.
 */

import { describe, it, expect } from 'vitest';
import {
  validateAutonomyLevel,
  validateResourceLimits,
  validateLogLevel,
  validateFilePaths,
  validateNotificationChannels,
  validateConfig,
  formatValidationErrors,
  getConfigSummary,
} from '../../src/config/validation.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { AppConfig } from '../../src/config/schema.js';

describe('Configuration Validation', () => {
  describe('validateAutonomyLevel', () => {
    it('should accept valid autonomy levels', () => {
      const levels = ['Cautious', 'Automated', 'YOLO'];

      for (const level of levels) {
        const config = {
          level: level as 'Cautious' | 'Automated' | 'YOLO',
          approvalThresholds: {
            fileChanges: 5,
            gitOperations: true,
            schemaChanges: true,
            externalAPICalls: true,
          },
        };

        const result = validateAutonomyLevel(config);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }
    });

    it('should reject invalid autonomy level', () => {
      const config = {
        level: 'Invalid' as any,
        approvalThresholds: {
          fileChanges: 5,
          gitOperations: true,
          schemaChanges: true,
          externalAPICalls: true,
        },
      };

      const result = validateAutonomyLevel(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('autonomy.level');
    });

    it('should suggest correction for lowercase "yolo"', () => {
      const config = {
        level: 'yolo' as any,
        approvalThresholds: {
          fileChanges: 5,
          gitOperations: true,
          schemaChanges: true,
          externalAPICalls: true,
        },
      };

      const result = validateAutonomyLevel(config);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('YOLO');
    });
  });

  describe('validateResourceLimits', () => {
    it('should accept valid resource limits', () => {
      const config = {
        maxAgents: 10,
        maxWorktrees: 20,
        tokenBudget: 100000,
      };

      const result = validateResourceLimits(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject maxAgents > 100', () => {
      const config = {
        maxAgents: 150,
        maxWorktrees: 20,
        tokenBudget: 100000,
      };

      const result = validateResourceLimits(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('maxAgents');
      expect(result.errors[0]).toContain('≤ 100');
    });

    it('should reject maxWorktrees > 50', () => {
      const config = {
        maxAgents: 10,
        maxWorktrees: 60,
        tokenBudget: 100000,
      };

      const result = validateResourceLimits(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('maxWorktrees');
      expect(result.errors[0]).toContain('≤ 50');
    });

    it('should reject tokenBudget < 1000', () => {
      const config = {
        maxAgents: 10,
        maxWorktrees: 20,
        tokenBudget: 500,
      };

      const result = validateResourceLimits(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('tokenBudget');
      expect(result.errors[0]).toContain('at least 1000');
    });

    it('should reject negative values', () => {
      const config = {
        maxAgents: -10,
        maxWorktrees: 20,
        tokenBudget: 100000,
      };

      const result = validateResourceLimits(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject non-integer values', () => {
      const config = {
        maxAgents: 10.5,
        maxWorktrees: 20,
        tokenBudget: 100000,
      };

      const result = validateResourceLimits(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should collect multiple errors', () => {
      const config = {
        maxAgents: 150, // Too high
        maxWorktrees: 60, // Too high
        tokenBudget: 500, // Too low
      };

      const result = validateResourceLimits(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(3);
    });
  });

  describe('validateLogLevel', () => {
    it('should accept valid log levels', () => {
      const levels = ['debug', 'info', 'warn', 'error'];

      for (const level of levels) {
        const config = {
          level: level as 'debug' | 'info' | 'warn' | 'error',
          consoleOutput: true,
        };

        const result = validateLogLevel(config);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }
    });

    it('should reject invalid log level', () => {
      const config = {
        level: 'verbose' as any,
        consoleOutput: true,
      };

      const result = validateLogLevel(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('logging.level');
    });
  });

  describe('validateFilePaths', () => {
    it('should accept valid file paths without checking existence', () => {
      const config: AppConfig = {
        ...DEFAULT_CONFIG,
        logging: {
          ...DEFAULT_CONFIG.logging,
          filePath: '/tmp/test.log',
        },
      };

      const result = validateFilePaths(config, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept config without optional file paths', () => {
      const config: AppConfig = {
        ...DEFAULT_CONFIG,
        logging: {
          ...DEFAULT_CONFIG.logging,
          filePath: undefined,
        },
      };

      const result = validateFilePaths(config, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty database path', () => {
      const config: AppConfig = {
        ...DEFAULT_CONFIG,
        database: {
          ...DEFAULT_CONFIG.database,
          path: '',
        },
      };

      const result = validateFilePaths(config, false);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('database.path');
    });
  });

  describe('validateNotificationChannels', () => {
    it('should accept valid notification channels', () => {
      const config = {
        enabled: true,
        channels: ['email', 'slack', 'webhook'],
      };

      const result = validateNotificationChannels(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept empty channels array', () => {
      const config = {
        enabled: false,
        channels: [],
      };

      const result = validateNotificationChannels(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject unsupported channel', () => {
      const config = {
        enabled: true,
        channels: ['email', 'discord'],
      };

      const result = validateNotificationChannels(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('discord');
      expect(result.errors[0]).toContain('email, slack, webhook');
    });

    it('should collect multiple unsupported channels', () => {
      const config = {
        enabled: true,
        channels: ['discord', 'teams', 'slack'],
      };

      const result = validateNotificationChannels(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2); // discord and teams
    });
  });

  describe('validateConfig', () => {
    it('should validate complete valid config', () => {
      const result = validateConfig(DEFAULT_CONFIG, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should collect errors from multiple validators', () => {
      const invalidConfig: AppConfig = {
        autonomy: {
          level: 'Invalid' as any,
          approvalThresholds: {
            fileChanges: 5,
            gitOperations: true,
            schemaChanges: true,
            externalAPICalls: true,
          },
        },
        resources: {
          maxAgents: 150, // Too high
          maxWorktrees: 60, // Too high
          tokenBudget: 100000,
        },
        logging: {
          level: 'verbose' as any,
          consoleOutput: true,
        },
        notifications: {
          enabled: true,
          channels: ['discord'], // Unsupported
        },
        database: {
          path: '',
          backupEnabled: true,
          backupInterval: 24,
        },
      };

      const result = validateConfig(invalidConfig, false);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('formatValidationErrors', () => {
    it('should format empty errors array', () => {
      const formatted = formatValidationErrors([]);
      expect(formatted).toBe('Configuration is valid');
    });

    it('should format single error', () => {
      const errors = ['autonomy.level: invalid value'];
      const formatted = formatValidationErrors(errors);

      expect(formatted).toContain('Configuration validation failed');
      expect(formatted).toContain('autonomy.level');
    });

    it('should format multiple errors as bulleted list', () => {
      const errors = ['autonomy.level: invalid', 'resources.maxAgents: too high'];
      const formatted = formatValidationErrors(errors);

      expect(formatted).toContain('Configuration validation failed');
      expect(formatted).toContain('• autonomy.level');
      expect(formatted).toContain('• resources.maxAgents');
    });
  });

  describe('getConfigSummary', () => {
    it('should generate readable summary of config', () => {
      const summary = getConfigSummary(DEFAULT_CONFIG);

      expect(summary).toContain('Configuration Summary');
      expect(summary).toContain('Autonomy:');
      expect(summary).toContain('Resources:');
      expect(summary).toContain('Logging:');
      expect(summary).toContain('Notifications:');
      expect(summary).toContain('Database:');
      expect(summary).toContain(DEFAULT_CONFIG.autonomy.level);
      expect(summary).toContain(String(DEFAULT_CONFIG.resources.maxAgents));
    });

    it('should handle config with optional values', () => {
      const config: AppConfig = {
        ...DEFAULT_CONFIG,
        logging: {
          ...DEFAULT_CONFIG.logging,
          filePath: '/tmp/test.log',
        },
      };

      const summary = getConfigSummary(config);
      expect(summary).toContain('/tmp/test.log');
    });

    it('should show "none" for undefined optional values', () => {
      const config: AppConfig = {
        ...DEFAULT_CONFIG,
        logging: {
          ...DEFAULT_CONFIG.logging,
          filePath: undefined,
        },
      };

      const summary = getConfigSummary(config);
      expect(summary).toContain('File Path: none');
    });
  });
});
