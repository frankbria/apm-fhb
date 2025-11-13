/**
 * Memory Log Generation Validation
 *
 * Validates memory logs against Memory_Log_Guide.md format requirements,
 * checks frontmatter fields, markdown structure, completion criteria,
 * and detects progress patterns for ProgressMonitor integration.
 */

import fs from 'fs/promises';
import matter from 'gray-matter';

/**
 * Validation error severity
 */
export enum ValidationSeverity {
  Error = 'error',
  Warning = 'warning',
}

/**
 * Validation error category
 */
export enum ValidationCategory {
  Frontmatter = 'frontmatter',
  Structure = 'structure',
  Content = 'content',
  CompletionCriteria = 'completion_criteria',
}

/**
 * Validation error
 */
export interface ValidationError {
  /** Error category */
  category: ValidationCategory;
  /** Field name (if applicable) */
  field?: string;
  /** Error message */
  message: string;
  /** Severity */
  severity: ValidationSeverity;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  /** Warning category */
  category: ValidationCategory;
  /** Warning message */
  message: string;
}

/**
 * Detected progress patterns
 */
export interface DetectedPatterns {
  /** Completion markers found */
  completionMarkers: string[];
  /** Error indicators found */
  errorIndicators: string[];
  /** Blocker indicators found */
  blockerIndicators: string[];
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Is memory log valid */
  valid: boolean;
  /** Validation errors */
  errors: ValidationError[];
  /** Validation warnings */
  warnings: ValidationWarning[];
  /** Detected patterns */
  detectedPatterns: DetectedPatterns;
}

/**
 * Memory log frontmatter
 */
export interface MemoryLogFrontmatter {
  agent: string;
  task_ref: string;
  status: 'Completed' | 'Partial' | 'Blocked' | 'Error' | 'InProgress';
  ad_hoc_delegation: boolean;
  compatibility_issues: boolean;
  important_findings: boolean;
}

/**
 * Memory Log Validator
 * Validates memory logs against Memory_Log_Guide.md format
 */
export class MemoryLogValidator {
  /**
   * Validate memory log file
   *
   * @param memoryLogPath - Path to memory log file
   * @returns Validation result
   */
  async validateMemoryLog(memoryLogPath: string): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    try {
      // Read memory log file
      const content = await fs.readFile(memoryLogPath, 'utf-8');

      // Parse YAML frontmatter and markdown
      const parsed = matter(content);

      // Validate frontmatter
      const frontmatterErrors = this.checkFrontmatter(parsed.data);
      errors.push(...frontmatterErrors);

      // Validate markdown structure
      const structureErrors = this.checkMarkdownStructure(parsed.content, parsed.data);
      errors.push(...structureErrors);

      // Check completion criteria if status is Completed
      if (parsed.data.status === 'Completed') {
        const completionErrors = this.checkCompletionCriteria(parsed.content);
        errors.push(...completionErrors);
      }

      // Detect progress patterns
      const detectedPatterns = this.detectProgressPatterns(parsed.content);

      return {
        valid: errors.filter(e => e.severity === ValidationSeverity.Error).length === 0,
        errors,
        warnings,
        detectedPatterns,
      };
    } catch (error) {
      errors.push({
        category: ValidationCategory.Content,
        message: `Failed to read or parse memory log: ${(error as Error).message}`,
        severity: ValidationSeverity.Error,
      });

      return {
        valid: false,
        errors,
        warnings,
        detectedPatterns: {
          completionMarkers: [],
          errorIndicators: [],
          blockerIndicators: [],
        },
      };
    }
  }

  /**
   * Check frontmatter fields
   *
   * @param frontmatter - Parsed frontmatter data
   * @returns Validation errors
   */
  checkFrontmatter(frontmatter: Record<string, unknown>): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check required fields
    if (!frontmatter.agent || typeof frontmatter.agent !== 'string') {
      errors.push({
        category: ValidationCategory.Frontmatter,
        field: 'agent',
        message: 'Missing or invalid required field: agent',
        severity: ValidationSeverity.Error,
      });
    }

    if (!frontmatter.task_ref || typeof frontmatter.task_ref !== 'string') {
      errors.push({
        category: ValidationCategory.Frontmatter,
        field: 'task_ref',
        message: 'Missing or invalid required field: task_ref',
        severity: ValidationSeverity.Error,
      });
    }

    // Validate status field
    const validStatuses = ['Completed', 'Partial', 'Blocked', 'Error', 'InProgress'];
    if (!frontmatter.status || typeof frontmatter.status !== 'string') {
      errors.push({
        category: ValidationCategory.Frontmatter,
        field: 'status',
        message: 'Missing or invalid required field: status',
        severity: ValidationSeverity.Error,
      });
    } else if (!validStatuses.includes(frontmatter.status)) {
      errors.push({
        category: ValidationCategory.Frontmatter,
        field: 'status',
        message: `Invalid status value: ${frontmatter.status}. Must be one of: ${validStatuses.join(', ')}`,
        severity: ValidationSeverity.Error,
      });
    }

    // Validate boolean flags
    const booleanFlags = ['ad_hoc_delegation', 'compatibility_issues', 'important_findings'];
    for (const flag of booleanFlags) {
      if (frontmatter[flag] !== undefined && typeof frontmatter[flag] !== 'boolean') {
        errors.push({
          category: ValidationCategory.Frontmatter,
          field: flag,
          message: `Field ${flag} must be boolean (true/false)`,
          severity: ValidationSeverity.Error,
        });
      }
    }

    return errors;
  }

  /**
   * Check markdown structure
   *
   * @param content - Markdown content
   * @param frontmatter - Frontmatter data
   * @returns Validation errors
   */
  checkMarkdownStructure(
    content: string,
    frontmatter: Record<string, unknown>
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check required sections
    const requiredSections = ['Summary', 'Details', 'Output', 'Issues', 'Next Steps'];
    for (const section of requiredSections) {
      if (!this.hasSectionHeading(content, section)) {
        errors.push({
          category: ValidationCategory.Structure,
          message: `Missing required section: ## ${section}`,
          severity: ValidationSeverity.Error,
        });
      }
    }

    // Check conditional sections based on frontmatter flags
    if (frontmatter.compatibility_issues === true) {
      if (!this.hasSectionHeading(content, 'Compatibility Concerns')) {
        errors.push({
          category: ValidationCategory.Structure,
          message: 'compatibility_issues is true but section "## Compatibility Concerns" is missing',
          severity: ValidationSeverity.Error,
        });
      }
    }

    if (frontmatter.ad_hoc_delegation === true) {
      if (!this.hasSectionHeading(content, 'Ad-Hoc Agent Delegation')) {
        errors.push({
          category: ValidationCategory.Structure,
          message: 'ad_hoc_delegation is true but section "## Ad-Hoc Agent Delegation" is missing',
          severity: ValidationSeverity.Error,
        });
      }
    }

    if (frontmatter.important_findings === true) {
      if (!this.hasSectionHeading(content, 'Important Findings')) {
        errors.push({
          category: ValidationCategory.Structure,
          message: 'important_findings is true but section "## Important Findings" is missing',
          severity: ValidationSeverity.Error,
        });
      }
    }

    // Validate section headers use correct level (##)
    const invalidHeaders = content.match(/^###\s+(Summary|Details|Output|Issues|Next Steps)/gm);
    if (invalidHeaders) {
      errors.push({
        category: ValidationCategory.Structure,
        message: `Section headers must use ## not ###: ${invalidHeaders.join(', ')}`,
        severity: ValidationSeverity.Warning,
      });
    }

    return errors;
  }

  /**
   * Check completion criteria for Completed status
   *
   * @param content - Markdown content
   * @returns Validation errors
   */
  checkCompletionCriteria(content: string): ValidationError[] {
    const errors: ValidationError[] = [];

    // Extract sections
    const summary = this.extractSection(content, 'Summary');
    const details = this.extractSection(content, 'Details');
    const output = this.extractSection(content, 'Output');
    const issues = this.extractSection(content, 'Issues');

    // Check Summary section
    if (!summary || summary.trim().length === 0) {
      errors.push({
        category: ValidationCategory.CompletionCriteria,
        message: 'Summary section is empty. Must contain 1-2 sentences describing outcome.',
        severity: ValidationSeverity.Error,
      });
    } else if (summary.includes('[To be filled upon completion]')) {
      errors.push({
        category: ValidationCategory.CompletionCriteria,
        message: 'Summary section contains placeholder text.',
        severity: ValidationSeverity.Error,
      });
    }

    // Check Details section
    if (!details || details.trim().length === 0) {
      errors.push({
        category: ValidationCategory.CompletionCriteria,
        message: 'Details section is empty. Must describe work performed.',
        severity: ValidationSeverity.Error,
      });
    } else if (details.includes('[Work performed')) {
      errors.push({
        category: ValidationCategory.CompletionCriteria,
        message: 'Details section contains placeholder text.',
        severity: ValidationSeverity.Error,
      });
    }

    // Check Output section
    if (!output || output.trim().length === 0) {
      errors.push({
        category: ValidationCategory.CompletionCriteria,
        message: 'Output section is empty. Must list deliverables with file paths.',
        severity: ValidationSeverity.Error,
      });
    } else if (output.includes('[File paths')) {
      errors.push({
        category: ValidationCategory.CompletionCriteria,
        message: 'Output section contains placeholder text.',
        severity: ValidationSeverity.Error,
      });
    }

    // Check Issues section indicates resolution (structure check already verified it exists)
    if (issues.trim().length === 0) {
      errors.push({
        category: ValidationCategory.CompletionCriteria,
        message: 'Issues section is empty. Must indicate "None" or describe resolved issues.',
        severity: ValidationSeverity.Warning,
      });
    }

    // Check for test results mention in Output
    if (output && !this.mentionsTestResults(output)) {
      errors.push({
        category: ValidationCategory.CompletionCriteria,
        message: 'Output section should mention test results (pass rate, coverage).',
        severity: ValidationSeverity.Warning,
      });
    }

    return errors;
  }

  /**
   * Detect progress patterns (for ProgressMonitor integration)
   *
   * @param content - Markdown content
   * @returns Detected patterns
   */
  detectProgressPatterns(content: string): DetectedPatterns {
    const completionMarkers: string[] = [];
    const errorIndicators: string[] = [];
    const blockerIndicators: string[] = [];

    // Completion marker patterns (from Task 4.2 ProgressMonitor)
    const completionPatterns = [
      /✓/g,
      /✅/g,
      /\[x\]/gi,
      /\[X\]/g,
      /COMPLETE/gi,
      /COMPLETED/gi,
      /status:\s*completed/gi,
      /Task.*Complete/gi,
    ];

    for (const pattern of completionPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        completionMarkers.push(...matches);
      }
    }

    // Error indicator patterns
    const errorPatterns = [
      /ERROR/g,
      /FAILED/g,
      /Exception/g,
      /Error:/g,
      /test.*fail/gi,
    ];

    for (const pattern of errorPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        errorIndicators.push(...matches);
      }
    }

    // Blocker indicator patterns
    const blockerPatterns = [
      /BLOCKED/gi,
      /blocked by/gi,
      /waiting for/gi,
      /cannot proceed/gi,
      /dependency.*incomplete/gi,
    ];

    for (const pattern of blockerPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        blockerIndicators.push(...matches);
      }
    }

    return {
      completionMarkers,
      errorIndicators,
      blockerIndicators,
    };
  }

  /**
   * Check if content has a section heading
   *
   * @param content - Markdown content
   * @param heading - Section heading (without ##)
   * @returns True if heading exists
   */
  private hasSectionHeading(content: string, heading: string): boolean {
    const pattern = new RegExp(`^##\\s+${heading}\\s*$`, 'im');
    return pattern.test(content);
  }

  /**
   * Extract section content by heading
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
   * Check if text mentions test results
   *
   * @param text - Text to check
   * @returns True if test results mentioned
   */
  private mentionsTestResults(text: string): boolean {
    const testPatterns = [
      /test.*pass/i,
      /pass.*rate/i,
      /coverage/i,
      /\d+\s*tests/i,
      /\d+%\s*coverage/i,
      /all tests/i,
    ];

    return testPatterns.some(pattern => pattern.test(text));
  }
}

/**
 * Create a MemoryLogValidator instance
 *
 * @returns MemoryLogValidator instance
 */
export function createMemoryLogValidator(): MemoryLogValidator {
  return new MemoryLogValidator();
}
