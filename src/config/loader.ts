/**
 * Configuration File Loader
 *
 * Loads configuration from multiple sources with precedence:
 * 1. Environment variables (highest priority)
 * 2. Project-local config (.apm-auto/config.yml)
 * 3. Global user config (~/.apm-auto/config.yml)
 * 4. Built-in defaults (lowest priority)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { AppConfigSchema, type AppConfig } from './schema.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { ZodError } from 'zod';

/**
 * Configuration source for tracking where settings came from
 */
export type ConfigSource = 'default' | 'global' | 'project' | 'env';

/**
 * Configuration with source tracking
 */
export interface ConfigWithSource {
  config: AppConfig;
  sources: {
    [key: string]: ConfigSource;
  };
}

/**
 * Cached configuration to avoid repeated file system access
 */
let cachedConfig: AppConfig | null = null;

/**
 * Load and merge configuration from all sources.
 *
 * Precedence order (highest to lowest):
 * 1. Environment variables (APM_AUTO_*)
 * 2. Project-local config (.apm-auto/config.yml in cwd)
 * 3. Global user config (~/.apm-auto/config.yml)
 * 4. Built-in defaults
 *
 * @returns Complete configuration with all required fields
 * @throws {Error} If configuration validation fails
 */
export function loadConfig(): AppConfig {
  // Start with defaults
  let config: any = deepClone(DEFAULT_CONFIG);

  // 1. Try global user config (~/.apm-auto/config.yml)
  const globalConfigPath = path.join(os.homedir(), '.apm-auto', 'config.yml');
  const globalConfig = loadConfigFile(globalConfigPath);
  if (globalConfig) {
    config = deepMerge(config, globalConfig);
  }

  // 2. Try project-local config (.apm-auto/config.yml in cwd)
  const projectConfigPath = path.join(process.cwd(), '.apm-auto', 'config.yml');
  const projectConfig = loadConfigFile(projectConfigPath);
  if (projectConfig) {
    config = deepMerge(config, projectConfig);
  }

  // 3. Apply environment variable overrides (highest priority)
  const envConfig = loadEnvironmentConfig();
  if (envConfig) {
    config = deepMerge(config, envConfig);
  }

  // Validate final merged configuration
  try {
    const validated = AppConfigSchema.parse(config);
    cachedConfig = validated;
    return validated;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(formatValidationErrors(error));
    }
    throw error;
  }
}

/**
 * Get cached configuration or load if not cached.
 *
 * @returns Cached or newly loaded configuration
 */
export function getConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }
  return loadConfig();
}

/**
 * Reload configuration, clearing cache and re-reading all sources.
 *
 * @returns Newly loaded configuration
 */
export function reloadConfig(): AppConfig {
  cachedConfig = null;
  return loadConfig();
}

/**
 * Clear cached configuration. Useful for testing.
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * Load configuration from a YAML file.
 *
 * @param filePath - Path to YAML configuration file
 * @returns Parsed configuration object or null if file doesn't exist
 * @throws {Error} If YAML parsing fails
 */
export function loadConfigFile(filePath: string): Partial<AppConfig> | null {
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const parsed = yaml.load(fileContent);

    // Empty file returns null
    if (!parsed) {
      return null;
    }

    if (typeof parsed !== 'object') {
      throw new Error(`Invalid configuration file: ${filePath} - expected object`);
    }

    return parsed as Partial<AppConfig>;
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'YAMLException') {
      const yamlError = error as any;
      throw new Error(
        `YAML parsing error in ${filePath}:\n` +
          `  Line ${yamlError.mark?.line ?? '?'}: ${yamlError.message}`
      );
    }
    throw error;
  }
}

/**
 * Load configuration from environment variables.
 *
 * Supports environment variables with APM_AUTO_ prefix:
 * - APM_AUTO_AUTONOMY_LEVEL
 * - APM_AUTO_MAX_AGENTS
 * - APM_AUTO_MAX_WORKTREES
 * - APM_AUTO_TOKEN_BUDGET
 * - APM_AUTO_LOG_LEVEL
 * - APM_AUTO_LOG_FILE
 * - APM_AUTO_CONSOLE_OUTPUT
 * - APM_AUTO_NOTIFICATIONS_ENABLED
 * - APM_AUTO_DATABASE_PATH
 * - APM_AUTO_BACKUP_ENABLED
 *
 * @returns Partial configuration from environment variables
 */
export function loadEnvironmentConfig(): Partial<AppConfig> | null {
  const env = process.env;
  const config: any = {};

  // Autonomy level
  if (env.APM_AUTO_AUTONOMY_LEVEL) {
    config.autonomy = config.autonomy || {};
    config.autonomy.level = env.APM_AUTO_AUTONOMY_LEVEL;
  }

  // Resource limits
  if (env.APM_AUTO_MAX_AGENTS) {
    config.resources = config.resources || {};
    config.resources.maxAgents = parseInt(env.APM_AUTO_MAX_AGENTS, 10);
  }
  if (env.APM_AUTO_MAX_WORKTREES) {
    config.resources = config.resources || {};
    config.resources.maxWorktrees = parseInt(env.APM_AUTO_MAX_WORKTREES, 10);
  }
  if (env.APM_AUTO_TOKEN_BUDGET) {
    config.resources = config.resources || {};
    config.resources.tokenBudget = parseInt(env.APM_AUTO_TOKEN_BUDGET, 10);
  }

  // Logging
  if (env.APM_AUTO_LOG_LEVEL) {
    config.logging = config.logging || {};
    config.logging.level = env.APM_AUTO_LOG_LEVEL;
  }
  if (env.APM_AUTO_LOG_FILE) {
    config.logging = config.logging || {};
    config.logging.filePath = env.APM_AUTO_LOG_FILE;
  }
  if (env.APM_AUTO_CONSOLE_OUTPUT !== undefined) {
    config.logging = config.logging || {};
    config.logging.consoleOutput = env.APM_AUTO_CONSOLE_OUTPUT === 'true';
  }

  // Notifications
  if (env.APM_AUTO_NOTIFICATIONS_ENABLED !== undefined) {
    config.notifications = config.notifications || {};
    config.notifications.enabled = env.APM_AUTO_NOTIFICATIONS_ENABLED === 'true';
  }

  // Database
  if (env.APM_AUTO_DATABASE_PATH) {
    config.database = config.database || {};
    config.database.path = env.APM_AUTO_DATABASE_PATH;
  }
  if (env.APM_AUTO_BACKUP_ENABLED !== undefined) {
    config.database = config.database || {};
    config.database.backupEnabled = env.APM_AUTO_BACKUP_ENABLED === 'true';
  }

  return Object.keys(config).length > 0 ? config : null;
}

/**
 * Deep merge two objects, with source overriding target.
 *
 * - Nested objects are merged recursively
 * - Arrays are replaced entirely (not merged)
 * - Primitive values in source override target
 *
 * @param target - Base object
 * @param source - Object to merge into target
 * @returns Merged object
 */
export function deepMerge<T>(target: T, source: Partial<T>): T {
  const result: any = { ...target };

  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      continue;
    }

    const sourceValue = source[key];
    const targetValue = result[key];

    // If source value is undefined, skip
    if (sourceValue === undefined) {
      continue;
    }

    // If source value is an object and not an array, merge recursively
    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(targetValue, sourceValue);
    } else {
      // Otherwise, replace with source value
      result[key] = sourceValue;
    }
  }

  return result;
}

/**
 * Deep clone an object.
 *
 * @param obj - Object to clone
 * @returns Cloned object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Format Zod validation errors into human-readable message.
 *
 * @param error - Zod validation error
 * @returns Formatted error message
 */
export function formatValidationErrors(error: ZodError): string {
  const errors = error.issues.map((err) => {
    const path = err.path.join('.');
    return `  • ${path}: ${err.message}`;
  });

  return `Configuration validation failed:\n${errors.join('\n')}`;
}

/**
 * Validate a configuration file without loading it.
 *
 * @param filePath - Path to configuration file
 * @returns Validation result with errors if any
 */
export function validateConfigFile(
  filePath: string
): { valid: boolean; errors?: string } {
  try {
    const config = loadConfigFile(filePath);
    if (!config) {
      return { valid: false, errors: 'Configuration file not found' };
    }

    // Merge with defaults to get complete config for validation
    const merged = deepMerge(DEFAULT_CONFIG, config);
    AppConfigSchema.parse(merged);

    return { valid: true };
  } catch (error) {
    if (error instanceof ZodError) {
      return { valid: false, errors: formatValidationErrors(error) };
    }
    if (error instanceof Error) {
      return { valid: false, errors: error.message };
    }
    return { valid: false, errors: 'Unknown validation error' };
  }
}
