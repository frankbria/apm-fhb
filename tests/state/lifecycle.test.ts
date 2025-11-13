/**
 * State Lifecycle Tests
 * Tests for agent state machine transitions, validation, and guards
 */

import { describe, it, expect } from 'vitest';
import {
  VALID_TRANSITIONS,
  isValidTransition,
  validateTransition,
  canTransition,
  getValidNextStates,
  isFinalState,
  getTransitionDescription,
  getStateMachineStats
} from '../../src/state/agent-lifecycle.js';
import { AgentStatus, AgentType, AgentState } from '../../src/types/agent.js';

describe('Agent Lifecycle State Machine', () => {
  describe('VALID_TRANSITIONS map', () => {
    it('should define transitions for all agent states', () => {
      expect(VALID_TRANSITIONS.has(AgentStatus.Spawning)).toBe(true);
      expect(VALID_TRANSITIONS.has(AgentStatus.Active)).toBe(true);
      expect(VALID_TRANSITIONS.has(AgentStatus.Waiting)).toBe(true);
      expect(VALID_TRANSITIONS.has(AgentStatus.Idle)).toBe(true);
      expect(VALID_TRANSITIONS.has(AgentStatus.Terminated)).toBe(true);
    });

    it('should allow Spawning → Active transition', () => {
      const transitions = VALID_TRANSITIONS.get(AgentStatus.Spawning);
      expect(transitions).toContain(AgentStatus.Active);
    });

    it('should allow Spawning → Terminated transition', () => {
      const transitions = VALID_TRANSITIONS.get(AgentStatus.Spawning);
      expect(transitions).toContain(AgentStatus.Terminated);
    });

    it('should not allow Terminated → any transition', () => {
      const transitions = VALID_TRANSITIONS.get(AgentStatus.Terminated);
      expect(transitions).toHaveLength(0);
    });
  });

  describe('isValidTransition()', () => {
    it('should allow null → Spawning (initial spawn)', () => {
      expect(isValidTransition(null, AgentStatus.Spawning)).toBe(true);
    });

    it('should reject null → Active (must spawn first)', () => {
      expect(isValidTransition(null, AgentStatus.Active)).toBe(false);
    });

    it('should allow Spawning → Active', () => {
      expect(isValidTransition(AgentStatus.Spawning, AgentStatus.Active)).toBe(true);
    });

    it('should allow Active → Waiting', () => {
      expect(isValidTransition(AgentStatus.Active, AgentStatus.Waiting)).toBe(true);
    });

    it('should allow Active → Idle', () => {
      expect(isValidTransition(AgentStatus.Active, AgentStatus.Idle)).toBe(true);
    });

    it('should allow Active → Terminated', () => {
      expect(isValidTransition(AgentStatus.Active, AgentStatus.Terminated)).toBe(true);
    });

    it('should allow Waiting → Active', () => {
      expect(isValidTransition(AgentStatus.Waiting, AgentStatus.Active)).toBe(true);
    });

    it('should allow Idle → Active', () => {
      expect(isValidTransition(AgentStatus.Idle, AgentStatus.Active)).toBe(true);
    });

    it('should reject Terminated → Active (final state)', () => {
      expect(isValidTransition(AgentStatus.Terminated, AgentStatus.Active)).toBe(false);
    });

    it('should reject Spawning → Waiting (invalid path)', () => {
      expect(isValidTransition(AgentStatus.Spawning, AgentStatus.Waiting)).toBe(false);
    });

    it('should reject Active → Spawning (can\'t return to spawning)', () => {
      expect(isValidTransition(AgentStatus.Active, AgentStatus.Spawning)).toBe(false);
    });
  });

  describe('validateTransition()', () => {
    it('should return allowed=true for valid transitions', () => {
      const result = validateTransition(AgentStatus.Spawning, AgentStatus.Active);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should return allowed=false with reason for invalid transitions', () => {
      const result = validateTransition(AgentStatus.Terminated, AgentStatus.Active);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Cannot transition');
      expect(result.reason).toContain('Terminated');
      expect(result.reason).toContain('Active');
    });

    it('should provide allowed transitions in error message', () => {
      const result = validateTransition(AgentStatus.Spawning, AgentStatus.Waiting);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Allowed transitions');
    });

    it('should validate initial spawn correctly', () => {
      const validResult = validateTransition(null, AgentStatus.Spawning);
      expect(validResult.allowed).toBe(true);

      const invalidResult = validateTransition(null, AgentStatus.Active);
      expect(invalidResult.allowed).toBe(false);
      expect(invalidResult.reason).toContain('Initial agent state must be Spawning');
    });
  });

  describe('canTransition() - guard functions', () => {
    const createAgent = (status: AgentStatus, currentTask: string | null = null): AgentState => ({
      id: 'test_agent',
      type: AgentType.Implementation,
      status,
      currentTask,
      metadata: {
        spawnedAt: new Date(),
        lastActivityAt: new Date()
      }
    });

    it('should allow valid state machine transitions', () => {
      const agent = createAgent(AgentStatus.Spawning);
      const result = canTransition(agent, AgentStatus.Active);
      expect(result.allowed).toBe(true);
    });

    it('should reject Terminated → Active (crashed without recovery)', () => {
      const agent = createAgent(AgentStatus.Terminated);
      (agent.metadata as any).terminationReason = 'crash';

      const result = canTransition(agent, AgentStatus.Active);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('crash');
    });

    it('should reject Idle → Active without task assignment', () => {
      const agent = createAgent(AgentStatus.Idle, null);
      const result = canTransition(agent, AgentStatus.Active);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('task assignment');
    });

    it('should allow Idle → Active with task assignment', () => {
      const agent = createAgent(AgentStatus.Idle, null);
      agent.currentTask = 'task_1';

      const result = canTransition(agent, AgentStatus.Active);
      expect(result.allowed).toBe(true);
    });

    it('should reject Active → Waiting without active task', () => {
      const agent = createAgent(AgentStatus.Active, null);
      const result = canTransition(agent, AgentStatus.Waiting);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('without an active task');
    });

    it('should allow Active → Waiting with active task', () => {
      const agent = createAgent(AgentStatus.Active, 'task_1');
      const result = canTransition(agent, AgentStatus.Waiting);
      expect(result.allowed).toBe(true);
    });

    it('should reject Active → Idle with current task', () => {
      const agent = createAgent(AgentStatus.Active, 'task_1');
      const result = canTransition(agent, AgentStatus.Idle);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('assigned to a task');
    });

    it('should allow Active → Idle without current task', () => {
      const agent = createAgent(AgentStatus.Active, null);
      const result = canTransition(agent, AgentStatus.Idle);
      expect(result.allowed).toBe(true);
    });

    it('should always allow transitions to Terminated', () => {
      const statuses = [AgentStatus.Spawning, AgentStatus.Active, AgentStatus.Waiting, AgentStatus.Idle];

      for (const status of statuses) {
        const agent = createAgent(status);
        const result = canTransition(agent, AgentStatus.Terminated);
        expect(result.allowed).toBe(true);
      }
    });

    it('should reject return to Spawning state', () => {
      const agent = createAgent(AgentStatus.Active);
      const result = canTransition(agent, AgentStatus.Spawning);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cannot return to Spawning');
    });
  });

  describe('getValidNextStates()', () => {
    it('should return [Spawning] for null (initial state)', () => {
      const nextStates = getValidNextStates(null);
      expect(nextStates).toEqual([AgentStatus.Spawning]);
    });

    it('should return correct next states for Spawning', () => {
      const nextStates = getValidNextStates(AgentStatus.Spawning);
      expect(nextStates).toContain(AgentStatus.Active);
      expect(nextStates).toContain(AgentStatus.Terminated);
    });

    it('should return empty array for Terminated (final state)', () => {
      const nextStates = getValidNextStates(AgentStatus.Terminated);
      expect(nextStates).toHaveLength(0);
    });

    it('should return correct next states for Active', () => {
      const nextStates = getValidNextStates(AgentStatus.Active);
      expect(nextStates).toContain(AgentStatus.Waiting);
      expect(nextStates).toContain(AgentStatus.Idle);
      expect(nextStates).toContain(AgentStatus.Terminated);
    });
  });

  describe('isFinalState()', () => {
    it('should return true for Terminated state', () => {
      expect(isFinalState(AgentStatus.Terminated)).toBe(true);
    });

    it('should return false for non-final states', () => {
      expect(isFinalState(AgentStatus.Spawning)).toBe(false);
      expect(isFinalState(AgentStatus.Active)).toBe(false);
      expect(isFinalState(AgentStatus.Waiting)).toBe(false);
      expect(isFinalState(AgentStatus.Idle)).toBe(false);
    });
  });

  describe('getTransitionDescription()', () => {
    it('should provide description for initial spawn', () => {
      const desc = getTransitionDescription(null, AgentStatus.Spawning);
      expect(desc).toContain('spawned');
      expect(desc).toContain('initialized');
    });

    it('should provide description for Spawning → Active', () => {
      const desc = getTransitionDescription(AgentStatus.Spawning, AgentStatus.Active);
      expect(desc).toContain('initialized');
      expect(desc).toContain('ready');
    });

    it('should provide description for Active → Waiting', () => {
      const desc = getTransitionDescription(AgentStatus.Active, AgentStatus.Waiting);
      expect(desc).toContain('waiting');
      expect(desc).toContain('blocked');
    });

    it('should provide description for Active → Terminated', () => {
      const desc = getTransitionDescription(AgentStatus.Active, AgentStatus.Terminated);
      expect(desc).toContain('shut down');
      expect(desc).toContain('error');
    });

    it('should provide generic description for unlisted transitions', () => {
      const desc = getTransitionDescription(AgentStatus.Waiting, AgentStatus.Idle);
      expect(desc).toContain('transitions');
    });
  });

  describe('getStateMachineStats()', () => {
    it('should return correct statistics', () => {
      const stats = getStateMachineStats();

      expect(stats.totalStates).toBe(5); // Spawning, Active, Waiting, Idle, Terminated
      expect(stats.totalTransitions).toBeGreaterThan(0);
      expect(stats.finalStates).toBe(1); // Only Terminated
      expect(stats.avgTransitionsPerState).toBeGreaterThan(0);
    });

    it('should calculate average correctly', () => {
      const stats = getStateMachineStats();
      const expectedAvg = stats.totalTransitions / stats.totalStates;
      expect(stats.avgTransitionsPerState).toBeCloseTo(expectedAvg, 2);
    });
  });
});
