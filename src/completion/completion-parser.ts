/**
 * Completion Detection Parser
 *
 * System-wide completion marker parser extracting task status from memory logs.
 * Parses status markers, deliverables, test results, and quality gates.
 */

import fs from 'fs/promises';
import matter from 'gray-matter';

/**
 * Completion status enum
 */
export enum CompletionStatus {
  Completed = 'Completed',
  Partial = 'Partial',
  Blocked = 'Blocked',
  Failed = 'Failed',
  InProgress = 'InProgress',
  NotStarted = 'NotStarted',
}

/**
 * Test results metadata
 */
export interface TestResults {
  /** Total tests run */
  total: number;
  /** Tests passed */
  passed: number;
  /** Coverage percentage */
  coveragePercent?: number;
}

/**
 * Quality gate results
 */
export interface QualityGateResults {
  /** TDD compliance */
  tdd?: boolean;
  /** Conventional commits */
  commits?: boolean;
  /** Security checks */
  security?: boolean;
  /** Coverage threshold */
  coverage?: boolean;
}

/**
 * Completion result
 */
export interface CompletionResult {
  /** Task reference */
  taskRef: string;
  /** Agent ID */
  agentId: string;
  /** Completion status */
  status: CompletionStatus;
  /** Deliverables list */
  deliverables: string[];
  /** Test results */
  testResults?: TestResults;
  /** Quality gate results */
  qualityGates?: QualityGateResults;
  /** Completion timestamp */
  completionTimestamp: Date;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Completion Parser
 * Parses completion status and metadata from memory logs
 */
export class CompletionParser {
  /**
   * Parse completion from memory log file
   *
   * @param memoryLogPath - Path to memory log file
   * @returns Completion result
   */
  async parseCompletion(memoryLogPath: string): Promise<CompletionResult> {
    // Read memory log file
    const content = await fs.readFile(memoryLogPath, 'utf-8');

    // Parse YAML frontmatter (handle errors gracefully)
    let parsed;
    try {
      parsed = matter(content);
    } catch (error) {
      // If YAML parsing fails, use empty frontmatter
      parsed = { data: {}, content: content };
    }
    const frontmatter = parsed.data;
    const markdownContent = parsed.content;

    // Get file stats for timestamp
    const stats = await fs.stat(memoryLogPath);

    // Extract status
    const status = this.extractStatus(frontmatter.status as string);

    // Extract agent and task ref
    const agentId = (frontmatter.agent as string) ?? 'Unknown';
    const taskRef = (frontmatter.task_ref as string) ?? 'Unknown';

    // Extract deliverables
    const deliverables = this.extractDeliverables(markdownContent);

    // Extract test results
    const testResults = this.extractTestResults(markdownContent);

    // Extract quality gates
    const qualityGates = this.extractQualityGates(markdownContent);

    // Calculate confidence
    const confidence = this.calculateConfidence({
      status,
      deliverables,
      testResults,
      qualityGates,
      markdownContent,
    });

    return {
      taskRef,
      agentId,
      status,
      deliverables,
      testResults,
      qualityGates,
      completionTimestamp: stats.mtime,
      confidence,
    };
  }

  /**
   * Extract status from frontmatter
   */
  private extractStatus(statusValue: string): CompletionStatus {
    if (!statusValue) {
      return CompletionStatus.NotStarted;
    }

    const normalized = statusValue.trim();
    if (normalized === 'Completed') {
      return CompletionStatus.Completed;
    } else if (normalized === 'Partial') {
      return CompletionStatus.Partial;
    } else if (normalized === 'Blocked') {
      return CompletionStatus.Blocked;
    } else if (normalized === 'Failed') {
      return CompletionStatus.Failed;
    } else if (normalized === 'InProgress') {
      return CompletionStatus.InProgress;
    } else {
      return CompletionStatus.NotStarted;
    }
  }

  /**
   * Extract deliverables from Output section
   */
  private extractDeliverables(content: string): string[] {
    const outputSection = this.extractSection(content, 'Output');
    if (!outputSection) {
      return [];
    }

    const lines = outputSection.split('\n');
    const deliverables: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Match list items (- or *)
      if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        const item = trimmed.substring(1).trim();
        if (item.length > 0) {
          deliverables.push(item);
        }
      }
    }

    return deliverables;
  }

  /**
   * Extract test results from content
   */
  private extractTestResults(content: string): TestResults | undefined {
    // Pattern 1: "X/Y tests passing"
    const pattern1 = /(\d+)\/(\d+)\s+tests?\s+passing/i;
    const match1 = content.match(pattern1);

    // Pattern 2: "X tests, Y passed"
    const pattern2 = /(\d+)\s+tests?,\s+(\d+)\s+passed/i;
    const match2 = content.match(pattern2);

    // Pattern 3: "Tests: X/Y passing"
    const pattern3 = /Tests?:\s+(\d+)\/(\d+)\s+passing/i;
    const match3 = content.match(pattern3);

    let total: number | undefined;
    let passed: number | undefined;

    if (match1) {
      passed = parseInt(match1[1], 10);
      total = parseInt(match1[2], 10);
    } else if (match2) {
      total = parseInt(match2[1], 10);
      passed = parseInt(match2[2], 10);
    } else if (match3) {
      passed = parseInt(match3[1], 10);
      total = parseInt(match3[2], 10);
    }

    // Extract coverage percentage (multiple patterns)
    let coveragePercent: number | undefined;

    // Pattern 1: "XX% statement coverage"
    const coveragePattern1 = /(\d+(?:\.\d+)?)\s*%\s*statement.*coverage/i;
    const coverageMatch1 = content.match(coveragePattern1);

    // Pattern 2: "Coverage: XX%"
    const coveragePattern2 = /Coverage:\s+(\d+(?:\.\d+)?)\s*%/i;
    const coverageMatch2 = content.match(coveragePattern2);

    // Pattern 3: "XX% coverage"
    const coveragePattern3 = /(\d+(?:\.\d+)?)\s*%\s+coverage/i;
    const coverageMatch3 = content.match(coveragePattern3);

    if (coverageMatch1) {
      coveragePercent = parseFloat(coverageMatch1[1]);
    } else if (coverageMatch2) {
      coveragePercent = parseFloat(coverageMatch2[1]);
    } else if (coverageMatch3) {
      coveragePercent = parseFloat(coverageMatch3[1]);
    }

    if (total !== undefined || passed !== undefined || coveragePercent !== undefined) {
      return {
        total: total ?? passed ?? 0,
        passed: passed ?? total ?? 0,
        coveragePercent,
      };
    }

    return undefined;
  }

  /**
   * Extract quality gate results from content
   */
  private extractQualityGates(content: string): QualityGateResults | undefined {
    const gates: QualityGateResults = {};
    let hasAnyGate = false;

    // TDD compliance
    if (
      /TDD|test.*driven.*development|wrote tests before|tests first/i.test(content)
    ) {
      gates.tdd = true;
      hasAnyGate = true;
    }

    // Conventional commits
    if (
      /conventional commit|feat\(|fix\(|chore\(|docs\(/i.test(content)
    ) {
      gates.commits = true;
      hasAnyGate = true;
    }

    // Security checks
    if (
      /security.*passed|no vulnerabilities|vulnerability.*scan|security.*check/i.test(content)
    ) {
      gates.security = true;
      hasAnyGate = true;
    }

    // Coverage threshold
    if (
      /coverage.*threshold|exceeds.*80|coverage.*met|\d+%.*threshold/i.test(content)
    ) {
      gates.coverage = true;
      hasAnyGate = true;
    }

    return hasAnyGate ? gates : undefined;
  }

  /**
   * Calculate confidence score for completion detection
   */
  private calculateConfidence(params: {
    status: CompletionStatus;
    deliverables: string[];
    testResults?: TestResults;
    qualityGates?: QualityGateResults;
    markdownContent: string;
  }): number {
    let score = 0.5; // Base score

    // Status completeness
    if (params.status === CompletionStatus.Completed) {
      score += 0.2;
    } else if (params.status === CompletionStatus.Partial) {
      score += 0.1;
    }

    // Deliverables present
    if (params.deliverables.length > 0) {
      score += 0.15;
    }

    // Test results documented
    if (params.testResults) {
      score += 0.1;
      if (params.testResults.passed === params.testResults.total) {
        score += 0.05;
      }
    }

    // Quality gates documented
    if (params.qualityGates) {
      const gateCount = Object.keys(params.qualityGates).length;
      score += gateCount * 0.025;
    }

    // Content length (more detailed = higher confidence)
    const wordCount = params.markdownContent.split(/\s+/).length;
    if (wordCount > 100) {
      score += 0.05;
    }
    if (wordCount > 300) {
      score += 0.05;
    }

    // Cap at 1.0
    return Math.min(score, 1.0);
  }

  /**
   * Extract markdown section by heading
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
}

/**
 * Create a CompletionParser instance
 *
 * @returns CompletionParser instance
 */
export function createCompletionParser(): CompletionParser {
  return new CompletionParser();
}
