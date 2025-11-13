/**
 * Claude CLI Wrapper
 *
 * Provides interface for executing Claude CLI commands via Node.js child_process.
 * Handles availability checking, process spawning, retry logic, and error handling.
 */

import { spawn, ChildProcess, SpawnOptions as NodeSpawnOptions } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';

const execAsync = promisify(exec);

/**
 * Spawn options for Claude CLI
 */
export interface ClaudeSpawnOptions {
  /** Enable shell execution (default: true) */
  shell?: boolean;
  /** Stdio configuration: 'pipe' for capture, 'inherit' for debug (default: 'pipe') */
  stdio?: 'pipe' | 'inherit' | [string, string, string];
  /** Timeout in milliseconds (default: 300000ms/5 minutes) */
  timeout?: number;
  /** Working directory for spawned process */
  cwd?: string;
  /** Environment variables (merged with process.env) */
  env?: Record<string, string>;
}

/**
 * Result of spawn operation
 */
export interface SpawnResult {
  /** Whether spawn was successful */
  success: boolean;
  /** Spawned process reference (if successful) */
  process?: ChildProcess;
  /** Process ID (if successful) */
  pid?: number;
  /** Error details (if failed) */
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

/**
 * Claude CLI availability check result
 */
export interface AvailabilityResult {
  /** Whether Claude CLI is available */
  available: boolean;
  /** Path to Claude CLI executable (if available) */
  path?: string;
  /** Error message (if not available) */
  error?: string;
}

/**
 * Spawn error codes
 */
export enum SpawnErrorCode {
  /** Claude CLI not found on PATH */
  CLI_NOT_FOUND = 'ENOENT',
  /** Insufficient permissions to execute */
  INSUFFICIENT_PERMISSIONS = 'EACCES',
  /** Resource temporarily unavailable */
  RESOURCE_UNAVAILABLE = 'EAGAIN',
  /** Too many open files */
  TOO_MANY_FILES = 'EMFILE',
  /** Operation timed out */
  TIMEOUT = 'ETIMEDOUT',
}

/**
 * Check if error is transient and retryable
 */
function isTransientError(code: string): boolean {
  return code === SpawnErrorCode.RESOURCE_UNAVAILABLE || 
         code === SpawnErrorCode.TOO_MANY_FILES ||
         code === SpawnErrorCode.TIMEOUT;
}

/**
 * Check if error is permanent
 */
function isPermanentError(code: string): boolean {
  return code === SpawnErrorCode.CLI_NOT_FOUND || 
         code === SpawnErrorCode.INSUFFICIENT_PERMISSIONS;
}

/**
 * Claude CLI wrapper class
 */
export class ClaudeCLI {
  private readonly defaultTimeout = 300000; // 5 minutes

  /**
   * Check if Claude CLI is available on PATH
   */
  async checkAvailability(): Promise<AvailabilityResult> {
    try {
      const command = platform() === 'win32' ? 'where claude' : 'which claude';
      const { stdout, stderr } = await execAsync(command);
      
      if (stderr && !stdout) {
        return {
          available: false,
          error: 'Claude CLI not found on PATH',
        };
      }

      const path = stdout.trim();
      if (!path) {
        return {
          available: false,
          error: 'Claude CLI not found on PATH',
        };
      }

      return {
        available: true,
        path,
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error checking Claude CLI',
      };
    }
  }

  /**
   * Spawn Claude agent process
   * 
   * @param prompt - Prompt text for Claude agent
   * @param options - Spawn configuration options
   * @returns SpawnResult with process reference or error
   */
  spawnAgent(prompt: string, options: ClaudeSpawnOptions = {}): SpawnResult {
    try {
      // Build spawn options
      const spawnOptions: NodeSpawnOptions = {
        shell: options.shell ?? true,
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env,
        },
        timeout: options.timeout ?? this.defaultTimeout,
      };

      // Configure stdio
      if (options.stdio === 'inherit') {
        spawnOptions.stdio = 'inherit';
      } else if (Array.isArray(options.stdio)) {
        spawnOptions.stdio = options.stdio as [string, string, string];
      } else {
        // Default to 'pipe' for capture
        spawnOptions.stdio = ['pipe', 'pipe', 'pipe'];
      }

      // Spawn the process
      const childProcess = spawn('claude', [prompt], spawnOptions);

      // Handle timeout
      let timeoutId: NodeJS.Timeout | undefined;
      if (spawnOptions.timeout && spawnOptions.timeout > 0) {
        timeoutId = setTimeout(() => {
          if (childProcess && !childProcess.killed) {
            childProcess.kill('SIGTERM');
          }
        }, spawnOptions.timeout);
      }

      // Clear timeout on exit
      childProcess.on('exit', () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      });

      return {
        success: true,
        process: childProcess,
        pid: childProcess.pid,
      };
    } catch (error) {
      // Handle spawn errors
      const err = error as NodeJS.ErrnoException;
      return {
        success: false,
        error: {
          code: err.code || 'UNKNOWN',
          message: err.message || 'Unknown spawn error',
          details: err.stack,
        },
      };
    }
  }

  /**
   * Spawn agent with retry logic for transient failures
   * 
   * @param prompt - Prompt text for Claude agent
   * @param options - Spawn configuration options
   * @param maxRetries - Maximum number of retry attempts (default: 3)
   * @param retryDelay - Initial retry delay in milliseconds (default: 5000ms)
   * @returns SpawnResult with process reference or error
   */
  async spawnWithRetry(
    prompt: string,
    options: ClaudeSpawnOptions = {},
    maxRetries: number = 3,
    retryDelay: number = 5000
  ): Promise<SpawnResult> {
    let lastError: SpawnResult['error'];
    let attempt = 0;

    while (attempt <= maxRetries) {
      const result = this.spawnAgent(prompt, options);

      // Success case
      if (result.success) {
        return result;
      }

      // Store error
      lastError = result.error;

      // Check if error is permanent (don't retry)
      if (lastError && isPermanentError(lastError.code)) {
        return result;
      }

      // Check if error is transient (retry)
      if (lastError && isTransientError(lastError.code)) {
        attempt++;
        if (attempt <= maxRetries) {
          // Exponential backoff: delay * 2^(attempt-1)
          const currentDelay = retryDelay * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, currentDelay));
          continue;
        } else {
          // Max retries exceeded for transient error
          break;
        }
      }

      // Non-transient, non-permanent error (don't retry)
      return result;
    }

    // Max retries exceeded
    return {
      success: false,
      error: {
        code: lastError?.code || 'UNKNOWN',
        message: `Spawn failed after ${maxRetries} retries: ${lastError?.message || 'Unknown error'}`,
        details: lastError?.details,
      },
    };
  }
}
