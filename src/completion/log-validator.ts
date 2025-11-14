/**
 * Memory Log Format Validation
 *
 * Comprehensive memory log validator ensuring completion log quality with
 * strictness levels, section checking, frontmatter validation, and completion criteria.
 */

import fs from 'fs/promises';
import matter from 'gray-matter';

/**
 * Validation strictness level
 */
export enum ValidationStrictness {
  Strict = 'strict',
  Lenient = 'lenient',
  Audit = 'audit',
}

/**
 * Validation error
 */
export interface ValidationError {
  /** Error field */
  field?: string;
  /** Error message */
  message: string;
  /** Severity */
  severity: 'error' | 'warning';
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Is valid */
  valid: boolean;
  /** Sections present */
  sectionsPresent: string[];
  /** Format correct */
  formatCorrect: boolean;
  /** Content complete */
  contentComplete: boolean;
  /** Errors */
  errors: ValidationError[];
  /** Warnings */
  warnings: ValidationError[];
}

/**
 * Log validator configuration
 */
export interface LogValidatorConfig {
  /** Validation strictness */
  strictness?: ValidationStrictness;
}

/**
 * Log Validator
 * Validates memory logs against Memory_Log_Guide.md format
 */
export class LogValidator {
  private readonly strictness: ValidationStrictness;

  constructor(config: LogValidatorConfig = {}) {
    this.strictness = config.strictness ?? ValidationStrictness.Strict;
  }

  /**
   * Validate memory log
   *
   * @param memoryLogPath - Path to memory log file
   * @returns Validation result
   */
  async validateMemoryLog(memoryLogPath: string): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const sectionsPresent: string[] = [];

    try {
      // Read memory log
      const content = await fs.readFile(memoryLogPath, 'utf-8');

      // Parse YAML frontmatter
      let parsed;
      try {
        parsed = matter(content);
      } catch (error) {
        errors.push({
          message: 'Failed to parse YAML frontmatter',
          severity: 'error',
        });
        return {
          valid: false,
          sectionsPresent: [],
          formatCorrect: false,
          contentComplete: false,
          errors,
          warnings,
        };
      }

      const frontmatter = parsed.data;
      const markdownContent = parsed.content;

      // Validate frontmatter
      this.validateFrontmatter(frontmatter, errors);

      // Validate sections
      const requiredSections = ['Summary', 'Details', 'Output', 'Issues', 'Next Steps'];
      for (const section of requiredSections) {
        if (this.hasSectionHeading(markdownContent, section)) {
          sectionsPresent.push(section);
        } else {
          if (this.strictness !== ValidationStrictness.Lenient) {
            errors.push({
              message: `Missing required section: ## ${section}`,
              severity: 'error',
            });
          }
        }
      }

      // Validate conditional sections
      if (frontmatter.compatibility_issues === true) {
        if (!this.hasSectionHeading(markdownContent, 'Compatibility Concerns')) {
          errors.push({
            message: 'compatibility_issues is true but section "## Compatibility Concerns" is missing',
            severity: 'error',
          });
        }
      }

      if (frontmatter.ad_hoc_delegation === true) {
        if (!this.hasSectionHeading(markdownContent, 'Ad-Hoc Agent Delegation')) {
          errors.push({
            message: 'ad_hoc_delegation is true but section "## Ad-Hoc Agent Delegation" is missing',
            severity: 'error',
          });
        }
      }

      if (frontmatter.important_findings === true) {
        if (!this.hasSectionHeading(markdownContent, 'Important Findings')) {
          errors.push({
            message: 'important_findings is true but section "## Important Findings" is missing',
            severity: 'error',
          });
        }
      }

      // Check header levels
      const invalidHeaders = markdownContent.match(/^###\s+(Summary|Details|Output|Issues|Next Steps)/gm);
      if (invalidHeaders) {
        warnings.push({
          message: `Section headers should use ## not ###: ${invalidHeaders.join(', ')}`,
          severity: 'warning',
        });
      }

      // Check Output section for Completed status
      if (frontmatter.status === 'Completed') {
        const outputSection = this.extractSection(markdownContent, 'Output');
        if (!outputSection || outputSection.trim().length === 0) {
          warnings.push({
            message: 'Output section is empty for Completed status',
            severity: 'warning',
          });
        }
      }

      // Determine validity based on strictness
      let valid = false;
      if (this.strictness === ValidationStrictness.Audit) {
        // Audit mode: always valid, just log issues
        valid = true;
      } else if (this.strictness === ValidationStrictness.Lenient) {
        // Lenient mode: only errors block
        valid = errors.length === 0;
      } else {
        // Strict mode: errors block
        valid = errors.length === 0;
      }

      return {
        valid,
        sectionsPresent,
        formatCorrect: errors.length === 0 && warnings.length === 0,
        contentComplete: sectionsPresent.length === requiredSections.length,
        errors,
        warnings,
      };
    } catch (error) {
      errors.push({
        message: `Failed to validate memory log: ${(error as Error).message}`,
        severity: 'error',
      });

      return {
        valid: false,
        sectionsPresent: [],
        formatCorrect: false,
        contentComplete: false,
        errors,
        warnings,
      };
    }
  }

  /**
   * Validate frontmatter fields
   */
  private validateFrontmatter(frontmatter: Record<string, unknown>, errors: ValidationError[]): void {
    // Check required fields
    if (!frontmatter.agent || typeof frontmatter.agent !== 'string') {
      errors.push({
        field: 'agent',
        message: 'Missing or invalid required field: agent',
        severity: 'error',
      });
    }

    if (!frontmatter.task_ref || typeof frontmatter.task_ref !== 'string') {
      errors.push({
        field: 'task_ref',
        message: 'Missing or invalid required field: task_ref',
        severity: 'error',
      });
    }

    // Validate status field
    const validStatuses = ['Completed', 'Partial', 'Blocked', 'Error', 'InProgress'];
    if (!frontmatter.status || typeof frontmatter.status !== 'string') {
      errors.push({
        field: 'status',
        message: 'Missing or invalid required field: status',
        severity: 'error',
      });
    } else if (!validStatuses.includes(frontmatter.status)) {
      errors.push({
        field: 'status',
        message: `Invalid status value: ${frontmatter.status}. Must be one of: ${validStatuses.join(', ')}`,
        severity: 'error',
      });
    }

    // Validate boolean flags
    const booleanFlags = ['ad_hoc_delegation', 'compatibility_issues', 'important_findings'];
    for (const flag of booleanFlags) {
      if (frontmatter[flag] !== undefined && typeof frontmatter[flag] !== 'boolean') {
        errors.push({
          field: flag,
          message: `Field ${flag} must be boolean (true/false)`,
          severity: 'error',
        });
      }
    }
  }

  /**
   * Check if content has section heading
   */
  private hasSectionHeading(content: string, heading: string): boolean {
    const pattern = new RegExp(`^##\\s+${heading}\\s*$`, 'im');
    return pattern.test(content);
  }

  /**
   * Extract section content
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
 * Create a LogValidator instance
 *
 * @param config - Validator configuration
 * @returns LogValidator instance
 */
export function createLogValidator(config?: LogValidatorConfig): LogValidator {
  return new LogValidator(config);
}
