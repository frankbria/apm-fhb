/**
 * Error Handler Tests
 * Tests for structured error handling and actionable guidance
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SpawnErrorHandler,
  SpawnErrorCode,
  ErrorCategory,
  createSpawnErrorHandler,
  type ErrorContext,
} from '../../src/spawn/error-handler.js';

describe('SpawnErrorHandler', () => {
  let handler: SpawnErrorHandler;

  beforeEach(() => {
    handler = createSpawnErrorHandler();
  });

  describe('createErrorContext()', () => {
    it('should create error context for CLI_NOT_FOUND', () => {
      const context = handler.createErrorContext(SpawnErrorCode.CLI_NOT_FOUND);

      expect(context.code).toBe(SpawnErrorCode.CLI_NOT_FOUND);
      expect(context.message).toBe('Claude CLI not found in system PATH');
      expect(context.category).toBe(ErrorCategory.Permanent);
      expect(context.retryable).toBe(false);
      expect(context.guidance).toContain('Install Claude CLI');
    });

    it('should create error context for SPAWN_TIMEOUT', () => {
      const context = handler.createErrorContext(SpawnErrorCode.SPAWN_TIMEOUT);

      expect(context.code).toBe(SpawnErrorCode.SPAWN_TIMEOUT);
      expect(context.message).toBe('Process spawn timeout');
      expect(context.category).toBe(ErrorCategory.Transient);
      expect(context.retryable).toBe(true);
      expect(context.guidance).toContain('Retry with increased timeout');
    });

    it('should include additional details', () => {
      const details = { path: '/usr/bin/claude', pid: 12345 };
      const context = handler.createErrorContext(
        SpawnErrorCode.SPAWN_FAILED,
        details
      );

      expect(context.details).toEqual(details);
    });

    it('should create error context for all error codes', () => {
      const codes = Object.values(SpawnErrorCode);

      for (const code of codes) {
        const context = handler.createErrorContext(code);

        expect(context.code).toBe(code);
        expect(context.message).toBeTruthy();
        expect(context.category).toBeTruthy();
        expect(context.guidance).toBeTruthy();
        expect(typeof context.retryable).toBe('boolean');
      }
    });
  });

  describe('createErrorContextFromError()', () => {
    it('should map ENOENT error to CLI_NOT_FOUND', () => {
      const error = new Error('spawn claude ENOENT');
      const context = handler.createErrorContextFromError(error);

      expect(context.code).toBe(SpawnErrorCode.CLI_NOT_FOUND);
      expect(context.details?.originalError).toBe(error.message);
    });

    it('should map EACCES error to PERMISSION_DENIED', () => {
      const error = new Error('spawn EACCES');
      const context = handler.createErrorContextFromError(error);

      expect(context.code).toBe(SpawnErrorCode.PERMISSION_DENIED);
    });

    it('should map EMFILE error to TOO_MANY_FILES', () => {
      const error = new Error('spawn EMFILE: too many open files');
      const context = handler.createErrorContextFromError(error);

      expect(context.code).toBe(SpawnErrorCode.TOO_MANY_FILES);
    });

    it('should map EAGAIN error to RESOURCE_UNAVAILABLE', () => {
      const error = new Error('spawn EAGAIN');
      const context = handler.createErrorContextFromError(error);

      expect(context.code).toBe(SpawnErrorCode.RESOURCE_UNAVAILABLE);
    });

    it('should map timeout error to SPAWN_TIMEOUT', () => {
      const error = new Error('Process spawn timeout exceeded');
      const context = handler.createErrorContextFromError(error);

      expect(context.code).toBe(SpawnErrorCode.SPAWN_TIMEOUT);
    });

    it('should map database error to DATABASE_ERROR', () => {
      const error = new Error('database connection failed');
      const context = handler.createErrorContextFromError(error);

      expect(context.code).toBe(SpawnErrorCode.DATABASE_ERROR);
    });

    it('should map template error to TEMPLATE_NOT_FOUND', () => {
      const error = new Error('Template not found: test-template');
      const context = handler.createErrorContextFromError(error);

      expect(context.code).toBe(SpawnErrorCode.TEMPLATE_NOT_FOUND);
    });

    it('should map unknown error to UNKNOWN_ERROR', () => {
      const error = new Error('Something unexpected happened');
      const context = handler.createErrorContextFromError(error);

      expect(context.code).toBe(SpawnErrorCode.UNKNOWN_ERROR);
    });

    it('should include additional details', () => {
      const error = new Error('test error');
      const details = { agentId: 'agent_001' };
      const context = handler.createErrorContextFromError(error, details);

      expect(context.details?.originalError).toBe(error.message);
      expect(context.details?.agentId).toBe('agent_001');
    });
  });

  describe('Error Categories', () => {
    it('should classify permanent errors correctly', () => {
      const permanentCodes = [
        SpawnErrorCode.CLI_NOT_FOUND,
        SpawnErrorCode.CLI_NOT_EXECUTABLE,
        SpawnErrorCode.CLI_VERSION_INCOMPATIBLE,
        SpawnErrorCode.SPAWN_FAILED,
        SpawnErrorCode.PERMISSION_DENIED,
        SpawnErrorCode.TEMPLATE_NOT_FOUND,
        SpawnErrorCode.TEMPLATE_INVALID,
        SpawnErrorCode.TEMPLATE_MISSING_VARS,
        SpawnErrorCode.TEMPLATE_RENDER_FAILED,
        SpawnErrorCode.PROCESS_KILLED,
      ];

      for (const code of permanentCodes) {
        const context = handler.createErrorContext(code);
        expect(context.category).toBe(ErrorCategory.Permanent);
        expect(context.retryable).toBe(false);
      }
    });

    it('should classify transient errors correctly', () => {
      const transientCodes = [
        SpawnErrorCode.SPAWN_TIMEOUT,
        SpawnErrorCode.TOO_MANY_FILES,
        SpawnErrorCode.RESOURCE_UNAVAILABLE,
        SpawnErrorCode.DATABASE_ERROR,
        SpawnErrorCode.DATABASE_RECORD_FAILED,
        SpawnErrorCode.DATABASE_UPDATE_FAILED,
      ];

      for (const code of transientCodes) {
        const context = handler.createErrorContext(code);
        expect(context.category).toBe(ErrorCategory.Transient);
        expect(context.retryable).toBe(true);
      }
    });

    it('should classify unknown category errors correctly', () => {
      const unknownCodes = [
        SpawnErrorCode.PROCESS_CRASHED,
        SpawnErrorCode.PROCESS_ERROR_EXIT,
        SpawnErrorCode.UNKNOWN_ERROR,
      ];

      for (const code of unknownCodes) {
        const context = handler.createErrorContext(code);
        expect(context.category).toBe(ErrorCategory.Unknown);
      }
    });
  });

  describe('Actionable Guidance', () => {
    it('should provide CLI installation guidance for CLI_NOT_FOUND', () => {
      const context = handler.createErrorContext(SpawnErrorCode.CLI_NOT_FOUND);

      expect(context.guidance).toContain('Install Claude CLI');
      expect(context.guidance).toContain('claude --version');
    });

    it('should provide permission guidance for CLI_NOT_EXECUTABLE', () => {
      const context = handler.createErrorContext(
        SpawnErrorCode.CLI_NOT_EXECUTABLE
      );

      expect(context.guidance).toContain('execute permissions');
      expect(context.guidance).toContain('chmod +x');
    });

    it('should provide resource guidance for TOO_MANY_FILES', () => {
      const context = handler.createErrorContext(
        SpawnErrorCode.TOO_MANY_FILES
      );

      expect(context.guidance).toContain('file descriptor');
      expect(context.guidance).toContain('Retry');
    });

    it('should provide template guidance for TEMPLATE_NOT_FOUND', () => {
      const context = handler.createErrorContext(
        SpawnErrorCode.TEMPLATE_NOT_FOUND
      );

      expect(context.guidance).toContain('template ID');
      expect(context.guidance).toContain('templates directory');
    });

    it('should provide database guidance for DATABASE_ERROR', () => {
      const context = handler.createErrorContext(
        SpawnErrorCode.DATABASE_ERROR
      );

      expect(context.guidance).toContain('database');
      expect(context.guidance).toContain('retry');
    });
  });

  describe('formatError()', () => {
    it('should format error context with all fields', () => {
      const context: ErrorContext = {
        code: SpawnErrorCode.CLI_NOT_FOUND,
        message: 'Claude CLI not found',
        category: ErrorCategory.Permanent,
        retryable: false,
        guidance: 'Install Claude CLI',
      };

      const formatted = handler.formatError(context);

      expect(formatted).toContain('[SPAWN_E001]');
      expect(formatted).toContain('Claude CLI not found');
      expect(formatted).toContain('Category: permanent');
      expect(formatted).toContain('Retryable: No');
      expect(formatted).toContain('Guidance: Install Claude CLI');
    });

    it('should include details in formatted output', () => {
      const context: ErrorContext = {
        code: SpawnErrorCode.SPAWN_FAILED,
        message: 'Failed to spawn',
        category: ErrorCategory.Permanent,
        retryable: false,
        guidance: 'Check resources',
        details: {
          path: '/usr/bin/claude',
          pid: 12345,
        },
      };

      const formatted = handler.formatError(context);

      expect(formatted).toContain('Details:');
      expect(formatted).toContain('/usr/bin/claude');
      expect(formatted).toContain('12345');
    });

    it('should format retryable error correctly', () => {
      const context: ErrorContext = {
        code: SpawnErrorCode.SPAWN_TIMEOUT,
        message: 'Timeout',
        category: ErrorCategory.Transient,
        retryable: true,
        guidance: 'Retry',
      };

      const formatted = handler.formatError(context);

      expect(formatted).toContain('Retryable: Yes');
    });
  });

  describe('isRetryable()', () => {
    it('should return false for permanent errors', () => {
      expect(handler.isRetryable(SpawnErrorCode.CLI_NOT_FOUND)).toBe(false);
      expect(handler.isRetryable(SpawnErrorCode.PERMISSION_DENIED)).toBe(false);
      expect(handler.isRetryable(SpawnErrorCode.TEMPLATE_NOT_FOUND)).toBe(
        false
      );
    });

    it('should return true for transient errors', () => {
      expect(handler.isRetryable(SpawnErrorCode.SPAWN_TIMEOUT)).toBe(true);
      expect(handler.isRetryable(SpawnErrorCode.TOO_MANY_FILES)).toBe(true);
      expect(handler.isRetryable(SpawnErrorCode.DATABASE_ERROR)).toBe(true);
    });

    it('should return true for unknown errors', () => {
      expect(handler.isRetryable(SpawnErrorCode.PROCESS_CRASHED)).toBe(true);
      expect(handler.isRetryable(SpawnErrorCode.UNKNOWN_ERROR)).toBe(true);
    });
  });

  describe('getCategory()', () => {
    it('should return correct category for each error code', () => {
      expect(handler.getCategory(SpawnErrorCode.CLI_NOT_FOUND)).toBe(
        ErrorCategory.Permanent
      );
      expect(handler.getCategory(SpawnErrorCode.SPAWN_TIMEOUT)).toBe(
        ErrorCategory.Transient
      );
      expect(handler.getCategory(SpawnErrorCode.PROCESS_CRASHED)).toBe(
        ErrorCategory.Unknown
      );
    });
  });

  describe('Error Code Format', () => {
    it('should follow SPAWN_E### format', () => {
      const codes = Object.values(SpawnErrorCode);

      for (const code of codes) {
        expect(code).toMatch(/^SPAWN_E\d{3}$/);
      }
    });

    it('should have unique error codes', () => {
      const codes = Object.values(SpawnErrorCode);
      const uniqueCodes = new Set(codes);

      expect(uniqueCodes.size).toBe(codes.length);
    });
  });

  describe('createSpawnErrorHandler()', () => {
    it('should create SpawnErrorHandler instance', () => {
      const handler = createSpawnErrorHandler();
      expect(handler).toBeInstanceOf(SpawnErrorHandler);
    });
  });
});
