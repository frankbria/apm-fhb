/**
 * Option Parsing and Validation Framework
 *
 * Provides utilities for parsing, validating, and normalizing CLI options.
 * Supports:
 * - Scope definitions (phase:1-3, task:1.1,1.2, agent:Orchestration*)
 * - Path resolution and validation
 * - Type coercion and normalization
 * - Environment variable overrides
 */

import path from 'path';
import fs from 'fs-extra';

/**
 * Scope types supported by the CLI
 */
export type ScopeType = 'phase' | 'task' | 'agent';

/**
 * Parsed scope definition
 */
export interface ParsedScope {
  type: ScopeType;
  values: string[];
  raw: string;
}

/**
 * Validation error with helpful message
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Parse scope definition from string
 *
 * Supported formats:
 * - phase:1-3 (range)
 * - phase:1,2,3 (list)
 * - task:1.1,1.2,2.3 (list with dots)
 * - agent:Orchestration* (pattern)
 *
 * @param scope - Scope string to parse
 * @returns Parsed scope object
 * @throws ValidationError if format is invalid
 */
export function parseScope(scope: string): ParsedScope {
  const match = scope.match(/^(phase|task|agent):(.+)$/);

  if (!match) {
    throw new ValidationError(
      `Invalid scope format: "${scope}"`,
      'scope',
      scope,
      'Use format like "phase:1-3", "task:1.1,1.2", or "agent:Manager*"',
    );
  }

  const [, typeStr, valueStr] = match;
  const type = typeStr as ScopeType;
  let values: string[];

  // Parse range format (e.g., "1-3")
  const rangeMatch = valueStr.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const [, start, end] = rangeMatch;
    const startNum = parseInt(start, 10);
    const endNum = parseInt(end, 10);

    if (startNum > endNum) {
      throw new ValidationError(
        `Invalid range: start (${start}) is greater than end (${end})`,
        'scope',
        scope,
        `Use format like "phase:1-3" where start <= end`,
      );
    }

    values = [];
    for (let i = startNum; i <= endNum; i++) {
      values.push(i.toString());
    }
  } else {
    // Parse comma-separated list or pattern
    values = valueStr.split(',').map((v) => v.trim());
  }

  if (values.length === 0) {
    throw new ValidationError(
      `Empty scope values: "${scope}"`,
      'scope',
      scope,
      'Provide at least one value',
    );
  }

  return { type, values, raw: scope };
}

/**
 * Parse multiple scope definitions
 *
 * @param scopes - Array of scope strings
 * @returns Array of parsed scopes
 */
export function parseScopes(scopes: string[]): ParsedScope[] {
  return scopes.map(parseScope);
}

/**
 * Resolve and validate a file path
 *
 * @param filePath - Path to resolve (can be relative or absolute)
 * @param mustExist - Whether the path must exist
 * @returns Absolute path
 * @throws ValidationError if path is invalid or doesn't exist when required
 */
export function resolvePath(filePath: string, mustExist = false): string {
  // Normalize and resolve to absolute path
  const resolved = path.resolve(filePath.trim());

  if (mustExist && !fs.existsSync(resolved)) {
    throw new ValidationError(
      `Path does not exist: "${filePath}"`,
      'path',
      filePath,
      'Provide a valid file path',
    );
  }

  return resolved;
}

/**
 * Validate a positive number
 *
 * @param value - Value to validate
 * @param field - Field name for error messages
 * @returns Validated number
 * @throws ValidationError if not a positive number
 */
export function validatePositiveNumber(value: unknown, field: string): number {
  const num = typeof value === 'string' ? parseFloat(value) : Number(value);

  if (isNaN(num) || num <= 0) {
    throw new ValidationError(
      `${field} must be a positive number, got: "${value}"`,
      field,
      value,
      'Provide a positive number like 1, 2.5, etc.',
    );
  }

  return num;
}

/**
 * Validate enum value
 *
 * @param value - Value to validate
 * @param field - Field name for error messages
 * @param allowedValues - Array of allowed values
 * @returns Validated value
 * @throws ValidationError if not in allowed values
 */
export function validateEnum<T extends string>(
  value: unknown,
  field: string,
  allowedValues: readonly T[],
): T {
  const strValue = String(value).toLowerCase();
  const found = allowedValues.find((v) => v.toLowerCase() === strValue);

  if (!found) {
    throw new ValidationError(
      `Invalid ${field}: "${value}"`,
      field,
      value,
      `Use one of: ${allowedValues.join(', ')}`,
    );
  }

  return found;
}

/**
 * Get configuration file path from options or environment
 *
 * Priority:
 * 1. --config flag
 * 2. APM_AUTO_CONFIG_PATH environment variable
 * 3. Default: .apm/config.yaml
 *
 * @param configOption - Config path from CLI option
 * @returns Resolved config path
 */
export function getConfigPath(configOption?: string): string {
  const configPath =
    configOption ||
    process.env.APM_AUTO_CONFIG_PATH ||
    path.join(process.cwd(), '.apm', 'config.yaml');

  return resolvePath(configPath, false);
}

/**
 * Check if verbose mode is enabled
 *
 * Checks both --verbose flag and APM_AUTO_VERBOSE environment variable
 *
 * @param verboseFlag - Verbose flag from CLI option
 * @returns Whether verbose mode is enabled
 */
export function isVerboseEnabled(verboseFlag?: boolean): boolean {
  if (verboseFlag !== undefined) {
    return verboseFlag;
  }

  const envVerbose = process.env.APM_AUTO_VERBOSE;
  return envVerbose === 'true' || envVerbose === '1';
}

/**
 * Normalize boolean value from various input formats
 *
 * @param value - Value to normalize
 * @returns Boolean value
 */
export function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  const strValue = String(value).toLowerCase().trim();
  return strValue === 'true' || strValue === '1' || strValue === 'yes';
}
