/**
 * Configuration Schema Definition
 *
 * Defines TypeScript interfaces and Zod schemas for runtime validation
 * of application configuration settings.
 */

import { z } from 'zod';

/**
 * Autonomy Configuration
 *
 * Controls the level of automation and approval requirements for agent operations.
 */
export interface AutonomyConfig {
  /**
   * Autonomy level controlling agent behavior and approval requirements.
   *
   * - "Cautious": Requires approval for all significant operations
   * - "Automated": Runs autonomously with minimal approvals
   * - "YOLO": Full automation with no approval gates (use with caution!)
   *
   * @default "Cautious"
   * @example "Automated"
   */
  level: 'Cautious' | 'Automated' | 'YOLO';

  /**
   * Thresholds for approval requirements based on operation impact.
   *
   * @example { fileChanges: 10, gitOperations: true }
   */
  approvalThresholds: {
    /**
     * Maximum number of files that can be modified without approval.
     *
     * @default 5
     * @example 10
     */
    fileChanges: number;

    /**
     * Whether git operations (commit, push, branch) require approval.
     *
     * @default true
     * @example false
     */
    gitOperations: boolean;

    /**
     * Whether database schema changes require approval.
     *
     * @default true
     * @example true
     */
    schemaChanges: boolean;

    /**
     * Whether external API calls require approval.
     *
     * @default true
     * @example false
     */
    externalAPICalls: boolean;
  };
}

/**
 * Resource Configuration
 *
 * Controls resource limits for concurrent operations and token usage.
 */
export interface ResourceConfig {
  /**
   * Maximum number of concurrent agents that can run simultaneously.
   *
   * @default 10
   * @minimum 1
   * @maximum 100
   * @example 20
   */
  maxAgents: number;

  /**
   * Maximum number of parallel git worktrees.
   *
   * @default 20
   * @minimum 1
   * @maximum 50
   * @example 30
   */
  maxWorktrees: number;

  /**
   * Maximum tokens per session before requiring user intervention.
   *
   * @default 100000
   * @minimum 1000
   * @example 200000
   */
  tokenBudget: number;
}

/**
 * Logging Configuration
 *
 * Controls logging behavior, output destinations, and verbosity.
 */
export interface LoggingConfig {
  /**
   * Log level controlling verbosity of output.
   *
   * - "debug": Verbose debugging information
   * - "info": General informational messages
   * - "warn": Warning messages for potential issues
   * - "error": Error messages only
   *
   * @default "info"
   * @example "debug"
   */
  level: 'debug' | 'info' | 'warn' | 'error';

  /**
   * Optional file path for log output. If undefined, only console logging is used.
   *
   * @default undefined
   * @example ".apm-auto/logs/apm-auto.log"
   */
  filePath?: string;

  /**
   * Whether to output logs to console.
   *
   * @default true
   * @example true
   */
  consoleOutput: boolean;
}

/**
 * Notification Configuration
 *
 * Controls notification delivery for agent operations and events.
 */
export interface NotificationConfig {
  /**
   * Whether notifications are enabled.
   *
   * @default false
   * @example true
   */
  enabled: boolean;

  /**
   * Notification channels to use for delivery.
   *
   * Supported channels: 'email', 'slack', 'webhook'
   *
   * @default []
   * @example ['email', 'slack']
   */
  channels: string[];
}

/**
 * Database Configuration
 *
 * Controls database location, backup behavior, and maintenance settings.
 */
export interface DatabaseConfig {
  /**
   * Path to SQLite database file.
   *
   * @default ".apm-auto/state.db"
   * @example ".apm-auto/state.db"
   */
  path: string;

  /**
   * Whether automatic database backups are enabled.
   *
   * @default true
   * @example true
   */
  backupEnabled: boolean;

  /**
   * Backup interval in hours.
   *
   * @default 24
   * @minimum 1
   * @example 12
   */
  backupInterval: number;
}

/**
 * Application Configuration
 *
 * Complete configuration structure combining all configuration sections.
 */
export interface AppConfig {
  autonomy: AutonomyConfig;
  resources: ResourceConfig;
  logging: LoggingConfig;
  notifications: NotificationConfig;
  database: DatabaseConfig;
}

/**
 * Zod Schema for Autonomy Configuration
 */
export const AutonomyConfigSchema = z.object({
  level: z.enum(['Cautious', 'Automated', 'YOLO']),
  approvalThresholds: z.object({
    fileChanges: z.number().int().positive({
      message: 'fileChanges must be a positive integer',
    }),
    gitOperations: z.boolean(),
    schemaChanges: z.boolean(),
    externalAPICalls: z.boolean(),
  }),
});

/**
 * Zod Schema for Resource Configuration
 */
export const ResourceConfigSchema = z.object({
  maxAgents: z.number().int().positive().max(100, {
    message: 'maxAgents must be between 1 and 100',
  }),
  maxWorktrees: z.number().int().positive().max(50, {
    message: 'maxWorktrees must be between 1 and 50',
  }),
  tokenBudget: z.number().int().min(1000, {
    message: 'tokenBudget must be at least 1000',
  }),
});

/**
 * Zod Schema for Logging Configuration
 */
export const LoggingConfigSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  filePath: z.string().optional(),
  consoleOutput: z.boolean(),
});

/**
 * Zod Schema for Notification Configuration
 */
export const NotificationConfigSchema = z.object({
  enabled: z.boolean(),
  channels: z.array(z.string()),
});

/**
 * Zod Schema for Database Configuration
 */
export const DatabaseConfigSchema = z.object({
  path: z.string().min(1, {
    message: 'Database path must be a non-empty string',
  }),
  backupEnabled: z.boolean(),
  backupInterval: z.number().int().positive({
    message: 'backupInterval must be a positive integer (hours)',
  }),
});

/**
 * Complete Application Configuration Schema
 *
 * Validates the entire configuration object including all sections.
 */
export const AppConfigSchema = z.object({
  autonomy: AutonomyConfigSchema,
  resources: ResourceConfigSchema,
  logging: LoggingConfigSchema,
  notifications: NotificationConfigSchema,
  database: DatabaseConfigSchema,
});

/**
 * Type alias for validated configuration
 */
export type ValidatedAppConfig = z.infer<typeof AppConfigSchema>;
