/**
 * APM Memory Log Parser
 *
 * Parses memory log markdown files to extract task status:
 * - YAML frontmatter parsing (agent, task_ref, status, flags)
 * - Markdown section extraction (Summary, Details, Issues, Output, etc.)
 * - Status mapping to TaskStatus enum
 * - Incomplete log handling with fallbacks
 * - Additional metadata extraction
 * - Data validation
 * - Graceful error handling
 */

import * as fs from 'fs';
import * as matter from 'gray-matter';
import { TaskStatus } from '../protocol/types';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Memory log frontmatter structure
 */
interface MemoryLogFrontmatter {
  /** Agent ID/name */
  agent?: string;
  /** Task reference (e.g., "Task 3.2") */
  task_ref?: string;
  /** Task status */
  status?: string;
  /** Whether ad-hoc delegation occurred */
  ad_hoc_delegation?: boolean;
  /** Whether compatibility issues exist */
  compatibility_issues?: boolean;
  /** Whether important findings exist */
  important_findings?: boolean;
}

/**
 * Parsed memory log result (success)
 */
export interface ParsedMemoryLog {
  /** Task ID extracted from task_ref */
  taskId: string;
  /** Task status mapped to enum */
  status: TaskStatus;
  /** Agent ID */
  agentId?: string;
  /** Progress percentage (if extractable) */
  progressPercentage?: number;
  /** Blockers from Issues section */
  blockers?: string[];
  /** Completion timestamp (if found) */
  completionTimestamp?: Date;
  /** Important findings flag */
  hasImportantFindings: boolean;
  /** Raw content for debugging */
  rawContent?: string;
  /** Ad-hoc delegation flag */
  hasAdHocDelegation?: boolean;
  /** Compatibility issues flag */
  hasCompatibilityIssues?: boolean;
}

/**
 * Parse error result
 */
export interface ParseError {
  /** Error flag */
  error: true;
  /** Error message */
  errorMessage: string;
  /** File path that failed */
  filePath: string;
  /** Error details */
  details?: unknown;
}

/**
 * Parse result (success or error)
 */
export type ParseResult = ParsedMemoryLog | ParseError;

// ============================================================================
// MemoryLogParser Class
// ============================================================================

/**
 * Parser for APM memory log markdown files
 *
 * Extracts task status and metadata from memory logs per Memory_Log_Guide.md format.
 */
export class MemoryLogParser {
  /**
   * Parse memory log file
   *
   * @param filePath - Path to memory log file
   * @returns Parsed result or error
   */
  parse(filePath: string): ParseResult {
    try {
      // Read file
      if (!fs.existsSync(filePath)) {
        return {
          error: true,
          errorMessage: 'File not found',
          filePath,
        };
      }

      const content = fs.readFileSync(filePath, 'utf-8');

      // Parse with gray-matter
      let parsed: matter.GrayMatterFile<string>;
      try {
        parsed = matter(content);
      } catch (err) {
        // Frontmatter parse error - try parsing as plain markdown
        console.warn(
          `[MemoryLogParser] Frontmatter parse failed for ${filePath}, parsing as plain markdown`
        );
        return this.parsePlainMarkdown(filePath, content);
      }

      const frontmatter = parsed.data as MemoryLogFrontmatter;
      const markdownContent = parsed.content;

      // Extract task ID
      const taskId = this.extractTaskId(frontmatter, markdownContent, filePath);
      if (!taskId) {
        return {
          error: true,
          errorMessage: 'Could not extract task ID',
          filePath,
        };
      }

      // Validate task ID format
      if (!this.validateTaskId(taskId)) {
        console.warn(
          `[MemoryLogParser] Invalid task ID format: ${taskId} (expected X.Y pattern)`
        );
      }

      // Extract status
      const status = this.extractStatus(frontmatter, markdownContent);

      // Extract agent ID
      const agentId = frontmatter.agent;

      // Extract additional metadata
      const progressPercentage = this.extractProgressPercentage(markdownContent);
      const blockers = this.extractBlockers(markdownContent);
      const completionTimestamp = this.extractCompletionTimestamp(
        frontmatter,
        markdownContent
      );

      // Flags from frontmatter
      const hasImportantFindings = frontmatter.important_findings ?? false;
      const hasAdHocDelegation = frontmatter.ad_hoc_delegation ?? false;
      const hasCompatibilityIssues = frontmatter.compatibility_issues ?? false;

      return {
        taskId,
        status,
        agentId,
        progressPercentage,
        blockers,
        completionTimestamp,
        hasImportantFindings,
        hasAdHocDelegation,
        hasCompatibilityIssues,
        rawContent: content,
      };
    } catch (error) {
      return {
        error: true,
        errorMessage: 'Parse exception',
        filePath,
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Extraction Methods
  // ==========================================================================

  /**
   * Extract task ID from frontmatter or content
   */
  private extractTaskId(
    frontmatter: MemoryLogFrontmatter,
    content: string,
    filePath: string
  ): string | null {
    // Primary source: task_ref in frontmatter
    if (frontmatter.task_ref) {
      // Extract just the ID part (e.g., "Task 3.2" → "3.2")
      const match = frontmatter.task_ref.match(/(\d+\.\d+)/);
      if (match) {
        return match[1];
      }
      // If no match but looks like an ID already
      if (/^\d+\.\d+$/.test(frontmatter.task_ref)) {
        return frontmatter.task_ref;
      }
    }

    // Fallback: Extract from file name
    // Example: Task_3_2_Memory_File_Monitoring.md → 3.2
    const fileNameMatch = filePath.match(/Task_(\d+)_(\d+)/);
    if (fileNameMatch) {
      return `${fileNameMatch[1]}.${fileNameMatch[2]}`;
    }

    // Fallback: Search content for task reference
    const contentMatch = content.match(/Task\s+(\d+\.\d+)/i);
    if (contentMatch) {
      return contentMatch[1];
    }

    return null;
  }

  /**
   * Extract status from frontmatter or content
   */
  private extractStatus(
    frontmatter: MemoryLogFrontmatter,
    content: string
  ): TaskStatus {
    // Primary source: status field in frontmatter
    if (frontmatter.status) {
      return this.mapStatusToEnum(frontmatter.status);
    }

    // Fallback: Search for status markers in content
    const statusMatch = content.match(/Status:\s*(\w+)/i);
    if (statusMatch) {
      return this.mapStatusToEnum(statusMatch[1]);
    }

    // Default: Assume in-progress
    console.warn('[MemoryLogParser] Status not found, defaulting to IN_PROGRESS');
    return TaskStatus.IN_PROGRESS;
  }

  /**
   * Map status string to TaskStatus enum
   */
  private mapStatusToEnum(statusString: string): TaskStatus {
    const normalized = statusString.toLowerCase().trim();

    // Map common variations
    if (normalized === 'completed' || normalized === 'complete' || normalized === 'done') {
      return TaskStatus.COMPLETED;
    }

    if (
      normalized === 'in progress' ||
      normalized === 'in_progress' ||
      normalized === 'started' ||
      normalized === 'ongoing'
    ) {
      return TaskStatus.IN_PROGRESS;
    }

    if (normalized === 'blocked') {
      return TaskStatus.BLOCKED;
    }

    if (
      normalized === 'pending review' ||
      normalized === 'pending_review' ||
      normalized === 'review'
    ) {
      return TaskStatus.PENDING_REVIEW;
    }

    if (normalized === 'failed' || normalized === 'error') {
      return TaskStatus.FAILED;
    }

    // Default to in-progress for unknown status
    console.warn(
      `[MemoryLogParser] Unknown status "${statusString}", defaulting to IN_PROGRESS`
    );
    return TaskStatus.IN_PROGRESS;
  }

  /**
   * Extract progress percentage from content
   */
  private extractProgressPercentage(content: string): number | undefined {
    // Look for patterns like "Progress: 75%" or "75% complete"
    const patterns = [
      /Progress:\s*(\d+)%/i,
      /(\d+)%\s+complete/i,
      /(\d+)%\s+done/i,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const percentage = parseInt(match[1], 10);
        if (percentage >= 0 && percentage <= 100) {
          return percentage;
        }
      }
    }

    return undefined;
  }

  /**
   * Extract blockers from Issues section
   */
  private extractBlockers(content: string): string[] | undefined {
    // Find ## Issues section
    const issuesMatch = content.match(/##\s+Issues\s*\n([\s\S]*?)(?:\n##|$)/i);
    if (!issuesMatch) {
      return undefined;
    }

    const issuesSection = issuesMatch[1].trim();

    // Check if "None" or empty
    if (
      issuesSection.toLowerCase() === 'none' ||
      issuesSection.toLowerCase() === 'no issues' ||
      issuesSection.length === 0
    ) {
      return undefined;
    }

    // Extract blockers (assume bullet points or lines)
    const blockers: string[] = [];

    // Try bullet points first
    const bulletMatches = issuesSection.match(/^[-*]\s+(.+)$/gm);
    if (bulletMatches) {
      for (const bullet of bulletMatches) {
        const blocker = bullet.replace(/^[-*]\s+/, '').trim();
        if (blocker) {
          blockers.push(blocker);
        }
      }
    } else {
      // Otherwise, split by lines
      const lines = issuesSection.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && trimmed.toLowerCase() !== 'none') {
          blockers.push(trimmed);
        }
      }
    }

    return blockers.length > 0 ? blockers : undefined;
  }

  /**
   * Extract completion timestamp
   */
  private extractCompletionTimestamp(
    frontmatter: MemoryLogFrontmatter,
    content: string
  ): Date | undefined {
    // Check if status is completed
    const isCompleted = frontmatter.status?.toLowerCase() === 'completed';
    if (!isCompleted) {
      return undefined;
    }

    // Look for timestamp patterns in content
    const patterns = [
      /Completion(?:\s+Date)?:\s*(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)?)/i,
      /Completed(?:\s+at)?:\s*(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)?)/i,
      /Task\s+Completion\s+Timestamp:\s*(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)?)/i,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        try {
          return new Date(match[1]);
        } catch {
          // Invalid date, continue
        }
      }
    }

    return undefined;
  }

  // ==========================================================================
  // Validation
  // ==========================================================================

  /**
   * Validate task ID format (X.Y pattern)
   */
  private validateTaskId(taskId: string): boolean {
    return /^\d+\.\d+$/.test(taskId);
  }

  /**
   * Validate ISO 8601 date string
   */
  private validateIso8601(dateString: string): boolean {
    try {
      const date = new Date(dateString);
      return !isNaN(date.getTime()) && dateString.includes('-');
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Fallback Parsing
  // ==========================================================================

  /**
   * Parse as plain markdown when frontmatter missing/invalid
   */
  private parsePlainMarkdown(filePath: string, content: string): ParseResult {
    // Try to extract task ID from filename or content
    const taskId = this.extractTaskId({}, content, filePath);
    if (!taskId) {
      return {
        error: true,
        errorMessage: 'No frontmatter and could not extract task ID from content',
        filePath,
      };
    }

    // Extract status from content
    const status = this.extractStatus({}, content);

    // Extract blockers
    const blockers = this.extractBlockers(content);

    console.warn(
      `[MemoryLogParser] Parsed ${filePath} as plain markdown (no frontmatter)`
    );

    return {
      taskId,
      status,
      blockers,
      hasImportantFindings: false,
      rawContent: content,
    };
  }
}
