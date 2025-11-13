/**
 * Scope Definition Data Structures and Extraction Logic
 *
 * Converts raw frontmatter into normalized scope definitions for task filtering.
 * Supports phase ranges, task lists, agent filters with wildcards, and tags.
 */

import { RawScopeFrontmatter } from './frontmatter.js';
import { log } from '../cli/logger.js';

/**
 * Phase range (inclusive)
 */
export interface PhaseRange {
  start: number;
  end: number;
}

/**
 * Normalized scope definition ready for task filtering
 */
export class ScopeDefinition {
  phaseRange?: PhaseRange;
  taskList?: string[];
  agentFilters?: string[];
  tags?: string[];

  constructor(data?: {
    phaseRange?: PhaseRange;
    taskList?: string[];
    agentFilters?: string[];
    tags?: string[];
  }) {
    if (data) {
      this.phaseRange = data.phaseRange;
      this.taskList = data.taskList;
      this.agentFilters = data.agentFilters;
      this.tags = data.tags;
    }
  }

  /**
   * Check if scope is empty (no filters defined)
   */
  isEmpty(): boolean {
    return (
      !this.phaseRange &&
      (!this.taskList || this.taskList.length === 0) &&
      (!this.agentFilters || this.agentFilters.length === 0) &&
      (!this.tags || this.tags.length === 0)
    );
  }

  /**
   * Get human-readable scope description
   */
  toString(): string {
    const parts: string[] = [];

    if (this.phaseRange) {
      if (this.phaseRange.start === this.phaseRange.end) {
        parts.push(`Phase ${this.phaseRange.start}`);
      } else {
        parts.push(`Phases ${this.phaseRange.start}-${this.phaseRange.end}`);
      }
    }

    if (this.taskList && this.taskList.length > 0) {
      parts.push(`Tasks [${this.taskList.join(', ')}]`);
    }

    if (this.agentFilters && this.agentFilters.length > 0) {
      parts.push(`Agents matching [${this.agentFilters.join(', ')}]`);
    }

    if (this.tags && this.tags.length > 0) {
      parts.push(`Tags [${this.tags.join(', ')}]`);
    }

    return parts.length > 0 ? parts.join(', ') : 'Empty scope';
  }

  /**
   * Create a union of two scopes (OR logic)
   * Combines all filters from both scopes
   */
  union(other: ScopeDefinition): ScopeDefinition {
    const result = new ScopeDefinition();

    // Union of phase ranges (expand to cover both)
    if (this.phaseRange || other.phaseRange) {
      const start = Math.min(
        this.phaseRange?.start ?? Infinity,
        other.phaseRange?.start ?? Infinity,
      );
      const end = Math.max(
        this.phaseRange?.end ?? -Infinity,
        other.phaseRange?.end ?? -Infinity,
      );
      if (start !== Infinity && end !== -Infinity) {
        result.phaseRange = { start, end };
      }
    }

    // Union of task lists (combine unique tasks)
    const allTasks = [
      ...(this.taskList || []),
      ...(other.taskList || []),
    ];
    if (allTasks.length > 0) {
      result.taskList = [...new Set(allTasks)];
    }

    // Union of agent filters (combine unique filters)
    const allAgents = [
      ...(this.agentFilters || []),
      ...(other.agentFilters || []),
    ];
    if (allAgents.length > 0) {
      result.agentFilters = [...new Set(allAgents)];
    }

    // Union of tags (combine unique tags)
    const allTags = [
      ...(this.tags || []),
      ...(other.tags || []),
    ];
    if (allTags.length > 0) {
      result.tags = [...new Set(allTags)];
    }

    return result;
  }

  /**
   * Create an intersection of two scopes (AND logic)
   * Only includes items that satisfy both scopes
   */
  intersect(other: ScopeDefinition): ScopeDefinition {
    const result = new ScopeDefinition();

    // Intersection of phase ranges (overlap only)
    if (this.phaseRange && other.phaseRange) {
      const start = Math.max(this.phaseRange.start, other.phaseRange.start);
      const end = Math.min(this.phaseRange.end, other.phaseRange.end);
      if (start <= end) {
        result.phaseRange = { start, end };
      }
    }

    // Intersection of task lists (common tasks only)
    if (this.taskList && other.taskList) {
      const commonTasks = this.taskList.filter((t) => other.taskList!.includes(t));
      if (commonTasks.length > 0) {
        result.taskList = commonTasks;
      }
    }

    // Intersection of agent filters (both must match - combine filters)
    if (this.agentFilters || other.agentFilters) {
      const allFilters = [
        ...(this.agentFilters || []),
        ...(other.agentFilters || []),
      ];
      result.agentFilters = allFilters;
    }

    // Intersection of tags (common tags only)
    if (this.tags && other.tags) {
      const commonTags = this.tags.filter((t) => other.tags!.includes(t));
      if (commonTags.length > 0) {
        result.tags = commonTags;
      }
    }

    return result;
  }
}

/**
 * Parse phase string into phase range
 *
 * Supported formats:
 * - Single number: "1" → { start: 1, end: 1 }
 * - Range: "1-3" → { start: 1, end: 3 }
 * - Number: 2 → { start: 2, end: 2 }
 *
 * @param phase - Phase string or number
 * @returns Phase range object
 * @throws Error if format is invalid or range is invalid
 */
export function parsePhaseRange(phase: string | number): PhaseRange {
  // Handle numeric input
  if (typeof phase === 'number') {
    if (!Number.isInteger(phase) || phase <= 0) {
      throw new Error(`Invalid phase number: ${phase} (must be positive integer)`);
    }
    return { start: phase, end: phase };
  }

  // Handle string input
  const trimmed = phase.trim();

  // Check for range format (e.g., "1-3")
  const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);

    if (start <= 0 || end <= 0) {
      throw new Error(`Invalid phase range: ${phase} (phases must be positive)`);
    }

    if (start > end) {
      throw new Error(`Invalid phase range: ${phase} (start ${start} > end ${end})`);
    }

    return { start, end };
  }

  // Check for single number format (e.g., "1")
  const singleMatch = trimmed.match(/^(\d+)$/);
  if (singleMatch) {
    const num = parseInt(singleMatch[1], 10);

    if (num <= 0) {
      throw new Error(`Invalid phase number: ${phase} (must be positive)`);
    }

    return { start: num, end: num };
  }

  throw new Error(`Invalid phase format: "${phase}" (expected "1", "1-3", or number)`);
}

/**
 * Validate and normalize task ID format
 *
 * Expected format: X.Y where X and Y are positive integers
 * Examples: "1.1", "2.3", "10.5"
 *
 * @param taskId - Task ID string
 * @returns Normalized task ID
 * @throws Error if format is invalid
 */
export function normalizeTaskId(taskId: string): string {
  const trimmed = taskId.trim();

  // Validate format: X.Y
  const match = trimmed.match(/^(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid task ID format: "${taskId}" (expected format: X.Y, e.g., "1.1")`);
  }

  const [, phase, task] = match;

  // Validate positive numbers
  if (parseInt(phase, 10) <= 0 || parseInt(task, 10) <= 0) {
    throw new Error(`Invalid task ID: "${taskId}" (phase and task numbers must be positive)`);
  }

  return trimmed;
}

/**
 * Normalize agent filter to array format
 *
 * Converts single string to array and preserves wildcards.
 * Examples:
 * - "Orchestration*" → ["Orchestration*"]
 * - ["Agent1", "Agent2"] → ["Agent1", "Agent2"]
 *
 * @param agents - Agent filter string or array
 * @returns Normalized agent filter array
 */
export function normalizeAgentFilters(agents: string | string[]): string[] {
  if (typeof agents === 'string') {
    return [agents.trim()];
  }

  if (Array.isArray(agents)) {
    return agents.map((a) => a.trim()).filter((a) => a.length > 0);
  }

  return [];
}

/**
 * Match agent name against filter pattern
 *
 * Supports wildcard patterns:
 * - Prefix: "Orchestration*" matches "Orchestration_Foundation", "Orchestration_CLI"
 * - Suffix: "*_CLI" matches "Orchestration_CLI", "Manager_CLI"
 * - Contains: "*Orchestration*" matches "Agent_Orchestration_Foundation"
 * - Exact: "Agent_Foundation" matches only "Agent_Foundation"
 *
 * @param agentName - Agent name to test
 * @param pattern - Filter pattern (supports * wildcard)
 * @returns True if agent matches pattern
 */
export function matchesAgentPattern(agentName: string, pattern: string): boolean {
  // Exact match (no wildcards)
  if (!pattern.includes('*')) {
    return agentName === pattern;
  }

  // Convert wildcard pattern to regex
  // Escape special regex characters except *
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // Replace * with regex .*
  const regexPattern = '^' + escaped.replace(/\*/g, '.*') + '$';
  const regex = new RegExp(regexPattern);

  return regex.test(agentName);
}

/**
 * Extract scope definition from raw frontmatter
 *
 * Converts raw frontmatter fields into normalized ScopeDefinition with validation.
 *
 * @param frontmatter - Raw frontmatter scope fields
 * @returns Normalized scope definition
 * @throws Error if validation fails
 */
export function extractScopeDefinition(frontmatter: RawScopeFrontmatter): ScopeDefinition {
  const scope = new ScopeDefinition();
  const errors: string[] = [];

  // Parse phase range
  if (frontmatter.phase !== undefined) {
    try {
      scope.phaseRange = parsePhaseRange(frontmatter.phase);
      log.debug(`Parsed phase range: ${scope.phaseRange.start}-${scope.phaseRange.end}`);
    } catch (error) {
      if (error instanceof Error) {
        errors.push(error.message);
      }
    }
  }

  // Normalize task list
  if (frontmatter.tasks !== undefined) {
    try {
      scope.taskList = frontmatter.tasks.map(normalizeTaskId);
      log.debug(`Normalized task list: ${scope.taskList.join(', ')}`);
    } catch (error) {
      if (error instanceof Error) {
        errors.push(error.message);
      }
    }
  }

  // Normalize agent filters
  if (frontmatter.agents !== undefined) {
    scope.agentFilters = normalizeAgentFilters(frontmatter.agents);
    log.debug(`Normalized agent filters: ${scope.agentFilters.join(', ')}`);
  }

  // Normalize tags
  if (frontmatter.tags !== undefined) {
    if (Array.isArray(frontmatter.tags)) {
      scope.tags = frontmatter.tags.map((t) => t.trim()).filter((t) => t.length > 0);
      log.debug(`Normalized tags: ${scope.tags.join(', ')}`);
    }
  }

  // Throw if any validation errors occurred
  if (errors.length > 0) {
    throw new Error(
      `Scope extraction failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }

  return scope;
}

/**
 * Get human-readable scope summary
 *
 * Generates descriptive text for user confirmation before execution.
 *
 * @param scope - Scope definition
 * @returns Human-readable summary string
 */
export function getScopeSummary(scope: ScopeDefinition): string {
  if (scope.isEmpty()) {
    return 'No scope filters defined (will process all tasks)';
  }

  return scope.toString();
}
