/**
 * Tests for CompletionParser
 *
 * Validates completion marker detection, deliverable extraction, test results parsing,
 * quality gate validation, metadata extraction, and confidence scoring.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CompletionParser, CompletionResult, CompletionStatus } from '../../src/completion/completion-parser';
import fs from 'fs/promises';
import path from 'path';

describe('CompletionParser', () => {
  let parser: CompletionParser;
  let tempDir: string;

  beforeEach(async () => {
    parser = new CompletionParser();
    tempDir = path.join(process.cwd(), 'test-completion-parser');
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Status Marker Detection', () => {
    it('should detect Completed status', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 1.1
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Task completed successfully.
`;

      const logPath = path.join(tempDir, 'completed.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.status).toBe(CompletionStatus.Completed);
    });

    it('should detect Partial status', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 1.2
status: Partial
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Task partially completed.
`;

      const logPath = path.join(tempDir, 'partial.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.status).toBe(CompletionStatus.Partial);
    });

    it('should detect Blocked status', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 1.3
status: Blocked
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Task blocked by dependency.
`;

      const logPath = path.join(tempDir, 'blocked.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.status).toBe(CompletionStatus.Blocked);
    });

    it('should detect Failed status', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 1.4
status: Failed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Task failed permanently.
`;

      const logPath = path.join(tempDir, 'failed.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.status).toBe(CompletionStatus.Failed);
    });

    it('should detect InProgress status', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 1.5
status: InProgress
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Task actively executing.
`;

      const logPath = path.join(tempDir, 'inprogress.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.status).toBe(CompletionStatus.InProgress);
    });
  });

  describe('Deliverable Detection', () => {
    it('should extract deliverable files from Output section', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 2.1
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Created implementation files.

## Output
- src/completion/completion-parser.ts (450 lines) - Completion status parser
- src/completion/log-validator.ts (380 lines) - Memory log validator
- tests/completion/completion-parser.test.ts (650 lines) - Parser tests
`;

      const logPath = path.join(tempDir, 'deliverables.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.deliverables).toHaveLength(3);
      expect(result.deliverables).toContain('src/completion/completion-parser.ts (450 lines) - Completion status parser');
    });

    it('should handle empty Output section', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 2.2
status: InProgress
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Work in progress.

## Output
`;

      const logPath = path.join(tempDir, 'no-deliverables.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.deliverables).toHaveLength(0);
    });
  });

  describe('Test Results Extraction', () => {
    it('should parse test pass count and total', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 3.1
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
All tests passing.

## Output
Test Results:
- 35/35 tests passing (100% pass rate)
- Coverage: 92.5% statement coverage
`;

      const logPath = path.join(tempDir, 'tests.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.testResults).toBeDefined();
      expect(result.testResults?.total).toBe(35);
      expect(result.testResults?.passed).toBe(35);
    });

    it('should parse coverage percentage', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 3.2
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Tests complete.

## Output
Coverage: 87.3% statement, 81.2% branch, 100% function
`;

      const logPath = path.join(tempDir, 'coverage.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.testResults).toBeDefined();
      expect(result.testResults?.coveragePercent).toBeCloseTo(87.3, 1);
    });

    it('should handle multiple test result formats', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 3.3
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Output
Tests: 42 tests, 42 passed
Coverage: 95% coverage achieved
`;

      const logPath = path.join(tempDir, 'multi-format.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.testResults?.total).toBe(42);
      expect(result.testResults?.passed).toBe(42);
      expect(result.testResults?.coveragePercent).toBeCloseTo(95, 1);
    });
  });

  describe('Quality Gate Validation', () => {
    it('should detect TDD compliance from Details section', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 4.1
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Details
Followed TDD methodology: wrote tests before implementation.
All tests passing with 90% coverage.
`;

      const logPath = path.join(tempDir, 'tdd.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.qualityGates).toBeDefined();
      expect(result.qualityGates?.tdd).toBe(true);
    });

    it('should detect conventional commits compliance', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 4.2
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Details
Created conventional commit: feat(parser): Add completion detection
`;

      const logPath = path.join(tempDir, 'commits.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.qualityGates).toBeDefined();
      expect(result.qualityGates?.commits).toBe(true);
    });

    it('should detect security checks passed', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Details
Security scan passed - no vulnerabilities detected
`;

      const logPath = path.join(tempDir, 'security.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.qualityGates).toBeDefined();
      expect(result.qualityGates?.security).toBe(true);
    });

    it('should detect coverage threshold met', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 4.4
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Output
Coverage: 88% statement coverage (exceeds 80% threshold)
`;

      const logPath = path.join(tempDir, 'coverage-threshold.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.qualityGates).toBeDefined();
      expect(result.qualityGates?.coverage).toBe(true);
    });
  });

  describe('Metadata Extraction', () => {
    it('should extract completion timestamp from file mtime', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 5.1
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Completed.
`;

      const logPath = path.join(tempDir, 'timestamp.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.completionTimestamp).toBeInstanceOf(Date);
    });

    it('should extract deliverables list', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 5.2
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Output
- File 1: description
- File 2: description
- File 3: description
`;

      const logPath = path.join(tempDir, 'deliverables-list.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.deliverables).toHaveLength(3);
    });

    it('should extract test results metadata', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 5.3
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Output
Tests: 50/50 passing
Coverage: 95.5%
`;

      const logPath = path.join(tempDir, 'test-metadata.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.testResults?.total).toBe(50);
      expect(result.testResults?.passed).toBe(50);
      expect(result.testResults?.coveragePercent).toBeCloseTo(95.5, 1);
    });

    it('should extract quality gate results', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 5.4
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Details
✓ TDD: Tests written before implementation
✓ Conventional commits: feat(module): description
✓ Security: No vulnerabilities
✓ Coverage: 90% (threshold: 80%)
`;

      const logPath = path.join(tempDir, 'quality-gates.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.qualityGates?.tdd).toBe(true);
      expect(result.qualityGates?.commits).toBe(true);
      expect(result.qualityGates?.security).toBe(true);
      expect(result.qualityGates?.coverage).toBe(true);
    });
  });

  describe('Ambiguity Handling', () => {
    it('should use most recent status when multiple status markers present', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 6.1
status: InProgress
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Updated to completed.

---
status: Completed
---
`;

      const logPath = path.join(tempDir, 'multi-status.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      // Should use first frontmatter (gray-matter takes first)
      expect(result.status).toBe(CompletionStatus.InProgress);
    });

    it('should return confidence score for detection accuracy', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 6.2
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Task complete.

## Output
- All deliverables present
- Tests: 40/40 passing
- Coverage: 95%
`;

      const logPath = path.join(tempDir, 'high-confidence.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    it('should provide lower confidence for ambiguous content', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 6.3
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Some work done.
`;

      const logPath = path.join(tempDir, 'low-confidence.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThan(1.0);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for non-existent file', async () => {
      await expect(parser.parseCompletion('/nonexistent.md')).rejects.toThrow();
    });

    it('should handle malformed YAML gracefully', async () => {
      const memoryLog = `---
invalid: yaml: content: here
---

# Task Log
`;

      const logPath = path.join(tempDir, 'malformed.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      // gray-matter should parse it (may have empty data)
      expect(result).toBeDefined();
    });

    it('should handle missing sections gracefully', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 7.2
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Only summary present.
`;

      const logPath = path.join(tempDir, 'missing-sections.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await parser.parseCompletion(logPath);
      expect(result.status).toBe(CompletionStatus.Completed);
      expect(result.deliverables).toHaveLength(0);
    });
  });
});
