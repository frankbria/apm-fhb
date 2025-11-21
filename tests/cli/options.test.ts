import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  parseScope,
  parseScopes,
  resolvePath,
  validatePositiveNumber,
  validateEnum,
  getConfigPath,
  isVerboseEnabled,
  normalizeBoolean,
  ValidationError,
} from '../../src/cli/options.js';

describe('CLI Options utilities', () => {
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    Object.assign(process.env, originalEnv);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-options-'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseScope', () => {
    it('parses phase ranges into enumerated values', () => {
      const result = parseScope('phase:2-4');
      expect(result).toEqual({ type: 'phase', values: ['2', '3', '4'], raw: 'phase:2-4' });
    });

    it('parses task lists and trims whitespace', () => {
      const result = parseScope('task:1.1, 1.2 ,2.3');
      expect(result.values).toEqual(['1.1', '1.2', '2.3']);
      expect(result.type).toBe('task');
    });

    it('throws for invalid formats with helpful suggestion', () => {
      let error: ValidationError | null = null;
      try {
        parseScope('invalid-scope');
      } catch (err) {
        error = err as ValidationError;
      }

      expect(error).toBeInstanceOf(ValidationError);
      expect(error?.message).toContain('Invalid scope format');
      expect(error?.suggestion).toContain('Use format like');
    });

    it('throws when range start exceeds end', () => {
      expect(() => parseScope('phase:3-1')).toThrowError(/start \(3\) is greater than end/);
    });
  });

  it('parses multiple scopes with parseScopes', () => {
    const result = parseScopes(['phase:1-2', 'agent:Manager*']);
    expect(result).toHaveLength(2);
    expect(result[0].values).toEqual(['1', '2']);
    expect(result[1].type).toBe('agent');
  });

  describe('resolvePath', () => {
    it('returns absolute path even when not existing', () => {
      const target = path.join(tempDir, 'config.yml');
      const resolved = resolvePath(target, false);
      expect(resolved).toBe(path.resolve(target));
    });

    it('validates existence when required', () => {
      const missing = path.join(tempDir, 'missing.yml');
      expect(() => resolvePath(missing, true)).toThrowError(/Path does not exist/);
    });

    it('accepts existing files when mustExist is true', () => {
      const existing = path.join(tempDir, 'existing.yml');
      fs.writeFileSync(existing, 'test');
      expect(resolvePath(existing, true)).toBe(path.resolve(existing));
    });
  });

  describe('validation helpers', () => {
    it('validates positive numbers from strings and numbers', () => {
      expect(validatePositiveNumber('3.5', 'timeout')).toBeCloseTo(3.5);
      expect(validatePositiveNumber(7, 'retry')).toBe(7);
    });

    it('rejects non-positive values with descriptive errors', () => {
      expect(() => validatePositiveNumber(0, 'timeout')).toThrowError(/positive number/);
      expect(() => validatePositiveNumber('bad', 'timeout')).toThrowError(/positive number/);
    });

    it('validates enums case-insensitively', () => {
      const level = validateEnum('INFO', 'level', ['error', 'warn', 'info'] as const);
      expect(level).toBe('info');

      try {
        validateEnum('verbose', 'level', ['error', 'warn'] as const);
        expect.unreachable('validateEnum should throw for invalid value');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).suggestion).toContain('Use one of: error, warn');
      }
    });
  });

  describe('config and verbosity helpers', () => {
    it('derives config path from option, env, and default', () => {
      const explicit = getConfigPath(path.join(tempDir, 'explicit.yml'));
      expect(explicit).toContain('explicit.yml');

      process.env.APM_AUTO_CONFIG_PATH = path.join(tempDir, 'env.yml');
      expect(getConfigPath()).toContain('env.yml');

      delete process.env.APM_AUTO_CONFIG_PATH;
      const cwdDefault = path.join(process.cwd(), '.apm', 'config.yaml');
      expect(getConfigPath()).toBe(path.resolve(cwdDefault));
    });

    it('checks verbose flag and environment override', () => {
      expect(isVerboseEnabled(true)).toBe(true);
      process.env.APM_AUTO_VERBOSE = '1';
      expect(isVerboseEnabled(undefined)).toBe(true);
      process.env.APM_AUTO_VERBOSE = 'false';
      expect(isVerboseEnabled(undefined)).toBe(false);
    });

    it('normalizes boolean-like values', () => {
      expect(normalizeBoolean('true')).toBe(true);
      expect(normalizeBoolean('1')).toBe(true);
      expect(normalizeBoolean('yes')).toBe(true);
      expect(normalizeBoolean('no')).toBe(false);
      expect(normalizeBoolean(false)).toBe(false);
    });
  });
});
