/**
 * Dependency Resolver Tests
 * Tests for dependency resolution and execution order
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DependencyResolver,
  createDependencyResolver,
  type DependencyResolverConfig,
  type DependencyNode,
} from '../../src/orchestration/dependency-resolver.js';
import { type ImplementationPlan, type TaskMetadata } from '../../src/scope/filter.js';

// Helper to create task metadata
function createTask(
  taskId: string,
  phase: number,
  agentAssignment: string,
  dependencies: string[] = []
): TaskMetadata {
  return {
    taskId,
    title: `Task ${taskId}`,
    phase,
    agentAssignment,
    dependencies,
    objective: `Objective for ${taskId}`,
    output: `Output for ${taskId}`,
    guidance: dependencies.length > 0
      ? `Depends on ${dependencies.join(', ')}`
      : 'No dependencies',
    fullContent: 'Full task content...',
  };
}

// Helper to create Implementation Plan
function createPlan(tasks: TaskMetadata[]): ImplementationPlan {
  const taskMap = new Map<string, TaskMetadata>();
  for (const task of tasks) {
    taskMap.set(task.taskId, task);
  }

  return {
    tasks: taskMap,
    phases: [
      { phaseNumber: 1, title: 'Phase 1', totalTasks: tasks.length },
    ],
  };
}

describe('DependencyResolver', () => {
  describe('Simple Linear Dependencies', () => {
    let resolver: DependencyResolver;
    let plan: ImplementationPlan;

    beforeEach(() => {
      // Linear chain: 1.1 -> 1.2 -> 1.3
      const tasks = [
        createTask('1.1', 1, 'Agent_A'),
        createTask('1.2', 1, 'Agent_A', ['1.1']),
        createTask('1.3', 1, 'Agent_A', ['1.2']),
      ];

      plan = createPlan(tasks);
      resolver = createDependencyResolver({ implementationPlan: plan });
    });

    it('should build dependency graph', () => {
      const graph = resolver.buildDependencyGraph();

      expect(graph.size).toBe(3);
      expect(graph.get('1.1')?.dependencies).toEqual([]);
      expect(graph.get('1.2')?.dependencies).toEqual(['1.1']);
      expect(graph.get('1.3')?.dependencies).toEqual(['1.2']);
    });

    it('should build reverse edges (dependents)', () => {
      const graph = resolver.buildDependencyGraph();

      expect(graph.get('1.1')?.dependents).toEqual(['1.2']);
      expect(graph.get('1.2')?.dependents).toEqual(['1.3']);
      expect(graph.get('1.3')?.dependents).toEqual([]);
    });

    it('should perform topological sort', () => {
      const order = resolver.topologicalSort();

      expect(order).toEqual(['1.1', '1.2', '1.3']);
    });

    it('should create execution batches', () => {
      const batches = resolver.buildExecutionBatches();

      expect(batches).toHaveLength(3);
      expect(batches[0].tasks).toEqual(['1.1']);
      expect(batches[1].tasks).toEqual(['1.2']);
      expect(batches[2].tasks).toEqual(['1.3']);
    });

    it('should analyze dependencies', () => {
      const analysis = resolver.analyzeDependencies();

      expect(analysis.totalTasks).toBe(3);
      expect(analysis.rootTasks).toEqual(['1.1']);
      expect(analysis.leafTasks).toEqual(['1.3']);
      expect(analysis.executionOrder).toEqual(['1.1', '1.2', '1.3']);
      expect(analysis.hasCircularDependencies).toBe(false);
      expect(analysis.circularDependencies).toEqual([]);
    });
  });

  describe('Parallel Tasks (No Dependencies)', () => {
    let resolver: DependencyResolver;

    beforeEach(() => {
      // Three independent tasks
      const tasks = [
        createTask('1.1', 1, 'Agent_A'),
        createTask('1.2', 1, 'Agent_B'),
        createTask('1.3', 1, 'Agent_C'),
      ];

      const plan = createPlan(tasks);
      resolver = createDependencyResolver({ implementationPlan: plan });
    });

    it('should identify all tasks as root tasks', () => {
      const analysis = resolver.analyzeDependencies();

      expect(analysis.rootTasks).toEqual(['1.1', '1.2', '1.3']);
    });

    it('should create single execution batch', () => {
      const batches = resolver.buildExecutionBatches();

      expect(batches).toHaveLength(1);
      expect(batches[0].tasks).toEqual(['1.1', '1.2', '1.3']);
      expect(batches[0].description).toContain('3 tasks');
    });

    it('should handle topological sort', () => {
      const order = resolver.topologicalSort();

      expect(order).toHaveLength(3);
      expect(order).toContain('1.1');
      expect(order).toContain('1.2');
      expect(order).toContain('1.3');
    });
  });

  describe('Diamond Dependencies', () => {
    let resolver: DependencyResolver;

    beforeEach(() => {
      // Diamond: 1.4 depends on 1.2 and 1.3, both depend on 1.1
      //     1.1
      //    /   \
      //  1.2   1.3
      //    \   /
      //     1.4
      const tasks = [
        createTask('1.1', 1, 'Agent_A'),
        createTask('1.2', 1, 'Agent_A', ['1.1']),
        createTask('1.3', 1, 'Agent_A', ['1.1']),
        createTask('1.4', 1, 'Agent_A', ['1.2', '1.3']),
      ];

      const plan = createPlan(tasks);
      resolver = createDependencyResolver({ implementationPlan: plan });
    });

    it('should identify correct root and leaf tasks', () => {
      const analysis = resolver.analyzeDependencies();

      expect(analysis.rootTasks).toEqual(['1.1']);
      expect(analysis.leafTasks).toEqual(['1.4']);
    });

    it('should create correct execution batches', () => {
      const batches = resolver.buildExecutionBatches();

      expect(batches).toHaveLength(3);
      expect(batches[0].tasks).toEqual(['1.1']);
      expect(batches[1].tasks).toEqual(['1.2', '1.3']); // Parallel
      expect(batches[2].tasks).toEqual(['1.4']);
    });

    it('should respect all dependencies in topological sort', () => {
      const order = resolver.topologicalSort();

      const idx11 = order.indexOf('1.1');
      const idx12 = order.indexOf('1.2');
      const idx13 = order.indexOf('1.3');
      const idx14 = order.indexOf('1.4');

      // 1.1 must come before 1.2 and 1.3
      expect(idx11).toBeLessThan(idx12);
      expect(idx11).toBeLessThan(idx13);

      // 1.2 and 1.3 must come before 1.4
      expect(idx12).toBeLessThan(idx14);
      expect(idx13).toBeLessThan(idx14);
    });
  });

  describe('Circular Dependencies', () => {
    let resolver: DependencyResolver;

    beforeEach(() => {
      // Circular: 1.1 -> 1.2 -> 1.3 -> 1.1
      const tasks = [
        createTask('1.1', 1, 'Agent_A', ['1.3']),
        createTask('1.2', 1, 'Agent_A', ['1.1']),
        createTask('1.3', 1, 'Agent_A', ['1.2']),
      ];

      const plan = createPlan(tasks);
      resolver = createDependencyResolver({ implementationPlan: plan });
    });

    it('should detect circular dependencies', () => {
      const cycles = resolver.detectCircularDependencies();

      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0]).toContain('1.1');
      expect(cycles[0]).toContain('1.2');
      expect(cycles[0]).toContain('1.3');
    });

    it('should report circular dependencies in analysis', () => {
      const analysis = resolver.analyzeDependencies();

      expect(analysis.hasCircularDependencies).toBe(true);
      expect(analysis.circularDependencies.length).toBeGreaterThan(0);
    });

    it('should return empty execution order when circular dependencies exist', () => {
      const analysis = resolver.analyzeDependencies();

      expect(analysis.executionOrder).toEqual([]);
      expect(analysis.executionBatches).toEqual([]);
    });
  });

  describe('Cross-Agent Dependencies', () => {
    let resolver: DependencyResolver;

    beforeEach(() => {
      // Tasks from different agents with dependencies
      const tasks = [
        createTask('1.1', 1, 'Agent_Foundation'),
        createTask('2.1', 2, 'Agent_CLI', ['1.1']), // CLI depends on Foundation
        createTask('3.1', 3, 'Agent_Communication', ['1.1']), // Comm depends on Foundation
        createTask('4.1', 4, 'Agent_Automation', ['2.1', '3.1']), // Automation depends on CLI and Comm
      ];

      const plan = createPlan(tasks);
      resolver = createDependencyResolver({ implementationPlan: plan });
    });

    it('should identify cross-agent dependencies', () => {
      const crossAgentDeps = resolver.findCrossAgentDependencies();

      expect(crossAgentDeps.length).toBe(4);

      // 2.1 depends on 1.1 (CLI -> Foundation)
      expect(crossAgentDeps).toContainEqual({
        taskId: '2.1',
        dependsOn: '1.1',
        fromAgent: 'Agent_CLI',
        toAgent: 'Agent_Foundation',
      });

      // 3.1 depends on 1.1 (Comm -> Foundation)
      expect(crossAgentDeps).toContainEqual({
        taskId: '3.1',
        dependsOn: '1.1',
        fromAgent: 'Agent_Communication',
        toAgent: 'Agent_Foundation',
      });

      // 4.1 depends on 2.1 (Automation -> CLI)
      expect(crossAgentDeps).toContainEqual({
        taskId: '4.1',
        dependsOn: '2.1',
        fromAgent: 'Agent_Automation',
        toAgent: 'Agent_CLI',
      });

      // 4.1 also depends on 3.1 (Automation -> Comm)
      expect(crossAgentDeps).toContainEqual({
        taskId: '4.1',
        dependsOn: '3.1',
        fromAgent: 'Agent_Automation',
        toAgent: 'Agent_Communication',
      });
    });

    it('should include cross-agent dependencies in analysis', () => {
      const analysis = resolver.analyzeDependencies();

      expect(analysis.crossAgentDependencies.length).toBe(4);
    });
  });

  describe('Task Readiness Checking', () => {
    let resolver: DependencyResolver;

    beforeEach(() => {
      const tasks = [
        createTask('1.1', 1, 'Agent_A'),
        createTask('1.2', 1, 'Agent_A', ['1.1']),
        createTask('1.3', 1, 'Agent_A', ['1.1']),
        createTask('1.4', 1, 'Agent_A', ['1.2', '1.3']),
      ];

      const plan = createPlan(tasks);
      resolver = createDependencyResolver({ implementationPlan: plan });
    });

    it('should identify task as ready when no dependencies', () => {
      const ready = resolver.isTaskReady('1.1', new Set());

      expect(ready).toBe(true);
    });

    it('should identify task as ready when all dependencies completed', () => {
      const completed = new Set(['1.1']);
      const ready = resolver.isTaskReady('1.2', completed);

      expect(ready).toBe(true);
    });

    it('should identify task as not ready when dependencies incomplete', () => {
      const completed = new Set<string>();
      const ready = resolver.isTaskReady('1.2', completed);

      expect(ready).toBe(false);
    });

    it('should identify task as not ready when some dependencies incomplete', () => {
      const completed = new Set(['1.2']); // Missing 1.3
      const ready = resolver.isTaskReady('1.4', completed);

      expect(ready).toBe(false);
    });

    it('should identify task as ready when all dependencies completed', () => {
      const completed = new Set(['1.2', '1.3']);
      const ready = resolver.isTaskReady('1.4', completed);

      expect(ready).toBe(true);
    });
  });

  describe('getReadyTasks()', () => {
    let resolver: DependencyResolver;

    beforeEach(() => {
      const tasks = [
        createTask('1.1', 1, 'Agent_A'),
        createTask('1.2', 1, 'Agent_A', ['1.1']),
        createTask('1.3', 1, 'Agent_A', ['1.1']),
        createTask('1.4', 1, 'Agent_A', ['1.2', '1.3']),
      ];

      const plan = createPlan(tasks);
      resolver = createDependencyResolver({ implementationPlan: plan });
    });

    it('should return initial ready tasks', () => {
      const ready = resolver.getReadyTasks(new Set());

      expect(ready).toEqual(['1.1']);
    });

    it('should return next batch after completing dependencies', () => {
      const completed = new Set(['1.1']);
      const ready = resolver.getReadyTasks(completed);

      expect(ready).toEqual(['1.2', '1.3']);
    });

    it('should exclude in-progress tasks', () => {
      const completed = new Set(['1.1']);
      const inProgress = new Set(['1.2']);
      const ready = resolver.getReadyTasks(completed, inProgress);

      expect(ready).toEqual(['1.3']);
    });

    it('should return empty when all tasks completed', () => {
      const completed = new Set(['1.1', '1.2', '1.3', '1.4']);
      const ready = resolver.getReadyTasks(completed);

      expect(ready).toEqual([]);
    });

    it('should return final task when all dependencies met', () => {
      const completed = new Set(['1.1', '1.2', '1.3']);
      const ready = resolver.getReadyTasks(completed);

      expect(ready).toEqual(['1.4']);
    });
  });

  describe('getTaskDependencies() and getTaskDependents()', () => {
    let resolver: DependencyResolver;

    beforeEach(() => {
      const tasks = [
        createTask('1.1', 1, 'Agent_A'),
        createTask('1.2', 1, 'Agent_A', ['1.1']),
        createTask('1.3', 1, 'Agent_A', ['1.1']),
        createTask('1.4', 1, 'Agent_A', ['1.2', '1.3']),
      ];

      const plan = createPlan(tasks);
      resolver = createDependencyResolver({ implementationPlan: plan });
    });

    it('should get task dependencies', () => {
      const deps = resolver.getTaskDependencies('1.4');

      expect(deps).toEqual(['1.2', '1.3']);
    });

    it('should get task dependents', () => {
      const dependents = resolver.getTaskDependents('1.1');

      expect(dependents).toEqual(['1.2', '1.3']);
    });

    it('should return empty for task with no dependencies', () => {
      const deps = resolver.getTaskDependencies('1.1');

      expect(deps).toEqual([]);
    });

    it('should return empty for task with no dependents', () => {
      const dependents = resolver.getTaskDependents('1.4');

      expect(dependents).toEqual([]);
    });

    it('should return empty for non-existent task', () => {
      const deps = resolver.getTaskDependencies('99.99');
      const dependents = resolver.getTaskDependents('99.99');

      expect(deps).toEqual([]);
      expect(dependents).toEqual([]);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle large dependency graph', () => {
      // Create 10 tasks with complex dependencies
      const tasks: TaskMetadata[] = [
        createTask('1.1', 1, 'Agent_A'),
        createTask('1.2', 1, 'Agent_A', ['1.1']),
        createTask('1.3', 1, 'Agent_A', ['1.1']),
        createTask('2.1', 2, 'Agent_B', ['1.2']),
        createTask('2.2', 2, 'Agent_B', ['1.3']),
        createTask('2.3', 2, 'Agent_B', ['1.2', '1.3']),
        createTask('3.1', 3, 'Agent_C', ['2.1', '2.2']),
        createTask('3.2', 3, 'Agent_C', ['2.3']),
        createTask('4.1', 4, 'Agent_D', ['3.1', '3.2']),
        createTask('4.2', 4, 'Agent_D', ['3.2']),
      ];

      const plan = createPlan(tasks);
      const resolver = createDependencyResolver({ implementationPlan: plan });

      const analysis = resolver.analyzeDependencies();

      expect(analysis.totalTasks).toBe(10);
      expect(analysis.hasCircularDependencies).toBe(false);
      expect(analysis.executionBatches.length).toBeGreaterThan(0);
      expect(analysis.crossAgentDependencies.length).toBeGreaterThan(0);
    });

    it('should handle mixed same-agent and cross-agent dependencies', () => {
      const tasks = [
        createTask('1.1', 1, 'Agent_A'),
        createTask('1.2', 1, 'Agent_A', ['1.1']), // Same agent
        createTask('2.1', 2, 'Agent_B', ['1.2']), // Cross-agent
        createTask('2.2', 2, 'Agent_B', ['2.1']), // Same agent
      ];

      const plan = createPlan(tasks);
      const resolver = createDependencyResolver({ implementationPlan: plan });

      const crossAgentDeps = resolver.findCrossAgentDependencies();

      // Only 2.1 -> 1.2 is cross-agent
      expect(crossAgentDeps).toHaveLength(1);
      expect(crossAgentDeps[0]).toEqual({
        taskId: '2.1',
        dependsOn: '1.2',
        fromAgent: 'Agent_B',
        toAgent: 'Agent_A',
      });
    });

    it('should handle self-circular dependency', () => {
      const tasks = [
        createTask('1.1', 1, 'Agent_A', ['1.1']), // Self-dependency
      ];

      const plan = createPlan(tasks);
      const resolver = createDependencyResolver({ implementationPlan: plan });

      const cycles = resolver.detectCircularDependencies();

      expect(cycles.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty plan', () => {
      const plan = createPlan([]);
      const resolver = createDependencyResolver({ implementationPlan: plan });

      const analysis = resolver.analyzeDependencies();

      expect(analysis.totalTasks).toBe(0);
      expect(analysis.rootTasks).toEqual([]);
      expect(analysis.leafTasks).toEqual([]);
      expect(analysis.executionOrder).toEqual([]);
      expect(analysis.executionBatches).toEqual([]);
    });

    it('should handle single task', () => {
      const tasks = [createTask('1.1', 1, 'Agent_A')];
      const plan = createPlan(tasks);
      const resolver = createDependencyResolver({ implementationPlan: plan });

      const analysis = resolver.analyzeDependencies();

      expect(analysis.totalTasks).toBe(1);
      expect(analysis.rootTasks).toEqual(['1.1']);
      expect(analysis.leafTasks).toEqual(['1.1']);
      expect(analysis.executionOrder).toEqual(['1.1']);
      expect(analysis.executionBatches).toHaveLength(1);
      expect(analysis.executionBatches[0].tasks).toEqual(['1.1']);
    });

    it('should handle task depending on non-existent task', () => {
      const tasks = [
        createTask('1.1', 1, 'Agent_A', ['99.99']), // Depends on non-existent
      ];

      const plan = createPlan(tasks);
      const resolver = createDependencyResolver({ implementationPlan: plan });

      const graph = resolver.buildDependencyGraph();

      // Graph should still build
      expect(graph.size).toBe(1);
      expect(graph.get('1.1')?.dependencies).toEqual(['99.99']);

      // Non-existent dependency won't have dependents
      expect(graph.get('99.99')).toBeUndefined();
    });
  });

  describe('getDependencyGraph()', () => {
    it('should return dependency graph', () => {
      const tasks = [
        createTask('1.1', 1, 'Agent_A'),
        createTask('1.2', 1, 'Agent_A', ['1.1']),
      ];

      const plan = createPlan(tasks);
      const resolver = createDependencyResolver({ implementationPlan: plan });

      const graph = resolver.getDependencyGraph();

      expect(graph.size).toBe(2);
      expect(graph.get('1.1')).toBeDefined();
      expect(graph.get('1.2')).toBeDefined();
    });

    it('should build graph if not already built', () => {
      const tasks = [createTask('1.1', 1, 'Agent_A')];
      const plan = createPlan(tasks);
      const resolver = createDependencyResolver({ implementationPlan: plan });

      // Don't call buildDependencyGraph explicitly
      const graph = resolver.getDependencyGraph();

      expect(graph.size).toBe(1);
    });
  });

  describe('createDependencyResolver()', () => {
    it('should create DependencyResolver instance', () => {
      const plan = createPlan([]);
      const resolver = createDependencyResolver({ implementationPlan: plan });

      expect(resolver).toBeInstanceOf(DependencyResolver);
    });
  });

  describe('Execution Batch Descriptions', () => {
    it('should create descriptive batch messages', () => {
      const tasks = [
        createTask('1.1', 1, 'Agent_A'),
        createTask('1.2', 1, 'Agent_A', ['1.1']),
        createTask('1.3', 1, 'Agent_A', ['1.1']),
      ];

      const plan = createPlan(tasks);
      const resolver = createDependencyResolver({ implementationPlan: plan });

      const batches = resolver.buildExecutionBatches();

      expect(batches[0].description).toContain('Batch 1');
      expect(batches[0].description).toContain('1 task');
      expect(batches[0].description).toContain('1.1');

      expect(batches[1].description).toContain('Batch 2');
      expect(batches[1].description).toContain('2 tasks');
      expect(batches[1].description).toContain('1.2');
      expect(batches[1].description).toContain('1.3');
    });
  });
});
