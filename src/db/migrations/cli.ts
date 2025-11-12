/**
 * Migration CLI Command Handlers
 *
 * Command handler functions for migration operations.
 * These will be integrated with Commander.js in Phase 2 Task 2.1.
 */

import { ConnectionManager } from '../connection.js';
import { MigrationRunner } from './framework.js';
import { MigrationStateManager, calculateChecksum } from './state.js';
import chalk from 'chalk';

/**
 * CLI command options
 */
export interface MigrateOptions {
  /** Dry-run mode (don't execute) */
  dryRun?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** Target migration name */
  target?: string;
  /** Number of migrations to rollback */
  steps?: number;
  /** Migrations directory path */
  migrationsDir?: string;
}

/**
 * Migration status for listing
 */
export interface MigrationStatus {
  /** Migration name */
  name: string;
  /** Applied or pending */
  status: 'applied' | 'pending';
  /** Timestamp when applied (if applied) */
  appliedAt?: string;
  /** Execution duration (if applied) */
  durationMs?: number;
  /** Checksum (if applied) */
  checksum?: string;
}

/**
 * Apply pending migrations (migrate up)
 *
 * Usage in Phase 2:
 * ```
 * await migrateUp(connectionManager, { verbose: true, dryRun: false });
 * ```
 */
export async function migrateUp(
  connectionManager: ConnectionManager,
  options: MigrateOptions = {}
): Promise<void> {
  const {
    dryRun = false,
    verbose = true,
    target,
    migrationsDir = './migrations'
  } = options;

  const stateManager = new MigrationStateManager(connectionManager);
  const runner = new MigrationRunner(connectionManager, migrationsDir);

  try {
    // Acquire lock
    if (!dryRun) {
      if (verbose) {
        console.log(chalk.blue('Acquiring migration lock...'));
      }
      await stateManager.acquireLock();
    }

    try {
      // Discover migrations
      if (verbose) {
        console.log(chalk.blue('Discovering migrations...'));
      }
      await runner.discoverMigrations();

      // Get applied migrations
      const appliedNames = await stateManager.getAppliedMigrationNames();
      const pending = await runner.getPendingMigrations(appliedNames);

      if (pending.length === 0) {
        console.log(chalk.green('✓ No pending migrations'));
        return;
      }

      // Filter by target if specified
      let toApply = pending;
      if (target) {
        const targetIndex = pending.findIndex(m => m.name === target);
        if (targetIndex === -1) {
          console.error(chalk.red(`✗ Target migration not found: ${target}`));
          return;
        }
        toApply = pending.slice(0, targetIndex + 1);
      }

      if (dryRun) {
        console.log(chalk.yellow(`[DRY RUN] Would apply ${toApply.length} migration(s):`));
        toApply.forEach((m, i) => {
          console.log(chalk.yellow(`  ${i + 1}. ${m.name}`));
        });
        return;
      }

      console.log(chalk.blue(`Applying ${toApply.length} migration(s)...`));
      console.log('');

      // Apply migrations
      for (let i = 0; i < toApply.length; i++) {
        const migration = toApply[i];
        const migrationFile = runner.getDiscoveredMigrations().find(f => f.name === migration.name);

        if (!migrationFile) {
          console.error(chalk.red(`✗ Migration file not found: ${migration.name}`));
          break;
        }

        console.log(chalk.blue(`[${i + 1}/${toApply.length}] ${migration.name}`));

        const result = await runner.applyMigration(migration, { verbose: false });

        if (!result.success) {
          console.error(chalk.red(`✗ Failed: ${result.error?.message}`));
          console.log('');
          console.error(chalk.red('Migration failed! Stopping execution.'));
          break;
        }

        // Calculate checksum and record migration
        const checksum = calculateChecksum(migrationFile.filepath);
        await stateManager.recordMigration(migration.name, result.durationMs, checksum);

        console.log(chalk.green(`✓ Applied (${result.durationMs}ms)`));
        console.log('');
      }

      console.log(chalk.green('✓ Migrations complete'));
    } finally {
      // Release lock
      if (!dryRun) {
        await stateManager.releaseLock();
        if (verbose) {
          console.log(chalk.blue('Released migration lock'));
        }
      }
    }
  } catch (error) {
    console.error(chalk.red('✗ Migration error:'), error);
    throw error;
  }
}

/**
 * Rollback last migration(s) (migrate down)
 *
 * Usage in Phase 2:
 * ```
 * await migrateDown(connectionManager, { steps: 2, verbose: true });
 * ```
 */
export async function migrateDown(
  connectionManager: ConnectionManager,
  options: MigrateOptions = {}
): Promise<void> {
  const {
    dryRun = false,
    verbose = true,
    steps = 1,
    migrationsDir = './migrations'
  } = options;

  const stateManager = new MigrationStateManager(connectionManager);
  const runner = new MigrationRunner(connectionManager, migrationsDir);

  try {
    // Acquire lock
    if (!dryRun) {
      if (verbose) {
        console.log(chalk.blue('Acquiring migration lock...'));
      }
      await stateManager.acquireLock();
    }

    try {
      // Get applied migrations
      const appliedNames = await stateManager.getAppliedMigrationNames();

      if (appliedNames.length === 0) {
        console.log(chalk.yellow('No migrations to rollback'));
        return;
      }

      // Get migrations to rollback
      const toRollback = appliedNames.slice(-steps);

      if (dryRun) {
        console.log(chalk.yellow(`[DRY RUN] Would rollback ${toRollback.length} migration(s):`));
        toRollback.reverse().forEach((name, i) => {
          console.log(chalk.yellow(`  ${i + 1}. ${name}`));
        });
        return;
      }

      console.log(chalk.blue(`Rolling back ${toRollback.length} migration(s)...`));
      console.log('');

      // Discover migrations to load modules
      await runner.discoverMigrations();

      // Rollback migrations
      const results = await runner.rollbackLast(appliedNames, steps, { verbose: false });

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        console.log(chalk.blue(`[${i + 1}/${results.length}] ${result.name}`));

        if (!result.success) {
          console.error(chalk.red(`✗ Failed: ${result.error?.message}`));
          console.log('');
          console.error(chalk.red('Rollback failed! Stopping execution.'));
          break;
        }

        // Remove migration record
        await stateManager.removeMigration(result.name);

        console.log(chalk.green(`✓ Rolled back (${result.durationMs}ms)`));
        console.log('');
      }

      console.log(chalk.green('✓ Rollback complete'));
    } finally {
      // Release lock
      if (!dryRun) {
        await stateManager.releaseLock();
        if (verbose) {
          console.log(chalk.blue('Released migration lock'));
        }
      }
    }
  } catch (error) {
    console.error(chalk.red('✗ Rollback error:'), error);
    throw error;
  }
}

/**
 * List migration status
 *
 * Usage in Phase 2:
 * ```
 * await migrateList(connectionManager, { verbose: true });
 * ```
 */
export async function migrateList(
  connectionManager: ConnectionManager,
  options: MigrateOptions = {}
): Promise<MigrationStatus[]> {
  const { migrationsDir = './migrations' } = options;

  const stateManager = new MigrationStateManager(connectionManager);
  const runner = new MigrationRunner(connectionManager, migrationsDir);

  try {
    // Discover migrations
    await runner.discoverMigrations();
    const discovered = runner.getDiscoveredMigrations();

    // Get applied migrations
    const applied = await stateManager.getAppliedMigrations();
    const appliedMap = new Map(applied.map(m => [m.migration_name, m]));

    // Build status list
    const statuses: MigrationStatus[] = discovered.map(file => {
      const appliedRecord = appliedMap.get(file.name);

      if (appliedRecord) {
        return {
          name: file.name,
          status: 'applied' as const,
          appliedAt: appliedRecord.applied_at,
          durationMs: appliedRecord.execution_duration_ms,
          checksum: appliedRecord.checksum
        };
      }

      return {
        name: file.name,
        status: 'pending' as const
      };
    });

    // Display status
    console.log(chalk.bold('Migration Status:'));
    console.log('');

    if (statuses.length === 0) {
      console.log(chalk.yellow('  No migrations found'));
      return [];
    }

    const appliedCount = statuses.filter(s => s.status === 'applied').length;
    const pendingCount = statuses.filter(s => s.status === 'pending').length;

    statuses.forEach(status => {
      const icon = status.status === 'applied' ? chalk.green('✓') : chalk.yellow('○');
      const statusText = status.status === 'applied'
        ? chalk.green('applied')
        : chalk.yellow('pending');

      let line = `${icon} ${status.name} ${statusText}`;

      if (status.appliedAt) {
        const date = new Date(status.appliedAt).toLocaleString();
        line += chalk.gray(` (${date}, ${status.durationMs}ms)`);
      }

      console.log(`  ${line}`);
    });

    console.log('');
    console.log(chalk.blue(`Total: ${statuses.length} migrations`));
    console.log(chalk.green(`Applied: ${appliedCount}`));
    console.log(chalk.yellow(`Pending: ${pendingCount}`));

    return statuses;
  } catch (error) {
    console.error(chalk.red('✗ List error:'), error);
    throw error;
  }
}

/**
 * Create new migration file from template
 *
 * Usage in Phase 2:
 * ```
 * await migrateCreate('create_users_table', { migrationsDir: './migrations' });
 * ```
 */
export async function migrateCreate(
  name: string,
  options: MigrateOptions = {}
): Promise<string> {
  const { migrationsDir = './migrations' } = options;

  // Import template generator
  const { generateMigrationFile } = await import('./template.js');

  try {
    const filepath = await generateMigrationFile(name, migrationsDir);

    console.log(chalk.green('✓ Created migration:'));
    console.log(chalk.blue(`  ${filepath}`));
    console.log('');
    console.log(chalk.gray('  Edit the migration file to add your schema changes.'));

    return filepath;
  } catch (error) {
    console.error(chalk.red('✗ Create error:'), error);
    throw error;
  }
}
