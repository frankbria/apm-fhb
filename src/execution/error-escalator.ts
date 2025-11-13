/**
 * Error Escalation for Blockers
 *
 * Detects blocker categories, updates memory logs with Blocked status,
 * emits task-blocked events for Manager escalation, and supports
 * blocker resolution workflow.
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import matter from 'gray-matter';

/**
 * Blocker category
 */
export enum BlockerCategory {
  ExternalDependency = 'external_dependency',
  AmbiguousRequirements = 'ambiguous_requirements',
  TestFailures = 'test_failures',
  ResourceConstraints = 'resource_constraints',
  DesignDecision = 'design_decision',
  Unknown = 'unknown',
}

/**
 * Blocker severity
 */
export enum BlockerSeverity {
  Critical = 'critical',
  High = 'high',
  Medium = 'medium',
  Low = 'low',
}

/**
 * Blocker information
 */
export interface BlockerInfo {
  /** Blocker category */
  category: BlockerCategory;
  /** Blocker severity */
  severity: BlockerSeverity;
  /** Description of blocker */
  description: string;
  /** Task that is blocked */
  blockedTaskRef: string;
  /** Agent that is blocked */
  blockedAgentId: string;
  /** Blocking dependency (if applicable) */
  blockingDependency?: string;
  /** Timestamp when blocker detected */
  timestamp: Date;
  /** Suggested resolution (optional) */
  suggestedResolution?: string;
}

/**
 * Blocker detection result
 */
export interface BlockerDetectionResult {
  /** Is task blocked */
  isBlocked: boolean;
  /** Detected blockers */
  blockers: BlockerInfo[];
}

/**
 * Error escalator configuration
 */
export interface ErrorEscalatorConfig {
  /** Enable automatic blocker detection */
  autoDetect?: boolean;
  /** Polling interval for auto-detection (ms) */
  pollingIntervalMs?: number;
  /** Memory log base path */
  memoryBasePath?: string;
}

/**
 * Error Escalator
 * Detects blockers and escalates to Manager agent
 */
export class ErrorEscalator extends EventEmitter {
  private config: ErrorEscalatorConfig;
  private pollingTimers: Map<string, NodeJS.Timeout>;

  constructor(config: ErrorEscalatorConfig = {}) {
    super();
    this.config = {
      autoDetect: config.autoDetect ?? false,
      pollingIntervalMs: config.pollingIntervalMs ?? 10000,
      memoryBasePath: config.memoryBasePath ?? '.apm/Memory',
    };
    this.pollingTimers = new Map();
  }

  /**
   * Detect blockers from memory log
   *
   * @param memoryLogPath - Path to memory log file
   * @returns Blocker detection result
   */
  async detectBlockers(memoryLogPath: string): Promise<BlockerDetectionResult> {
    try {
      // Read memory log
      const content = await fs.readFile(memoryLogPath, 'utf-8');

      // Parse YAML frontmatter
      const parsed = matter(content);
      const frontmatter = parsed.data;
      const markdownContent = parsed.content;

      // Check if status is Blocked or Error
      const status = frontmatter.status as string;

      if (status !== 'Blocked' && status !== 'Error') {
        return {
          isBlocked: false,
          blockers: [],
        };
      }

      // Extract blocker information
      const blockers = await this.extractBlockers(
        memoryLogPath,
        frontmatter,
        markdownContent
      );

      return {
        isBlocked: blockers.length > 0,
        blockers,
      };
    } catch (error) {
      // File read or parse error
      return {
        isBlocked: false,
        blockers: [],
      };
    }
  }

  /**
   * Escalate blocker to Manager
   *
   * @param blocker - Blocker information
   */
  async escalateBlocker(blocker: BlockerInfo): Promise<void> {
    this.emit('task_blocked', {
      category: blocker.category,
      severity: blocker.severity,
      description: blocker.description,
      blockedTaskRef: blocker.blockedTaskRef,
      blockedAgentId: blocker.blockedAgentId,
      blockingDependency: blocker.blockingDependency,
      timestamp: blocker.timestamp,
      suggestedResolution: blocker.suggestedResolution,
    });
  }

  /**
   * Update memory log to Blocked status
   *
   * @param memoryLogPath - Path to memory log file
   * @param blocker - Blocker information
   */
  async updateMemoryLogToBlocked(
    memoryLogPath: string,
    blocker: BlockerInfo
  ): Promise<void> {
    try {
      // Read current memory log
      const content = await fs.readFile(memoryLogPath, 'utf-8');
      const parsed = matter(content);

      // Update frontmatter status
      parsed.data.status = 'Blocked';

      // Update Issues section with blocker description
      const issuesSection = this.extractSection(parsed.content, 'Issues');
      const updatedIssues = this.addBlockerToIssues(issuesSection, blocker);
      const updatedContent = this.replaceSection(
        parsed.content,
        'Issues',
        updatedIssues
      );

      // Reconstruct memory log
      const updatedLog = matter.stringify(updatedContent, parsed.data);

      // Write updated memory log
      await fs.writeFile(memoryLogPath, updatedLog, 'utf-8');
    } catch (error) {
      // Error updating memory log - emit error event
      this.emit('update_error', {
        memoryLogPath,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Resolve blocker and update memory log
   *
   * @param memoryLogPath - Path to memory log file
   * @param resolution - Resolution description
   */
  async resolveBlocker(memoryLogPath: string, resolution: string): Promise<void> {
    try {
      // Read current memory log
      const content = await fs.readFile(memoryLogPath, 'utf-8');
      const parsed = matter(content);

      // Update frontmatter status to InProgress
      parsed.data.status = 'InProgress';

      // Update Issues section with resolution
      const issuesSection = this.extractSection(parsed.content, 'Issues');
      const updatedIssues = issuesSection + `\n\nResolved: ${resolution}`;
      const updatedContent = this.replaceSection(
        parsed.content,
        'Issues',
        updatedIssues
      );

      // Reconstruct memory log
      const updatedLog = matter.stringify(updatedContent, parsed.data);

      // Write updated memory log
      await fs.writeFile(memoryLogPath, updatedLog, 'utf-8');

      // Emit resolution event
      this.emit('blocker_resolved', {
        memoryLogPath,
        resolution,
        timestamp: new Date(),
      });
    } catch (error) {
      // Error updating memory log
      this.emit('update_error', {
        memoryLogPath,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Start auto-detection for blockers
   *
   * @param taskId - Task ID for tracking
   * @param memoryLogPath - Path to memory log file
   */
  startAutoDetection(taskId: string, memoryLogPath: string): void {
    if (!this.config.autoDetect) {
      return;
    }

    // Stop existing timer if present
    this.stopAutoDetection(taskId);

    // Start polling
    const timer = setInterval(async () => {
      const detection = await this.detectBlockers(memoryLogPath);

      if (detection.isBlocked) {
        // Escalate all blockers
        for (const blocker of detection.blockers) {
          await this.escalateBlocker(blocker);
        }

        // Stop polling after escalation
        this.stopAutoDetection(taskId);
      }
    }, this.config.pollingIntervalMs);

    this.pollingTimers.set(taskId, timer);
  }

  /**
   * Stop auto-detection for task
   *
   * @param taskId - Task ID
   */
  stopAutoDetection(taskId: string): void {
    const timer = this.pollingTimers.get(taskId);
    if (timer) {
      clearInterval(timer);
      this.pollingTimers.delete(taskId);
    }
  }

  /**
   * Stop all auto-detection timers
   */
  stopAllAutoDetection(): void {
    for (const timer of this.pollingTimers.values()) {
      clearInterval(timer);
    }
    this.pollingTimers.clear();
  }

  /**
   * Extract blockers from memory log
   *
   * @param memoryLogPath - Path to memory log
   * @param frontmatter - Parsed frontmatter
   * @param content - Markdown content
   * @returns Array of detected blockers
   */
  private async extractBlockers(
    memoryLogPath: string,
    frontmatter: Record<string, unknown>,
    content: string
  ): Promise<BlockerInfo[]> {
    const blockers: BlockerInfo[] = [];

    // Extract task and agent info
    const taskRef = (frontmatter.task_ref as string) ?? 'Unknown';
    const agentId = (frontmatter.agent as string) ?? 'Unknown';

    // Extract Issues section
    const issuesSection = this.extractSection(content, 'Issues');

    // Categorize blockers based on content patterns
    const categories = this.categorizeBlockers(issuesSection);

    for (const category of categories) {
      const blocker: BlockerInfo = {
        category: category.category,
        severity: category.severity,
        description: category.description,
        blockedTaskRef: taskRef,
        blockedAgentId: agentId,
        blockingDependency: category.dependency,
        timestamp: new Date(),
        suggestedResolution: category.resolution,
      };

      blockers.push(blocker);
    }

    return blockers;
  }

  /**
   * Categorize blockers from Issues section
   *
   * @param issuesContent - Issues section content
   * @returns Categorized blockers
   */
  private categorizeBlockers(
    issuesContent: string
  ): Array<{
    category: BlockerCategory;
    severity: BlockerSeverity;
    description: string;
    dependency?: string;
    resolution?: string;
  }> {
    const blockers: Array<{
      category: BlockerCategory;
      severity: BlockerSeverity;
      description: string;
      dependency?: string;
      resolution?: string;
    }> = [];

    if (!issuesContent || issuesContent.trim().length === 0) {
      return blockers;
    }

    // Patterns for blocker categories
    const patterns = [
      {
        pattern: /blocked by.*task\s+([\d.]+)|waiting for.*task\s+([\d.]+)|dependency.*task\s+([\d.]+)/i,
        category: BlockerCategory.ExternalDependency,
        severity: BlockerSeverity.High,
      },
      {
        pattern: /ambiguous|unclear|not specified|missing requirements|needs clarification/i,
        category: BlockerCategory.AmbiguousRequirements,
        severity: BlockerSeverity.Medium,
      },
      {
        pattern: /test.*fail|failing tests|test failures|tests? not passing/i,
        category: BlockerCategory.TestFailures,
        severity: BlockerSeverity.High,
      },
      {
        pattern: /resource|memory|cpu|disk|quota|limit exceeded/i,
        category: BlockerCategory.ResourceConstraints,
        severity: BlockerSeverity.Critical,
      },
      {
        pattern: /design decision|architectural|design choice|needs decision/i,
        category: BlockerCategory.DesignDecision,
        severity: BlockerSeverity.Medium,
      },
    ];

    // Split into individual issue items
    const lines = issuesContent.split('\n');
    let currentIssue = '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        // Process previous issue
        if (currentIssue) {
          this.processIssue(currentIssue, patterns, blockers);
        }
        // Start new issue
        currentIssue = trimmed.substring(1).trim();
      } else if (currentIssue && trimmed.length > 0 && !trimmed.startsWith('#')) {
        // Continuation of current issue
        currentIssue += ' ' + trimmed;
      } else if (!currentIssue && trimmed.length > 0 && !trimmed.startsWith('#')) {
        // Non-list item
        this.processIssue(trimmed, patterns, blockers);
      }
    }

    // Process last issue
    if (currentIssue) {
      this.processIssue(currentIssue, patterns, blockers);
    }

    return blockers;
  }

  /**
   * Process individual issue to detect blocker category
   *
   * @param issue - Issue description
   * @param patterns - Category patterns
   * @param blockers - Output array
   */
  private processIssue(
    issue: string,
    patterns: Array<{
      pattern: RegExp;
      category: BlockerCategory;
      severity: BlockerSeverity;
    }>,
    blockers: Array<{
      category: BlockerCategory;
      severity: BlockerSeverity;
      description: string;
      dependency?: string;
      resolution?: string;
    }>
  ): void {
    for (const { pattern, category, severity } of patterns) {
      const match = issue.match(pattern);
      if (match) {
        // Extract dependency task ID if applicable
        let dependency: string | undefined;
        if (category === BlockerCategory.ExternalDependency) {
          dependency = match[1] || match[2] || match[3];
        }

        blockers.push({
          category,
          severity,
          description: issue,
          dependency,
        });

        return; // Only categorize as first matching pattern
      }
    }

    // If no pattern matches, categorize as Unknown
    blockers.push({
      category: BlockerCategory.Unknown,
      severity: BlockerSeverity.Medium,
      description: issue,
    });
  }

  /**
   * Extract markdown section by heading
   *
   * @param content - Markdown content
   * @param heading - Section heading (without ##)
   * @returns Section content
   */
  private extractSection(content: string, heading: string): string {
    const lines = content.split('\n');
    let inSection = false;
    const sectionLines: string[] = [];

    for (const line of lines) {
      if (line.match(new RegExp(`^##\\s+${heading}\\s*$`, 'i'))) {
        inSection = true;
        continue;
      }

      if (inSection && line.match(/^##\s+/)) {
        break;
      }

      if (inSection) {
        sectionLines.push(line);
      }
    }

    return sectionLines.join('\n').trim();
  }

  /**
   * Replace section content in markdown
   *
   * @param content - Markdown content
   * @param heading - Section heading (without ##)
   * @param newContent - New section content
   * @returns Updated markdown content
   */
  private replaceSection(content: string, heading: string, newContent: string): string {
    const lines = content.split('\n');
    const resultLines: string[] = [];
    let inSection = false;
    let sectionFound = false;

    for (const line of lines) {
      if (line.match(new RegExp(`^##\\s+${heading}\\s*$`, 'i'))) {
        inSection = true;
        sectionFound = true;
        resultLines.push(line);
        resultLines.push(newContent);
        continue;
      }

      if (inSection && line.match(/^##\s+/)) {
        inSection = false;
        resultLines.push(line);
        continue;
      }

      if (!inSection) {
        resultLines.push(line);
      }
    }

    return resultLines.join('\n');
  }

  /**
   * Add blocker to Issues section
   *
   * @param issuesContent - Current Issues section content
   * @param blocker - Blocker to add
   * @returns Updated Issues content
   */
  private addBlockerToIssues(issuesContent: string, blocker: BlockerInfo): string {
    const blockerLine = `- [BLOCKED - ${blocker.category}] ${blocker.description}`;

    if (!issuesContent || issuesContent.trim().toLowerCase() === 'none') {
      return blockerLine;
    }

    return `${issuesContent}\n${blockerLine}`;
  }
}

/**
 * Create an ErrorEscalator instance
 *
 * @param config - ErrorEscalator configuration
 * @returns ErrorEscalator instance
 */
export function createErrorEscalator(config?: ErrorEscalatorConfig): ErrorEscalator {
  return new ErrorEscalator(config);
}
