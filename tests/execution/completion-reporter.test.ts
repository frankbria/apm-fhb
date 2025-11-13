/**
 * Tests for Completion Reporter
 *
 * Tests completion detection, event emission, and summary generation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  CompletionReporter,
  createCompletionReporter,
  CompletionStatus,
} from '../../src/execution/completion-reporter.js';

describe('CompletionReporter', () => {
  let reporter: CompletionReporter;
  let tempDir: string;

  beforeEach(async () => {
    reporter = createCompletionReporter();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'completion-reporter-test-'));
  });

  afterEach(async () => {
    reporter.stopAllAutoDetection();
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

  describe('Completion Detection', () => {
    it('should detect completed status', async () => {
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
Implementation completed.

## Output
- Created src/execution/task-receiver.ts (476 lines)
- Created tests/execution/task-receiver.test.ts (718 lines, 28 tests)
- All tests passing with 95.79% coverage

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('completed.md', content);
      const result = await reporter.detectCompletion(logPath);

      expect(result.isCompleted).toBe(true);
      expect(result.isPartial).toBe(false);
      expect(result.summary).toBeDefined();
      expect(result.summary?.status).toBe(CompletionStatus.Completed);
      expect(result.summary?.taskRef).toBe('Task 4.3');
      expect(result.summary?.agentId).toBe('Agent_Test');
    });

    it('should detect partial status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Partial
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Task Log: Task 4.3

## Summary
Partially completed implementation with some blockers.

## Details
Implementation in progress.

## Output
- Created src/execution/task-receiver.ts (partial)

## Issues
- Blocked by missing dependency

## Next Steps
- Resolve dependency blocker
`;

      const logPath = await createMemoryLog('partial.md', content);
      const result = await reporter.detectCompletion(logPath);

      expect(result.isCompleted).toBe(false);
      expect(result.isPartial).toBe(true);
      expect(result.summary).toBeDefined();
      expect(result.summary?.status).toBe(CompletionStatus.Partial);
    });

    it('should detect not completed status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: InProgress
---

# Task Log: Task 4.3

## Summary
[To be filled upon completion]

## Details
Working on implementation.

## Output
[File paths for created/modified files]

## Issues
None

## Next Steps
Continue implementation
`;

      const logPath = await createMemoryLog('inprogress.md', content);
      const result = await reporter.detectCompletion(logPath);

      expect(result.isCompleted).toBe(false);
      expect(result.isPartial).toBe(false);
      expect(result.summary).toBeUndefined();
    });

    it('should handle file read errors', async () => {
      const nonExistentPath = path.join(tempDir, 'non-existent.md');
      const result = await reporter.detectCompletion(nonExistentPath);

      expect(result.isCompleted).toBe(false);
      expect(result.isPartial).toBe(false);
      expect(result.summary).toBeUndefined();
    });

    it('should handle malformed YAML', async () => {
      const content = `---
agent: Agent_Test
invalid yaml here {
---

# Task Log

## Summary
Test
`;

      const logPath = await createMemoryLog('malformed.md', content);
      const result = await reporter.detectCompletion(logPath);

      // gray-matter handles malformed YAML gracefully
      expect(result.isCompleted).toBe(false);
      expect(result.isPartial).toBe(false);
    });
  });

  describe('Summary Generation', () => {
    it('should extract summary text', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
This is a test summary describing the outcome.

## Details
Details here.

## Output
- Output item

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('summary-test.md', content);
      const result = await reporter.detectCompletion(logPath);

      expect(result.summary?.summary).toBe('This is a test summary describing the outcome.');
    });

    it('should extract output deliverables', async () => {
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
- Created src/execution/task-receiver.ts (476 lines)
- Created tests/execution/task-receiver.test.ts (718 lines)
- All tests passing with 95.79% coverage

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('outputs-test.md', content);
      const result = await reporter.detectCompletion(logPath);

      expect(result.summary?.outputs).toHaveLength(3);
      expect(result.summary?.outputs[0]).toContain('task-receiver.ts');
      expect(result.summary?.outputs[1]).toContain('test.ts');
      expect(result.summary?.outputs[2]).toContain('All tests passing');
    });

    it('should extract issues', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Partial
---

# Task Log

## Summary
Partial completion

## Details
Test

## Output
- Partial output

## Issues
- Test failures in integration suite
- Memory leak detected in monitoring component

## Next Steps
- Fix test failures
`;

      const logPath = await createMemoryLog('issues-test.md', content);
      const result = await reporter.detectCompletion(logPath);

      expect(result.summary?.issues).toHaveLength(2);
      expect(result.summary?.issues[0]).toContain('Test failures');
      expect(result.summary?.issues[1]).toContain('Memory leak');
    });

    it('should extract next steps', async () => {
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
- Output

## Issues
None

## Next Steps
- Update documentation
- Create follow-up task for optimization
`;

      const logPath = await createMemoryLog('nextsteps-test.md', content);
      const result = await reporter.detectCompletion(logPath);

      expect(result.summary?.nextSteps).toHaveLength(2);
      expect(result.summary?.nextSteps[0]).toContain('documentation');
      expect(result.summary?.nextSteps[1]).toContain('optimization');
    });

    it('should extract frontmatter flags', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
ad_hoc_delegation: true
compatibility_issues: true
important_findings: true
---

# Task Log

## Summary
Test with all flags enabled

## Details
Test

## Output
- Output

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('flags-test.md', content);
      const result = await reporter.detectCompletion(logPath);

      expect(result.summary?.adHocDelegation).toBe(true);
      expect(result.summary?.compatibilityIssues).toBe(true);
      expect(result.summary?.importantFindings).toBe(true);
    });

    it('should handle "None" in Issues section', async () => {
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
- Output

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('issues-none.md', content);
      const result = await reporter.detectCompletion(logPath);

      expect(result.summary?.issues).toHaveLength(0);
    });

    it('should handle empty sections', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Test summary

## Details
Test

## Output

## Issues

## Next Steps
`;

      const logPath = await createMemoryLog('empty-sections.md', content);
      const result = await reporter.detectCompletion(logPath);

      expect(result.summary?.outputs).toHaveLength(0);
      expect(result.summary?.issues).toHaveLength(0);
      expect(result.summary?.nextSteps).toHaveLength(0);
    });

    it('should handle multi-line list items', async () => {
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
- Created src/execution/task-receiver.ts with comprehensive
  implementation including validation and dependency loading
- Created comprehensive test suite with 28 tests
  covering all functionality

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('multiline-items.md', content);
      const result = await reporter.detectCompletion(logPath);

      expect(result.summary?.outputs).toHaveLength(2);
      expect(result.summary?.outputs[0]).toContain('validation and dependency loading');
      expect(result.summary?.outputs[1]).toContain('covering all functionality');
    });
  });

  describe('Event Emission', () => {
    it('should emit task_completed event for Completed status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Completed successfully

## Details
Test

## Output
- Output item

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('event-completed.md', content);

      // Listen for event
      const eventPromise = new Promise(resolve => {
        reporter.once('task_completed', resolve);
      });

      await reporter.reportCompletion(logPath);

      const event = (await eventPromise) as any;
      expect(event.taskRef).toBe('Task 4.3');
      expect(event.agentId).toBe('Agent_Test');
      expect(event.status).toBe(CompletionStatus.Completed);
      expect(event.summary).toBe('Completed successfully');
      expect(event.outputs).toHaveLength(1);
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('should emit task_partial event for Partial status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Partial
---

# Task Log

## Summary
Partially completed

## Details
Test

## Output
- Partial output

## Issues
- Blocker

## Next Steps
- Resolve blocker
`;

      const logPath = await createMemoryLog('event-partial.md', content);

      // Listen for event
      const eventPromise = new Promise(resolve => {
        reporter.once('task_partial', resolve);
      });

      await reporter.reportCompletion(logPath);

      const event = (await eventPromise) as any;
      expect(event.taskRef).toBe('Task 4.3');
      expect(event.status).toBe(CompletionStatus.Partial);
      expect(event.summary).toBe('Partially completed');
      expect(event.issues).toHaveLength(1);
    });

    it('should not emit events for InProgress status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: InProgress
---

# Task Log

## Summary
[To be filled]

## Details
Test

## Output
[To be added]

## Issues
None

## Next Steps
Continue
`;

      const logPath = await createMemoryLog('event-inprogress.md', content);

      let completedCalled = false;
      let partialCalled = false;

      reporter.once('task_completed', () => {
        completedCalled = true;
      });
      reporter.once('task_partial', () => {
        partialCalled = true;
      });

      await reporter.reportCompletion(logPath);

      // Wait a bit to ensure no events fired
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(completedCalled).toBe(false);
      expect(partialCalled).toBe(false);
    });

    it('should include all flags in event payload', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
ad_hoc_delegation: true
compatibility_issues: true
important_findings: true
---

# Task Log

## Summary
Completed with flags

## Details
Test

## Output
- Output

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('event-flags.md', content);

      const eventPromise = new Promise(resolve => {
        reporter.once('task_completed', resolve);
      });

      await reporter.reportCompletion(logPath);

      const event = (await eventPromise) as any;
      expect(event.adHocDelegation).toBe(true);
      expect(event.compatibilityIssues).toBe(true);
      expect(event.importantFindings).toBe(true);
    });
  });

  describe('Auto-Detection', () => {
    it('should poll until completion detected', async () => {
      // Create initial InProgress log
      let content = `---
agent: Agent_Test
task_ref: Task 4.3
status: InProgress
---

# Task Log

## Summary
[To be filled]

## Details
Test

## Output
[To be added]

## Issues
None

## Next Steps
Continue
`;

      const logPath = await createMemoryLog('auto-detect.md', content);

      // Enable auto-detection
      const autoReporter = createCompletionReporter({ autoDetect: true, pollingIntervalMs: 100 });

      const eventPromise = new Promise(resolve => {
        autoReporter.once('task_completed', resolve);
      });

      autoReporter.startAutoDetection('task-4.3', logPath);

      // Simulate completion after 200ms
      setTimeout(async () => {
        const completedContent = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Completed via auto-detection

## Details
Test

## Output
- Output

## Issues
None

## Next Steps
None
`;
        await fs.writeFile(logPath, completedContent, 'utf-8');
      }, 200);

      const event = (await eventPromise) as any;
      expect(event.taskRef).toBe('Task 4.3');
      expect(event.summary).toBe('Completed via auto-detection');

      autoReporter.stopAllAutoDetection();
    });

    it('should stop auto-detection when disabled', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: InProgress
---

# Task Log

## Summary
[To be filled]

## Details
Test

## Output
[To be added]

## Issues
None

## Next Steps
Continue
`;

      const logPath = await createMemoryLog('auto-disabled.md', content);

      // Disabled auto-detection
      const noAutoReporter = createCompletionReporter({ autoDetect: false });

      let eventCalled = false;
      noAutoReporter.once('task_completed', () => {
        eventCalled = true;
      });

      noAutoReporter.startAutoDetection('task-4.3', logPath);

      // Wait and verify no polling occurred
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(eventCalled).toBe(false);

      noAutoReporter.stopAllAutoDetection();
    });

    it('should stop auto-detection for specific task', async () => {
      const autoReporter = createCompletionReporter({ autoDetect: true, pollingIntervalMs: 100 });

      const logPath1 = await createMemoryLog('task1.md', '---\nstatus: InProgress\n---\n');
      const logPath2 = await createMemoryLog('task2.md', '---\nstatus: InProgress\n---\n');

      autoReporter.startAutoDetection('task-1', logPath1);
      autoReporter.startAutoDetection('task-2', logPath2);

      // Stop task-1
      autoReporter.stopAutoDetection('task-1');

      // Verify task-1 stopped but task-2 still running
      // (Internal implementation detail - timers map)
      expect((autoReporter as any).pollingTimers.has('task-1')).toBe(false);
      expect((autoReporter as any).pollingTimers.has('task-2')).toBe(true);

      autoReporter.stopAllAutoDetection();
    });

    it('should stop all auto-detection timers', async () => {
      const autoReporter = createCompletionReporter({ autoDetect: true, pollingIntervalMs: 100 });

      const logPath1 = await createMemoryLog('task1.md', '---\nstatus: InProgress\n---\n');
      const logPath2 = await createMemoryLog('task2.md', '---\nstatus: InProgress\n---\n');

      autoReporter.startAutoDetection('task-1', logPath1);
      autoReporter.startAutoDetection('task-2', logPath2);

      autoReporter.stopAllAutoDetection();

      expect((autoReporter as any).pollingTimers.size).toBe(0);
    });
  });

  describe('Factory Function', () => {
    it('should create reporter instance via factory', () => {
      const reporter = createCompletionReporter();
      expect(reporter).toBeInstanceOf(CompletionReporter);
    });

    it('should create reporter with custom config', () => {
      const reporter = createCompletionReporter({
        autoDetect: true,
        pollingIntervalMs: 1000,
      });
      expect(reporter).toBeInstanceOf(CompletionReporter);
      expect((reporter as any).config.autoDetect).toBe(true);
      expect((reporter as any).config.pollingIntervalMs).toBe(1000);
    });
  });
});
