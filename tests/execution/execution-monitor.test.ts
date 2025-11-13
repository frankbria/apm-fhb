/**
 * Tests for Execution Monitor
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ExecutionMonitor,
  createExecutionMonitor,
  MilestoneType,
  AnomalyType,
  AnomalySeverity,
  MonitoringState,
  type ExecutionMonitorConfig,
  type ProcessTracker,
} from '../../src/execution/execution-monitor.js';

describe('ExecutionMonitor', () => {
  let monitor: ExecutionMonitor;
  let config: ExecutionMonitorConfig;
  let mockProcessTracker: Partial<ProcessTracker>;

  beforeEach(() => {
    // Mock process tracker
    mockProcessTracker = {
      getProcessInfo: vi.fn().mockReturnValue({
        processId: 'test-process',
        metrics: {
          memoryUsage: 100 * 1024 * 1024, // 100MB
        },
      }),
    };

    config = {
      processTracker: mockProcessTracker as ProcessTracker,
      healthCheckIntervalMs: 100, // Shorter for tests
      noProgressThresholdMs: 1000, // 1 second for tests
      anomalyCheckIntervalMs: 100, // Shorter for tests
      expectedTotalSteps: 5,
    };

    monitor = createExecutionMonitor(config);
  });

  afterEach(() => {
    monitor.cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('startMonitoring()', () => {
    it('should start monitoring session', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      expect(sessionId).toContain('agent_001');
      expect(sessionId).toContain('task_4.3');

      const session = monitor.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session!.agentId).toBe('agent_001');
      expect(session!.taskId).toBe('task_4.3');
      expect(session!.state).toBe(MonitoringState.Active);
    });

    it('should emit monitoring_started event', () => {
      const eventSpy = vi.fn();
      monitor.on('monitoring_started', eventSpy);

      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      expect(eventSpy).toHaveBeenCalledWith({
        sessionId,
        agentId: 'agent_001',
        taskId: 'task_4.3',
        startTime: expect.any(Date),
      });
    });

    it('should initialize metrics to zero', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');
      const session = monitor.getSession(sessionId);

      expect(session!.metrics.stepsCompleted).toBe(0);
      expect(session!.metrics.testsRun).toBe(0);
      expect(session!.metrics.coveragePercent).toBe(0);
      expect(session!.metrics.filesCreated).toBe(0);
      expect(session!.metrics.filesModified).toBe(0);
    });

    it('should initialize empty milestones and anomalies arrays', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');
      const session = monitor.getSession(sessionId);

      expect(session!.milestones).toHaveLength(0);
      expect(session!.anomalies).toHaveLength(0);
    });
  });

  describe('stopMonitoring()', () => {
    it('should stop monitoring session', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      monitor.stopMonitoring(sessionId);

      const session = monitor.getSession(sessionId);
      expect(session!.state).toBe(MonitoringState.Stopped);
    });

    it('should emit monitoring_stopped event', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');
      const eventSpy = vi.fn();
      monitor.on('monitoring_stopped', eventSpy);

      monitor.stopMonitoring(sessionId);

      expect(eventSpy).toHaveBeenCalledWith({
        sessionId,
        agentId: 'agent_001',
        taskId: 'task_4.3',
        duration: expect.any(Number),
        finalMetrics: expect.any(Object),
      });
    });

    it('should update final metrics with elapsed time', () => {
      vi.useFakeTimers();
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      vi.advanceTimersByTime(5000); // 5 seconds

      monitor.stopMonitoring(sessionId);

      const session = monitor.getSession(sessionId);
      expect(session!.metrics.timeElapsedMs).toBeGreaterThanOrEqual(5000);

      vi.useRealTimers();
    });

    it('should handle stopping non-existent session gracefully', () => {
      expect(() => {
        monitor.stopMonitoring('non-existent');
      }).not.toThrow();
    });
  });

  describe('pauseMonitoring() and resumeMonitoring()', () => {
    it('should pause active monitoring session', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      monitor.pauseMonitoring(sessionId);

      const session = monitor.getSession(sessionId);
      expect(session!.state).toBe(MonitoringState.Paused);
    });

    it('should emit monitoring_paused event', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');
      const eventSpy = vi.fn();
      monitor.on('monitoring_paused', eventSpy);

      monitor.pauseMonitoring(sessionId);

      expect(eventSpy).toHaveBeenCalledWith({
        sessionId,
        agentId: 'agent_001',
        taskId: 'task_4.3',
      });
    });

    it('should resume paused monitoring session', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');
      monitor.pauseMonitoring(sessionId);

      monitor.resumeMonitoring(sessionId);

      const session = monitor.getSession(sessionId);
      expect(session!.state).toBe(MonitoringState.Active);
    });

    it('should emit monitoring_resumed event', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');
      monitor.pauseMonitoring(sessionId);

      const eventSpy = vi.fn();
      monitor.on('monitoring_resumed', eventSpy);

      monitor.resumeMonitoring(sessionId);

      expect(eventSpy).toHaveBeenCalledWith({
        sessionId,
        agentId: 'agent_001',
        taskId: 'task_4.3',
      });
    });

    it('should not pause non-active session', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');
      monitor.stopMonitoring(sessionId);

      monitor.pauseMonitoring(sessionId);

      const session = monitor.getSession(sessionId);
      expect(session!.state).toBe(MonitoringState.Stopped);
    });

    it('should not resume non-paused session', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      monitor.resumeMonitoring(sessionId);

      const session = monitor.getSession(sessionId);
      expect(session!.state).toBe(MonitoringState.Active);
    });
  });

  describe('recordMilestone()', () => {
    it('should record subtask completion milestone', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      monitor.recordMilestone(sessionId, MilestoneType.SubtaskCompleted, 'Completed step 1');

      const session = monitor.getSession(sessionId);
      expect(session!.milestones).toHaveLength(1);
      expect(session!.milestones[0].type).toBe(MilestoneType.SubtaskCompleted);
      expect(session!.milestones[0].description).toBe('Completed step 1');
    });

    it('should emit milestone_reached event', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');
      const eventSpy = vi.fn();
      monitor.on('milestone_reached', eventSpy);

      monitor.recordMilestone(sessionId, MilestoneType.TestPassed, '10 tests passed');

      expect(eventSpy).toHaveBeenCalledWith({
        sessionId,
        agentId: 'agent_001',
        taskId: 'task_4.3',
        milestoneType: MilestoneType.TestPassed,
        description: '10 tests passed',
        timestamp: expect.any(Date),
        progressPercent: expect.any(Number),
      });
    });

    it('should increment steps completed for subtask milestones', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      monitor.recordMilestone(sessionId, MilestoneType.SubtaskCompleted, 'Step 1');
      monitor.recordMilestone(sessionId, MilestoneType.SubtaskCompleted, 'Step 2');

      const session = monitor.getSession(sessionId);
      expect(session!.metrics.stepsCompleted).toBe(2);
    });

    it('should increment tests run for test passed milestones', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      monitor.recordMilestone(sessionId, MilestoneType.TestPassed, 'Test 1');
      monitor.recordMilestone(sessionId, MilestoneType.TestPassed, 'Test 2');
      monitor.recordMilestone(sessionId, MilestoneType.TestPassed, 'Test 3');

      const session = monitor.getSession(sessionId);
      expect(session!.metrics.testsRun).toBe(3);
    });

    it('should calculate progress percentage', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      // With expectedTotalSteps: 5, each step is 20%
      monitor.recordMilestone(sessionId, MilestoneType.SubtaskCompleted, 'Step 1');
      let session = monitor.getSession(sessionId);
      expect(session!.milestones[0].progressPercent).toBe(20);

      monitor.recordMilestone(sessionId, MilestoneType.SubtaskCompleted, 'Step 2');
      session = monitor.getSession(sessionId);
      expect(session!.milestones[1].progressPercent).toBe(40);

      monitor.recordMilestone(sessionId, MilestoneType.SubtaskCompleted, 'Step 3');
      session = monitor.getSession(sessionId);
      expect(session!.milestones[2].progressPercent).toBe(60);
    });

    it('should cap progress percentage at 100', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      // Record 10 steps (more than expected 5)
      for (let i = 0; i < 10; i++) {
        monitor.recordMilestone(sessionId, MilestoneType.SubtaskCompleted, `Step ${i + 1}`);
      }

      const session = monitor.getSession(sessionId);
      const lastMilestone = session!.milestones[session!.milestones.length - 1];
      expect(lastMilestone.progressPercent).toBe(100);
    });

    it('should update estimated completion time', () => {
      vi.useFakeTimers();
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      vi.advanceTimersByTime(1000); // 1 second
      monitor.recordMilestone(sessionId, MilestoneType.SubtaskCompleted, 'Step 1');

      const session = monitor.getSession(sessionId);
      // 1 step took 1s, 4 steps remaining, so ~4s estimated
      expect(session!.metrics.estimatedCompletionMs).toBeGreaterThan(0);

      vi.useRealTimers();
    });
  });

  describe('trackMetrics() and updateMetrics()', () => {
    it('should track current metrics', () => {
      vi.useFakeTimers();
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      vi.advanceTimersByTime(2000); // 2 seconds

      const metrics = monitor.trackMetrics(sessionId);

      expect(metrics).toBeDefined();
      expect(metrics!.timeElapsedMs).toBeGreaterThanOrEqual(2000);

      vi.useRealTimers();
    });

    it('should return null for non-existent session', () => {
      const metrics = monitor.trackMetrics('non-existent');
      expect(metrics).toBeNull();
    });

    it('should update metrics', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      monitor.updateMetrics(sessionId, {
        testsRun: 25,
        coveragePercent: 85,
        filesCreated: 3,
        filesModified: 5,
      });

      const session = monitor.getSession(sessionId);
      expect(session!.metrics.testsRun).toBe(25);
      expect(session!.metrics.coveragePercent).toBe(85);
      expect(session!.metrics.filesCreated).toBe(3);
      expect(session!.metrics.filesModified).toBe(5);
    });

    it('should update partial metrics', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      monitor.updateMetrics(sessionId, { coveragePercent: 90 });

      const session = monitor.getSession(sessionId);
      expect(session!.metrics.coveragePercent).toBe(90);
      expect(session!.metrics.testsRun).toBe(0); // Unchanged
    });
  });

  describe('Anomaly Detection', () => {
    it('should detect no progress anomaly', async () => {
      vi.useFakeTimers();

      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');
      const eventSpy = vi.fn();
      monitor.on('anomaly_detected', eventSpy);

      // Advance time beyond noProgressThresholdMs (1000ms)
      vi.advanceTimersByTime(1500);

      // Wait for anomaly check interval
      await vi.advanceTimersByTimeAsync(150);

      expect(eventSpy).toHaveBeenCalled();
      const call = eventSpy.mock.calls[0][0];
      expect(call.anomalyType).toBe(AnomalyType.NoProgress);

      vi.useRealTimers();
    });

    it('should detect high memory usage anomaly', async () => {
      vi.useFakeTimers();

      // Mock high memory usage
      mockProcessTracker.getProcessInfo = vi.fn().mockReturnValue({
        processId: 'test-process',
        metrics: {
          memoryUsage: 1.5 * 1024 * 1024 * 1024, // 1.5GB
        },
      });

      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');
      const eventSpy = vi.fn();
      monitor.on('anomaly_detected', eventSpy);

      // Wait for health check
      await vi.advanceTimersByTimeAsync(150);

      expect(eventSpy).toHaveBeenCalled();
      const call = eventSpy.mock.calls.find(c => c[0].anomalyType === AnomalyType.HighMemoryUsage);
      expect(call).toBeDefined();

      vi.useRealTimers();
    });

    it('should detect process unhealthy anomaly when process not found', async () => {
      vi.useFakeTimers();

      mockProcessTracker.getProcessInfo = vi.fn().mockReturnValue(null);

      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');
      const eventSpy = vi.fn();
      monitor.on('anomaly_detected', eventSpy);

      // Wait for health check
      await vi.advanceTimersByTimeAsync(150);

      expect(eventSpy).toHaveBeenCalled();
      const call = eventSpy.mock.calls.find(
        c => c[0].anomalyType === AnomalyType.ProcessUnhealthy
      );
      expect(call).toBeDefined();

      vi.useRealTimers();
    });

    it('should not report duplicate anomalies within 1 minute', async () => {
      vi.useFakeTimers();

      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');
      const eventSpy = vi.fn();
      monitor.on('anomaly_detected', eventSpy);

      // Trigger no progress anomaly
      vi.advanceTimersByTime(1500);
      await vi.advanceTimersByTimeAsync(150);

      const firstCallCount = eventSpy.mock.calls.length;

      // Trigger again within 1 minute
      await vi.advanceTimersByTimeAsync(150);

      // Should not have new calls
      expect(eventSpy.mock.calls.length).toBe(firstCallCount);

      vi.useRealTimers();
    });
  });

  describe('getSession() and getActiveSessions()', () => {
    it('should get session by ID', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      const session = monitor.getSession(sessionId);

      expect(session).toBeDefined();
      expect(session!.id).toBe(sessionId);
    });

    it('should return null for non-existent session', () => {
      const session = monitor.getSession('non-existent');
      expect(session).toBeNull();
    });

    it('should return copy of session (not reference)', () => {
      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');

      const session1 = monitor.getSession(sessionId);
      const session2 = monitor.getSession(sessionId);

      expect(session1).not.toBe(session2); // Different objects
      expect(session1).toEqual(session2); // Same content
    });

    it('should get all active sessions', () => {
      const sessionId1 = monitor.startMonitoring('agent_001', 'task_4.3');
      const sessionId2 = monitor.startMonitoring('agent_002', 'task_4.4');
      monitor.pauseMonitoring(sessionId2);
      const sessionId3 = monitor.startMonitoring('agent_003', 'task_4.5');

      const activeSessions = monitor.getActiveSessions();

      expect(activeSessions).toHaveLength(2); // Only 1 and 3 are active
      expect(activeSessions.map(s => s.id)).toContain(sessionId1);
      expect(activeSessions.map(s => s.id)).toContain(sessionId3);
      expect(activeSessions.map(s => s.id)).not.toContain(sessionId2);
    });
  });

  describe('cleanup()', () => {
    it('should clear all sessions', () => {
      monitor.startMonitoring('agent_001', 'task_4.3');
      monitor.startMonitoring('agent_002', 'task_4.4');

      monitor.cleanup();

      const activeSessions = monitor.getActiveSessions();
      expect(activeSessions).toHaveLength(0);
    });

    it('should stop all intervals', () => {
      vi.useFakeTimers();

      monitor.startMonitoring('agent_001', 'task_4.3');

      monitor.cleanup();

      // Intervals should be cleared
      const eventSpy = vi.fn();
      monitor.on('anomaly_detected', eventSpy);

      vi.advanceTimersByTime(10000); // Advance well beyond intervals

      expect(eventSpy).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should remove all event listeners', () => {
      const eventSpy = vi.fn();
      monitor.on('monitoring_started', eventSpy);

      monitor.cleanup();

      monitor.startMonitoring('agent_001', 'task_4.3');

      expect(eventSpy).not.toHaveBeenCalled();
    });
  });

  describe('createExecutionMonitor()', () => {
    it('should create ExecutionMonitor instance', () => {
      const monitor = createExecutionMonitor({});

      expect(monitor).toBeInstanceOf(ExecutionMonitor);

      monitor.cleanup();
    });

    it('should use default configuration values', () => {
      const monitor = createExecutionMonitor({});

      const sessionId = monitor.startMonitoring('agent_001', 'task_4.3');
      const session = monitor.getSession(sessionId);

      expect(session).toBeDefined();

      monitor.cleanup();
    });
  });

  describe('Edge Cases', () => {
    it('should handle recording milestone for non-existent session', () => {
      expect(() => {
        monitor.recordMilestone('non-existent', MilestoneType.TestPassed, 'Test');
      }).not.toThrow();
    });

    it('should handle updating metrics for non-existent session', () => {
      expect(() => {
        monitor.updateMetrics('non-existent', { coveragePercent: 80 });
      }).not.toThrow();
    });

    it('should handle multiple sessions simultaneously', () => {
      const sessionId1 = monitor.startMonitoring('agent_001', 'task_4.3');
      const sessionId2 = monitor.startMonitoring('agent_002', 'task_4.4');

      monitor.recordMilestone(sessionId1, MilestoneType.SubtaskCompleted, 'Task 1 Step 1');
      monitor.recordMilestone(sessionId2, MilestoneType.SubtaskCompleted, 'Task 2 Step 1');

      const session1 = monitor.getSession(sessionId1);
      const session2 = monitor.getSession(sessionId2);

      expect(session1!.milestones).toHaveLength(1);
      expect(session2!.milestones).toHaveLength(1);
      expect(session1!.milestones[0].description).toBe('Task 1 Step 1');
      expect(session2!.milestones[0].description).toBe('Task 2 Step 1');
    });
  });
});
