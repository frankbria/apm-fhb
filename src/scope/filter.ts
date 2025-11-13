/**
 * Task Filtering Logic for Implementation Plans
 *
 * Filters tasks from Implementation Plans based on scope definitions.
 * Handles phase ranges, task lists, agent assignments, and dependency resolution.
 */

import { ScopeDefinition, matchesAgentPattern } from './definition.js';
import { log } from '../cli/logger.js';

/**
 * Task metadata extracted from Implementation Plan
 */
export interface TaskMetadata {
  taskId: string;
  title: string;
  phase: number;
  agentAssignment: string;
  dependencies: string[];
  objective?: string;
  output?: string;
  guidance?: string;
  fullContent: string;
}

/**
 * Implementation Plan structure
 */
export interface ImplementationPlan {
  phases: PhaseInfo[];
  tasks: Map<string, TaskMetadata>;
}

/**
 * Phase information
 */
export interface PhaseInfo {
  phaseNumber: number;
  title: string;
  tasks: string[];
}

/**
 * Task filtering options
 */
export interface FilterOptions {
  dryRun?: boolean;
  includeDependencies?: boolean;
  warnMissingDependencies?: boolean;
}

/**
 * Filtered task result
 */
export interface FilterResult {
  tasks: TaskMetadata[];
  warnings: string[];
  includedDependencies: string[];
}

/**
 * Parse Implementation Plan markdown to extract task structure
 *
 * Extracts tasks with format: ### Task X.Y – Title │ AgentName
 * Also extracts dependencies from guidance sections.
 *
 * @param planContent - Implementation Plan markdown content
 * @returns Parsed plan structure
 */
export function parseImplementationPlan(planContent: string): ImplementationPlan {
  const phases = new Map<number, PhaseInfo>();
  const tasks = new Map<string, TaskMetadata>();

  const lines = planContent.split('\n');
  let currentPhase: number | null = null;
  let currentTask: TaskMetadata | null = null;
  let inGuidance = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Parse phase headers: ## Phase X: Title
    const phaseMatch = line.match(/^##\s+Phase\s+(\d+)[:\s]+(.+)$/);
    if (phaseMatch) {
      currentPhase = parseInt(phaseMatch[1], 10);
      const title = phaseMatch[2].trim();

      if (!phases.has(currentPhase)) {
        phases.set(currentPhase, {
          phaseNumber: currentPhase,
          title,
          tasks: [],
        });
      }
      continue;
    }

    // Parse task headers: ### Task X.Y – Title │ AgentName
    const taskMatch = line.match(/^###\s+Task\s+([\d.]+)\s+[–-]\s+(.+?)\s+[│|]\s+(.+)$/);
    if (taskMatch) {
      const taskId = taskMatch[1].trim();
      const title = taskMatch[2].trim();
      const agentAssignment = taskMatch[3].trim();

      // Extract phase number from task ID
      const phaseNum = parseInt(taskId.split('.')[0], 10);

      // Save previous task if exists
      if (currentTask) {
        tasks.set(currentTask.taskId, currentTask);
      }

      currentTask = {
        taskId,
        title,
        phase: phaseNum,
        agentAssignment,
        dependencies: [],
        fullContent: line + '\n',
      };

      // Add task to phase
      if (phases.has(phaseNum)) {
        phases.get(phaseNum)!.tasks.push(taskId);
      }

      inGuidance = false;
      continue;
    }

    // Collect task content
    if (currentTask) {
      currentTask.fullContent += line + '\n';

      // Parse objective
      const objectiveMatch = line.match(/^-\s+\*\*Objective:\*\*\s+(.+)$/);
      if (objectiveMatch) {
        currentTask.objective = objectiveMatch[1].trim();
      }

      // Parse output
      const outputMatch = line.match(/^-\s+\*\*Output:\*\*\s+(.+)$/);
      if (outputMatch) {
        currentTask.output = outputMatch[1].trim();
      }

      // Parse guidance section
      const guidanceMatch = line.match(/^-\s+\*\*Guidance:\*\*\s+(.+)$/);
      if (guidanceMatch) {
        currentTask.guidance = guidanceMatch[1].trim();
        inGuidance = true;
      } else if (inGuidance && line.startsWith('-')) {
        // Continue guidance on next bullet
        currentTask.guidance = (currentTask.guidance || '') + ' ' + line.substring(1).trim();
      }

      // Extract dependencies from guidance
      // Pattern: "Depends on Task X.Y Output" or "Depends on Task X.Y and Task A.B"
      const depsMatch = line.match(/Depends on Task ([\d.]+(?:(?:\s+and\s+Task\s+[\d.]+)|(?:,\s+Task\s+[\d.]+))*)/i);
      if (depsMatch) {
        // Extract all task IDs from the match
        const depsText = depsMatch[1];
        const taskIds = depsText.match(/[\d.]+/g);
        if (taskIds) {
          currentTask.dependencies.push(...taskIds);
        }
      }
    }
  }

  // Save last task
  if (currentTask) {
    tasks.set(currentTask.taskId, currentTask);
  }

  return {
    phases: Array.from(phases.values()),
    tasks,
  };
}

/**
 * Filter tasks by phase range
 *
 * @param plan - Implementation plan
 * @param phaseRange - Phase range filter
 * @returns Task IDs in phase range
 */
export function filterByPhaseRange(
  plan: ImplementationPlan,
  phaseRange: { start: number; end: number },
): string[] {
  const taskIds: string[] = [];

  for (const [taskId, task] of plan.tasks) {
    if (task.phase >= phaseRange.start && task.phase <= phaseRange.end) {
      taskIds.push(taskId);
    }
  }

  return taskIds;
}

/**
 * Filter tasks by explicit task list
 *
 * @param plan - Implementation plan
 * @param taskList - List of task IDs
 * @returns Task IDs found in plan, with warnings for missing tasks
 */
export function filterByTaskList(
  plan: ImplementationPlan,
  taskList: string[],
): { taskIds: string[]; warnings: string[] } {
  const taskIds: string[] = [];
  const warnings: string[] = [];

  for (const taskId of taskList) {
    if (plan.tasks.has(taskId)) {
      taskIds.push(taskId);
    } else {
      warnings.push(`Task ${taskId} not found in Implementation Plan`);
    }
  }

  return { taskIds, warnings };
}

/**
 * Filter tasks by agent assignment
 *
 * @param plan - Implementation plan
 * @param agentFilters - Agent filter patterns
 * @returns Task IDs assigned to matching agents
 */
export function filterByAgentAssignment(
  plan: ImplementationPlan,
  agentFilters: string[],
): string[] {
  const taskIds: string[] = [];

  for (const [taskId, task] of plan.tasks) {
    // Check if task's agent matches any filter pattern
    const matches = agentFilters.some((pattern) =>
      matchesAgentPattern(task.agentAssignment, pattern),
    );

    if (matches) {
      taskIds.push(taskId);
    }
  }

  return taskIds;
}

/**
 * Resolve task dependencies
 *
 * Given a set of task IDs, include their dependencies recursively.
 *
 * @param plan - Implementation plan
 * @param taskIds - Initial task IDs
 * @param options - Dependency resolution options
 * @returns Task IDs with dependencies included
 */
export function resolveDependencies(
  plan: ImplementationPlan,
  taskIds: string[],
  options: { includeDependencies?: boolean; warnMissingDependencies?: boolean } = {},
): { taskIds: string[]; warnings: string[]; includedDeps: string[] } {
  const result = new Set<string>(taskIds);
  const warnings: string[] = [];
  const includedDeps: string[] = [];
  const visited = new Set<string>();

  const resolveDeps = (taskId: string): void => {
    if (visited.has(taskId)) return;
    visited.add(taskId);

    const task = plan.tasks.get(taskId);
    if (!task) return;

    for (const depId of task.dependencies) {
      // Check if dependency exists in plan
      if (!plan.tasks.has(depId)) {
        warnings.push(`Dependency ${depId} for task ${taskId} not found in plan`);
        continue;
      }

      // Check if dependency is already in result
      if (!result.has(depId)) {
        if (options.includeDependencies) {
          // Auto-include dependency
          result.add(depId);
          includedDeps.push(depId);
          log.debug(`Auto-included dependency ${depId} for task ${taskId}`);

          // Recursively resolve dependencies of the dependency
          resolveDeps(depId);
        } else if (options.warnMissingDependencies) {
          // Just warn about missing dependency
          warnings.push(
            `Task ${taskId} depends on ${depId}, which is not in scope (use --include-dependencies to auto-include)`,
          );
        }
      }
    }
  };

  // Resolve dependencies for all initial tasks
  for (const taskId of taskIds) {
    resolveDeps(taskId);
  }

  return {
    taskIds: Array.from(result),
    warnings,
    includedDeps,
  };
}

/**
 * Filter tasks from Implementation Plan based on scope definition
 *
 * Applies scope filters (phase range, task list, agent filters) and handles
 * dependency resolution according to options.
 *
 * @param plan - Implementation plan structure
 * @param scope - Scope definition with filters
 * @param options - Filtering options
 * @returns Filtered task list with metadata
 */
export function filterTasks(
  plan: ImplementationPlan,
  scope: ScopeDefinition,
  options: FilterOptions = {},
): FilterResult {
  let selectedTaskIds = new Set<string>();
  const warnings: string[] = [];

  // If scope is empty, select all tasks
  if (scope.isEmpty()) {
    log.info('No scope filters defined, selecting all tasks');
    selectedTaskIds = new Set(plan.tasks.keys());
  } else {
    // Apply phase range filter
    if (scope.phaseRange) {
      const phaseTaskIds = filterByPhaseRange(plan, scope.phaseRange);
      log.debug(`Phase filter matched ${phaseTaskIds.length} tasks`);

      if (selectedTaskIds.size === 0) {
        // First filter - initialize set
        selectedTaskIds = new Set(phaseTaskIds);
      } else {
        // Intersection with existing selection
        selectedTaskIds = new Set(
          [...selectedTaskIds].filter((id) => phaseTaskIds.includes(id)),
        );
      }
    }

    // Apply task list filter
    if (scope.taskList && scope.taskList.length > 0) {
      const { taskIds: taskListIds, warnings: taskWarnings } = filterByTaskList(
        plan,
        scope.taskList,
      );
      warnings.push(...taskWarnings);

      if (selectedTaskIds.size === 0 && !scope.phaseRange) {
        // First filter - initialize set
        selectedTaskIds = new Set(taskListIds);
      } else if (scope.phaseRange) {
        // Intersection: tasks must be in both phase range AND task list
        selectedTaskIds = new Set(
          [...selectedTaskIds].filter((id) => taskListIds.includes(id)),
        );
      } else {
        // Union: add task list to selection
        taskListIds.forEach((id) => selectedTaskIds.add(id));
      }
    }

    // Apply agent filter
    if (scope.agentFilters && scope.agentFilters.length > 0) {
      const agentTaskIds = filterByAgentAssignment(plan, scope.agentFilters);
      log.debug(`Agent filter matched ${agentTaskIds.length} tasks`);

      if (selectedTaskIds.size === 0 && !scope.phaseRange && (!scope.taskList || scope.taskList.length === 0)) {
        // First filter - initialize set
        selectedTaskIds = new Set(agentTaskIds);
      } else {
        // Intersection: tasks must match agent filter AND other filters
        selectedTaskIds = new Set(
          [...selectedTaskIds].filter((id) => agentTaskIds.includes(id)),
        );
      }
    }
  }

  // Resolve dependencies
  const { taskIds: finalTaskIds, warnings: depWarnings, includedDeps } = resolveDependencies(
    plan,
    Array.from(selectedTaskIds),
    {
      includeDependencies: options.includeDependencies,
      warnMissingDependencies: options.warnMissingDependencies ?? true,
    },
  );
  warnings.push(...depWarnings);

  // Dry run mode
  if (options.dryRun) {
    log.info(`[DRY RUN] Would select ${finalTaskIds.length} tasks:`);
    for (const taskId of finalTaskIds.sort()) {
      const task = plan.tasks.get(taskId);
      log.info(`  - Task ${taskId}: ${task?.title || 'Unknown'} (${task?.agentAssignment || 'Unknown'})`);
    }

    if (includedDeps.length > 0) {
      log.info(`[DRY RUN] Auto-included ${includedDeps.length} dependencies:`);
      for (const depId of includedDeps.sort()) {
        log.info(`  - Task ${depId}`);
      }
    }
  }

  // Get task metadata
  const tasks: TaskMetadata[] = finalTaskIds
    .map((id) => plan.tasks.get(id))
    .filter((task): task is TaskMetadata => task !== undefined)
    .sort((a, b) => {
      // Sort by phase first, then by task ID
      if (a.phase !== b.phase) {
        return a.phase - b.phase;
      }
      return a.taskId.localeCompare(b.taskId);
    });

  return {
    tasks,
    warnings,
    includedDependencies: includedDeps,
  };
}
