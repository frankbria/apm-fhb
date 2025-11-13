/**
 * Error Handler for Agent Spawning
 *
 * Provides structured error codes, actionable guidance, and retry recommendations
 * for agent spawning operations.
 */

/**
 * Spawn error codes following SPAWN_E### format
 */
export enum SpawnErrorCode {
  /** Claude CLI not found in system PATH */
  CLI_NOT_FOUND = 'SPAWN_E001',
  /** Claude CLI found but not executable */
  CLI_NOT_EXECUTABLE = 'SPAWN_E002',
  /** Claude CLI version incompatible */
  CLI_VERSION_INCOMPATIBLE = 'SPAWN_E003',

  /** Failed to spawn process (ENOENT) */
  SPAWN_FAILED = 'SPAWN_E010',
  /** Process spawn timeout */
  SPAWN_TIMEOUT = 'SPAWN_E011',
  /** Too many open files (EMFILE) */
  TOO_MANY_FILES = 'SPAWN_E012',
  /** Resource temporarily unavailable (EAGAIN) */
  RESOURCE_UNAVAILABLE = 'SPAWN_E013',
  /** Permission denied (EACCES) */
  PERMISSION_DENIED = 'SPAWN_E014',

  /** Template not found */
  TEMPLATE_NOT_FOUND = 'SPAWN_E020',
  /** Template validation failed */
  TEMPLATE_INVALID = 'SPAWN_E021',
  /** Missing required template variables */
  TEMPLATE_MISSING_VARS = 'SPAWN_E022',
  /** Template rendering failed */
  TEMPLATE_RENDER_FAILED = 'SPAWN_E023',

  /** Process crashed after spawn */
  PROCESS_CRASHED = 'SPAWN_E030',
  /** Process killed by signal */
  PROCESS_KILLED = 'SPAWN_E031',
  /** Process exit with non-zero code */
  PROCESS_ERROR_EXIT = 'SPAWN_E032',

  /** Database connection failed */
  DATABASE_ERROR = 'SPAWN_E040',
  /** Failed to record spawn to database */
  DATABASE_RECORD_FAILED = 'SPAWN_E041',
  /** Failed to update agent state */
  DATABASE_UPDATE_FAILED = 'SPAWN_E042',

  /** Unknown/unexpected error */
  UNKNOWN_ERROR = 'SPAWN_E999',
}

/**
 * Error category for retry logic
 */
export enum ErrorCategory {
  /** Permanent errors that won't resolve with retry */
  Permanent = 'permanent',
  /** Transient errors that may resolve with retry */
  Transient = 'transient',
  /** Unknown error category */
  Unknown = 'unknown',
}

/**
 * Error context for detailed guidance
 */
export interface ErrorContext {
  /** Error code */
  code: SpawnErrorCode;
  /** Human-readable error message */
  message: string;
  /** Error category (permanent/transient) */
  category: ErrorCategory;
  /** Whether retry is recommended */
  retryable: boolean;
  /** Actionable guidance for resolution */
  guidance: string;
  /** Additional context data */
  details?: Record<string, unknown>;
}

/**
 * Spawn Error Handler
 * Provides structured error handling with actionable guidance
 */
export class SpawnErrorHandler {
  /**
   * Create error context from error code
   */
  createErrorContext(
    code: SpawnErrorCode,
    details?: Record<string, unknown>
  ): ErrorContext {
    const { message, category, retryable, guidance } = this.getErrorInfo(code);

    return {
      code,
      message,
      category,
      retryable,
      guidance,
      details,
    };
  }

  /**
   * Create error context from Error object
   */
  createErrorContextFromError(
    error: Error,
    details?: Record<string, unknown>
  ): ErrorContext {
    const code = this.mapErrorToCode(error);
    return this.createErrorContext(code, {
      ...details,
      originalError: error.message,
    });
  }

  /**
   * Map Node.js error to SpawnErrorCode
   */
  private mapErrorToCode(error: Error): SpawnErrorCode {
    const message = error.message.toLowerCase();

    // ENOENT - Command not found
    if (message.includes('enoent')) {
      return SpawnErrorCode.CLI_NOT_FOUND;
    }

    // EACCES - Permission denied
    if (message.includes('eacces')) {
      return SpawnErrorCode.PERMISSION_DENIED;
    }

    // EMFILE - Too many open files
    if (message.includes('emfile')) {
      return SpawnErrorCode.TOO_MANY_FILES;
    }

    // EAGAIN - Resource temporarily unavailable
    if (message.includes('eagain')) {
      return SpawnErrorCode.RESOURCE_UNAVAILABLE;
    }

    // Timeout
    if (message.includes('timeout')) {
      return SpawnErrorCode.SPAWN_TIMEOUT;
    }

    // Database errors
    if (message.includes('database') || message.includes('sqlite')) {
      return SpawnErrorCode.DATABASE_ERROR;
    }

    // Template errors
    if (message.includes('template')) {
      return SpawnErrorCode.TEMPLATE_NOT_FOUND;
    }

    return SpawnErrorCode.UNKNOWN_ERROR;
  }

  /**
   * Get error information for a given code
   */
  private getErrorInfo(code: SpawnErrorCode): {
    message: string;
    category: ErrorCategory;
    retryable: boolean;
    guidance: string;
  } {
    switch (code) {
      case SpawnErrorCode.CLI_NOT_FOUND:
        return {
          message: 'Claude CLI not found in system PATH',
          category: ErrorCategory.Permanent,
          retryable: false,
          guidance:
            'Install Claude CLI following the official installation guide. Verify installation with: claude --version',
        };

      case SpawnErrorCode.CLI_NOT_EXECUTABLE:
        return {
          message: 'Claude CLI found but not executable',
          category: ErrorCategory.Permanent,
          retryable: false,
          guidance:
            'Ensure Claude CLI has execute permissions. Run: chmod +x $(which claude)',
        };

      case SpawnErrorCode.CLI_VERSION_INCOMPATIBLE:
        return {
          message: 'Claude CLI version incompatible',
          category: ErrorCategory.Permanent,
          retryable: false,
          guidance:
            'Update Claude CLI to the latest version. Current version may not support required features.',
        };

      case SpawnErrorCode.SPAWN_FAILED:
        return {
          message: 'Failed to spawn process',
          category: ErrorCategory.Permanent,
          retryable: false,
          guidance:
            'Check system resources and verify Claude CLI is properly installed.',
        };

      case SpawnErrorCode.SPAWN_TIMEOUT:
        return {
          message: 'Process spawn timeout',
          category: ErrorCategory.Transient,
          retryable: true,
          guidance:
            'System may be under load. Retry with increased timeout or check system resources.',
        };

      case SpawnErrorCode.TOO_MANY_FILES:
        return {
          message: 'Too many open files (EMFILE)',
          category: ErrorCategory.Transient,
          retryable: true,
          guidance:
            'Close unused file descriptors or increase system file descriptor limit. Retry after a brief delay.',
        };

      case SpawnErrorCode.RESOURCE_UNAVAILABLE:
        return {
          message: 'Resource temporarily unavailable (EAGAIN)',
          category: ErrorCategory.Transient,
          retryable: true,
          guidance:
            'System resources temporarily exhausted. Retry with exponential backoff.',
        };

      case SpawnErrorCode.PERMISSION_DENIED:
        return {
          message: 'Permission denied (EACCES)',
          category: ErrorCategory.Permanent,
          retryable: false,
          guidance:
            'Check file/directory permissions. User may lack required permissions to execute Claude CLI.',
        };

      case SpawnErrorCode.TEMPLATE_NOT_FOUND:
        return {
          message: 'Template not found',
          category: ErrorCategory.Permanent,
          retryable: false,
          guidance:
            'Verify template ID and ensure template files exist in templates directory.',
        };

      case SpawnErrorCode.TEMPLATE_INVALID:
        return {
          message: 'Template validation failed',
          category: ErrorCategory.Permanent,
          retryable: false,
          guidance:
            'Check template file format. Ensure YAML frontmatter is valid and required fields are present.',
        };

      case SpawnErrorCode.TEMPLATE_MISSING_VARS:
        return {
          message: 'Missing required template variables',
          category: ErrorCategory.Permanent,
          retryable: false,
          guidance:
            'Provide all required variables in TaskContext. Check template definition for required variables.',
        };

      case SpawnErrorCode.TEMPLATE_RENDER_FAILED:
        return {
          message: 'Template rendering failed',
          category: ErrorCategory.Permanent,
          retryable: false,
          guidance:
            'Check template syntax and variable names. Ensure all placeholders are valid.',
        };

      case SpawnErrorCode.PROCESS_CRASHED:
        return {
          message: 'Process crashed after spawn',
          category: ErrorCategory.Unknown,
          retryable: true,
          guidance:
            'Check process logs for crash details. May be caused by invalid input or system issues.',
        };

      case SpawnErrorCode.PROCESS_KILLED:
        return {
          message: 'Process killed by signal',
          category: ErrorCategory.Permanent,
          retryable: false,
          guidance:
            'Process was terminated externally (SIGTERM/SIGKILL). Check system logs for details.',
        };

      case SpawnErrorCode.PROCESS_ERROR_EXIT:
        return {
          message: 'Process exited with non-zero code',
          category: ErrorCategory.Unknown,
          retryable: true,
          guidance:
            'Check process output for error details. May require fixing input or configuration.',
        };

      case SpawnErrorCode.DATABASE_ERROR:
        return {
          message: 'Database connection failed',
          category: ErrorCategory.Transient,
          retryable: true,
          guidance:
            'Ensure database is accessible. Check connection configuration and retry.',
        };

      case SpawnErrorCode.DATABASE_RECORD_FAILED:
        return {
          message: 'Failed to record spawn to database',
          category: ErrorCategory.Transient,
          retryable: true,
          guidance:
            'Database write failed. Check database health and disk space. Retry operation.',
        };

      case SpawnErrorCode.DATABASE_UPDATE_FAILED:
        return {
          message: 'Failed to update agent state',
          category: ErrorCategory.Transient,
          retryable: true,
          guidance:
            'Database state update failed. Verify agent exists and database is writable.',
        };

      case SpawnErrorCode.UNKNOWN_ERROR:
      default:
        return {
          message: 'Unknown error occurred',
          category: ErrorCategory.Unknown,
          retryable: true,
          guidance:
            'An unexpected error occurred. Check logs for details and retry. If issue persists, report as bug.',
        };
    }
  }

  /**
   * Format error context as user-friendly message
   */
  formatError(context: ErrorContext): string {
    const parts = [
      `[${context.code}] ${context.message}`,
      `Category: ${context.category}`,
      `Retryable: ${context.retryable ? 'Yes' : 'No'}`,
      `\nGuidance: ${context.guidance}`,
    ];

    if (context.details) {
      parts.push(`\nDetails: ${JSON.stringify(context.details, null, 2)}`);
    }

    return parts.join('\n');
  }

  /**
   * Check if error is retryable
   */
  isRetryable(code: SpawnErrorCode): boolean {
    const { retryable } = this.getErrorInfo(code);
    return retryable;
  }

  /**
   * Get error category
   */
  getCategory(code: SpawnErrorCode): ErrorCategory {
    const { category } = this.getErrorInfo(code);
    return category;
  }
}

/**
 * Create a new SpawnErrorHandler instance
 */
export function createSpawnErrorHandler(): SpawnErrorHandler {
  return new SpawnErrorHandler();
}
