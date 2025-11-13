/**
 * Progress Monitor Tests
 * Tests for agent progress monitoring via memory logs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ProgressMonitor,
  createProgressMonitor,
  TaskProgress,
  type ProgressMonitorConfig,
} from '../../src/orchestration/progress-monitor.js';
import { AgentStatus, AgentType, type AgentState } from '../../src/types/agent.js';
import { type AgentPersistenceManager } from '../../src/state/persistence.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_LOGS_DIR = path.join(__dirname, '../test-data/progress-monitor');

// Mock agent state
function createMockAgent(
  id: string,
  status: AgentStatus,
  currentTask: string | null,
  lastActivityAt: Date = new Date(),
  memoryLogPath?: string
): AgentState {
  return {
    id,
    type: AgentType.Implementation,
    status,
    currentTask,
    metadata: {
      spawnedAt: new Date(),
      lastActivityAt,
      custom_metadata: memoryLogPath ? { memoryLogPath } : {},
    },
  };
}

// Mock Persistence Manager
function createMockPersistence(agents: AgentState[]): AgentPersistenceManager {
  return {
    getAgentState: vi.fn(async (agentId: string) => {
      return agents.find(a => a.id === agentId) || null;
    }),
    getAllAgents: vi.fn(async () => {
      return agents;
    }),
  } as unknown as AgentPersistenceManager;
}

describe('ProgressMonitor', () => {
  let monitor: ProgressMonitor;
  let mockPersistence: AgentPersistenceManager;
  let config: ProgressMonitorConfig;

  beforeEach(async () => {
    // Ensure test logs directory exists
    await fs.mkdir(TEST_LOGS_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test logs
    try {
      const files = await fs.readdir(TEST_LOGS_DIR);
      await Promise.all(files.map(f => fs.unlink(path.join(TEST_LOGS_DIR, f))));
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Initialization', () => {
    it('should create ProgressMonitor instance', () => {
      mockPersistence = createMockPersistence([]);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };

      monitor = createProgressMonitor(config);
      expect(monitor).toBeInstanceOf(ProgressMonitor);
    });

    it('should use default stall threshold', () => {
      mockPersistence = createMockPersistence([]);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };

      monitor = createProgressMonitor(config);
      expect(monitor).toBeDefined();
    });

    it('should accept custom stall threshold', () => {
      mockPersistence = createMockPersistence([]);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
        stallThresholdMs: 60000, // 1 minute
      };

      monitor = createProgressMonitor(config);
      expect(monitor).toBeDefined();
    });
  });

  describe('Memory Log Analysis', () => {
    beforeEach(() => {
      mockPersistence = createMockPersistence([]);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };
      monitor = createProgressMonitor(config);
    });

    it('should detect completion markers - checkmark', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'completed.md');
      await fs.writeFile(logPath, '## Task Complete ✓\n\nAll tests passing.');

      const indicators = await monitor.analyzeMemoryLog(logPath);

      expect(indicators.hasCompletionMarker).toBe(true);
    });

    it('should detect completion markers - emoji', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'completed-emoji.md');
      await fs.writeFile(logPath, '## Summary\n\n✅ Task completed successfully');

      const indicators = await monitor.analyzeMemoryLog(logPath);

      expect(indicators.hasCompletionMarker).toBe(true);
    });

    it('should detect completion markers - checkbox', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'completed-checkbox.md');
      await fs.writeFile(logPath, '- [x] Implement feature\n- [x] Write tests');

      const indicators = await monitor.analyzeMemoryLog(logPath);

      expect(indicators.hasCompletionMarker).toBe(true);
    });

    it('should detect completion markers - status', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'completed-status.md');
      await fs.writeFile(logPath, '---\nstatus: completed\n---\n\n## Summary');

      const indicators = await monitor.analyzeMemoryLog(logPath);

      expect(indicators.hasCompletionMarker).toBe(true);
    });

    it('should detect errors', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'errors.md');
      await fs.writeFile(logPath, '## Issues\n\nERROR: Tests failed\nException in test suite');

      const indicators = await monitor.analyzeMemoryLog(logPath);

      expect(indicators.hasErrors).toBe(true);
    });

    it('should detect blockers', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'blockers.md');
      await fs.writeFile(logPath, '## Status\n\nBLOCKED by dependency\nWaiting for Task 1.1');

      const indicators = await monitor.analyzeMemoryLog(logPath);

      expect(indicators.hasBlockers).toBe(true);
    });

    it('should count total lines', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'lines.md');
      await fs.writeFile(logPath, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5');

      const indicators = await monitor.analyzeMemoryLog(logPath);

      expect(indicators.totalLines).toBe(5);
    });

    it('should get last activity from file mtime', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'activity.md');
      await fs.writeFile(logPath, 'Some content');

      const indicators = await monitor.analyzeMemoryLog(logPath);

      expect(indicators.lastActivity).toBeInstanceOf(Date);
      expect(indicators.lastActivity.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should handle non-existent files gracefully', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'nonexistent.md');

      const indicators = await monitor.analyzeMemoryLog(logPath);

      expect(indicators.hasCompletionMarker).toBe(false);
      expect(indicators.hasErrors).toBe(false);
      expect(indicators.hasBlockers).toBe(false);
      expect(indicators.totalLines).toBe(0);
    });
  });

  describe('Agent Progress', () => {
    it('should get progress for active agent with log', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'agent-progress.md');
      await fs.writeFile(logPath, '## Task 4.1\n\nIn progress...');

      const agents = [
        createMockAgent('agent_001', AgentStatus.Active, '4.1', new Date(), logPath),
      ];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };
      monitor = createProgressMonitor(config);

      const progress = await monitor.getAgentProgress('agent_001');

      expect(progress).toBeDefined();
      expect(progress?.agentId).toBe('agent_001');
      expect(progress?.currentTask).toBe('4.1');
      expect(progress?.agentStatus).toBe(AgentStatus.Active);
      expect(progress?.memoryLogPath).toBe(logPath);
      expect(progress?.indicators).toBeDefined();
      expect(progress?.taskProgress).toBe(TaskProgress.InProgress);
    });

    it('should return null for non-existent agent', async () => {
      mockPersistence = createMockPersistence([]);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };
      monitor = createProgressMonitor(config);

      const progress = await monitor.getAgentProgress('nonexistent');

      expect(progress).toBeNull();
    });

    it('should handle agent without memory log', async () => {
      const agents = [createMockAgent('agent_002', AgentStatus.Active, '4.2', new Date())];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };
      monitor = createProgressMonitor(config);

      const progress = await monitor.getAgentProgress('agent_002');

      expect(progress).toBeDefined();
      expect(progress?.memoryLogPath).toBeNull();
      expect(progress?.indicators).toBeNull();
      expect(progress?.taskProgress).toBe(TaskProgress.NotStarted);
    });

    it('should detect completed task', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'completed-task.md');
      await fs.writeFile(logPath, '## Summary\n\n✓ Task Complete\n\nAll objectives met.');

      const agents = [
        createMockAgent('agent_003', AgentStatus.Terminated, '4.3', new Date(), logPath),
      ];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };
      monitor = createProgressMonitor(config);

      const progress = await monitor.getAgentProgress('agent_003');

      expect(progress?.taskProgress).toBe(TaskProgress.Completed);
    });

    it('should detect failed task', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'failed-task.md');
      await fs.writeFile(logPath, '## Issues\n\nERROR: Tests failed\nCannot proceed.');

      const agents = [
        createMockAgent('agent_004', AgentStatus.Active, '4.4', new Date(), logPath),
      ];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };
      monitor = createProgressMonitor(config);

      const progress = await monitor.getAgentProgress('agent_004');

      expect(progress?.taskProgress).toBe(TaskProgress.Failed);
    });
  });

  describe('Stall Detection', () => {
    it('should detect stalled agent', async () => {
      const oldActivity = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

      const agents = [createMockAgent('agent_005', AgentStatus.Active, '4.5', oldActivity)];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
        stallThresholdMs: 5 * 60 * 1000, // 5 minutes
      };
      monitor = createProgressMonitor(config);

      const progress = await monitor.getAgentProgress('agent_005');

      expect(progress?.isStalled).toBe(true);
      expect(progress?.timeSinceActivity).toBeGreaterThan(5 * 60 * 1000);
    });

    it('should not mark recent activity as stalled', async () => {
      const recentActivity = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago

      const agents = [createMockAgent('agent_006', AgentStatus.Active, '4.6', recentActivity)];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
        stallThresholdMs: 5 * 60 * 1000,
      };
      monitor = createProgressMonitor(config);

      const progress = await monitor.getAgentProgress('agent_006');

      expect(progress?.isStalled).toBe(false);
    });

    it('should not mark terminated agents as stalled', async () => {
      const oldActivity = new Date(Date.now() - 10 * 60 * 1000);

      const agents = [createMockAgent('agent_007', AgentStatus.Terminated, null, oldActivity)];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
        stallThresholdMs: 5 * 60 * 1000,
      };
      monitor = createProgressMonitor(config);

      const progress = await monitor.getAgentProgress('agent_007');

      expect(progress?.isStalled).toBe(false);
    });
  });

  describe('Multiple Agents', () => {
    it('should get progress for all agents', async () => {
      const agents = [
        createMockAgent('agent_008', AgentStatus.Active, '4.8', new Date()),
        createMockAgent('agent_009', AgentStatus.Active, '4.9', new Date()),
        createMockAgent('agent_010', AgentStatus.Terminated, null, new Date()),
      ];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };
      monitor = createProgressMonitor(config);

      const allProgress = await monitor.getAllAgentProgress();

      expect(allProgress).toHaveLength(3);
      expect(allProgress.map(p => p.agentId)).toContain('agent_008');
      expect(allProgress.map(p => p.agentId)).toContain('agent_009');
      expect(allProgress.map(p => p.agentId)).toContain('agent_010');
    });

    it('should get stalled agents only', async () => {
      const oldActivity = new Date(Date.now() - 10 * 60 * 1000);
      const recentActivity = new Date();

      const agents = [
        createMockAgent('agent_stalled', AgentStatus.Active, '4.1', oldActivity),
        createMockAgent('agent_active', AgentStatus.Active, '4.2', recentActivity),
      ];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
        stallThresholdMs: 5 * 60 * 1000,
      };
      monitor = createProgressMonitor(config);

      const stalled = await monitor.getStalledAgents();

      expect(stalled).toHaveLength(1);
      expect(stalled[0].agentId).toBe('agent_stalled');
    });
  });

  describe('Task Completion Checking', () => {
    it('should check if task is completed', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'check-completed.md');
      await fs.writeFile(logPath, 'COMPLETED ✓');

      const agents = [
        createMockAgent('agent_011', AgentStatus.Terminated, '4.11', new Date(), logPath),
      ];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };
      monitor = createProgressMonitor(config);

      const isCompleted = await monitor.isTaskCompleted('agent_011');

      expect(isCompleted).toBe(true);
    });

    it('should return false for incomplete task', async () => {
      const agents = [createMockAgent('agent_012', AgentStatus.Active, '4.12', new Date())];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };
      monitor = createProgressMonitor(config);

      const isCompleted = await monitor.isTaskCompleted('agent_012');

      expect(isCompleted).toBe(false);
    });
  });

  describe('Completion Percentage', () => {
    it('should calculate completion percentage', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'percentage.md');
      await fs.writeFile(logPath, 'Some progress content here\n'.repeat(60) + '\n✓ Complete');

      const agents = [
        createMockAgent('agent_013', AgentStatus.Active, '4.13', new Date(), logPath),
      ];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };
      monitor = createProgressMonitor(config);

      const percentage = await monitor.getCompletionPercentage('agent_013');

      expect(percentage).toBeGreaterThan(0);
      expect(percentage).toBeLessThanOrEqual(100);
    });

    it('should return null for agent without log', async () => {
      const agents = [createMockAgent('agent_014', AgentStatus.Active, '4.14', new Date())];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };
      monitor = createProgressMonitor(config);

      const percentage = await monitor.getCompletionPercentage('agent_014');

      expect(percentage).toBeNull();
    });

    it('should calculate high percentage for completed task', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'high-percentage.md');
      await fs.writeFile(logPath, 'Progress\n'.repeat(100) + '\nCOMPLETED ✓');

      const agents = [
        createMockAgent('agent_015', AgentStatus.Active, '4.15', new Date(), logPath),
      ];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };
      monitor = createProgressMonitor(config);

      const percentage = await monitor.getCompletionPercentage('agent_015');

      expect(percentage).toBeGreaterThan(75);
    });
  });

  describe('Progress Summary', () => {
    it('should generate progress summary', async () => {
      const logPath1 = path.join(TEST_LOGS_DIR, 'summary-completed.md');
      await fs.writeFile(logPath1, 'COMPLETED ✓');

      const logPath2 = path.join(TEST_LOGS_DIR, 'summary-failed.md');
      await fs.writeFile(logPath2, 'ERROR: Failed');

      const oldActivity = new Date(Date.now() - 10 * 60 * 1000);

      const agents = [
        createMockAgent('agent_016', AgentStatus.Terminated, '4.16', new Date(), logPath1),
        createMockAgent('agent_017', AgentStatus.Active, '4.17', new Date(), logPath2),
        createMockAgent('agent_018', AgentStatus.Active, '4.18', oldActivity),
      ];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
        stallThresholdMs: 5 * 60 * 1000,
      };
      monitor = createProgressMonitor(config);

      const summary = await monitor.getProgressSummary();

      expect(summary.totalAgents).toBe(3);
      expect(summary.activeAgents).toBe(2);
      expect(summary.completedTasks).toBe(1);
      expect(summary.failedTasks).toBe(1);
      expect(summary.stalledAgents).toBe(1);
    });

    it('should handle empty summary', async () => {
      mockPersistence = createMockPersistence([]);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };
      monitor = createProgressMonitor(config);

      const summary = await monitor.getProgressSummary();

      expect(summary.totalAgents).toBe(0);
      expect(summary.activeAgents).toBe(0);
      expect(summary.completedTasks).toBe(0);
      expect(summary.failedTasks).toBe(0);
      expect(summary.stalledAgents).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle agent with empty log file', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'empty.md');
      await fs.writeFile(logPath, '');

      const agents = [
        createMockAgent('agent_019', AgentStatus.Active, '4.19', new Date(), logPath),
      ];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      };
      monitor = createProgressMonitor(config);

      const progress = await monitor.getAgentProgress('agent_019');

      // Empty file still counts as having lines (split returns [''])
      expect(progress?.taskProgress).toBe(TaskProgress.InProgress);
      expect(progress?.indicators?.totalLines).toBe(1); // Empty string splits to 1 line
    });

    it('should handle multiple completion markers', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'multi-markers.md');
      await fs.writeFile(logPath, '✓ Step 1\n✅ Step 2\n[x] Step 3\nCOMPLETED');

      const indicators = await monitor.analyzeMemoryLog(logPath);

      expect(indicators.hasCompletionMarker).toBe(true);
    });
  });

  describe('createProgressMonitor()', () => {
    it('should create ProgressMonitor instance', () => {
      mockPersistence = createMockPersistence([]);
      const newMonitor = createProgressMonitor({
        persistence: mockPersistence,
        memoryBasePath: '.apm/Memory',
      });

      expect(newMonitor).toBeInstanceOf(ProgressMonitor);
    });
  });
});
