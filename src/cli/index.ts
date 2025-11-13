#!/usr/bin/env node

/**
 * APM Auto CLI Entry Point
 *
 * Provides the apm-auto command-line interface for automation lifecycle management.
 * Built with Commander.js and follows existing apm CLI conventions.
 *
 * Commands:
 * - start [scope]  - Begin automation for specified scope
 * - stop           - Gracefully terminate running automation
 * - status         - Show current automation state
 * - resume         - Continue paused session
 *
 * Global Options:
 * - --verbose, -v       - Enable detailed output
 * - --config <path>     - Specify custom config file
 * - --no-color          - Disable colored output
 * - --version, -V       - Show version information
 * - --help, -h          - Show help information
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import chalk from 'chalk';
import { initLogger, log } from './logger.js';
import { getConfigPath, isVerboseEnabled } from './options.js';
import { registerStartCommand } from './commands/start.js';
import { registerStopCommand } from './commands/stop.js';
import { registerStatusCommand } from './commands/status.js';
import { registerResumeCommand } from './commands/resume.js';

// Get package.json for version info
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '../../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

/**
 * Create and configure the CLI program
 */
function createProgram(): Command {
  const program = new Command();

  program
    .name('apm-auto')
    .description('Agentic Project Management - Automation CLI')
    .version(packageJson.version, '-V, --version', 'Output the current version');

  // Global options
  program
    .option('-v, --verbose', 'Enable verbose output')
    .option('--config <path>', 'Path to configuration file')
    .option('--no-color', 'Disable colored output')
    .hook('preAction', (thisCommand) => {
      // Initialize logger with global options
      const opts = thisCommand.opts();
      const verbose = isVerboseEnabled(opts.verbose);
      const noColor = !thisCommand.opts().color; // Commander converts --no-color to color: false

      initLogger({
        verbose,
        noColor,
      });

      // Log config path if specified
      if (opts.config) {
        const configPath = getConfigPath(opts.config);
        log.debug(`Using config file: ${configPath}`);
      }
    });

  return program;
}

/**
 * Register all commands with the program
 */
function registerCommands(program: Command): void {
  registerStartCommand(program);
  registerStopCommand(program);
  registerStatusCommand(program);
  registerResumeCommand(program);
}

/**
 * Custom version display with build information
 */
function showVersion(): void {
  const nodeVersion = process.version;
  console.log(`apm-auto version ${packageJson.version}`);
  console.log(`Node.js ${nodeVersion}`);

  // Show build info if available (can be added by build process)
  const buildInfo = (packageJson as { buildInfo?: { commit?: string; date?: string } }).buildInfo;
  if (buildInfo) {
    if (buildInfo.commit) {
      console.log(`Commit: ${buildInfo.commit}`);
    }
    if (buildInfo.date) {
      console.log(`Built: ${buildInfo.date}`);
    }
  }
}

/**
 * Setup graceful shutdown handlers
 */
function setupShutdownHandlers(): void {
  const shutdown = (signal: string) => {
    log.debug(`Received ${signal}, shutting down gracefully...`);

    // TODO: Add cleanup logic in Phase 4
    // - Stop running automation
    // - Save current state
    // - Close database connections
    // - Clean up temporary resources

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Global error handler for unhandled errors
 */
function setupErrorHandlers(): void {
  process.on('unhandledRejection', (reason: unknown) => {
    console.error(chalk.red('Unhandled promise rejection:'));
    console.error(reason);
    process.exit(1);
  });

  process.on('uncaughtException', (error: Error) => {
    console.error(chalk.red('Uncaught exception:'));
    console.error(error);
    process.exit(1);
  });
}

/**
 * Main CLI execution
 */
async function main(): Promise<void> {
  try {
    // Setup error and shutdown handlers
    setupErrorHandlers();
    setupShutdownHandlers();

    // Create and configure program
    const program = createProgram();

    // Override version action to show custom info
    program.on('option:version', () => {
      showVersion();
      process.exit(0);
    });

    // Register all commands
    registerCommands(program);

    // Enhanced help text
    program.addHelpText(
      'after',
      `
Environment Variables:
  APM_AUTO_CONFIG_PATH    Override config file path
  APM_AUTO_LOG_LEVEL      Set log level (error, warn, info, debug)
  APM_AUTO_VERBOSE        Enable verbose mode (true/false)

Examples:
  $ apm-auto start phase:1-2           # Start phases 1 and 2
  $ apm-auto status                    # Check automation status
  $ apm-auto stop                      # Stop running automation
  $ apm-auto --verbose start task:1.1  # Start with verbose output

For more information, visit: https://github.com/sdi2200262/agentic-project-management
`,
    );

    // Parse command line arguments
    await program.parseAsync(process.argv);

  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('Error:'), error.message);
      if (error.stack) {
        log.debug(error.stack);
      }
    } else {
      console.error(chalk.red('Unknown error:'), error);
    }
    process.exit(1);
  }
}

// Run main if this is the entry point
main();
