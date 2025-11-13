/**
 * Tests for Error Escalator
 *
 * Tests blocker detection, categorization, escalation, and resolution.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  ErrorEscalator,
  createErrorEscalator,
  BlockerCategory,
  BlockerSeverity,
} from '../../src/execution/error-escalator.js';

describe('ErrorEscalator', () => {
  let escalator: ErrorEscalator;
  let tempDir: string;

  beforeEach(async () => {
    escalator = createErrorEscalator();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'error-escalator-test-'));
  });

  afterEach(async () => {
    escalator.stopAllAutoDetection();
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

  describe('Blocker Detection', () => {
    it('should detect blocked status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Blocked
---

# Task Log: Task 4.3

## Summary
Task is blocked

## Details
Working on implementation but encountered blocker.

## Output
None

## Issues
- Blocked by Task 4.2 not being completed

## Next Steps
Wait for Task 4.2
`;

      const logPath = await createMemoryLog('blocked.md', content);
      const result = await escalator.detectBlockers(logPath);

      expect(result.isBlocked).toBe(true);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].blockedTaskRef).toBe('Task 4.3');
      expect(result.blockers[0].blockedAgentId).toBe('Agent_Test');
    });

    it('should detect error status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Error
---

# Task Log

## Summary
Task encountered errors

## Details
Test

## Output
None

## Issues
- Test failures preventing progress

## Next Steps
Fix tests
`;

      const logPath = await createMemoryLog('error.md', content);
      const result = await escalator.detectBlockers(logPath);

      expect(result.isBlocked).toBe(true);
      expect(result.blockers.length).toBeGreaterThan(0);
    });

    it('should not detect blockers in InProgress status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: InProgress
---

# Task Log

## Summary
[To be filled]

## Details
Working on implementation

## Output
None

## Issues
None

## Next Steps
Continue
`;

      const logPath = await createMemoryLog('inprogress.md', content);
      const result = await escalator.detectBlockers(logPath);

      expect(result.isBlocked).toBe(false);
      expect(result.blockers).toHaveLength(0);
    });

    it('should not detect blockers in Completed status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Completed
---

# Task Log

## Summary
Completed successfully

## Details
Implementation done

## Output
- File created

## Issues
None

## Next Steps
None
`;

      const logPath = await createMemoryLog('completed.md', content);
      const result = await escalator.detectBlockers(logPath);

      expect(result.isBlocked).toBe(false);
      expect(result.blockers).toHaveLength(0);
    });

    it('should handle file read errors', async () => {
      const nonExistentPath = path.join(tempDir, 'non-existent.md');
      const result = await escalator.detectBlockers(nonExistentPath);

      expect(result.isBlocked).toBe(false);
      expect(result.blockers).toHaveLength(0);
    });
  });

  describe('Blocker Categorization', () => {
    it('should categorize external dependency blockers', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Blocked
---

# Task Log

## Summary
Blocked

## Details
Test

## Output
None

## Issues
- Blocked by Task 4.2 not being completed
- Waiting for Task 3.1 to provide dependency data

## Next Steps
Wait
`;

      const logPath = await createMemoryLog('external-dep.md', content);
      const result = await escalator.detectBlockers(logPath);

      expect(result.blockers).toHaveLength(2);
      expect(result.blockers[0].category).toBe(BlockerCategory.ExternalDependency);
      expect(result.blockers[0].severity).toBe(BlockerSeverity.High);
      expect(result.blockers[0].blockingDependency).toBeDefined();
    });

    it('should categorize ambiguous requirements blockers', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Blocked
---

# Task Log

## Summary
Blocked

## Details
Test

## Output
None

## Issues
- Requirements are ambiguous and need clarification
- Missing specification for error handling

## Next Steps
Request clarification
`;

      const logPath = await createMemoryLog('ambiguous-req.md', content);
      const result = await escalator.detectBlockers(logPath);

      expect(result.blockers.length).toBeGreaterThan(0);
      const ambiguousBlockers = result.blockers.filter(
        b => b.category === BlockerCategory.AmbiguousRequirements
      );
      expect(ambiguousBlockers.length).toBeGreaterThan(0);
      expect(ambiguousBlockers[0].severity).toBe(BlockerSeverity.Medium);
    });

    it('should categorize test failure blockers', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Error
---

# Task Log

## Summary
Tests failing

## Details
Test

## Output
None

## Issues
- Test failures in validation suite
- Tests not passing after refactor

## Next Steps
Fix tests
`;

      const logPath = await createMemoryLog('test-fail.md', content);
      const result = await escalator.detectBlockers(logPath);

      expect(result.blockers.length).toBeGreaterThan(0);
      const testBlockers = result.blockers.filter(
        b => b.category === BlockerCategory.TestFailures
      );
      expect(testBlockers.length).toBeGreaterThan(0);
      expect(testBlockers[0].severity).toBe(BlockerSeverity.High);
    });

    it('should categorize resource constraint blockers', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Blocked
---

# Task Log

## Summary
Resource limits

## Details
Test

## Output
None

## Issues
- Memory limit exceeded during processing
- CPU quota reached

## Next Steps
Request more resources
`;

      const logPath = await createMemoryLog('resource.md', content);
      const result = await escalator.detectBlockers(logPath);

      expect(result.blockers.length).toBeGreaterThan(0);
      const resourceBlockers = result.blockers.filter(
        b => b.category === BlockerCategory.ResourceConstraints
      );
      expect(resourceBlockers.length).toBeGreaterThan(0);
      expect(resourceBlockers[0].severity).toBe(BlockerSeverity.Critical);
    });

    it('should categorize design decision blockers', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Blocked
---

# Task Log

## Summary
Needs decision

## Details
Test

## Output
None

## Issues
- Design decision required for error handling approach
- Architectural choice needed between sync vs async

## Next Steps
Escalate for decision
`;

      const logPath = await createMemoryLog('design.md', content);
      const result = await escalator.detectBlockers(logPath);

      expect(result.blockers.length).toBeGreaterThan(0);
      const designBlockers = result.blockers.filter(
        b => b.category === BlockerCategory.DesignDecision
      );
      expect(designBlockers.length).toBeGreaterThan(0);
      expect(designBlockers[0].severity).toBe(BlockerSeverity.Medium);
    });

    it('should categorize unknown blockers', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Blocked
---

# Task Log

## Summary
Unknown issue

## Details
Test

## Output
None

## Issues
- Something unexpected went wrong
- Unable to proceed for unclear reasons

## Next Steps
Investigate
`;

      const logPath = await createMemoryLog('unknown.md', content);
      const result = await escalator.detectBlockers(logPath);

      expect(result.blockers.length).toBeGreaterThan(0);
      const unknownBlockers = result.blockers.filter(
        b => b.category === BlockerCategory.Unknown
      );
      expect(unknownBlockers.length).toBeGreaterThan(0);
    });

    it('should handle empty Issues section', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Blocked
---

# Task Log

## Summary
Blocked

## Details
Test

## Output
None

## Issues

## Next Steps
None
`;

      const logPath = await createMemoryLog('empty-issues.md', content);
      const result = await escalator.detectBlockers(logPath);

      expect(result.blockers).toHaveLength(0);
    });
  });

  describe('Event Emission', () => {
    it('should emit task_blocked event when escalating', async () => {
      const blocker = {
        category: BlockerCategory.ExternalDependency,
        severity: BlockerSeverity.High,
        description: 'Blocked by Task 4.2',
        blockedTaskRef: 'Task 4.3',
        blockedAgentId: 'Agent_Test',
        blockingDependency: '4.2',
        timestamp: new Date(),
      };

      const eventPromise = new Promise(resolve => {
        escalator.once('task_blocked', resolve);
      });

      await escalator.escalateBlocker(blocker);

      const event = (await eventPromise) as any;
      expect(event.category).toBe(BlockerCategory.ExternalDependency);
      expect(event.severity).toBe(BlockerSeverity.High);
      expect(event.blockedTaskRef).toBe('Task 4.3');
      expect(event.blockingDependency).toBe('4.2');
    });

    it('should emit blocker_resolved event when resolving', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Blocked
---

# Task Log

## Summary
Blocked

## Details
Test

## Output
None

## Issues
- Blocked by Task 4.2

## Next Steps
Wait
`;

      const logPath = await createMemoryLog('resolve-test.md', content);

      const eventPromise = new Promise(resolve => {
        escalator.once('blocker_resolved', resolve);
      });

      await escalator.resolveBlocker(logPath, 'Task 4.2 completed');

      const event = (await eventPromise) as any;
      expect(event.memoryLogPath).toBe(logPath);
      expect(event.resolution).toBe('Task 4.2 completed');
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('should emit update_error event on file write failure', async () => {
      const invalidPath = '/invalid/path/to/file.md';

      const eventPromise = new Promise(resolve => {
        escalator.once('update_error', resolve);
      });

      await escalator.updateMemoryLogToBlocked(invalidPath, {
        category: BlockerCategory.Unknown,
        severity: BlockerSeverity.Medium,
        description: 'Test',
        blockedTaskRef: 'Task 4.3',
        blockedAgentId: 'Agent_Test',
        timestamp: new Date(),
      });

      const event = (await eventPromise) as any;
      expect(event.memoryLogPath).toBe(invalidPath);
      expect(event.error).toBeDefined();
    });
  });

  describe('Memory Log Updates', () => {
    it('should update memory log to Blocked status', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: InProgress
---

# Task Log

## Summary
Working on it

## Details
Test

## Output
None

## Issues
None

## Next Steps
Continue
`;

      const logPath = await createMemoryLog('update-blocked.md', content);

      const blocker = {
        category: BlockerCategory.ExternalDependency,
        severity: BlockerSeverity.High,
        description: 'Blocked by Task 4.2',
        blockedTaskRef: 'Task 4.3',
        blockedAgentId: 'Agent_Test',
        timestamp: new Date(),
      };

      await escalator.updateMemoryLogToBlocked(logPath, blocker);

      // Read updated log
      const updatedContent = await fs.readFile(logPath, 'utf-8');

      expect(updatedContent).toContain('status: Blocked');
      expect(updatedContent).toContain('[BLOCKED - external_dependency]');
      expect(updatedContent).toContain('Blocked by Task 4.2');
    });

    it('should append blocker to existing issues', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: InProgress
---

# Task Log

## Summary
Working on it

## Details
Test

## Output
None

## Issues
- Minor issue 1

## Next Steps
Continue
`;

      const logPath = await createMemoryLog('append-blocker.md', content);

      const blocker = {
        category: BlockerCategory.TestFailures,
        severity: BlockerSeverity.High,
        description: 'Tests failing',
        blockedTaskRef: 'Task 4.3',
        blockedAgentId: 'Agent_Test',
        timestamp: new Date(),
      };

      await escalator.updateMemoryLogToBlocked(logPath, blocker);

      const updatedContent = await fs.readFile(logPath, 'utf-8');

      expect(updatedContent).toContain('Minor issue 1');
      expect(updatedContent).toContain('[BLOCKED - test_failures]');
    });

    it('should replace "None" in Issues with blocker', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: InProgress
---

# Task Log

## Summary
Working on it

## Details
Test

## Output
None

## Issues
None

## Next Steps
Continue
`;

      const logPath = await createMemoryLog('replace-none.md', content);

      const blocker = {
        category: BlockerCategory.DesignDecision,
        severity: BlockerSeverity.Medium,
        description: 'Design decision needed',
        blockedTaskRef: 'Task 4.3',
        blockedAgentId: 'Agent_Test',
        timestamp: new Date(),
      };

      await escalator.updateMemoryLogToBlocked(logPath, blocker);

      const updatedContent = await fs.readFile(logPath, 'utf-8');

      expect(updatedContent).toContain('[BLOCKED - design_decision]');
      expect(updatedContent).toContain('Design decision needed');
    });

    it('should resolve blocker and update to InProgress', async () => {
      const content = `---
agent: Agent_Test
task_ref: Task 4.3
status: Blocked
---

# Task Log

## Summary
Blocked

## Details
Test

## Output
None

## Issues
- [BLOCKED - external_dependency] Blocked by Task 4.2

## Next Steps
Wait
`;

      const logPath = await createMemoryLog('resolve-blocked.md', content);

      await escalator.resolveBlocker(logPath, 'Task 4.2 completed successfully');

      const updatedContent = await fs.readFile(logPath, 'utf-8');

      expect(updatedContent).toContain('status: InProgress');
      expect(updatedContent).toContain('Resolved: Task 4.2 completed successfully');
    });
  });

  describe('Auto-Detection', () => {
    it('should start and stop auto-detection', () => {
      const autoEscalator = createErrorEscalator({
        autoDetect: true,
        pollingIntervalMs: 100,
      });

      // Start auto-detection
      autoEscalator.startAutoDetection('task-1', '/path/to/log1.md');
      autoEscalator.startAutoDetection('task-2', '/path/to/log2.md');

      // Verify timers are set
      expect((autoEscalator as any).pollingTimers.has('task-1')).toBe(true);
      expect((autoEscalator as any).pollingTimers.has('task-2')).toBe(true);

      // Stop one task
      autoEscalator.stopAutoDetection('task-1');
      expect((autoEscalator as any).pollingTimers.has('task-1')).toBe(false);
      expect((autoEscalator as any).pollingTimers.has('task-2')).toBe(true);

      // Stop all
      autoEscalator.stopAllAutoDetection();
      expect((autoEscalator as any).pollingTimers.size).toBe(0);
    });

    it('should not start timers when auto-detect is disabled', () => {
      const noAutoEscalator = createErrorEscalator({ autoDetect: false });

      noAutoEscalator.startAutoDetection('task-1', '/path/to/log.md');

      // No timers should be started
      expect((noAutoEscalator as any).pollingTimers.size).toBe(0);

      noAutoEscalator.stopAllAutoDetection();
    });
  });

  describe('Factory Function', () => {
    it('should create escalator instance via factory', () => {
      const escalator = createErrorEscalator();
      expect(escalator).toBeInstanceOf(ErrorEscalator);
    });

    it('should create escalator with custom config', () => {
      const escalator = createErrorEscalator({
        autoDetect: true,
        pollingIntervalMs: 5000,
        memoryBasePath: '/custom/path',
      });
      expect(escalator).toBeInstanceOf(ErrorEscalator);
      expect((escalator as any).config.autoDetect).toBe(true);
      expect((escalator as any).config.pollingIntervalMs).toBe(5000);
      expect((escalator as any).config.memoryBasePath).toBe('/custom/path');
    });
  });
});
