/**
 * Configuration Management Module
 *
 * Main API for loading, validating, and managing application configuration.
 *
 * @example
 * ```typescript
 * import { getConfig, reloadConfig, validateConfig } from './config/index.js';
 *
 * // Get current configuration (cached)
 * const config = getConfig();
 * console.log(config.autonomy.level);
 *
 * // Reload configuration from disk
 * const freshConfig = reloadConfig();
 *
 * // Validate configuration
 * const result = validateConfig(config);
 * if (!result.valid) {
 *   console.error(result.errors);
 * }
 * ```
 */

// Schema exports
export {
  type AutonomyConfig,
  type ResourceConfig,
  type LoggingConfig,
  type NotificationConfig,
  type DatabaseConfig,
  type AppConfig,
  type ValidatedAppConfig,
  AutonomyConfigSchema,
  ResourceConfigSchema,
  LoggingConfigSchema,
  NotificationConfigSchema,
  DatabaseConfigSchema,
  AppConfigSchema,
} from './schema.js';

// Default configuration
export { DEFAULT_CONFIG } from './defaults.js';

// Loader functions
export {
  loadConfig,
  getConfig,
  reloadConfig,
  clearConfigCache,
  loadConfigFile,
  loadEnvironmentConfig,
  validateConfigFile,
  deepMerge,
  deepClone,
  formatValidationErrors as formatLoaderErrors,
  type ConfigSource,
  type ConfigWithSource,
} from './loader.js';

// Validation functions
export {
  validateAutonomyLevel,
  validateResourceLimits,
  validateLogLevel,
  validateFilePaths,
  validateNotificationChannels,
  validateConfig,
  formatValidationErrors,
  getConfigSummary,
  type ValidationResult,
} from './validation.js';
