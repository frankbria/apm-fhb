/**
 * Tests for LogValidator
 *
 * Validates comprehensive memory log validation with strictness levels,
 * section checking, frontmatter validation, and completion criteria enforcement.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LogValidator, ValidationStrictness } from '../../src/completion/log-validator';
import fs from 'fs/promises';
import path from 'path';

describe('LogValidator', () => {
  let validator: LogValidator;
  let tempDir: string;

  beforeEach(async () => {
    validator = new LogValidator();
    tempDir = path.join(process.cwd(), 'test-log-validator');
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Required Sections Validation', () => {
    it('should validate all required sections present', async () => {
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
Task completed.

## Details
Work performed successfully.

## Output
- File created

## Issues
None

## Next Steps
None
`;

      const logPath = path.join(tempDir, 'complete.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await validator.validateMemoryLog(logPath);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing Summary section', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 1.2
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Details
Work performed.

## Output
- File created

## Issues
None

## Next Steps
None
`;

      const logPath = path.join(tempDir, 'no-summary.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await validator.validateMemoryLog(logPath);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({
        message: expect.stringContaining('Summary')
      }));
    });

    it('should detect missing Details section', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 1.3
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Completed.

## Output
- File created

## Issues
None

## Next Steps
None
`;

      const logPath = path.join(tempDir, 'no-details.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await validator.validateMemoryLog(logPath);
      expect(result.valid).toBe(false);
    });

    it('should detect missing Output section', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 1.4
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Completed.

## Details
Work done.

## Issues
None

## Next Steps
None
`;

      const logPath = path.join(tempDir, 'no-output.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await validator.validateMemoryLog(logPath);
      expect(result.valid).toBe(false);
    });
  });

  describe('Conditional Sections Validation', () => {
    it('should require Compatibility Concerns when flag is true', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 2.1
status: Completed
ad_hoc_delegation: false
compatibility_issues: true
important_findings: false
---

# Task Log

## Summary
Completed.

## Details
Work done.

## Output
- File

## Issues
None

## Next Steps
None
`;

      const logPath = path.join(tempDir, 'missing-compat.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await validator.validateMemoryLog(logPath);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({
        message: expect.stringContaining('Compatibility Concerns')
      }));
    });

    it('should require Ad-Hoc Agent Delegation when flag is true', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 2.2
status: Completed
ad_hoc_delegation: true
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Completed.

## Details
Work done.

## Output
- File

## Issues
None

## Next Steps
None
`;

      const logPath = path.join(tempDir, 'missing-adhoc.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await validator.validateMemoryLog(logPath);
      expect(result.valid).toBe(false);
    });

    it('should require Important Findings when flag is true', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 2.3
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: true
---

# Task Log

## Summary
Completed.

## Details
Work done.

## Output
- File

## Issues
None

## Next Steps
None
`;

      const logPath = path.join(tempDir, 'missing-findings.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await validator.validateMemoryLog(logPath);
      expect(result.valid).toBe(false);
    });
  });

  describe('Frontmatter Validation', () => {
    it('should validate agent field', async () => {
      const memoryLog = `---
task_ref: Task 3.1
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Test
`;

      const logPath = path.join(tempDir, 'no-agent.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await validator.validateMemoryLog(logPath);
      expect(result.errors).toContainEqual(expect.objectContaining({
        field: 'agent'
      }));
    });

    it('should validate task_ref field', async () => {
      const memoryLog = `---
agent: Agent_Test
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Test
`;

      const logPath = path.join(tempDir, 'no-taskref.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await validator.validateMemoryLog(logPath);
      expect(result.errors).toContainEqual(expect.objectContaining({
        field: 'task_ref'
      }));
    });

    it('should validate status field values', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 3.3
status: InvalidStatus
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Test
`;

      const logPath = path.join(tempDir, 'invalid-status.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await validator.validateMemoryLog(logPath);
      expect(result.errors).toContainEqual(expect.objectContaining({
        field: 'status'
      }));
    });

    it('should validate boolean flags', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 3.4
status: Completed
ad_hoc_delegation: "yes"
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Test
`;

      const logPath = path.join(tempDir, 'invalid-bool.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await validator.validateMemoryLog(logPath);
      expect(result.errors).toContainEqual(expect.objectContaining({
        field: 'ad_hoc_delegation'
      }));
    });
  });

  describe('Completion Marker Syntax', () => {
    it('should detect incorrect header level (### instead of ##)', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 4.1
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

### Summary
Test

## Details
Work

## Output
File

## Issues
None

## Next Steps
None
`;

      const logPath = path.join(tempDir, 'wrong-header.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await validator.validateMemoryLog(logPath);
      expect(result.warnings).toBeDefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Deliverables Validation', () => {
    it('should warn if Output section empty for Completed status', async () => {
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

## Details
Work done.

## Output

## Issues
None

## Next Steps
None
`;

      const logPath = path.join(tempDir, 'empty-output.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await validator.validateMemoryLog(logPath);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Strictness Levels', () => {
    it('should use strict validation mode', async () => {
      const strictValidator = new LogValidator({ strictness: ValidationStrictness.Strict });

      const memoryLog = `---
agent: Agent_Test
task_ref: Task 6.1
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Test

## Details
Work

## Output
File

## Issues
None

## Next Steps
None
`;

      const logPath = path.join(tempDir, 'strict.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await strictValidator.validateMemoryLog(logPath);
      expect(result).toBeDefined();
    });

    it('should use lenient validation mode', async () => {
      const lenientValidator = new LogValidator({ strictness: ValidationStrictness.Lenient });

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
Test
`;

      const logPath = path.join(tempDir, 'lenient.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await lenientValidator.validateMemoryLog(logPath);
      // Lenient mode should be more forgiving
      expect(result).toBeDefined();
    });

    it('should use audit validation mode', async () => {
      const auditValidator = new LogValidator({ strictness: ValidationStrictness.Audit });

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
Test
`;

      const logPath = path.join(tempDir, 'audit.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await auditValidator.validateMemoryLog(logPath);
      // Audit mode logs all issues but doesn't block
      expect(result.valid).toBe(true);
    });
  });

  describe('Validation Report Generation', () => {
    it('should generate comprehensive validation report', async () => {
      const memoryLog = `---
agent: Agent_Test
task_ref: Task 7.1
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log

## Summary
Test

## Details
Work

## Output
- File 1
- File 2

## Issues
None

## Next Steps
None
`;

      const logPath = path.join(tempDir, 'report.md');
      await fs.writeFile(logPath, memoryLog);

      const result = await validator.validateMemoryLog(logPath);
      expect(result.sectionsPresent).toBeDefined();
      expect(result.formatCorrect).toBe(true);
      expect(result.contentComplete).toBe(true);
    });
  });
});
