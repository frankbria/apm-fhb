/**
 * Dependency Resolution Engine
 *
 * Builds dependency graphs from Implementation Plan, determines execution order,
 * identifies parallel execution opportunities, and detects circular dependencies.
 */

import { type ImplementationPlan, type TaskMetadata } from '../scope/filter.js';

/**
 * Dependency graph node
 */
export interface DependencyNode {
  /** Task ID */
  taskId: string;
  /** Direct dependencies (tasks this task depends on) */
  dependencies: string[];
  /** Dependents (tasks that depend on this task) */
  dependents: string[];
  /** Agent assignment */
  agentAssignment: string;
  /** Phase number */
  phase: number;
}

/**
 * Execution batch (tasks that can run in parallel)
 */
export interface ExecutionBatch {
  /** Batch number (0-indexed) */
  batchNumber: number;
  /** Task IDs in this batch */
  tasks: string[];
  /** Description of batch */
  description: string;
}

/**
 * Dependency analysis result
 */
export interface DependencyAnalysis {
  /** Total number of tasks */
  totalTasks: number;
  /** Tasks with no dependencies */
  rootTasks: string[];
  /** Tasks with no dependents */
  leafTasks: string[];
  /** Execution order (topologically sorted) */
  executionOrder: string[];
  /** Execution batches (parallel execution groups) */
  executionBatches: ExecutionBatch[];
  /** Has circular dependencies */
  hasCircularDependencies: boolean;
  /** Circular dependency chains (if any) */
  circularDependencies: string[][];
  /** Cross-agent dependencies */
  crossAgentDependencies: Array<{
    taskId: string;
    dependsOn: string;
    fromAgent: string;
    toAgent: string;
  }>;
}

/**
 * Dependency Resolver Configuration
 */
export interface DependencyResolverConfig {
  /** Implementation Plan with task dependencies */
  implementationPlan: ImplementationPlan;
}

/**
 * Dependency Resolver
 * Analyzes task dependencies and determines execution order
 */
export class DependencyResolver {
  private config: DependencyResolverConfig;
  private dependencyGraph: Map<string, DependencyNode> | null = null;

  constructor(config: DependencyResolverConfig) {
    this.config = config;
  }

  /**
   * Build dependency graph from Implementation Plan
   *
   * @returns Dependency graph
   */
  buildDependencyGraph(): Map<string, DependencyNode> {
    const graph = new Map<string, DependencyNode>();

    // Build nodes for all tasks
    for (const [taskId, metadata] of this.config.implementationPlan.tasks) {
      const node: DependencyNode = {
        taskId,
        dependencies: [...metadata.dependencies],
        dependents: [],
        agentAssignment: metadata.agentAssignment,
        phase: metadata.phase,
      };
      graph.set(taskId, node);
    }

    // Build reverse edges (dependents)
    for (const [taskId, node] of graph) {
      for (const depId of node.dependencies) {
        const depNode = graph.get(depId);
        if (depNode) {
          depNode.dependents.push(taskId);
        }
      }
    }

    this.dependencyGraph = graph;
    return graph;
  }

  /**
   * Perform dependency analysis
   *
   * @returns Complete dependency analysis
   */
  analyzeDependencies(): DependencyAnalysis {
    // Build graph if not already built
    if (!this.dependencyGraph) {
      this.buildDependencyGraph();
    }

    const graph = this.dependencyGraph!;

    // Find root tasks (no dependencies)
    const rootTasks = Array.from(graph.values())
      .filter(node => node.dependencies.length === 0)
      .map(node => node.taskId);

    // Find leaf tasks (no dependents)
    const leafTasks = Array.from(graph.values())
      .filter(node => node.dependents.length === 0)
      .map(node => node.taskId);

    // Detect circular dependencies
    const circularDependencies = this.detectCircularDependencies();

    // Perform topological sort (if no circular dependencies)
    const executionOrder = circularDependencies.length === 0
      ? this.topologicalSort()
      : [];

    // Build execution batches
    const executionBatches = circularDependencies.length === 0
      ? this.buildExecutionBatches()
      : [];

    // Find cross-agent dependencies
    const crossAgentDependencies = this.findCrossAgentDependencies();

    return {
      totalTasks: graph.size,
      rootTasks,
      leafTasks,
      executionOrder,
      executionBatches,
      hasCircularDependencies: circularDependencies.length > 0,
      circularDependencies,
      crossAgentDependencies,
    };
  }

  /**
   * Perform topological sort to determine execution order
   *
   * @returns Array of task IDs in execution order
   */
  topologicalSort(): string[] {
    if (!this.dependencyGraph) {
      this.buildDependencyGraph();
    }

    const graph = this.dependencyGraph!;
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (taskId: string): boolean => {
      if (visited.has(taskId)) {
        return true;
      }

      if (visiting.has(taskId)) {
        // Circular dependency detected
        return false;
      }

      visiting.add(taskId);

      const node = graph.get(taskId);
      if (node) {
        for (const depId of node.dependencies) {
          if (!visit(depId)) {
            return false;
          }
        }
      }

      visiting.delete(taskId);
      visited.add(taskId);
      sorted.push(taskId);

      return true;
    };

    // Visit all nodes
    for (const taskId of graph.keys()) {
      if (!visited.has(taskId)) {
        visit(taskId);
      }
    }

    return sorted;
  }

  /**
   * Build execution batches (tasks that can run in parallel)
   *
   * @returns Array of execution batches
   */
  buildExecutionBatches(): ExecutionBatch[] {
    if (!this.dependencyGraph) {
      this.buildDependencyGraph();
    }

    const graph = this.dependencyGraph!;
    const batches: ExecutionBatch[] = [];
    const completed = new Set<string>();
    let batchNumber = 0;

    while (completed.size < graph.size) {
      // Find tasks that can run now (all dependencies completed)
      const readyTasks: string[] = [];

      for (const [taskId, node] of graph) {
        if (completed.has(taskId)) {
          continue;
        }

        const allDepsCompleted = node.dependencies.every(depId =>
          completed.has(depId)
        );

        if (allDepsCompleted) {
          readyTasks.push(taskId);
        }
      }

      if (readyTasks.length === 0) {
        // No more tasks can be scheduled (possible circular dependency)
        break;
      }

      // Add batch
      batches.push({
        batchNumber,
        tasks: readyTasks,
        description: `Batch ${batchNumber + 1}: ${readyTasks.length} task${
          readyTasks.length > 1 ? 's' : ''
        } (${readyTasks.join(', ')})`,
      });

      // Mark tasks as completed
      for (const taskId of readyTasks) {
        completed.add(taskId);
      }

      batchNumber++;
    }

    return batches;
  }

  /**
   * Detect circular dependencies
   *
   * @returns Array of circular dependency chains
   */
  detectCircularDependencies(): string[][] {
    if (!this.dependencyGraph) {
      this.buildDependencyGraph();
    }

    const graph = this.dependencyGraph!;
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const path: string[] = [];

    const visit = (taskId: string): void => {
      if (visited.has(taskId)) {
        return;
      }

      if (visiting.has(taskId)) {
        // Circular dependency detected
        const cycleStart = path.indexOf(taskId);
        const cycle = path.slice(cycleStart).concat(taskId);
        cycles.push(cycle);
        return;
      }

      visiting.add(taskId);
      path.push(taskId);

      const node = graph.get(taskId);
      if (node) {
        for (const depId of node.dependencies) {
          visit(depId);
        }
      }

      path.pop();
      visiting.delete(taskId);
      visited.add(taskId);
    };

    // Visit all nodes
    for (const taskId of graph.keys()) {
      if (!visited.has(taskId)) {
        visit(taskId);
      }
    }

    return cycles;
  }

  /**
   * Find cross-agent dependencies
   *
   * @returns Array of cross-agent dependencies
   */
  findCrossAgentDependencies(): Array<{
    taskId: string;
    dependsOn: string;
    fromAgent: string;
    toAgent: string;
  }> {
    if (!this.dependencyGraph) {
      this.buildDependencyGraph();
    }

    const graph = this.dependencyGraph!;
    const crossAgentDeps: Array<{
      taskId: string;
      dependsOn: string;
      fromAgent: string;
      toAgent: string;
    }> = [];

    for (const [taskId, node] of graph) {
      for (const depId of node.dependencies) {
        const depNode = graph.get(depId);
        if (depNode && depNode.agentAssignment !== node.agentAssignment) {
          crossAgentDeps.push({
            taskId,
            dependsOn: depId,
            fromAgent: node.agentAssignment,
            toAgent: depNode.agentAssignment,
          });
        }
      }
    }

    return crossAgentDeps;
  }

  /**
   * Get dependencies for a specific task
   *
   * @param taskId - Task ID
   * @returns Array of dependency task IDs
   */
  getTaskDependencies(taskId: string): string[] {
    if (!this.dependencyGraph) {
      this.buildDependencyGraph();
    }

    const node = this.dependencyGraph!.get(taskId);
    return node ? [...node.dependencies] : [];
  }

  /**
   * Get dependents for a specific task (tasks that depend on this task)
   *
   * @param taskId - Task ID
   * @returns Array of dependent task IDs
   */
  getTaskDependents(taskId: string): string[] {
    if (!this.dependencyGraph) {
      this.buildDependencyGraph();
    }

    const node = this.dependencyGraph!.get(taskId);
    return node ? [...node.dependents] : [];
  }

  /**
   * Check if a task is ready to execute
   *
   * @param taskId - Task ID
   * @param completedTasks - Set of completed task IDs
   * @returns True if all dependencies are completed
   */
  isTaskReady(taskId: string, completedTasks: Set<string>): boolean {
    const dependencies = this.getTaskDependencies(taskId);
    return dependencies.every(depId => completedTasks.has(depId));
  }

  /**
   * Get next batch of tasks ready to execute
   *
   * @param completedTasks - Set of completed task IDs
   * @param inProgressTasks - Set of in-progress task IDs
   * @returns Array of task IDs ready to start
   */
  getReadyTasks(
    completedTasks: Set<string>,
    inProgressTasks: Set<string> = new Set()
  ): string[] {
    if (!this.dependencyGraph) {
      this.buildDependencyGraph();
    }

    const graph = this.dependencyGraph!;
    const readyTasks: string[] = [];

    for (const [taskId, node] of graph) {
      // Skip if already completed or in progress
      if (completedTasks.has(taskId) || inProgressTasks.has(taskId)) {
        continue;
      }

      // Check if all dependencies are completed
      const allDepsCompleted = node.dependencies.every(depId =>
        completedTasks.has(depId)
      );

      if (allDepsCompleted) {
        readyTasks.push(taskId);
      }
    }

    return readyTasks;
  }

  /**
   * Get dependency graph
   *
   * @returns Dependency graph
   */
  getDependencyGraph(): Map<string, DependencyNode> {
    if (!this.dependencyGraph) {
      this.buildDependencyGraph();
    }
    return this.dependencyGraph!;
  }
}

/**
 * Create a DependencyResolver instance
 */
export function createDependencyResolver(
  config: DependencyResolverConfig
): DependencyResolver {
  return new DependencyResolver(config);
}
