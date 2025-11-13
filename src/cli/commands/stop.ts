/**
 * Stop Command - Gracefully terminate running automation
 *
 * Placeholder implementation for Task 2.1.
 * Full implementation will be added in Phase 4.
 */

import { Command } from 'commander';
import { log } from '../logger.js';

export interface StopOptions {
  force?: boolean;
}

/**
 * Execute the stop command
 */
export async function stopCommand(options: StopOptions): Promise<void> {
  log.debug('Stop command invoked');
  log.debug(`Options: ${JSON.stringify(options)}`);

  // Placeholder implementation
  log.warn('Not yet implemented - Phase 4 will implement automation lifecycle management');

  if (options.force) {
    log.info('The stop command will immediately terminate running automation');
    log.info('Warning: Force stop may leave cleanup tasks incomplete');
  } else {
    log.info('The stop command will gracefully terminate running automation:');
    log.info('  - Complete current operation');
    log.info('  - Save state for potential resume');
    log.info('  - Clean up resources');
    log.info('  - Exit cleanly');
  }
}

/**
 * Register the stop command with Commander
 */
export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Gracefully terminate running automation')
    .option('--force', 'Immediately terminate without graceful shutdown')
    .action(stopCommand)
    .addHelpText(
      'after',
      `
Examples:
  $ apm-auto stop          # Gracefully stop automation
  $ apm-auto stop --force  # Immediately terminate

Notes:
  - Graceful stop completes current operation before exiting
  - Force stop terminates immediately (may leave incomplete state)
  - State is saved to allow resuming with 'apm-auto resume'

Related Commands:
  status          Show current automation state
  resume          Resume paused automation
`,
    );
}
