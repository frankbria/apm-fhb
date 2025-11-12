/**
 * apm-auto Database Module - Barrel Export
 *
 * Provides centralized exports for database connection management,
 * initialization, and typed database operations.
 */

// Connection Manager
export {
  ConnectionManager,
  createConnectionManager,
  DEFAULT_CONFIG,
  TEST_CONFIG,
  type DatabaseConfig,
  type PoolStats,
  type TransactionOptions,
  type TypedDatabase
} from './connection.js';

// Initialization Functions
export {
  initializeSchema,
  validateSchema,
  healthCheck,
  setupProductionDatabase,
  setupTestDatabase,
  quickSetup,
  type SchemaValidationResult,
  type HealthCheckResult,
  type InitOptions
} from './init.js';
