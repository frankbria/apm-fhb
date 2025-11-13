/**
 * Configuration Validation Utilities
 *
 * Provides validation functions and error messaging utilities for configuration validation.
 */

import fs from 'fs';
import path from 'path';
import type { AppConfig, AutonomyConfig, ResourceConfig, LoggingConfig, NotificationConfig } from './schema.js';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Supported notification channels
 */
const SUPPORTED_CHANNELS = ['email', 'slack', 'webhook'];

/**
 * Validate autonomy level.
 *
 * @param config - Autonomy configuration
 * @returns Validation result
 */
export function validateAutonomyLevel(config: AutonomyConfig): ValidationResult {
  const errors: string[] = [];

  const validLevels = ['Cautious', 'Automated', 'YOLO'];
  if (!validLevels.includes(config.level)) {
    const suggestion = config.level.toLowerCase() === 'yolo' ? 'YOLO' : config.level;
    errors.push(
      `autonomy.level: expected 'Cautious' | 'Automated' | 'YOLO', got '${config.level}'` +
        (suggestion !== config.level ? ` - Did you mean '${suggestion}' (case-sensitive)?` : '')
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate resource limits.
 *
 * @param config - Resource configuration
 * @returns Validation result
 */
export function validateResourceLimits(config: ResourceConfig): ValidationResult {
  const errors: string[] = [];

  // Validate maxAgents
  if (!Number.isInteger(config.maxAgents) || config.maxAgents < 1) {
    errors.push('resources.maxAgents: must be a positive integer (at least 1)');
  } else if (config.maxAgents > 100) {
    errors.push('resources.maxAgents: must be ≤ 100 (current: ' + config.maxAgents + ')');
  }

  // Validate maxWorktrees
  if (!Number.isInteger(config.maxWorktrees) || config.maxWorktrees < 1) {
    errors.push('resources.maxWorktrees: must be a positive integer (at least 1)');
  } else if (config.maxWorktrees > 50) {
    errors.push('resources.maxWorktrees: must be ≤ 50 (current: ' + config.maxWorktrees + ')');
  }

  // Validate tokenBudget
  if (!Number.isInteger(config.tokenBudget) || config.tokenBudget < 1000) {
    errors.push('resources.tokenBudget: must be at least 1000 (current: ' + config.tokenBudget + ')');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate log level.
 *
 * @param config - Logging configuration
 * @returns Validation result
 */
export function validateLogLevel(config: LoggingConfig): ValidationResult {
  const errors: string[] = [];

  const validLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLevels.includes(config.level)) {
    errors.push(
      `logging.level: expected 'debug' | 'info' | 'warn' | 'error', got '${config.level}'`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate file paths in configuration.
 *
 * Checks that paths are strings and optionally checks existence/writability.
 *
 * @param config - Application configuration
 * @param checkExistence - Whether to check if paths exist/are writable
 * @returns Validation result
 */
export function validateFilePaths(
  config: AppConfig,
  checkExistence: boolean = false
): ValidationResult {
  const errors: string[] = [];

  // Validate logging file path
  if (config.logging.filePath) {
    if (typeof config.logging.filePath !== 'string') {
      errors.push('logging.filePath: must be a string');
    } else if (checkExistence) {
      const logDir = path.dirname(config.logging.filePath);
      if (!fs.existsSync(logDir)) {
        errors.push(
          `logging.filePath: directory does not exist: ${logDir} - create it first or use a different path`
        );
      } else {
        try {
          fs.accessSync(logDir, fs.constants.W_OK);
        } catch {
          errors.push(
            `logging.filePath: directory is not writable: ${logDir} - check permissions`
          );
        }
      }
    }
  }

  // Validate database path
  if (typeof config.database.path !== 'string' || config.database.path.length === 0) {
    errors.push('database.path: must be a non-empty string');
  } else if (checkExistence) {
    const dbDir = path.dirname(config.database.path);
    // Only check if directory exists if it's not current directory
    if (dbDir !== '.' && !fs.existsSync(dbDir)) {
      errors.push(
        `database.path: directory does not exist: ${dbDir} - create it first or use a different path`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate notification channels.
 *
 * @param config - Notification configuration
 * @returns Validation result
 */
export function validateNotificationChannels(config: NotificationConfig): ValidationResult {
  const errors: string[] = [];

  for (const channel of config.channels) {
    if (!SUPPORTED_CHANNELS.includes(channel)) {
      errors.push(
        `notifications.channels: unsupported channel '${channel}' - ` +
          `supported channels: ${SUPPORTED_CHANNELS.join(', ')}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate complete configuration.
 *
 * Runs all validation checks and aggregates errors.
 *
 * @param config - Application configuration
 * @param checkFilePaths - Whether to check file path existence
 * @returns Validation result with all errors
 */
export function validateConfig(
  config: AppConfig,
  checkFilePaths: boolean = false
): ValidationResult {
  const allErrors: string[] = [];

  const autonomyResult = validateAutonomyLevel(config.autonomy);
  allErrors.push(...autonomyResult.errors);

  const resourceResult = validateResourceLimits(config.resources);
  allErrors.push(...resourceResult.errors);

  const logLevelResult = validateLogLevel(config.logging);
  allErrors.push(...logLevelResult.errors);

  const filePathResult = validateFilePaths(config, checkFilePaths);
  allErrors.push(...filePathResult.errors);

  const channelResult = validateNotificationChannels(config.notifications);
  allErrors.push(...channelResult.errors);

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

/**
 * Format validation errors as a user-friendly message.
 *
 * @param errors - Array of validation error messages
 * @returns Formatted error message
 */
export function formatValidationErrors(errors: string[]): string {
  if (errors.length === 0) {
    return 'Configuration is valid';
  }

  const header = 'Configuration validation failed:';
  const errorList = errors.map((err) => `  • ${err}`).join('\n');

  return `${header}\n${errorList}`;
}

/**
 * Get configuration summary for display.
 *
 * @param config - Application configuration
 * @returns Human-readable configuration summary
 */
export function getConfigSummary(config: AppConfig): string {
  const lines: string[] = [];

  lines.push('Configuration Summary:');
  lines.push('');
  lines.push('Autonomy:');
  lines.push(`  Level: ${config.autonomy.level}`);
  lines.push(`  File Changes Threshold: ${config.autonomy.approvalThresholds.fileChanges}`);
  lines.push(`  Git Operations Approval: ${config.autonomy.approvalThresholds.gitOperations}`);
  lines.push(`  Schema Changes Approval: ${config.autonomy.approvalThresholds.schemaChanges}`);
  lines.push(
    `  External API Calls Approval: ${config.autonomy.approvalThresholds.externalAPICalls}`
  );
  lines.push('');
  lines.push('Resources:');
  lines.push(`  Max Agents: ${config.resources.maxAgents}`);
  lines.push(`  Max Worktrees: ${config.resources.maxWorktrees}`);
  lines.push(`  Token Budget: ${config.resources.tokenBudget}`);
  lines.push('');
  lines.push('Logging:');
  lines.push(`  Level: ${config.logging.level}`);
  lines.push(`  Console Output: ${config.logging.consoleOutput}`);
  lines.push(`  File Path: ${config.logging.filePath ?? 'none'}`);
  lines.push('');
  lines.push('Notifications:');
  lines.push(`  Enabled: ${config.notifications.enabled}`);
  lines.push(`  Channels: ${config.notifications.channels.join(', ') || 'none'}`);
  lines.push('');
  lines.push('Database:');
  lines.push(`  Path: ${config.database.path}`);
  lines.push(`  Backup Enabled: ${config.database.backupEnabled}`);
  lines.push(`  Backup Interval: ${config.database.backupInterval} hours`);

  return lines.join('\n');
}
