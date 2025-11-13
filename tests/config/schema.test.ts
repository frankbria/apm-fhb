/**
 * Configuration Schema Tests
 *
 * Tests for TypeScript interfaces and Zod schema validation.
 */

import { describe, it, expect } from 'vitest';
import {
  AppConfigSchema,
  AutonomyConfigSchema,
  ResourceConfigSchema,
  LoggingConfigSchema,
  NotificationConfigSchema,
  DatabaseConfigSchema,
} from '../../src/config/schema.js';

describe('Configuration Schema', () => {
  describe('AutonomyConfigSchema', () => {
    it('should validate correct autonomy config', () => {
      const valid = {
        level: 'Cautious',
        approvalThresholds: {
          fileChanges: 5,
          gitOperations: true,
          schemaChanges: true,
          externalAPICalls: true,
        },
      };

      const result = AutonomyConfigSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should accept all valid autonomy levels', () => {
      const levels = ['Cautious', 'Automated', 'YOLO'];

      for (const level of levels) {
        const config = {
          level,
          approvalThresholds: {
            fileChanges: 5,
            gitOperations: true,
            schemaChanges: true,
            externalAPICalls: true,
          },
        };

        const result = AutonomyConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid autonomy level', () => {
      const invalid = {
        level: 'Invalid',
        approvalThresholds: {
          fileChanges: 5,
          gitOperations: true,
          schemaChanges: true,
          externalAPICalls: true,
        },
      };

      const result = AutonomyConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject negative fileChanges', () => {
      const invalid = {
        level: 'Cautious',
        approvalThresholds: {
          fileChanges: -5,
          gitOperations: true,
          schemaChanges: true,
          externalAPICalls: true,
        },
      };

      const result = AutonomyConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject non-boolean approval thresholds', () => {
      const invalid = {
        level: 'Cautious',
        approvalThresholds: {
          fileChanges: 5,
          gitOperations: 'true', // Should be boolean
          schemaChanges: true,
          externalAPICalls: true,
        },
      };

      const result = AutonomyConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('ResourceConfigSchema', () => {
    it('should validate correct resource config', () => {
      const valid = {
        maxAgents: 10,
        maxWorktrees: 20,
        tokenBudget: 100000,
      };

      const result = ResourceConfigSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should reject maxAgents > 100', () => {
      const invalid = {
        maxAgents: 150,
        maxWorktrees: 20,
        tokenBudget: 100000,
      };

      const result = ResourceConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject maxWorktrees > 50', () => {
      const invalid = {
        maxAgents: 10,
        maxWorktrees: 60,
        tokenBudget: 100000,
      };

      const result = ResourceConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject tokenBudget < 1000', () => {
      const invalid = {
        maxAgents: 10,
        maxWorktrees: 20,
        tokenBudget: 500,
      };

      const result = ResourceConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject negative values', () => {
      const invalid = {
        maxAgents: -10,
        maxWorktrees: 20,
        tokenBudget: 100000,
      };

      const result = ResourceConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject non-integer values', () => {
      const invalid = {
        maxAgents: 10.5,
        maxWorktrees: 20,
        tokenBudget: 100000,
      };

      const result = ResourceConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('LoggingConfigSchema', () => {
    it('should validate correct logging config', () => {
      const valid = {
        level: 'info',
        consoleOutput: true,
      };

      const result = LoggingConfigSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should accept all valid log levels', () => {
      const levels = ['debug', 'info', 'warn', 'error'];

      for (const level of levels) {
        const config = {
          level,
          consoleOutput: true,
        };

        const result = LoggingConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }
    });

    it('should accept optional filePath', () => {
      const valid = {
        level: 'info',
        consoleOutput: true,
        filePath: '/path/to/log.txt',
      };

      const result = LoggingConfigSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should reject invalid log level', () => {
      const invalid = {
        level: 'verbose',
        consoleOutput: true,
      };

      const result = LoggingConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject non-boolean consoleOutput', () => {
      const invalid = {
        level: 'info',
        consoleOutput: 'yes',
      };

      const result = LoggingConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('NotificationConfigSchema', () => {
    it('should validate correct notification config', () => {
      const valid = {
        enabled: false,
        channels: [],
      };

      const result = NotificationConfigSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should accept valid channels array', () => {
      const valid = {
        enabled: true,
        channels: ['email', 'slack'],
      };

      const result = NotificationConfigSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should reject non-boolean enabled', () => {
      const invalid = {
        enabled: 'true',
        channels: [],
      };

      const result = NotificationConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject non-array channels', () => {
      const invalid = {
        enabled: true,
        channels: 'email',
      };

      const result = NotificationConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('DatabaseConfigSchema', () => {
    it('should validate correct database config', () => {
      const valid = {
        path: '.apm-auto/state.db',
        backupEnabled: true,
        backupInterval: 24,
      };

      const result = DatabaseConfigSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should reject empty path', () => {
      const invalid = {
        path: '',
        backupEnabled: true,
        backupInterval: 24,
      };

      const result = DatabaseConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject negative backupInterval', () => {
      const invalid = {
        path: '.apm-auto/state.db',
        backupEnabled: true,
        backupInterval: -1,
      };

      const result = DatabaseConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject non-boolean backupEnabled', () => {
      const invalid = {
        path: '.apm-auto/state.db',
        backupEnabled: 1,
        backupInterval: 24,
      };

      const result = DatabaseConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('AppConfigSchema', () => {
    it('should validate complete valid config', () => {
      const valid = {
        autonomy: {
          level: 'Cautious',
          approvalThresholds: {
            fileChanges: 5,
            gitOperations: true,
            schemaChanges: true,
            externalAPICalls: true,
          },
        },
        resources: {
          maxAgents: 10,
          maxWorktrees: 20,
          tokenBudget: 100000,
        },
        logging: {
          level: 'info',
          consoleOutput: true,
        },
        notifications: {
          enabled: false,
          channels: [],
        },
        database: {
          path: '.apm-auto/state.db',
          backupEnabled: true,
          backupInterval: 24,
        },
      };

      const result = AppConfigSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should reject config missing required sections', () => {
      const invalid = {
        autonomy: {
          level: 'Cautious',
          approvalThresholds: {
            fileChanges: 5,
            gitOperations: true,
            schemaChanges: true,
            externalAPICalls: true,
          },
        },
        // Missing other sections
      };

      const result = AppConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject config with invalid nested values', () => {
      const invalid = {
        autonomy: {
          level: 'Invalid', // Invalid level
          approvalThresholds: {
            fileChanges: 5,
            gitOperations: true,
            schemaChanges: true,
            externalAPICalls: true,
          },
        },
        resources: {
          maxAgents: 10,
          maxWorktrees: 20,
          tokenBudget: 100000,
        },
        logging: {
          level: 'info',
          consoleOutput: true,
        },
        notifications: {
          enabled: false,
          channels: [],
        },
        database: {
          path: '.apm-auto/state.db',
          backupEnabled: true,
          backupInterval: 24,
        },
      };

      const result = AppConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});
