/**
 * Database Initialization Module for apm-auto
 *
 * Provides idempotent schema creation, validation, and health checking
 * using schema definitions from Task 1.3.
 */

import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { ConnectionManager } from './connection.js';
import {
  DatabaseSchema,
  generateSchemaSQL
} from '../validation/schema-export.js';

/**
 * Schema Validation Result
 */
export interface SchemaValidationResult {
  /** Whether schema is valid */
  valid: boolean;
  /** Missing tables */
  missingTables: string[];
  /** Missing indexes */
  missingIndexes: string[];
  /** Error messages */
  errors: string[];
}

/**
 * Database Health Check Result
 */
export interface HealthCheckResult {
  /** Overall health status */
  healthy: boolean;
  /** Database connection status */
  connected: boolean;
  /** Schema validation status */
  schemaValid: boolean;
  /** Database file exists (false for :memory:) */
  fileExists: boolean;
  /** Database file path */
  filePath: string;
  /** Pool statistics */
  poolStats?: {
    total: number;
    active: number;
    idle: number;
    waiting: number;
  };
  /** Checks performed */
  checks: {
    name: string;
    passed: boolean;
    message?: string;
  }[];
}

/**
 * Database Initialization Options
 */
export interface InitOptions {
  /** Skip schema validation after creation */
  skipValidation?: boolean;
  /** Drop existing tables before creation (dangerous!) */
  dropExisting?: boolean;
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Initialize database schema
 * Creates all tables and indexes idempotently
 */
export async function initializeSchema(
  connectionManager: ConnectionManager,
  options: InitOptions = {}
): Promise<void> {
  const { skipValidation = false, dropExisting = false, verbose = false } = options;

  if (!connectionManager.isConnected()) {
    throw new Error('Connection manager must be connected before initializing schema');
  }

  try {
    if (verbose) {
      console.log('Initializing apm-auto database schema...');
    }

    // Drop existing tables if requested (DANGEROUS!)
    if (dropExisting) {
      if (verbose) {
        console.log('WARNING: Dropping existing tables...');
      }
      await dropAllTables(connectionManager);
    }

    // Execute PRAGMA statements first (outside transaction)
    await connectionManager.execute('PRAGMA foreign_keys = ON');
    await connectionManager.execute('PRAGMA journal_mode = WAL');

    // Use transaction for atomic schema creation
    await connectionManager.transaction((db) => {
      // Generate complete schema SQL
      const schemaSQL = generateSchemaSQL();

      // Split into statements and filter out PRAGMA statements (already executed)
      const statements = schemaSQL
        .split('\n')
        .filter(line => {
          const trimmed = line.trim();
          return trimmed.length > 0 &&
                 !trimmed.startsWith('--') &&
                 !trimmed.startsWith('PRAGMA');
        });

      let currentStatement = '';
      for (const line of statements) {
        currentStatement += line + '\n';

        // Execute when we hit a semicolon
        if (line.trim().endsWith(';')) {
          if (verbose) {
            console.log(`Executing: ${currentStatement.substring(0, 50)}...`);
          }
          try {
            db.exec(currentStatement);
          } catch (error) {
            // Add statement to error for debugging
            const err = error instanceof Error ? error : new Error(String(error));
            throw new Error(`${err.message}\nFailed statement: ${currentStatement}`);
          }
          currentStatement = '';
        }
      }

      // Execute any remaining statement
      if (currentStatement.trim().length > 0) {
        try {
          db.exec(currentStatement);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          throw new Error(`${err.message}\nFailed statement: ${currentStatement}`);
        }
      }
    });

    if (verbose) {
      console.log(`Successfully created ${DatabaseSchema.length} tables`);
    }

    // Validate schema unless skipped
    if (!skipValidation) {
      if (verbose) {
        console.log('Validating schema...');
      }

      const validation = await validateSchema(connectionManager);
      if (!validation.valid) {
        throw new Error(
          `Schema validation failed:\n` +
          `Missing tables: ${validation.missingTables.join(', ')}\n` +
          `Missing indexes: ${validation.missingIndexes.join(', ')}\n` +
          `Errors: ${validation.errors.join('\n')}`
        );
      }

      if (verbose) {
        console.log('Schema validation passed');
      }
    }

    if (verbose) {
      console.log('Database initialization complete');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to initialize database schema: ${errorMessage}`);
  }
}

/**
 * Validate database schema matches expected structure
 */
export async function validateSchema(
  connectionManager: ConnectionManager
): Promise<SchemaValidationResult> {
  const result: SchemaValidationResult = {
    valid: true,
    missingTables: [],
    missingIndexes: [],
    errors: []
  };

  try {
    // Get list of existing tables
    const existingTables = await connectionManager.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    const tableNames = new Set(existingTables.map(t => t.name));

    // Check each expected table
    for (const tableDef of DatabaseSchema) {
      if (!tableNames.has(tableDef.name)) {
        result.missingTables.push(tableDef.name);
        result.valid = false;
        continue;
      }

      // Validate table structure
      const columns = await connectionManager.query<{ name: string; type: string; notnull: number; pk: number }>(
        `PRAGMA table_info(${tableDef.name})`
      );

      if (columns.length === 0) {
        result.errors.push(`Table ${tableDef.name} has no columns`);
        result.valid = false;
        continue;
      }

      // Check for missing columns
      const columnNames = new Set(columns.map(c => c.name));
      for (const colDef of tableDef.columns) {
        if (!columnNames.has(colDef.name)) {
          result.errors.push(`Table ${tableDef.name} missing column: ${colDef.name}`);
          result.valid = false;
        }
      }

      // Check indexes if defined
      if (tableDef.indexes) {
        const existingIndexes = await connectionManager.query<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='${tableDef.name}' AND name NOT LIKE 'sqlite_%'`
        );
        const indexNames = new Set(existingIndexes.map(i => i.name));

        for (const indexDef of tableDef.indexes) {
          if (!indexNames.has(indexDef.name)) {
            result.missingIndexes.push(`${tableDef.name}.${indexDef.name}`);
            result.valid = false;
          }
        }
      }
    }

    // Check for foreign key constraints
    const foreignKeysEnabled = await connectionManager.get<{ foreign_keys: number }>(
      'PRAGMA foreign_keys'
    );
    if (!foreignKeysEnabled || foreignKeysEnabled.foreign_keys !== 1) {
      result.errors.push('Foreign keys are not enabled');
      result.valid = false;
    }

    // Check journal mode (WAL for file-based, memory for in-memory databases)
    const journalMode = await connectionManager.get<{ journal_mode: string }>(
      'PRAGMA journal_mode'
    );
    const validModes = ['wal', 'memory'];
    if (journalMode && !validModes.includes(journalMode.journal_mode.toLowerCase())) {
      result.errors.push(`Journal mode is ${journalMode.journal_mode}, expected WAL or memory`);
      result.valid = false;
    }
  } catch (error) {
    result.errors.push(`Schema validation error: ${error instanceof Error ? error.message : String(error)}`);
    result.valid = false;
  }

  return result;
}

/**
 * Perform comprehensive database health check
 */
export async function healthCheck(
  connectionManager: ConnectionManager,
  filePath: string
): Promise<HealthCheckResult> {
  const result: HealthCheckResult = {
    healthy: true,
    connected: false,
    schemaValid: false,
    fileExists: filePath !== ':memory:' ? existsSync(filePath) : false,
    filePath,
    checks: []
  };

  // Check 1: Connection status
  result.connected = connectionManager.isConnected();
  result.checks.push({
    name: 'Connection',
    passed: result.connected,
    message: result.connected ? 'Connected' : 'Not connected'
  });

  if (!result.connected) {
    result.healthy = false;
    return result;
  }

  // Check 2: Pool statistics
  try {
    result.poolStats = connectionManager.getPoolStats();
    const hasIdleConnections = result.poolStats.idle > 0;
    result.checks.push({
      name: 'Pool Health',
      passed: hasIdleConnections,
      message: `${result.poolStats.active} active, ${result.poolStats.idle} idle, ${result.poolStats.waiting} waiting`
    });
    if (!hasIdleConnections && result.poolStats.waiting > 0) {
      result.healthy = false;
    }
  } catch (error) {
    result.checks.push({
      name: 'Pool Health',
      passed: false,
      message: `Failed to get pool stats: ${error instanceof Error ? error.message : String(error)}`
    });
    result.healthy = false;
  }

  // Check 3: Schema validation
  try {
    const validation = await validateSchema(connectionManager);
    result.schemaValid = validation.valid;
    result.checks.push({
      name: 'Schema Validation',
      passed: validation.valid,
      message: validation.valid
        ? 'Schema is valid'
        : `Missing tables: ${validation.missingTables.length}, Missing indexes: ${validation.missingIndexes.length}, Errors: ${validation.errors.length}`
    });
    if (!validation.valid) {
      result.healthy = false;
    }
  } catch (error) {
    result.checks.push({
      name: 'Schema Validation',
      passed: false,
      message: `Validation failed: ${error instanceof Error ? error.message : String(error)}`
    });
    result.healthy = false;
  }

  // Check 4: Write test
  try {
    await connectionManager.execute(
      'CREATE TEMP TABLE health_check_test (id INTEGER PRIMARY KEY)'
    );
    await connectionManager.execute('DROP TABLE health_check_test');
    result.checks.push({
      name: 'Write Test',
      passed: true,
      message: 'Write operations working'
    });
  } catch (error) {
    result.checks.push({
      name: 'Write Test',
      passed: false,
      message: `Write test failed: ${error instanceof Error ? error.message : String(error)}`
    });
    result.healthy = false;
  }

  // Check 5: Foreign key integrity
  try {
    const integrityCheck = await connectionManager.query<{ integrity_check: string }>(
      'PRAGMA integrity_check'
    );
    const passed = integrityCheck[0]?.integrity_check === 'ok';
    result.checks.push({
      name: 'Integrity Check',
      passed,
      message: passed ? 'Database integrity OK' : integrityCheck[0]?.integrity_check || 'Unknown error'
    });
    if (!passed) {
      result.healthy = false;
    }
  } catch (error) {
    result.checks.push({
      name: 'Integrity Check',
      passed: false,
      message: `Integrity check failed: ${error instanceof Error ? error.message : String(error)}`
    });
    result.healthy = false;
  }

  return result;
}

/**
 * Drop all tables (DANGEROUS - for testing only)
 */
async function dropAllTables(connectionManager: ConnectionManager): Promise<void> {
  await connectionManager.transaction((db) => {
    // Get all table names
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as { name: string }[];

    // Disable foreign keys temporarily
    db.exec('PRAGMA foreign_keys = OFF');

    // Drop each table
    for (const table of tables) {
      db.exec(`DROP TABLE IF EXISTS ${table.name}`);
    }

    // Re-enable foreign keys
    db.exec('PRAGMA foreign_keys = ON');
  });
}

/**
 * Setup database for production use
 * Creates directory structure and initializes database
 */
export async function setupProductionDatabase(
  connectionManager: ConnectionManager,
  filePath: string,
  options: InitOptions = {}
): Promise<void> {
  const { verbose = false } = options;

  try {
    // Create directory if it doesn't exist (skip for :memory:)
    if (filePath !== ':memory:') {
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        if (verbose) {
          console.log(`Creating database directory: ${dir}`);
        }
        mkdirSync(dir, { recursive: true });
      }
    }

    // Connect to database
    if (!connectionManager.isConnected()) {
      if (verbose) {
        console.log('Connecting to database...');
      }
      await connectionManager.connect();
    }

    // Initialize schema
    await initializeSchema(connectionManager, options);

    // Perform health check
    if (verbose) {
      console.log('Performing health check...');
    }
    const health = await healthCheck(connectionManager, filePath);

    if (!health.healthy) {
      const failedChecks = health.checks.filter(c => !c.passed);
      throw new Error(
        `Database health check failed:\n` +
        failedChecks.map(c => `- ${c.name}: ${c.message}`).join('\n')
      );
    }

    if (verbose) {
      console.log('Production database setup complete');
      console.log(`Database location: ${filePath}`);
      console.log(`Schema valid: ${health.schemaValid}`);
      console.log(`Pool stats: ${health.poolStats?.active} active, ${health.poolStats?.idle} idle`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to setup production database: ${errorMessage}`);
  }
}

/**
 * Setup database for testing (in-memory)
 * Creates and initializes in-memory database
 */
export async function setupTestDatabase(
  connectionManager: ConnectionManager,
  options: InitOptions = {}
): Promise<void> {
  const { verbose = false } = options;

  try {
    // Connect to in-memory database
    if (!connectionManager.isConnected()) {
      if (verbose) {
        console.log('Connecting to in-memory test database...');
      }
      await connectionManager.connect();
    }

    // Initialize schema (skip validation for speed in tests)
    await initializeSchema(connectionManager, {
      ...options,
      skipValidation: options.skipValidation ?? true
    });

    if (verbose) {
      console.log('Test database setup complete');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to setup test database: ${errorMessage}`);
  }
}

/**
 * Quick database setup utility
 * Convenience function for common setup patterns
 */
export async function quickSetup(
  connectionManager: ConnectionManager,
  mode: 'production' | 'test' = 'production',
  verbose: boolean = false
): Promise<void> {
  const options: InitOptions = { verbose };

  if (mode === 'test') {
    await setupTestDatabase(connectionManager, options);
  } else {
    // Get file path from connection manager config
    const filePath = connectionManager.getFilePath();
    await setupProductionDatabase(connectionManager, filePath, options);
  }
}
