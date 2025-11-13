/**
 * Task Filtering Tests
 *
 * Tests task filtering logic with Implementation Plans.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseImplementationPlan,
  filterByPhaseRange,
  filterByTaskList,
  filterByAgentAssignment,
  resolveDependencies,
  filterTasks,
  type ImplementationPlan,
} from '../../src/scope/filter.js';
import { ScopeDefinition } from '../../src/scope/definition.js';

// Mock Implementation Plan for testing
const mockPlan = `# Test Implementation Plan

## Phase 1: Foundation

### Task 1.1 – Database Setup │ Agent_Foundation

- **Objective:** Set up database
- **Output:** Database schema
- **Guidance:** Depends on Task 1.3 Output. Create database tables.

### Task 1.2 – API Layer │ Agent_API

- **Objective:** Create API
- **Output:** REST API
- **Guidance:** Depends on Task 1.1 Output. Build API endpoints.

### Task 1.3 – Type Definitions │ Agent_Foundation

- **Objective:** Define types
- **Output:** TypeScript types
- **Guidance:** Create type definitions for the project.

## Phase 2: Features

### Task 2.1 – User Management │ Agent_Features

- **Objective:** Implement users
- **Output:** User CRUD
- **Guidance:** Depends on Task 1.2 Output. Create user management.

### Task 2.2 – Authentication │ Agent_Features

- **Objective:** Add auth
- **Output:** Auth system
- **Guidance:** Depends on Task 2.1 Output. Implement authentication.
`;

describe('Task Filtering', () => {
  let plan: ImplementationPlan;

  beforeEach(() => {
    plan = parseImplementationPlan(mockPlan);
  });

  describe('Implementation Plan Parsing', () => {
    it('should parse phases correctly', () => {
      expect(plan.phases).toHaveLength(2);
      expect(plan.phases[0].phaseNumber).toBe(1);
      expect(plan.phases[0].title).toBe('Foundation');
      expect(plan.phases[1].phaseNumber).toBe(2);
      expect(plan.phases[1].title).toBe('Features');
    });

    it('should parse tasks correctly', () => {
      expect(plan.tasks.size).toBe(5);
      expect(plan.tasks.has('1.1')).toBe(true);
      expect(plan.tasks.has('1.2')).toBe(true);
      expect(plan.tasks.has('1.3')).toBe(true);
      expect(plan.tasks.has('2.1')).toBe(true);
      expect(plan.tasks.has('2.2')).toBe(true);
    });

    it('should extract task metadata', () => {
      const task = plan.tasks.get('1.1');
      expect(task?.taskId).toBe('1.1');
      expect(task?.title).toBe('Database Setup');
      expect(task?.phase).toBe(1);
      expect(task?.agentAssignment).toBe('Agent_Foundation');
      expect(task?.objective).toContain('Set up database');
    });

    it('should extract task dependencies', () => {
      const task11 = plan.tasks.get('1.1');
      expect(task11?.dependencies).toEqual(['1.3']);

      const task12 = plan.tasks.get('1.2');
      expect(task12?.dependencies).toEqual(['1.1']);

      const task21 = plan.tasks.get('2.1');
      expect(task21?.dependencies).toEqual(['1.2']);

      const task22 = plan.tasks.get('2.2');
      expect(task22?.dependencies).toEqual(['2.1']);
    });

    it('should assign tasks to phases', () => {
      expect(plan.phases[0].tasks).toEqual(['1.1', '1.2', '1.3']);
      expect(plan.phases[1].tasks).toEqual(['2.1', '2.2']);
    });
  });

  describe('Filter by Phase Range', () => {
    it('should filter single phase', () => {
      const taskIds = filterByPhaseRange(plan, { start: 1, end: 1 });
      expect(taskIds).toHaveLength(3);
      expect(taskIds).toContain('1.1');
      expect(taskIds).toContain('1.2');
      expect(taskIds).toContain('1.3');
    });

    it('should filter phase range', () => {
      const taskIds = filterByPhaseRange(plan, { start: 1, end: 2 });
      expect(taskIds).toHaveLength(5);
    });

    it('should filter second phase only', () => {
      const taskIds = filterByPhaseRange(plan, { start: 2, end: 2 });
      expect(taskIds).toHaveLength(2);
      expect(taskIds).toContain('2.1');
      expect(taskIds).toContain('2.2');
    });

    it('should return empty for non-existent phase', () => {
      const taskIds = filterByPhaseRange(plan, { start: 99, end: 99 });
      expect(taskIds).toHaveLength(0);
    });
  });

  describe('Filter by Task List', () => {
    it('should filter existing tasks', () => {
      const result = filterByTaskList(plan, ['1.1', '2.1']);
      expect(result.taskIds).toHaveLength(2);
      expect(result.taskIds).toContain('1.1');
      expect(result.taskIds).toContain('2.1');
      expect(result.warnings).toHaveLength(0);
    });

    it('should warn about missing tasks', () => {
      const result = filterByTaskList(plan, ['1.1', '99.99']);
      expect(result.taskIds).toHaveLength(1);
      expect(result.taskIds).toContain('1.1');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Task 99.99 not found');
    });

    it('should return empty for all missing tasks', () => {
      const result = filterByTaskList(plan, ['99.1', '99.2']);
      expect(result.taskIds).toHaveLength(0);
      expect(result.warnings).toHaveLength(2);
    });
  });

  describe('Filter by Agent Assignment', () => {
    it('should filter exact agent match', () => {
      const taskIds = filterByAgentAssignment(plan, ['Agent_Foundation']);
      expect(taskIds).toHaveLength(2);
      expect(taskIds).toContain('1.1');
      expect(taskIds).toContain('1.3');
    });

    it('should filter with wildcard prefix', () => {
      const taskIds = filterByAgentAssignment(plan, ['Agent_F*']);
      expect(taskIds).toHaveLength(4); // Agent_Foundation and Agent_Features
    });

    it('should filter with wildcard suffix', () => {
      const taskIds = filterByAgentAssignment(plan, ['*_Foundation']);
      expect(taskIds).toHaveLength(2);
    });

    it('should filter with contains wildcard', () => {
      const taskIds = filterByAgentAssignment(plan, ['*Features*']);
      expect(taskIds).toHaveLength(2);
      expect(taskIds).toContain('2.1');
      expect(taskIds).toContain('2.2');
    });

    it('should return empty for no matches', () => {
      const taskIds = filterByAgentAssignment(plan, ['NonExistent']);
      expect(taskIds).toHaveLength(0);
    });
  });

  describe('Dependency Resolution', () => {
    it('should auto-include dependencies', () => {
      const result = resolveDependencies(plan, ['1.1'], { includeDependencies: true });

      expect(result.taskIds).toHaveLength(2);
      expect(result.taskIds).toContain('1.1');
      expect(result.taskIds).toContain('1.3'); // dependency
      expect(result.includedDeps).toEqual(['1.3']);
      expect(result.warnings).toHaveLength(0);
    });

    it('should warn about missing dependencies', () => {
      const result = resolveDependencies(plan, ['1.1'], { warnMissingDependencies: true });

      expect(result.taskIds).toHaveLength(1);
      expect(result.taskIds).toContain('1.1');
      expect(result.includedDeps).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('depends on 1.3');
    });

    it('should resolve deep dependencies', () => {
      const result = resolveDependencies(plan, ['2.2'], { includeDependencies: true });

      // 2.2 → 2.1 → 1.2 → 1.1 → 1.3
      expect(result.taskIds).toHaveLength(5);
      expect(result.taskIds).toContain('2.2');
      expect(result.taskIds).toContain('2.1');
      expect(result.taskIds).toContain('1.2');
      expect(result.taskIds).toContain('1.1');
      expect(result.taskIds).toContain('1.3');
    });

    it('should not duplicate already included tasks', () => {
      const result = resolveDependencies(plan, ['1.1', '1.3'], { includeDependencies: true });

      expect(result.taskIds).toHaveLength(2);
      expect(result.includedDeps).toHaveLength(0); // 1.3 already in scope
    });

    it('should handle tasks with no dependencies', () => {
      const result = resolveDependencies(plan, ['1.3'], { includeDependencies: true });

      expect(result.taskIds).toHaveLength(1);
      expect(result.taskIds).toContain('1.3');
      expect(result.includedDeps).toHaveLength(0);
    });
  });

  describe('Complete Task Filtering', () => {
    it('should filter by phase range', () => {
      const scope = new ScopeDefinition({ phaseRange: { start: 1, end: 1 } });
      const result = filterTasks(plan, scope);

      expect(result.tasks).toHaveLength(3);
      expect(result.tasks.map(t => t.taskId)).toContain('1.1');
      expect(result.tasks.map(t => t.taskId)).toContain('1.2');
      expect(result.tasks.map(t => t.taskId)).toContain('1.3');
    });

    it('should filter by task list', () => {
      const scope = new ScopeDefinition({ taskList: ['1.1', '2.1'] });
      const result = filterTasks(plan, scope);

      expect(result.tasks).toHaveLength(2);
      expect(result.tasks.map(t => t.taskId)).toContain('1.1');
      expect(result.tasks.map(t => t.taskId)).toContain('2.1');
    });

    it('should filter by agent', () => {
      const scope = new ScopeDefinition({ agentFilters: ['Agent_Features'] });
      const result = filterTasks(plan, scope);

      expect(result.tasks).toHaveLength(2);
      expect(result.tasks.map(t => t.taskId)).toContain('2.1');
      expect(result.tasks.map(t => t.taskId)).toContain('2.2');
    });

    it('should combine phase and agent filters (intersection)', () => {
      const scope = new ScopeDefinition({
        phaseRange: { start: 1, end: 1 },
        agentFilters: ['Agent_Foundation'],
      });
      const result = filterTasks(plan, scope);

      expect(result.tasks).toHaveLength(2);
      expect(result.tasks.map(t => t.taskId)).toContain('1.1');
      expect(result.tasks.map(t => t.taskId)).toContain('1.3');
    });

    it('should include dependencies with option', () => {
      const scope = new ScopeDefinition({ taskList: ['2.2'] });
      const result = filterTasks(plan, scope, { includeDependencies: true });

      expect(result.tasks).toHaveLength(5);
      expect(result.includedDependencies).toHaveLength(4);
    });

    it('should handle empty scope (select all)', () => {
      const scope = new ScopeDefinition();
      const result = filterTasks(plan, scope);

      expect(result.tasks).toHaveLength(5);
    });

    it('should sort tasks by phase and task ID', () => {
      const scope = new ScopeDefinition({ taskList: ['2.2', '1.1', '2.1'] });
      const result = filterTasks(plan, scope);

      expect(result.tasks[0].taskId).toBe('1.1');
      expect(result.tasks[1].taskId).toBe('2.1');
      expect(result.tasks[2].taskId).toBe('2.2');
    });
  });

  describe('Dry Run Mode', () => {
    it('should not modify behavior in dry run', () => {
      const scope = new ScopeDefinition({ phaseRange: { start: 1, end: 1 } });
      const result = filterTasks(plan, scope, { dryRun: true });

      // Same results as non-dry-run
      expect(result.tasks).toHaveLength(3);
    });
  });
});
