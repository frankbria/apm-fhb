/**
 * Beads State Machine Integration Module
 *
 * Integrates beads issue tracking with apm-auto state machine:
 * - Synchronizes beads issues to database tasks table
 * - Maps dependency relationships to task_dependencies table
 * - Tracks beads-driven state changes in state_transitions table
 * - Provides task readiness detection
 * - Supports periodic synchronization
 */

import { ConnectionManager } from '../db/connection.js';
import { TaskState, TaskStatus } from '../types/task.js';
import { TransitionTrigger, StateEntityType } from '../types/state.js';
import { BeadsIssue, BeadsDependencyType } from './cli.js';
import {
  getAllIssues,
  getReadyTasks,
  getDependencies,
  getBlockers,
  mapBeadsIssueToTaskState,
  invalidateQueryCache,
  QueryOptions
} from './queries.js';

/**
 * Sync configuration options
 */
export interface SyncOptions {
  /** Phase ID to assign to synced tasks */
  phaseId?: string;
  /** Query options for beads queries */
  queryOptions?: QueryOptions;
  /** Track state transitions */
  trackTransitions?: boolean;
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Default sync options
 */
const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  phaseId: 'beads_sync',
  queryOptions: { useCache: false }, // Fresh data for sync
  trackTransitions: true,
  verbose: false
};

/**
 * Sync result information
 */
export interface SyncResult {
  /** Number of tasks synced */
  tasksSynced: number;
  /** Number of dependencies synced */
  dependenciesSynced: number;
  /** Number of state transitions recorded */
  transitionsRecorded: number;
  /** Errors encountered during sync */
  errors: string[];
  /** Sync duration in milliseconds */
  durationMs: number;
}

/**
 * Ready tasks result
 */
export interface ReadyTasksResult {
  /** Ready task IDs */
  readyTaskIds: string[];
  /** Blocked task IDs with blocker information */
  blockedTasks: Array<{
    taskId: string;
    blockers: string[];
    reason: string;
  }>;
}

/**
 * Periodic sync handle
 */
export interface PeriodicSyncHandle {
  /** Stop periodic sync */
  stop: () => void;
  /** Check if sync is running */
  isRunning: () => boolean;
  /** Get sync interval */
  getInterval: () => number;
}

/**
 * Synchronize beads issues to database tasks table
 *
 * Queries all issues from beads, maps to TaskState objects,
 * and writes to database using atomic transactions.
 */
export async function syncBeadsToDatabase(
  connectionManager: ConnectionManager,
  options: SyncOptions = DEFAULT_SYNC_OPTIONS
): Promise<SyncResult> {
  const opts = { ...DEFAULT_SYNC_OPTIONS, ...options };
  const startTime = Date.now();
  const errors: string[] = [];

  let tasksSynced = 0;
  let dependenciesSynced = 0;
  let transitionsRecorded = 0;

  if (opts.verbose) {
    console.log('[Beads Sync] Starting beads to database synchronization...');
  }

  try {
    // Invalidate cache to ensure fresh data
    invalidateQueryCache();

    // Get all issues from beads
    const issues = await getAllIssues(undefined, opts.queryOptions);

    if (opts.verbose) {
      console.log(`[Beads Sync] Retrieved ${issues.length} issues from beads`);
    }

    // Sync in transaction for atomicity
    await connectionManager.transaction(async (db) => {
      for (const issue of issues) {
        try {
          // Map beads issue to TaskState
          const taskState = mapBeadsIssueToTaskState(issue, opts.phaseId);

          // Check if task already exists
          const existing = db
            .prepare('SELECT id, status FROM tasks WHERE id = ?')
            .get(issue.id) as { id: string; status: string } | undefined;

          if (existing) {
            // Update existing task
            db.prepare(`
              UPDATE tasks
              SET
                phase_id = ?,
                status = ?,
                assigned_agent = ?,
                priority = ?,
                start_time = ?,
                completion_time = ?,
                metadata = json(?)
              WHERE id = ?
            `).run(
              taskState.phaseId,
              taskState.status,
              taskState.assignedAgent,
              taskState.priority ?? null,
              taskState.startTime?.toISOString() ?? null,
              taskState.completionTime?.toISOString() ?? null,
              JSON.stringify(taskState.metadata),
              taskState.id
            );

            // Track state transition if status changed
            if (opts.trackTransitions && existing.status !== taskState.status) {
              const transitionId = `transition_${Date.now()}_${taskState.id}`;
              db.prepare(`
                INSERT INTO state_transitions (
                  id, entity_type, entity_id, from_state, to_state,
                  trigger, timestamp, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, json(?))
              `).run(
                transitionId,
                StateEntityType.Task,
                taskState.id,
                existing.status,
                taskState.status,
                TransitionTrigger.Dependency,
                new Date().toISOString(),
                JSON.stringify({
                  source: 'beads_sync',
                  beadsStatus: issue.status,
                  reason: 'Beads state change detected'
                })
              );
              transitionsRecorded++;
            }
          } else {
            // Insert new task
            db.prepare(`
              INSERT INTO tasks (
                id, phase_id, status, assigned_agent, priority,
                start_time, completion_time, metadata
              ) VALUES (?, ?, ?, ?, ?, ?, ?, json(?))
            `).run(
              taskState.id,
              taskState.phaseId,
              taskState.status,
              taskState.assignedAgent,
              taskState.priority ?? null,
              taskState.startTime?.toISOString() ?? null,
              taskState.completionTime?.toISOString() ?? null,
              JSON.stringify(taskState.metadata)
            );

            // Track initial state transition
            if (opts.trackTransitions) {
              const transitionId = `transition_${Date.now()}_${taskState.id}`;
              db.prepare(`
                INSERT INTO state_transitions (
                  id, entity_type, entity_id, from_state, to_state,
                  trigger, timestamp, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, json(?))
              `).run(
                transitionId,
                StateEntityType.Task,
                taskState.id,
                null,
                taskState.status,
                TransitionTrigger.Dependency,
                new Date().toISOString(),
                JSON.stringify({
                  source: 'beads_sync',
                  beadsStatus: issue.status,
                  reason: 'New task from beads'
                })
              );
              transitionsRecorded++;
            }
          }

          tasksSynced++;
        } catch (error) {
          const errorMsg = `Failed to sync task ${issue.id}: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMsg);
          if (opts.verbose) {
            console.error(`[Beads Sync] ${errorMsg}`);
          }
        }
      }
    });

    // Sync dependencies separately (after tasks are created)
    const depResult = await syncDependencies(connectionManager, issues, opts);
    dependenciesSynced = depResult.dependenciesSynced;
    errors.push(...depResult.errors);

    const durationMs = Date.now() - startTime;

    if (opts.verbose) {
      console.log(`[Beads Sync] Sync complete: ${tasksSynced} tasks, ${dependenciesSynced} dependencies, ${transitionsRecorded} transitions in ${durationMs}ms`);
      if (errors.length > 0) {
        console.warn(`[Beads Sync] ${errors.length} errors encountered`);
      }
    }

    return {
      tasksSynced,
      dependenciesSynced,
      transitionsRecorded,
      errors,
      durationMs
    };
  } catch (error) {
    const errorMsg = `Beads sync failed: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(errorMsg);

    if (opts.verbose) {
      console.error(`[Beads Sync] ${errorMsg}`);
    }

    return {
      tasksSynced,
      dependenciesSynced,
      transitionsRecorded,
      errors,
      durationMs: Date.now() - startTime
    };
  }
}

/**
 * Synchronize beads dependencies to task_dependencies table
 *
 * Reads dependency trees for all issues and populates
 * task_dependencies table with required/optional relationships.
 */
export async function syncDependencies(
  connectionManager: ConnectionManager,
  issues: BeadsIssue[],
  options: SyncOptions = DEFAULT_SYNC_OPTIONS
): Promise<{ dependenciesSynced: number; errors: string[] }> {
  const opts = { ...DEFAULT_SYNC_OPTIONS, ...options };
  const errors: string[] = [];
  let dependenciesSynced = 0;

  if (opts.verbose) {
    console.log('[Beads Sync] Starting dependency synchronization...');
  }

  try {
    await connectionManager.transaction(async (db) => {
      // Clear existing dependencies (will be recreated)
      db.prepare('DELETE FROM task_dependencies').run();

      for (const issue of issues) {
        try {
          // Get dependency tree
          const depTree = await getDependencies(issue.id, opts.queryOptions);

          // Traverse tree and extract dependencies
          const dependencies: Array<{
            dependentId: string;
            dependencyId: string;
            type: 'required' | 'optional';
          }> = [];

          function traverse(node: typeof depTree, parentId: string) {
            for (const dep of node.dependencies) {
              dependencies.push({
                dependentId: parentId,
                dependencyId: dep.issue.id,
                type: dep.dependencyType === BeadsDependencyType.Required ? 'required' : 'optional'
              });

              // Recursively traverse
              traverse(dep, dep.issue.id);
            }
          }

          traverse(depTree, issue.id);

          // Insert dependencies
          for (const dep of dependencies) {
            db.prepare(`
              INSERT OR IGNORE INTO task_dependencies (
                dependent_task_id, dependency_task_id, dependency_type
              ) VALUES (?, ?, ?)
            `).run(dep.dependentId, dep.dependencyId, dep.type);
            dependenciesSynced++;
          }
        } catch (error) {
          // Non-fatal error - continue with other issues
          const errorMsg = `Failed to sync dependencies for ${issue.id}: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMsg);
          if (opts.verbose) {
            console.warn(`[Beads Sync] ${errorMsg}`);
          }
        }
      }
    });

    if (opts.verbose) {
      console.log(`[Beads Sync] Synced ${dependenciesSynced} dependencies`);
    }
  } catch (error) {
    const errorMsg = `Dependency sync failed: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(errorMsg);
    if (opts.verbose) {
      console.error(`[Beads Sync] ${errorMsg}`);
    }
  }

  return { dependenciesSynced, errors };
}

/**
 * Determine ready tasks using beads dependency data
 *
 * Identifies tasks that can run in parallel (no blocking dependencies)
 * and tasks that must wait (dependencies not satisfied).
 */
export async function determineReadyTasks(
  options: SyncOptions = DEFAULT_SYNC_OPTIONS
): Promise<ReadyTasksResult> {
  const opts = { ...DEFAULT_SYNC_OPTIONS, ...options };

  if (opts.verbose) {
    console.log('[Beads Sync] Determining ready tasks...');
  }

  try {
    // Get ready tasks from beads
    const readyIssues = await getReadyTasks(opts.queryOptions);
    const readyTaskIds = readyIssues.map(issue => issue.id);

    // Get blockers
    const blockers = await getBlockers(opts.queryOptions);

    // Build blocked tasks map
    const blockedTasksMap = new Map<string, { blockers: Set<string>; reasons: Set<string> }>();

    for (const blocker of blockers) {
      if (!blockedTasksMap.has(blocker.blockedId)) {
        blockedTasksMap.set(blocker.blockedId, {
          blockers: new Set(),
          reasons: new Set()
        });
      }

      const entry = blockedTasksMap.get(blocker.blockedId)!;
      entry.blockers.add(blocker.blockerId);
      entry.reasons.add(blocker.reason);
    }

    // Convert to result format
    const blockedTasks = Array.from(blockedTasksMap.entries()).map(([taskId, info]) => ({
      taskId,
      blockers: Array.from(info.blockers),
      reason: Array.from(info.reasons).join('; ')
    }));

    if (opts.verbose) {
      console.log(`[Beads Sync] Found ${readyTaskIds.length} ready tasks, ${blockedTasks.length} blocked tasks`);
    }

    return {
      readyTaskIds,
      blockedTasks
    };
  } catch (error) {
    if (opts.verbose) {
      console.error(`[Beads Sync] Failed to determine ready tasks: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      readyTaskIds: [],
      blockedTasks: []
    };
  }
}

/**
 * Start periodic beads synchronization
 *
 * Executes syncBeadsToDatabase on interval to keep
 * state machine current with beads changes.
 */
export function startPeriodicSync(
  connectionManager: ConnectionManager,
  intervalMs: number,
  options: SyncOptions = DEFAULT_SYNC_OPTIONS
): PeriodicSyncHandle {
  const opts = { ...DEFAULT_SYNC_OPTIONS, ...options };
  let isRunning = true;
  let intervalHandle: NodeJS.Timeout;

  if (opts.verbose) {
    console.log(`[Beads Sync] Starting periodic sync with ${intervalMs}ms interval`);
  }

  // Execute sync function
  const executeSync = async () => {
    if (!isRunning) return;

    try {
      const result = await syncBeadsToDatabase(connectionManager, opts);
      if (opts.verbose && result.errors.length > 0) {
        console.warn(`[Beads Sync] Periodic sync completed with ${result.errors.length} errors`);
      }
    } catch (error) {
      if (opts.verbose) {
        console.error(`[Beads Sync] Periodic sync error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  // Start periodic execution
  intervalHandle = setInterval(executeSync, intervalMs);

  // Execute immediately on start
  executeSync().catch(error => {
    if (opts.verbose) {
      console.error(`[Beads Sync] Initial sync error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Return handle
  return {
    stop: () => {
      if (opts.verbose) {
        console.log('[Beads Sync] Stopping periodic sync');
      }
      isRunning = false;
      clearInterval(intervalHandle);
    },
    isRunning: () => isRunning,
    getInterval: () => intervalMs
  };
}

/**
 * Query ready tasks from database
 *
 * Returns tasks that have no unsatisfied required dependencies.
 */
export async function getReadyTasksFromDatabase(
  connectionManager: ConnectionManager
): Promise<TaskState[]> {
  const readyTasks = await connectionManager.query<{
    id: string;
    phase_id: string;
    status: string;
    assigned_agent: string | null;
    priority: string | null;
    start_time: string | null;
    completion_time: string | null;
    metadata: string;
  }>(`
    SELECT t.*
    FROM tasks t
    WHERE t.status = 'Pending'
      AND NOT EXISTS (
        SELECT 1
        FROM task_dependencies td
        INNER JOIN tasks dep ON td.dependency_task_id = dep.id
        WHERE td.dependent_task_id = t.id
          AND td.dependency_type = 'required'
          AND dep.status != 'Completed'
      )
  `);

  // Map to TaskState objects
  return readyTasks.map(row => ({
    id: row.id,
    phaseId: row.phase_id,
    status: row.status as TaskStatus,
    assignedAgent: row.assigned_agent,
    dependencies: [], // Would need to query separately if needed
    startTime: row.start_time ? new Date(row.start_time) : null,
    completionTime: row.completion_time ? new Date(row.completion_time) : null,
    priority: row.priority as any,
    metadata: JSON.parse(row.metadata)
  }));
}
