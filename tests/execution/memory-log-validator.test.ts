/**
 * Tests for Memory Log Validator
 *
 * Validates memory logs against Memory_Log_Guide.md format requirements.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  MemoryLogValidator,
  createMemoryLogValidator,
  ValidationSeverity,
  ValidationCategory,
} from '../../src/execution/memory-log-validator.js';

describe('MemoryLogValidator', () => {
  let validator: MemoryLogValidator;
  let tempDir: string;

  beforeEach(async () => {
    validator = createMemoryLogValidator();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-log-validator-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper: Create test memory log file
   */
  async function createMemoryLog(filename: string, content: string): Promise<string> {
    const filePath = path.join(tempDir, filename);
    await fs.writeFile(filePath, content, 'utf-8');
    return filePath;
  }

  describe('Valid Memory Logs', () => {
    it('should validate a complete valid memory log', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log: Task 4.3

## Summary
Successfully implemented task receiver with 28 tests passing at 95.79% coverage.

## Details
Implemented task receipt and parsing functionality:
- Created TaskReceiver class with gray-matter YAML parsing
- Implemented validation for required fields
- Added dependency data loading from memory logs
- Fixed regex patterns for markdown section extraction

## Output
- Created \`src/execution/task-receiver.ts\` (476 lines)
- Created \`tests/execution/task-receiver.test.ts\` (718 lines, 28 tests)
- All tests passing with 95.79% coverage

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('valid-completed.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(true);
      // Should have no errors (warnings are acceptable)
      const actualErrors = result.errors.filter(e => e.severity === ValidationSeverity.Error);
      expect(actualErrors).toHaveLength(0);
    });

    it('should validate memory log with InProgress status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: InProgress
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log: Task 4.3

## Summary
[To be filled upon completion]

## Details
Working on implementation...

## Output
[File paths for created/modified files]

## Issues
None

## Next Steps
Continue implementation
`;

      const logPath = await createMemoryLog('valid-inprogress.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate memory log with conditional sections', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
ad_hoc_delegation: true
compatibility_issues: true
important_findings: true
---

# Task Log: Task 4.3

## Summary
Completed with important findings.

## Details
Implementation details here.

## Output
- File created

## Issues
None

## Next Steps
None

## Compatibility Concerns
Found some compatibility issues with Node.js versions.

## Ad-Hoc Agent Delegation
Delegated debugging task to ad-hoc agent.

## Important Findings
- Discovery 1
- Discovery 2
`;

      const logPath = await createMemoryLog('valid-conditional.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(true);
      // May have warnings but no errors
      const actualErrors = result.errors.filter(e => e.severity === ValidationSeverity.Error);
      expect(actualErrors).toHaveLength(0);
    });
  });

  describe('Frontmatter Validation', () => {
    it('should reject missing agent field', async () => {
      const content = `---
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Test

## Details
Test

## Output
Test

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('missing-agent.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Frontmatter,
          field: 'agent',
          message: 'Missing or invalid required field: agent',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject missing task_ref field', async () => {
      const content = `---
agent: Agent_Test
status: Completed
---

# Task Log

## Summary
Test

## Details
Test

## Output
Test

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('missing-task-ref.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Frontmatter,
          field: 'task_ref',
          message: 'Missing or invalid required field: task_ref',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject missing status field', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
---

# Task Log

## Summary
Test

## Details
Test

## Output
Test

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('missing-status.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Frontmatter,
          field: 'status',
          message: 'Missing or invalid required field: status',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject invalid status value', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: InvalidStatus
---

# Task Log

## Summary
Test

## Details
Test

## Output
Test

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('invalid-status.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Frontmatter,
          field: 'status',
          severity: ValidationSeverity.Error,
        })
      );
      expect(result.errors.find(e => e.field === 'status')?.message).toContain('Invalid status value');
    });

    it('should accept all valid status values', async () => {
      const validStatuses = ['Completed', 'Partial', 'Blocked', 'Error', 'InProgress'];

      for (const status of validStatuses) {
        const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: ${status}
---

# Task Log

## Summary
Test

## Details
Test

## Output
Test

## Issues
None

## Next Steps
None
`;

        const logPath = await createMemoryLog(`valid-status-${status}.md`, content);
        const result = await validator.validateMemoryLog(logPath);

        const statusErrors = result.errors.filter(e => e.field === 'status');
        expect(statusErrors).toHaveLength(0);
      }
    });

    it('should reject non-boolean ad_hoc_delegation', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
ad_hoc_delegation: "yes"
---

# Task Log

## Summary
Test

## Details
Test

## Output
Test

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('invalid-boolean.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Frontmatter,
          field: 'ad_hoc_delegation',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject non-boolean compatibility_issues', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
compatibility_issues: 1
---

# Task Log

## Summary
Test

## Details
Test

## Output
Test

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('invalid-compatibility.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Frontmatter,
          field: 'compatibility_issues',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject non-boolean important_findings', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
important_findings: null
---

# Task Log

## Summary
Test

## Details
Test

## Output
Test

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('invalid-findings.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Frontmatter,
          field: 'important_findings',
          severity: ValidationSeverity.Error,
        })
      );
    });
  });

  describe('Markdown Structure Validation', () => {
    it('should reject missing Summary section', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Details
Test

## Output
Test

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('missing-summary.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Structure,
          message: 'Missing required section: ## Summary',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject missing Details section', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Test

## Output
Test

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('missing-details.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Structure,
          message: 'Missing required section: ## Details',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject missing Output section', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Test

## Details
Test

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('missing-output.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Structure,
          message: 'Missing required section: ## Output',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject missing Issues section', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Test

## Details
Test

## Output
Test

## Next Steps
None
`;

      const logPath = await createMemoryLog('missing-issues.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Structure,
          message: 'Missing required section: ## Issues',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject missing Next Steps section', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Test

## Details
Test

## Output
Test

## Issues
None
`;

      const logPath = await createMemoryLog('missing-next-steps.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Structure,
          message: 'Missing required section: ## Next Steps',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject missing Compatibility Concerns when flag is true', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
compatibility_issues: true
---

# Task Log

## Summary
Test

## Details
Test

## Output
Test

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('missing-compatibility-section.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Structure,
          message: 'compatibility_issues is true but section "## Compatibility Concerns" is missing',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject missing Ad-Hoc Agent Delegation when flag is true', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
ad_hoc_delegation: true
---

# Task Log

## Summary
Test

## Details
Test

## Output
Test

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('missing-adhoc-section.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Structure,
          message: 'ad_hoc_delegation is true but section "## Ad-Hoc Agent Delegation" is missing',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject missing Important Findings when flag is true', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
important_findings: true
---

# Task Log

## Summary
Test

## Details
Test

## Output
Test

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('missing-findings-section.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Structure,
          message: 'important_findings is true but section "## Important Findings" is missing',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should warn about invalid header levels', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

### Summary
Using wrong header level

## Details
Test

### Output
Wrong level again

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('invalid-header-levels.md', content);
      const result = await validator.validateMemoryLog(logPath);

      // Should have warnings about header levels
      const headerWarnings = result.errors.filter(
        e =>
          e.category === ValidationCategory.Structure &&
          e.message.includes('Section headers must use ## not ###')
      );
      expect(headerWarnings.length).toBeGreaterThan(0);
      expect(headerWarnings[0].severity).toBe(ValidationSeverity.Warning);
    });
  });

  describe('Completion Criteria Validation', () => {
    it('should reject empty Summary for Completed status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary

## Details
Implementation completed successfully.

## Output
- File created

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('empty-summary.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.CompletionCriteria,
          message: 'Summary section is empty. Must contain 1-2 sentences describing outcome.',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject Summary with placeholder text', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
[To be filled upon completion]

## Details
Implementation completed.

## Output
- File created

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('summary-placeholder.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.CompletionCriteria,
          message: 'Summary section contains placeholder text.',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject empty Details for Completed status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Task completed successfully.

## Details

## Output
- File created

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('empty-details.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.CompletionCriteria,
          message: 'Details section is empty. Must describe work performed.',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject Details with placeholder text', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Task completed successfully.

## Details
[Work performed will be documented here]

## Output
- File created

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('details-placeholder.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.CompletionCriteria,
          message: 'Details section contains placeholder text.',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject empty Output for Completed status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Task completed successfully.

## Details
Implementation work completed.

## Output

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('empty-output.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.CompletionCriteria,
          message: 'Output section is empty. Must list deliverables with file paths.',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should reject Output with placeholder text', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Task completed successfully.

## Details
Implementation work completed.

## Output
[File paths to be added]

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('output-placeholder.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.CompletionCriteria,
          message: 'Output section contains placeholder text.',
          severity: ValidationSeverity.Error,
        })
      );
    });

    it('should warn on empty Issues section for Completed status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Task completed successfully with 100% test pass rate.

## Details
Implementation work completed.

## Output
- File created with 100% tests passing

## Issues

## Next Steps
None
`;

      const logPath = await createMemoryLog('empty-issues.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.CompletionCriteria,
          message: 'Issues section is empty. Must indicate "None" or describe resolved issues.',
          severity: ValidationSeverity.Warning,
        })
      );
    });

    it('should warn when Output does not mention test results', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Task completed successfully.

## Details
Implementation work completed.

## Output
- Created src/execution/task-receiver.ts
- Created tests/execution/task-receiver.test.ts

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('no-test-results.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.CompletionCriteria,
          message: 'Output section should mention test results (pass rate, coverage).',
          severity: ValidationSeverity.Warning,
        })
      );
    });

    it('should accept Output with test results mentioned', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Task completed successfully with all tests passing.

## Details
Implementation work completed.

## Output
- Created src/execution/task-receiver.ts
- Created tests/execution/task-receiver.test.ts (28 tests, 95.79% coverage)
- All tests passing

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('with-test-results.md', content);
      const result = await validator.validateMemoryLog(logPath);

      const testWarnings = result.errors.filter(
        e =>
          e.category === ValidationCategory.CompletionCriteria &&
          e.message.includes('test results')
      );
      expect(testWarnings).toHaveLength(0);
    });
  });

  describe('Progress Pattern Detection', () => {
    it('should detect completion markers', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Task completed successfully.

## Details
- ✓ Implemented task receiver
- ✅ All tests passing
- [x] Coverage above 80%
- [X] Documentation complete
- COMPLETED all objectives
- Task Complete

## Output
Test

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('completion-markers.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.detectedPatterns.completionMarkers.length).toBeGreaterThan(0);
      expect(result.detectedPatterns.completionMarkers).toContain('✓');
      expect(result.detectedPatterns.completionMarkers).toContain('✅');
    });

    it('should detect error indicators', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Error
---

# Task Log

## Summary
Task encountered errors.

## Details
- ERROR: Failed to parse YAML
- FAILED test execution
- Exception thrown during validation
- Error: Invalid format
- test failed

## Output
None

## Issues
Multiple test failures

## Next Steps
Fix errors
`;

      const logPath = await createMemoryLog('error-indicators.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.detectedPatterns.errorIndicators.length).toBeGreaterThan(0);
      expect(result.detectedPatterns.errorIndicators).toContain('ERROR');
      expect(result.detectedPatterns.errorIndicators).toContain('FAILED');
    });

    it('should detect blocker indicators', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Blocked
---

# Task Log

## Summary
Task is BLOCKED.

## Details
- BLOCKED by missing dependency
- Blocked by upstream task
- Waiting for Task 4.2 to complete
- Cannot proceed without API key
- Dependency Task 4.1 incomplete

## Output
None

## Issues
Blocked waiting for dependencies

## Next Steps
Wait for Task 4.2
`;

      const logPath = await createMemoryLog('blocker-indicators.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.detectedPatterns.blockerIndicators.length).toBeGreaterThan(0);
      expect(result.detectedPatterns.blockerIndicators.some(i => i.toLowerCase().includes('blocked'))).toBe(
        true
      );
    });

    it('should detect multiple pattern types simultaneously', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Partial
---

# Task Log

## Summary
Task partially completed with some issues.

## Details
- ✓ Implemented core functionality
- ERROR: Integration test failed
- BLOCKED by external API dependency
- ✅ Unit tests passing
- Waiting for API access

## Output
- Partial implementation

## Issues
Some blockers remain

## Next Steps
Resolve blockers
`;

      const logPath = await createMemoryLog('mixed-patterns.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.detectedPatterns.completionMarkers.length).toBeGreaterThan(0);
      expect(result.detectedPatterns.errorIndicators.length).toBeGreaterThan(0);
      expect(result.detectedPatterns.blockerIndicators.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle file not found error', async () => {
      const nonExistentPath = path.join(tempDir, 'non-existent.md');
      const result = await validator.validateMemoryLog(nonExistentPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          category: ValidationCategory.Content,
          severity: ValidationSeverity.Error,
        })
      );
      expect(result.errors[0].message).toContain('Failed to read or parse memory log');
    });

    it('should handle malformed YAML gracefully', async () => {
      const content = `---
agent: Agent_Test
task_ref: "Task 4.3"
status: Completed
invalid yaml here { no closing
---

# Task Log

## Summary
Test

## Details
Test

## Output
Test

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('malformed-yaml.md', content);
      const result = await validator.validateMemoryLog(logPath);

      // gray-matter handles malformed YAML by returning empty frontmatter
      // Validation should catch missing required fields
      expect(result.valid).toBe(false);
    });

    it('should handle multiple validation errors', async () => {
      const content = `---
status: InvalidStatus
---

# Task Log

## Summary
Test
`;

      const logPath = await createMemoryLog('multiple-errors.md', content);
      const result = await validator.validateMemoryLog(logPath);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);

      // Should have errors for missing agent, missing task_ref, invalid status, missing sections
      const categories = result.errors.map(e => e.category);
      expect(categories).toContain(ValidationCategory.Frontmatter);
      expect(categories).toContain(ValidationCategory.Structure);
    });

    it('should not apply completion criteria to InProgress status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: InProgress
---

# Task Log

## Summary
[To be filled upon completion]

## Details
[Work in progress]

## Output
[To be added]

## Issues
None

## Next Steps
Continue work
`;

      const logPath = await createMemoryLog('inprogress-placeholders.md', content);
      const result = await validator.validateMemoryLog(logPath);

      // Should be valid - completion criteria only apply to Completed status
      expect(result.valid).toBe(true);

      // Should not have completion criteria errors
      const completionErrors = result.errors.filter(
        e => e.category === ValidationCategory.CompletionCriteria
      );
      expect(completionErrors).toHaveLength(0);
    });
  });

  describe('Factory Function', () => {
    it('should create validator instance via factory', () => {
      const validator = createMemoryLogValidator();
      expect(validator).toBeInstanceOf(MemoryLogValidator);
    });
  });
});
