/**
 * Completion Reporting to Manager
 *
 * Detects task completion from memory log status, generates completion summaries,
 * emits task-completed events for Manager coordination, and handles partial completion.
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import matter from 'gray-matter';

/**
 * Completion status type
 */
export enum CompletionStatus {
  Completed = 'Completed',
  Partial = 'Partial',
  NotCompleted = 'NotCompleted',
}

/**
 * Completion summary
 */
export interface CompletionSummary {
  /** Task reference */
  taskRef: string;
  /** Agent ID */
  agentId: string;
  /** Completion status */
  status: CompletionStatus;
  /** Summary text from memory log */
  summary: string;
  /** Output deliverables */
  outputs: string[];
  /** Issues encountered */
  issues: string[];
  /** Next steps */
  nextSteps: string[];
  /** Ad-hoc delegation occurred */
  adHocDelegation: boolean;
  /** Compatibility issues flagged */
  compatibilityIssues: boolean;
  /** Important findings flagged */
  importantFindings: boolean;
  /** Timestamp of completion */
  timestamp: Date;
}

/**
 * Completion detection result
 */
export interface CompletionDetectionResult {
  /** Is task completed */
  isCompleted: boolean;
  /** Is task partially completed */
  isPartial: boolean;
  /** Completion summary (if completed or partial) */
  summary?: CompletionSummary;
}

/**
 * Completion reporter configuration
 */
export interface CompletionReporterConfig {
  /** Enable automatic completion detection */
  autoDetect?: boolean;
  /** Polling interval for auto-detection (ms) */
  pollingIntervalMs?: number;
}

/**
 * Completion Reporter
 * Detects completion and reports to Manager agent
 */
export class CompletionReporter extends EventEmitter {
  private config: CompletionReporterConfig;
  private pollingTimers: Map<string, NodeJS.Timeout>;

  constructor(config: CompletionReporterConfig = {}) {
    super();
    this.config = {
      autoDetect: config.autoDetect ?? false,
      pollingIntervalMs: config.pollingIntervalMs ?? 5000,
    };
    this.pollingTimers = new Map();
  }

  /**
   * Detect completion from memory log file
   *
   * @param memoryLogPath - Path to memory log file
   * @returns Completion detection result
   */
  async detectCompletion(memoryLogPath: string): Promise<CompletionDetectionResult> {
    try {
      // Read memory log
      const content = await fs.readFile(memoryLogPath, 'utf-8');

      // Parse YAML frontmatter
      const parsed = matter(content);
      const frontmatter = parsed.data;
      const markdownContent = parsed.content;

      // Check completion status
      const status = frontmatter.status as string;

      if (status === 'Completed') {
        const summary = await this.generateCompletionSummary(
          memoryLogPath,
          frontmatter,
          markdownContent,
          CompletionStatus.Completed
        );

        return {
          isCompleted: true,
          isPartial: false,
          summary,
        };
      } else if (status === 'Partial') {
        const summary = await this.generateCompletionSummary(
          memoryLogPath,
          frontmatter,
          markdownContent,
          CompletionStatus.Partial
        );

        return {
          isCompleted: false,
          isPartial: true,
          summary,
        };
      } else {
        return {
          isCompleted: false,
          isPartial: false,
        };
      }
    } catch (error) {
      // File read or parse error
      return {
        isCompleted: false,
        isPartial: false,
      };
    }
  }

  /**
   * Report completion to Manager
   *
   * @param memoryLogPath - Path to memory log file
   */
  async reportCompletion(memoryLogPath: string): Promise<void> {
    const detection = await this.detectCompletion(memoryLogPath);

    if (detection.isCompleted && detection.summary) {
      this.emit('task_completed', {
        taskRef: detection.summary.taskRef,
        agentId: detection.summary.agentId,
        status: CompletionStatus.Completed,
        summary: detection.summary.summary,
        outputs: detection.summary.outputs,
        issues: detection.summary.issues,
        nextSteps: detection.summary.nextSteps,
        adHocDelegation: detection.summary.adHocDelegation,
        compatibilityIssues: detection.summary.compatibilityIssues,
        importantFindings: detection.summary.importantFindings,
        timestamp: detection.summary.timestamp,
      });
    } else if (detection.isPartial && detection.summary) {
      this.emit('task_partial', {
        taskRef: detection.summary.taskRef,
        agentId: detection.summary.agentId,
        status: CompletionStatus.Partial,
        summary: detection.summary.summary,
        outputs: detection.summary.outputs,
        issues: detection.summary.issues,
        nextSteps: detection.summary.nextSteps,
        adHocDelegation: detection.summary.adHocDelegation,
        compatibilityIssues: detection.summary.compatibilityIssues,
        importantFindings: detection.summary.importantFindings,
        timestamp: detection.summary.timestamp,
      });
    }
  }

  /**
   * Start auto-detection for memory log
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
      const detection = await this.detectCompletion(memoryLogPath);

      if (detection.isCompleted || detection.isPartial) {
        // Report completion and stop polling
        await this.reportCompletion(memoryLogPath);
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
   * Generate completion summary from memory log
   *
   * @param memoryLogPath - Path to memory log
   * @param frontmatter - Parsed frontmatter
   * @param content - Markdown content
   * @param status - Completion status
   * @returns Completion summary
   */
  private async generateCompletionSummary(
    memoryLogPath: string,
    frontmatter: Record<string, unknown>,
    content: string,
    status: CompletionStatus
  ): Promise<CompletionSummary> {
    // Extract frontmatter fields
    const taskRef = (frontmatter.task_ref as string) ?? 'Unknown';
    const agentId = (frontmatter.agent as string) ?? 'Unknown';
    const adHocDelegation = (frontmatter.ad_hoc_delegation as boolean) ?? false;
    const compatibilityIssues = (frontmatter.compatibility_issues as boolean) ?? false;
    const importantFindings = (frontmatter.important_findings as boolean) ?? false;

    // Extract sections
    const summary = this.extractSection(content, 'Summary');
    const outputSection = this.extractSection(content, 'Output');
    const issuesSection = this.extractSection(content, 'Issues');
    const nextStepsSection = this.extractSection(content, 'Next Steps');

    // Parse outputs
    const outputs = this.extractListItems(outputSection);

    // Parse issues
    const issues = this.extractListItems(issuesSection);

    // Parse next steps
    const nextSteps = this.extractListItems(nextStepsSection);

    return {
      taskRef,
      agentId,
      status,
      summary: summary.trim(),
      outputs,
      issues,
      nextSteps,
      adHocDelegation,
      compatibilityIssues,
      importantFindings,
      timestamp: new Date(),
    };
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
   * Extract list items from section
   *
   * @param section - Section content
   * @returns List of items
   */
  private extractListItems(section: string): string[] {
    if (!section || section.trim().length === 0) {
      return [];
    }

    // Check if section is just "None"
    if (section.trim().toLowerCase() === 'none') {
      return [];
    }

    const lines = section.split('\n');
    const items: string[] = [];
    let currentItem = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // Check if this is a new list item
      if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        // Save previous item if exists
        if (currentItem) {
          items.push(currentItem);
        }
        // Start new item
        currentItem = trimmed.substring(1).trim();
      } else if (currentItem && trimmed.length > 0 && !trimmed.startsWith('#')) {
        // Continuation of current item
        currentItem += ' ' + trimmed;
      } else if (!currentItem && trimmed.length > 0 && !trimmed.startsWith('#')) {
        // Non-list item, add as is
        items.push(trimmed);
      }
    }

    // Add last item
    if (currentItem) {
      items.push(currentItem);
    }

    return items;
  }
}

/**
 * Create a CompletionReporter instance
 *
 * @param config - CompletionReporter configuration
 * @returns CompletionReporter instance
 */
export function createCompletionReporter(config?: CompletionReporterConfig): CompletionReporter {
  return new CompletionReporter(config);
}
