/**
 * Cross-Agent Coordinator Tests
 * Tests for cross-agent coordination and handoff management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CrossAgentCoordinator,
  createCrossAgentCoordinator,
  HandoffStatus,
  type CrossAgentCoordinatorConfig,
  type CrossAgentHandoff,
} from '../../src/orchestration/cross-agent-coordinator.js';
import { type DependencyResolver } from '../../src/orchestration/dependency-resolver.js';
import { type AgentPersistenceManager } from '../../src/state/persistence.js';

// Mock Dependency Resolver
function createMockDependencyResolver(crossAgentDeps: Array<{
  taskId: string;
  dependsOn: string;
  fromAgent: string;
  toAgent: string;
}>): DependencyResolver {
  return {
    findCrossAgentDependencies: vi.fn(() => crossAgentDeps),
  } as unknown as DependencyResolver;
}

// Mock Persistence Manager
function createMockPersistence(): AgentPersistenceManager {
  return {} as AgentPersistenceManager;
}

describe('CrossAgentCoordinator', () => {
  let coordinator: CrossAgentCoordinator;
  let mockResolver: DependencyResolver;
  let config: CrossAgentCoordinatorConfig;

  describe('Initialization', () => {
    beforeEach(() => {
      const crossAgentDeps = [
        {
          taskId: '2.1',
          dependsOn: '1.1',
          fromAgent: 'Agent_CLI',
          toAgent: 'Agent_Foundation',
        },
        {
          taskId: '3.1',
          dependsOn: '1.1',
          fromAgent: 'Agent_Communication',
          toAgent: 'Agent_Foundation',
        },
      ];

      mockResolver = createMockDependencyResolver(crossAgentDeps);
      config = {
        dependencyResolver: mockResolver,
        persistence: createMockPersistence(),
      };

      coordinator = createCrossAgentCoordinator(config);
    });

    it('should create CrossAgentCoordinator instance', () => {
      expect(coordinator).toBeInstanceOf(CrossAgentCoordinator);
    });

    it('should initialize with empty state', () => {
      const handoffs = coordinator.getAllHandoffs();
      expect(handoffs).toEqual([]);
    });

    it('should create handoffs on initialization', () => {
      coordinator.initialize(new Set());

      const handoffs = coordinator.getAllHandoffs();
      expect(handoffs).toHaveLength(2);
    });

    it('should not create handoffs for already completed tasks', () => {
      const completed = new Set(['2.1']);
      coordinator.initialize(completed);

      const handoffs = coordinator.getAllHandoffs();
      expect(handoffs).toHaveLength(1);
      expect(handoffs[0].requestingTask).toBe('3.1');
    });

    it('should mark handoffs as Ready if dependency already completed', () => {
      const completed = new Set(['1.1']);
      coordinator.initialize(completed);

      const handoffs = coordinator.getAllHandoffs();
      expect(handoffs.every(h => h.status === HandoffStatus.Ready)).toBe(true);
    });
  });

  describe('Handoff Creation', () => {
    beforeEach(() => {
      mockResolver = createMockDependencyResolver([]);
      config = {
        dependencyResolver: mockResolver,
        persistence: createMockPersistence(),
      };
      coordinator = createCrossAgentCoordinator(config);
    });

    it('should create handoff with Pending status', () => {
      const handoff = coordinator.createHandoff(
        '2.1',
        'Agent_CLI',
        '1.1',
        'Agent_Foundation'
      );

      expect(handoff.requestingTask).toBe('2.1');
      expect(handoff.requestingAgent).toBe('Agent_CLI');
      expect(handoff.dependencyTask).toBe('1.1');
      expect(handoff.providingAgent).toBe('Agent_Foundation');
      expect(handoff.status).toBe(HandoffStatus.Pending);
      expect(handoff.createdAt).toBeInstanceOf(Date);
    });

    it('should generate handoff ID', () => {
      const handoff = coordinator.createHandoff(
        '2.1',
        'Agent_CLI',
        '1.1',
        'Agent_Foundation'
      );

      expect(handoff.handoffId).toBe('1.1->2.1');
    });

    it('should emit handoff-created event', () => {
      coordinator.createHandoff('2.1', 'Agent_CLI', '1.1', 'Agent_Foundation');

      const events = coordinator.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('handoff-created');
      expect(events[0].taskId).toBe('2.1');
      expect(events[0].agentId).toBe('Agent_CLI');
    });

    it('should create handoff with Ready status if dependency completed', () => {
      coordinator.initialize(new Set(['1.1']));

      const handoff = coordinator.createHandoff(
        '2.1',
        'Agent_CLI',
        '1.1',
        'Agent_Foundation'
      );

      expect(handoff.status).toBe(HandoffStatus.Ready);
      expect(handoff.readyAt).toBeInstanceOf(Date);
    });
  });

  describe('Task Completion and Handoff Updates', () => {
    beforeEach(() => {
      mockResolver = createMockDependencyResolver([]);
      config = {
        dependencyResolver: mockResolver,
        persistence: createMockPersistence(),
      };
      coordinator = createCrossAgentCoordinator(config);

      // Create handoffs
      coordinator.createHandoff('2.1', 'Agent_CLI', '1.1', 'Agent_Foundation');
      coordinator.createHandoff('3.1', 'Agent_Communication', '1.1', 'Agent_Foundation');
    });

    it('should mark task as completed', () => {
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');

      // Both handoffs should be Ready
      const handoffs = coordinator.getAllHandoffs();
      expect(handoffs.every(h => h.status === HandoffStatus.Ready)).toBe(true);
    });

    it('should update handoff status to Ready', () => {
      const handoff = coordinator.getHandoff('1.1->2.1');
      expect(handoff?.status).toBe(HandoffStatus.Pending);

      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');

      const updatedHandoff = coordinator.getHandoff('1.1->2.1');
      expect(updatedHandoff?.status).toBe(HandoffStatus.Ready);
      expect(updatedHandoff?.readyAt).toBeInstanceOf(Date);
    });

    it('should emit handoff-ready events', () => {
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');

      const events = coordinator.getEvents();
      const readyEvents = events.filter(e => e.type === 'handoff-ready');

      expect(readyEvents).toHaveLength(2);
    });

    it('should emit task-unblocked events', () => {
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');

      const events = coordinator.getEvents();
      const unblockedEvents = events.filter(e => e.type === 'task-unblocked');

      expect(unblockedEvents).toHaveLength(2);
    });

    it('should not update already completed handoffs', () => {
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');
      coordinator.completeHandoff('1.1->2.1');

      // Mark again
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');

      const handoff = coordinator.getHandoff('1.1->2.1');
      expect(handoff?.status).toBe(HandoffStatus.Completed);
    });
  });

  describe('Handoff Completion', () => {
    beforeEach(() => {
      mockResolver = createMockDependencyResolver([]);
      config = {
        dependencyResolver: mockResolver,
        persistence: createMockPersistence(),
      };
      coordinator = createCrossAgentCoordinator(config);

      coordinator.createHandoff('2.1', 'Agent_CLI', '1.1', 'Agent_Foundation');
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');
    });

    it('should complete handoff', () => {
      coordinator.completeHandoff('1.1->2.1');

      const handoff = coordinator.getHandoff('1.1->2.1');
      expect(handoff?.status).toBe(HandoffStatus.Completed);
      expect(handoff?.completedAt).toBeInstanceOf(Date);
    });

    it('should emit handoff-completed event', () => {
      coordinator.completeHandoff('1.1->2.1');

      const events = coordinator.getEvents();
      const completedEvents = events.filter(e => e.type === 'handoff-completed');

      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0].taskId).toBe('2.1');
    });

    it('should throw error for non-existent handoff', () => {
      expect(() => {
        coordinator.completeHandoff('99.99->88.88');
      }).toThrow('Handoff 99.99->88.88 not found');
    });

    it('should throw error if handoff not Ready', () => {
      coordinator.reset();
      coordinator.createHandoff('2.1', 'Agent_CLI', '1.1', 'Agent_Foundation');

      expect(() => {
        coordinator.completeHandoff('1.1->2.1');
      }).toThrow('Cannot complete handoff 1.1->2.1 with status Pending');
    });
  });

  describe('Task Readiness Checking', () => {
    beforeEach(() => {
      mockResolver = createMockDependencyResolver([]);
      config = {
        dependencyResolver: mockResolver,
        persistence: createMockPersistence(),
      };
      coordinator = createCrossAgentCoordinator(config);
    });

    it('should return true when no handoffs exist', () => {
      const canProceed = coordinator.canTaskProceed('2.1');
      expect(canProceed).toBe(true);
    });

    it('should return false when handoffs are Pending', () => {
      coordinator.createHandoff('2.1', 'Agent_CLI', '1.1', 'Agent_Foundation');

      const canProceed = coordinator.canTaskProceed('2.1');
      expect(canProceed).toBe(false);
    });

    it('should return true when all handoffs are Ready', () => {
      coordinator.createHandoff('2.1', 'Agent_CLI', '1.1', 'Agent_Foundation');
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');

      const canProceed = coordinator.canTaskProceed('2.1');
      expect(canProceed).toBe(true);
    });

    it('should return true when all handoffs are Completed', () => {
      coordinator.createHandoff('2.1', 'Agent_CLI', '1.1', 'Agent_Foundation');
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');
      coordinator.completeHandoff('1.1->2.1');

      const canProceed = coordinator.canTaskProceed('2.1');
      expect(canProceed).toBe(true);
    });

    it('should handle multiple handoffs', () => {
      coordinator.createHandoff('4.1', 'Agent_Automation', '2.1', 'Agent_CLI');
      coordinator.createHandoff('4.1', 'Agent_Automation', '3.1', 'Agent_Communication');

      // Both pending
      expect(coordinator.canTaskProceed('4.1')).toBe(false);

      // One ready
      coordinator.markTaskCompleted('2.1', 'Agent_CLI');
      expect(coordinator.canTaskProceed('4.1')).toBe(false);

      // Both ready
      coordinator.markTaskCompleted('3.1', 'Agent_Communication');
      expect(coordinator.canTaskProceed('4.1')).toBe(true);
    });
  });

  describe('Blocked Tasks', () => {
    beforeEach(() => {
      mockResolver = createMockDependencyResolver([]);
      config = {
        dependencyResolver: mockResolver,
        persistence: createMockPersistence(),
      };
      coordinator = createCrossAgentCoordinator(config);

      coordinator.createHandoff('2.1', 'Agent_CLI', '1.1', 'Agent_Foundation');
      coordinator.createHandoff('2.2', 'Agent_CLI', '1.2', 'Agent_Foundation');
      coordinator.createHandoff('3.1', 'Agent_Communication', '1.1', 'Agent_Foundation');
    });

    it('should get blocked tasks for agent', () => {
      const blocked = coordinator.getBlockedTasks('Agent_CLI');

      expect(blocked).toHaveLength(2);
      expect(blocked).toContain('2.1');
      expect(blocked).toContain('2.2');
    });

    it('should return empty for agent with no blocked tasks', () => {
      const blocked = coordinator.getBlockedTasks('Agent_Foundation');
      expect(blocked).toEqual([]);
    });

    it('should not include tasks with Ready handoffs', () => {
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');

      const blocked = coordinator.getBlockedTasks('Agent_CLI');

      expect(blocked).toHaveLength(1);
      expect(blocked).toContain('2.2'); // Only 2.2 still blocked
    });

    it('should check if task is blocked', () => {
      expect(coordinator.isTaskBlocked('2.1')).toBe(true);
      expect(coordinator.isTaskBlocked('1.1')).toBe(false);
    });

    it('should get blocking dependencies', () => {
      const blocking = coordinator.getBlockingDependencies('2.1');

      expect(blocking).toEqual(['1.1']);
    });
  });

  describe('Agent Coordination State', () => {
    beforeEach(() => {
      mockResolver = createMockDependencyResolver([]);
      config = {
        dependencyResolver: mockResolver,
        persistence: createMockPersistence(),
      };
      coordinator = createCrossAgentCoordinator(config);

      coordinator.createHandoff('2.1', 'Agent_CLI', '1.1', 'Agent_Foundation');
      coordinator.createHandoff('3.1', 'Agent_Communication', '1.1', 'Agent_Foundation');
    });

    it('should get coordination state for requesting agent', () => {
      const state = coordinator.getAgentCoordinationState('Agent_CLI');

      expect(state.agentId).toBe('Agent_CLI');
      expect(state.blockedTasks).toEqual(['2.1']);
      expect(state.pendingHandoffs).toHaveLength(1);
      expect(state.pendingHandoffs[0].requestingTask).toBe('2.1');
    });

    it('should get coordination state for providing agent', () => {
      const state = coordinator.getAgentCoordinationState('Agent_Foundation');

      expect(state.agentId).toBe('Agent_Foundation');
      expect(state.providingHandoffs).toHaveLength(2);
    });

    it('should track completed outputs', () => {
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');

      const state = coordinator.getAgentCoordinationState('Agent_Foundation');

      expect(state.completedOutputs).toContain('1.1');
    });

    it('should not include completed handoffs in pending', () => {
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');
      coordinator.completeHandoff('1.1->2.1');

      const state = coordinator.getAgentCoordinationState('Agent_CLI');

      expect(state.pendingHandoffs).toHaveLength(0);
    });
  });

  describe('Handoff Queries', () => {
    beforeEach(() => {
      mockResolver = createMockDependencyResolver([]);
      config = {
        dependencyResolver: mockResolver,
        persistence: createMockPersistence(),
      };
      coordinator = createCrossAgentCoordinator(config);

      coordinator.createHandoff('2.1', 'Agent_CLI', '1.1', 'Agent_Foundation');
      coordinator.createHandoff('2.2', 'Agent_CLI', '1.2', 'Agent_Foundation');
      coordinator.createHandoff('3.1', 'Agent_Communication', '1.1', 'Agent_Foundation');
    });

    it('should get all handoffs', () => {
      const handoffs = coordinator.getAllHandoffs();
      expect(handoffs).toHaveLength(3);
    });

    it('should get handoffs by status', () => {
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');

      const pending = coordinator.getHandoffsByStatus(HandoffStatus.Pending);
      const ready = coordinator.getHandoffsByStatus(HandoffStatus.Ready);

      expect(pending).toHaveLength(1);
      expect(ready).toHaveLength(2);
    });

    it('should get handoff by ID', () => {
      const handoff = coordinator.getHandoff('1.1->2.1');

      expect(handoff).toBeDefined();
      expect(handoff?.requestingTask).toBe('2.1');
    });

    it('should return undefined for non-existent handoff', () => {
      const handoff = coordinator.getHandoff('99.99->88.88');
      expect(handoff).toBeUndefined();
    });
  });

  describe('Event Tracking', () => {
    beforeEach(() => {
      mockResolver = createMockDependencyResolver([]);
      config = {
        dependencyResolver: mockResolver,
        persistence: createMockPersistence(),
      };
      coordinator = createCrossAgentCoordinator(config);
    });

    it('should track events in order', () => {
      coordinator.createHandoff('2.1', 'Agent_CLI', '1.1', 'Agent_Foundation');
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');
      coordinator.completeHandoff('1.1->2.1');

      const events = coordinator.getEvents();

      expect(events).toHaveLength(4); // created, ready, unblocked, completed
      expect(events[0].type).toBe('handoff-completed'); // Most recent first
      expect(events[3].type).toBe('handoff-created'); // Oldest last
    });

    it('should limit events returned', () => {
      coordinator.createHandoff('2.1', 'Agent_CLI', '1.1', 'Agent_Foundation');
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');

      const events = coordinator.getEvents(2);

      expect(events).toHaveLength(2);
    });

    it('should get events for task', () => {
      coordinator.createHandoff('2.1', 'Agent_CLI', '1.1', 'Agent_Foundation');
      coordinator.createHandoff('3.1', 'Agent_Communication', '1.1', 'Agent_Foundation');
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');

      const task21Events = coordinator.getEventsForTask('2.1');

      expect(task21Events.length).toBeGreaterThan(0);
      expect(task21Events.every(e => e.taskId === '2.1')).toBe(true);
    });

    it('should get events for agent', () => {
      coordinator.createHandoff('2.1', 'Agent_CLI', '1.1', 'Agent_Foundation');
      coordinator.createHandoff('3.1', 'Agent_Communication', '1.1', 'Agent_Foundation');
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');

      const cliEvents = coordinator.getEventsForAgent('Agent_CLI');

      expect(cliEvents.length).toBeGreaterThan(0);
      expect(cliEvents.every(e => e.agentId === 'Agent_CLI')).toBe(true);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle multiple agents with cross dependencies', () => {
      const crossAgentDeps = [
        {
          taskId: '2.1',
          dependsOn: '1.1',
          fromAgent: 'Agent_CLI',
          toAgent: 'Agent_Foundation',
        },
        {
          taskId: '3.1',
          dependsOn: '1.1',
          fromAgent: 'Agent_Communication',
          toAgent: 'Agent_Foundation',
        },
        {
          taskId: '4.1',
          dependsOn: '2.1',
          fromAgent: 'Agent_Automation',
          toAgent: 'Agent_CLI',
        },
        {
          taskId: '4.1',
          dependsOn: '3.1',
          fromAgent: 'Agent_Automation',
          toAgent: 'Agent_Communication',
        },
      ];

      mockResolver = createMockDependencyResolver(crossAgentDeps);
      config = {
        dependencyResolver: mockResolver,
        persistence: createMockPersistence(),
      };
      coordinator = createCrossAgentCoordinator(config);
      coordinator.initialize(new Set());

      expect(coordinator.getAllHandoffs()).toHaveLength(4);

      // Complete 1.1
      coordinator.markTaskCompleted('1.1', 'Agent_Foundation');
      expect(coordinator.canTaskProceed('2.1')).toBe(true);
      expect(coordinator.canTaskProceed('3.1')).toBe(true);
      expect(coordinator.canTaskProceed('4.1')).toBe(false); // Still waiting for 2.1 and 3.1

      // Complete 2.1 and 3.1
      coordinator.markTaskCompleted('2.1', 'Agent_CLI');
      coordinator.markTaskCompleted('3.1', 'Agent_Communication');
      expect(coordinator.canTaskProceed('4.1')).toBe(true);
    });

    it('should handle sequential handoffs', () => {
      mockResolver = createMockDependencyResolver([]);
      config = {
        dependencyResolver: mockResolver,
        persistence: createMockPersistence(),
      };
      coordinator = createCrossAgentCoordinator(config);

      // Chain: 1.1 -> 2.1 -> 3.1
      coordinator.createHandoff('2.1', 'Agent_B', '1.1', 'Agent_A');
      coordinator.createHandoff('3.1', 'Agent_C', '2.1', 'Agent_B');

      expect(coordinator.canTaskProceed('2.1')).toBe(false);
      expect(coordinator.canTaskProceed('3.1')).toBe(false);

      coordinator.markTaskCompleted('1.1', 'Agent_A');
      expect(coordinator.canTaskProceed('2.1')).toBe(true);
      expect(coordinator.canTaskProceed('3.1')).toBe(false);

      coordinator.markTaskCompleted('2.1', 'Agent_B');
      expect(coordinator.canTaskProceed('3.1')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      mockResolver = createMockDependencyResolver([]);
      config = {
        dependencyResolver: mockResolver,
        persistence: createMockPersistence(),
      };
      coordinator = createCrossAgentCoordinator(config);
    });

    it('should handle reset', () => {
      coordinator.createHandoff('2.1', 'Agent_CLI', '1.1', 'Agent_Foundation');
      coordinator.reset();

      expect(coordinator.getAllHandoffs()).toEqual([]);
      expect(coordinator.getEvents()).toEqual([]);
    });

    it('should handle same task depending on multiple tasks from same agent', () => {
      coordinator.createHandoff('3.1', 'Agent_C', '1.1', 'Agent_A');
      coordinator.createHandoff('3.1', 'Agent_C', '1.2', 'Agent_A');

      expect(coordinator.canTaskProceed('3.1')).toBe(false);

      coordinator.markTaskCompleted('1.1', 'Agent_A');
      expect(coordinator.canTaskProceed('3.1')).toBe(false);

      coordinator.markTaskCompleted('1.2', 'Agent_A');
      expect(coordinator.canTaskProceed('3.1')).toBe(true);
    });
  });

  describe('createCrossAgentCoordinator()', () => {
    it('should create CrossAgentCoordinator instance', () => {
      mockResolver = createMockDependencyResolver([]);
      const newCoordinator = createCrossAgentCoordinator({
        dependencyResolver: mockResolver,
        persistence: createMockPersistence(),
      });

      expect(newCoordinator).toBeInstanceOf(CrossAgentCoordinator);
    });
  });
});
