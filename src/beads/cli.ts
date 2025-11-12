/**
 * Beads CLI Wrapper Module
 *
 * Provides TypeScript wrapper around beads CLI commands with:
 * - Strongly-typed interfaces for beads JSON output
 * - Async/await command execution with timeout handling
 * - JSON schema validation using zod
 * - Comprehensive error handling
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

/**
 * Beads command execution configuration
 */
export interface BeadsCommandConfig {
  /** Command timeout in milliseconds (default: 10000) */
  timeout?: number;
  /** Current working directory for command execution */
  cwd?: string;
  /** Additional environment variables */
  env?: NodeJS.ProcessEnv;
}

/**
 * Default configuration for beads commands
 */
export const DEFAULT_BEADS_CONFIG: BeadsCommandConfig = {
  timeout: 10000,
  cwd: process.cwd(),
  env: process.env
};

/**
 * Beads issue status enum matching beads CLI output
 */
export enum BeadsStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
  Failed = 'failed',
  Blocked = 'blocked'
}

/**
 * Beads dependency type enum
 */
export enum BeadsDependencyType {
  Required = 'required',
  Optional = 'optional',
  Related = 'related'
}

/**
 * Beads issue interface matching CLI JSON output
 */
export interface BeadsIssue {
  /** Unique issue identifier */
  id: string;
  /** Issue title/summary */
  title: string;
  /** Issue description */
  description?: string;
  /** Current status */
  status: BeadsStatus;
  /** Tags associated with issue */
  tags: string[];
  /** Issue assignee */
  assignee?: string;
  /** Priority level */
  priority?: string;
  /** Creation timestamp */
  created_at?: string;
  /** Last updated timestamp */
  updated_at?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Beads dependency relationship
 */
export interface BeadsDependency {
  /** Source issue ID (dependent) */
  from: string;
  /** Target issue ID (dependency) */
  to: string;
  /** Dependency type */
  type: BeadsDependencyType;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Beads dependency tree node
 */
export interface BeadsDependencyNode {
  /** Issue information */
  issue: BeadsIssue;
  /** Direct dependencies */
  dependencies: BeadsDependencyNode[];
  /** Dependency type from parent */
  dependencyType?: BeadsDependencyType;
}

/**
 * Result of beads ready command
 */
export interface BeadsReadyResult {
  /** List of ready (unblocked) issues */
  ready: BeadsIssue[];
  /** Total count */
  count: number;
}

/**
 * Result of beads list command
 */
export interface BeadsListResult {
  /** List of issues */
  issues: BeadsIssue[];
  /** Total count */
  count: number;
  /** Query filters applied */
  filters?: Record<string, unknown>;
}

/**
 * Zod schema for BeadsIssue validation
 */
const BeadsIssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: z.nativeEnum(BeadsStatus),
  tags: z.array(z.string()),
  assignee: z.string().optional(),
  priority: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

/**
 * Zod schema for BeadsDependency validation
 */
const BeadsDependencySchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.nativeEnum(BeadsDependencyType),
  metadata: z.record(z.string(), z.unknown()).optional()
});

/**
 * Zod schema for BeadsReadyResult validation
 */
const BeadsReadyResultSchema = z.object({
  ready: z.array(BeadsIssueSchema),
  count: z.number()
});

/**
 * Zod schema for BeadsListResult validation
 */
const BeadsListResultSchema = z.object({
  issues: z.array(BeadsIssueSchema),
  count: z.number(),
  filters: z.record(z.string(), z.unknown()).optional()
});

/**
 * Beads CLI error types
 */
export enum BeadsErrorType {
  CommandNotFound = 'COMMAND_NOT_FOUND',
  ExecutionTimeout = 'EXECUTION_TIMEOUT',
  InvalidJSON = 'INVALID_JSON',
  ValidationError = 'VALIDATION_ERROR',
  InvalidIssueId = 'INVALID_ISSUE_ID',
  EmptyResult = 'EMPTY_RESULT',
  UnknownError = 'UNKNOWN_ERROR'
}

/**
 * Beads CLI error class
 */
export class BeadsError extends Error {
  constructor(
    public type: BeadsErrorType,
    message: string,
    public command?: string,
    public stderr?: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'BeadsError';
  }
}

/**
 * Check if beads CLI is available on PATH
 */
export async function isBeadsAvailable(): Promise<boolean> {
  try {
    await execFileAsync('bd', ['--version'], {
      timeout: 5000,
      env: process.env
    });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Execute beads CLI command with error handling
 */
async function executeBeadsCommand(
  args: string[],
  config: BeadsCommandConfig = DEFAULT_BEADS_CONFIG
): Promise<string> {
  const timeout = config.timeout ?? DEFAULT_BEADS_CONFIG.timeout!;
  const cwd = config.cwd ?? DEFAULT_BEADS_CONFIG.cwd!;
  const env = config.env ?? DEFAULT_BEADS_CONFIG.env!;

  try {
    const { stdout, stderr } = await execFileAsync('bd', args, {
      timeout,
      cwd,
      env,
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large outputs
    });

    // Check for stderr warnings (not necessarily errors)
    if (stderr && stderr.trim().length > 0) {
      console.warn(`Beads CLI warning: ${stderr.trim()}`);
    }

    return stdout.trim();
  } catch (error: any) {
    // Handle specific error types
    if (error.code === 'ENOENT') {
      throw new BeadsError(
        BeadsErrorType.CommandNotFound,
        'Beads CLI (bd) not found on PATH. Please ensure beads is installed.',
        `bd ${args.join(' ')}`
      );
    }

    if (error.killed && error.signal === 'SIGTERM') {
      throw new BeadsError(
        BeadsErrorType.ExecutionTimeout,
        `Beads command timed out after ${timeout}ms`,
        `bd ${args.join(' ')}`,
        error.stderr
      );
    }

    // Check for invalid issue ID errors in stderr
    if (error.stderr && error.stderr.includes('not found')) {
      throw new BeadsError(
        BeadsErrorType.InvalidIssueId,
        `Issue not found: ${error.stderr.trim()}`,
        `bd ${args.join(' ')}`,
        error.stderr
      );
    }

    throw new BeadsError(
      BeadsErrorType.UnknownError,
      `Beads command failed: ${error.message}`,
      `bd ${args.join(' ')}`,
      error.stderr,
      error
    );
  }
}

/**
 * Parse and validate JSON response from beads CLI
 */
function parseBeadsJSON<T>(
  output: string,
  schema: z.ZodSchema<T>,
  command: string
): T {
  if (!output || output.trim().length === 0) {
    throw new BeadsError(
      BeadsErrorType.EmptyResult,
      'Beads command returned empty output',
      command
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new BeadsError(
      BeadsErrorType.InvalidJSON,
      `Failed to parse beads JSON output: ${error instanceof Error ? error.message : String(error)}`,
      command,
      undefined,
      error instanceof Error ? error : undefined
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new BeadsError(
      BeadsErrorType.ValidationError,
      `Beads response validation failed: ${result.error.message}`,
      command
    );
  }

  return result.data;
}

/**
 * Get ready (unblocked) tasks from beads
 */
export async function getBeadsReady(
  config: BeadsCommandConfig = DEFAULT_BEADS_CONFIG
): Promise<BeadsReadyResult> {
  const output = await executeBeadsCommand(['ready', '--json'], config);
  return parseBeadsJSON(output, BeadsReadyResultSchema, 'bd ready --json');
}

/**
 * List all issues from beads
 */
export async function getBeadsList(
  filters?: {
    status?: BeadsStatus;
    tag?: string;
    assignee?: string;
  },
  config: BeadsCommandConfig = DEFAULT_BEADS_CONFIG
): Promise<BeadsListResult> {
  const args = ['list', '--json'];

  // Add filter arguments
  if (filters?.status) {
    args.push('--status', filters.status);
  }
  if (filters?.tag) {
    args.push('--tag', filters.tag);
  }
  if (filters?.assignee) {
    args.push('--assignee', filters.assignee);
  }

  const output = await executeBeadsCommand(args, config);
  return parseBeadsJSON(output, BeadsListResultSchema, `bd ${args.join(' ')}`);
}

/**
 * Get issue details by ID
 */
export async function getBeadsShow(
  issueId: string,
  config: BeadsCommandConfig = DEFAULT_BEADS_CONFIG
): Promise<BeadsIssue> {
  if (!issueId || issueId.trim().length === 0) {
    throw new BeadsError(
      BeadsErrorType.InvalidIssueId,
      'Issue ID cannot be empty',
      'bd show'
    );
  }

  const output = await executeBeadsCommand(['show', issueId, '--json'], config);
  return parseBeadsJSON(output, BeadsIssueSchema, `bd show ${issueId} --json`);
}

/**
 * Get dependency tree for an issue
 */
export async function getBeadsDependencyTree(
  issueId: string,
  config: BeadsCommandConfig = DEFAULT_BEADS_CONFIG
): Promise<BeadsDependencyNode> {
  if (!issueId || issueId.trim().length === 0) {
    throw new BeadsError(
      BeadsErrorType.InvalidIssueId,
      'Issue ID cannot be empty',
      'bd dep tree'
    );
  }

  const output = await executeBeadsCommand(['dep', 'tree', issueId, '--json'], config);

  // Define recursive schema for dependency tree
  const BeadsDependencyNodeSchema: z.ZodSchema<BeadsDependencyNode> = z.lazy(() =>
    z.object({
      issue: BeadsIssueSchema,
      dependencies: z.array(BeadsDependencyNodeSchema),
      dependencyType: z.nativeEnum(BeadsDependencyType).optional()
    })
  );

  return parseBeadsJSON(output, BeadsDependencyNodeSchema, `bd dep tree ${issueId} --json`);
}

/**
 * Get flat list of dependencies for an issue
 */
export async function getBeadsDependencies(
  issueId: string,
  config: BeadsCommandConfig = DEFAULT_BEADS_CONFIG
): Promise<BeadsDependency[]> {
  const tree = await getBeadsDependencyTree(issueId, config);

  // Flatten tree to list of dependencies
  const dependencies: BeadsDependency[] = [];

  function traverse(node: BeadsDependencyNode, parentId: string) {
    for (const dep of node.dependencies) {
      dependencies.push({
        from: parentId,
        to: dep.issue.id,
        type: dep.dependencyType ?? BeadsDependencyType.Required,
        metadata: dep.issue.metadata
      });

      // Recursively traverse dependencies
      traverse(dep, dep.issue.id);
    }
  }

  traverse(tree, issueId);

  return dependencies;
}

/**
 * Export all schemas for external validation if needed
 */
export const schemas = {
  BeadsIssueSchema,
  BeadsDependencySchema,
  BeadsReadyResultSchema,
  BeadsListResultSchema
};
