/**
 * YAML Frontmatter Parser for Implementation Plans
 *
 * Extracts scope definition from YAML frontmatter in markdown documents.
 * Supports phase ranges, task lists, agent filters, and custom tags.
 */

import matter from 'gray-matter';
import { log } from '../cli/logger.js';

/**
 * Raw frontmatter scope fields as parsed from YAML
 */
export interface RawScopeFrontmatter {
  phase?: string | number;
  tasks?: string[];
  agents?: string | string[];
  tags?: string[];
  [key: string]: unknown; // Allow additional fields
}

/**
 * Parsed frontmatter result
 */
export interface ParsedFrontmatter {
  scope: RawScopeFrontmatter | null;
  content: string;
  isEmpty: boolean;
  hasErrors: boolean;
  errors: string[];
}

/**
 * Parse YAML frontmatter from markdown content
 *
 * Extracts scope definition fields (phase, tasks, agents, tags) from YAML frontmatter.
 * Handles various edge cases gracefully with descriptive error messages.
 *
 * @param markdownContent - Markdown document with optional YAML frontmatter
 * @returns Parsed frontmatter with scope data or null if no frontmatter
 * @throws Error if YAML syntax is invalid
 *
 * @example
 * ```typescript
 * const result = parseFrontmatter(`
 * ---
 * phase: 1-3
 * tasks: ["1.1", "1.2"]
 * agents: Orchestration*
 * ---
 * # Content
 * `);
 * ```
 */
export function parseFrontmatter(markdownContent: string): ParsedFrontmatter {
  const errors: string[] = [];

  // Check if content has frontmatter delimiters
  const hasFrontmatter = markdownContent.trimStart().startsWith('---');

  if (!hasFrontmatter) {
    log.debug('No frontmatter found in markdown content');
    return {
      scope: null,
      content: markdownContent,
      isEmpty: true,
      hasErrors: false,
      errors: [],
    };
  }

  try {
    // Parse frontmatter using gray-matter
    const parsed = matter(markdownContent);

    // Check if frontmatter is empty
    if (!parsed.data || Object.keys(parsed.data).length === 0) {
      log.debug('Empty frontmatter found');
      return {
        scope: {},
        content: parsed.content,
        isEmpty: true,
        hasErrors: false,
        errors: [],
      };
    }

    // Extract scope-related fields
    const scope: RawScopeFrontmatter = {};
    const knownFields = ['phase', 'tasks', 'agents', 'tags'];

    // Validate and extract scope fields
    if ('phase' in parsed.data) {
      const phase = parsed.data.phase;
      if (typeof phase === 'string' || typeof phase === 'number') {
        scope.phase = phase;
      } else {
        errors.push(
          `Invalid scope field 'phase': expected string or number, got ${typeof phase}`,
        );
      }
    }

    if ('tasks' in parsed.data) {
      const tasks = parsed.data.tasks;
      if (Array.isArray(tasks)) {
        // Validate that all tasks are strings
        const allStrings = tasks.every((t) => typeof t === 'string');
        if (allStrings) {
          scope.tasks = tasks as string[];
        } else {
          errors.push(
            `Invalid scope field 'tasks': all elements must be strings, got mixed types`,
          );
        }
      } else {
        errors.push(
          `Invalid scope field 'tasks': expected array, got ${typeof tasks}`,
        );
      }
    }

    if ('agents' in parsed.data) {
      const agents = parsed.data.agents;
      if (typeof agents === 'string') {
        scope.agents = agents;
      } else if (Array.isArray(agents)) {
        const allStrings = agents.every((a) => typeof a === 'string');
        if (allStrings) {
          scope.agents = agents as string[];
        } else {
          errors.push(
            `Invalid scope field 'agents': all elements must be strings, got mixed types`,
          );
        }
      } else {
        errors.push(
          `Invalid scope field 'agents': expected string or array, got ${typeof agents}`,
        );
      }
    }

    if ('tags' in parsed.data) {
      const tags = parsed.data.tags;
      if (Array.isArray(tags)) {
        const allStrings = tags.every((t) => typeof t === 'string');
        if (allStrings) {
          scope.tags = tags as string[];
        } else {
          errors.push(
            `Invalid scope field 'tags': all elements must be strings, got mixed types`,
          );
        }
      } else {
        errors.push(
          `Invalid scope field 'tags': expected array, got ${typeof tags}`,
        );
      }
    }

    // Warn about unknown fields (not an error, just informational)
    const unknownFields = Object.keys(parsed.data).filter(
      (key) => !knownFields.includes(key),
    );
    if (unknownFields.length > 0) {
      log.warn(`Unknown fields in frontmatter (will be ignored): ${unknownFields.join(', ')}`);
    }

    // Copy all fields to scope (including unknown ones)
    Object.assign(scope, parsed.data);

    return {
      scope,
      content: parsed.content,
      isEmpty: Object.keys(scope).filter((k) => knownFields.includes(k)).length === 0,
      hasErrors: errors.length > 0,
      errors,
    };

  } catch (error) {
    // Handle YAML parsing errors
    if (error instanceof Error) {
      const errorMessage = `Invalid YAML syntax in frontmatter: ${error.message}`;

      // Try to extract line number from error if available
      const lineMatch = error.message.match(/line (\d+)/i);
      const lineInfo = lineMatch ? ` at line ${lineMatch[1]}` : '';

      throw new Error(errorMessage + lineInfo);
    }

    throw new Error('Unknown error parsing frontmatter');
  }
}

/**
 * Validate that parsed scope has no errors
 *
 * @param parsed - Parsed frontmatter result
 * @throws Error if scope has validation errors
 */
export function validateParsedScope(parsed: ParsedFrontmatter): void {
  if (parsed.hasErrors) {
    throw new Error(
      `Scope validation failed:\n${parsed.errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
}

/**
 * Check if frontmatter contains scope definition
 *
 * @param parsed - Parsed frontmatter result
 * @returns True if scope is defined and not empty
 */
export function hasScopeDefinition(parsed: ParsedFrontmatter): boolean {
  return !parsed.isEmpty && parsed.scope !== null;
}
