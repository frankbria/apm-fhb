/**
 * Beads Query Functions Module
 *
 * High-level query functions abstracting beads CLI with:
 * - Query result caching with TTL
 * - State mapping between beads and apm-auto formats
 * - Blocker detection and dependency analysis
 */

import {
  BeadsIssue,
  BeadsDependency,
  BeadsDependencyNode,
  BeadsStatus,
  BeadsDependencyType,
  BeadsCommandConfig,
  DEFAULT_BEADS_CONFIG,
  getBeadsReady,
  getBeadsList,
  getBeadsShow,
  getBeadsDependencyTree
} from './cli.js';
import { TaskState, TaskStatus, TaskPriority, TaskDependency, TaskExecutionType } from '../types/task.js';

/**
 * Cache entry with expiration
 */
interface CacheEntry<T> {
  /** Cached data */
  data: T;
  /** Expiration timestamp */
  expiresAt: number;
}

/**
 * Query cache with TTL management
 */
class QueryCache {
  private cache = new Map<string, CacheEntry<any>>();

  /**
   * Get cached value if not expired
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      // Expired, remove from cache
      this.cache.delete(key);
      return undefined;
    }

    return entry.data;
  }

  /**
   * Set cache value with TTL in milliseconds
   */
  set<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs
    });
  }

  /**
   * Invalidate cache entry
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Invalidate all cache entries matching pattern
   */
  invalidatePattern(pattern: RegExp): void {
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

/**
 * Global query cache instance
 */
const queryCache = new QueryCache();

/**
 * Default cache TTL (30 seconds)
 */
export const DEFAULT_CACHE_TTL_MS = 30000;

/**
 * Cache key generators
 */
const cacheKeys = {
  readyTasks: () => 'ready_tasks',
  allIssues: (status?: BeadsStatus, tag?: string, assignee?: string) =>
    `all_issues_${status ?? 'all'}_${tag ?? 'all'}_${assignee ?? 'all'}`,
  issueDetails: (issueId: string) => `issue_${issueId}`,
  dependencies: (issueId: string) => `deps_${issueId}`,
  blockers: () => 'blockers'
};

/**
 * Blocker information
 */
export interface BlockerInfo {
  /** Blocking issue ID */
  blockerId: string;
  /** Blocked issue ID */
  blockedId: string;
  /** Issue being blocked */
  blockedIssue: BeadsIssue;
  /** Blocking issue */
  blockingIssue: BeadsIssue;
  /** Reason for blocking */
  reason: string;
  /** Dependency type */
  dependencyType: BeadsDependencyType;
}

/**
 * Query configuration options
 */
export interface QueryOptions {
  /** Use cached result if available */
  useCache?: boolean;
  /** Cache TTL in milliseconds */
  cacheTtl?: number;
  /** Beads command configuration */
  beadsConfig?: BeadsCommandConfig;
}

/**
 * Default query options
 */
const DEFAULT_QUERY_OPTIONS: QueryOptions = {
  useCache: true,
  cacheTtl: DEFAULT_CACHE_TTL_MS,
  beadsConfig: DEFAULT_BEADS_CONFIG
};

/**
 * Get ready tasks (unblocked issues)
 *
 * Queries beads for issues with no open blockers and caches results
 * for 30 seconds to reduce CLI overhead.
 */
export async function getReadyTasks(
  options: QueryOptions = DEFAULT_QUERY_OPTIONS
): Promise<BeadsIssue[]> {
  const opts = { ...DEFAULT_QUERY_OPTIONS, ...options };
  const cacheKey = cacheKeys.readyTasks();

  // Check cache first
  if (opts.useCache) {
    const cached = queryCache.get<BeadsIssue[]>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // Cache miss, query beads
  const result = await getBeadsReady(opts.beadsConfig);
  const readyIssues = result.ready;

  // Cache result
  if (opts.useCache) {
    queryCache.set(cacheKey, readyIssues, opts.cacheTtl!);
  }

  return readyIssues;
}

/**
 * Get all issues with optional filtering
 */
export async function getAllIssues(
  filters?: {
    status?: BeadsStatus;
    tag?: string;
    assignee?: string;
  },
  options: QueryOptions = DEFAULT_QUERY_OPTIONS
): Promise<BeadsIssue[]> {
  const opts = { ...DEFAULT_QUERY_OPTIONS, ...options };
  const cacheKey = cacheKeys.allIssues(filters?.status, filters?.tag, filters?.assignee);

  // Check cache first
  if (opts.useCache) {
    const cached = queryCache.get<BeadsIssue[]>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // Cache miss, query beads
  const result = await getBeadsList(filters, opts.beadsConfig);
  const issues = result.issues;

  // Cache result
  if (opts.useCache) {
    queryCache.set(cacheKey, issues, opts.cacheTtl!);
  }

  return issues;
}

/**
 * Get issue details by ID
 */
export async function getIssueDetails(
  issueId: string,
  options: QueryOptions = DEFAULT_QUERY_OPTIONS
): Promise<BeadsIssue> {
  const opts = { ...DEFAULT_QUERY_OPTIONS, ...options };
  const cacheKey = cacheKeys.issueDetails(issueId);

  // Check cache first
  if (opts.useCache) {
    const cached = queryCache.get<BeadsIssue>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // Cache miss, query beads
  const issue = await getBeadsShow(issueId, opts.beadsConfig);

  // Cache result
  if (opts.useCache) {
    queryCache.set(cacheKey, issue, opts.cacheTtl!);
  }

  return issue;
}

/**
 * Get dependencies for an issue
 */
export async function getDependencies(
  issueId: string,
  options: QueryOptions = DEFAULT_QUERY_OPTIONS
): Promise<BeadsDependencyNode> {
  const opts = { ...DEFAULT_QUERY_OPTIONS, ...options };
  const cacheKey = cacheKeys.dependencies(issueId);

  // Check cache first
  if (opts.useCache) {
    const cached = queryCache.get<BeadsDependencyNode>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // Cache miss, query beads
  const depTree = await getBeadsDependencyTree(issueId, opts.beadsConfig);

  // Cache result
  if (opts.useCache) {
    queryCache.set(cacheKey, depTree, opts.cacheTtl!);
  }

  return depTree;
}

/**
 * Get blockers preventing progress
 *
 * Identifies tasks that are blocking other tasks by analyzing
 * dependency trees and finding incomplete required dependencies.
 */
export async function getBlockers(
  options: QueryOptions = DEFAULT_QUERY_OPTIONS
): Promise<BlockerInfo[]> {
  const opts = { ...DEFAULT_QUERY_OPTIONS, ...options };
  const cacheKey = cacheKeys.blockers();

  // Check cache first
  if (opts.useCache) {
    const cached = queryCache.get<BlockerInfo[]>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // Get all issues
  const allIssues = await getAllIssues(undefined, { ...opts, useCache: false });

  // Build blocker map
  const blockers: BlockerInfo[] = [];
  const issueMap = new Map(allIssues.map(issue => [issue.id, issue]));

  // Check each issue for blocking dependencies
  for (const issue of allIssues) {
    // Skip completed/failed issues - they're not blocked
    if (issue.status === BeadsStatus.Completed || issue.status === BeadsStatus.Failed) {
      continue;
    }

    try {
      // Get dependency tree
      const depTree = await getDependencies(issue.id, { ...opts, useCache: false });

      // Traverse tree to find blockers
      function findBlockers(node: BeadsDependencyNode, parentId: string) {
        for (const dep of node.dependencies) {
          // Check if dependency is blocking (not completed)
          const depIssue = issueMap.get(dep.issue.id);
          if (!depIssue) continue;

          const isBlocking =
            dep.dependencyType === BeadsDependencyType.Required &&
            depIssue.status !== BeadsStatus.Completed;

          if (isBlocking) {
            blockers.push({
              blockerId: dep.issue.id,
              blockedId: parentId,
              blockedIssue: issue,
              blockingIssue: depIssue,
              reason: `Required dependency "${depIssue.title}" (${depIssue.status})`,
              dependencyType: dep.dependencyType!
            });
          }

          // Recursively check dependencies
          findBlockers(dep, dep.issue.id);
        }
      }

      findBlockers(depTree, issue.id);
    } catch (error) {
      // Log error but continue processing other issues
      console.warn(`Failed to get dependencies for issue ${issue.id}:`, error);
    }
  }

  // Cache result
  if (opts.useCache) {
    queryCache.set(cacheKey, blockers, opts.cacheTtl!);
  }

  return blockers;
}

/**
 * Map beads issue to apm-auto TaskState
 *
 * Converts beads issue format to TaskState from Task 1.3 types,
 * mapping status enums and extracting metadata.
 */
export function mapBeadsIssueToTaskState(
  issue: BeadsIssue,
  phaseId: string = 'phase_unknown',
  dependencies: TaskDependency[] = []
): TaskState {
  // Map beads status to TaskStatus
  let status: TaskStatus;
  switch (issue.status) {
    case BeadsStatus.Pending:
      status = TaskStatus.Pending;
      break;
    case BeadsStatus.InProgress:
      status = TaskStatus.InProgress;
      break;
    case BeadsStatus.Completed:
      status = TaskStatus.Completed;
      break;
    case BeadsStatus.Failed:
      status = TaskStatus.Failed;
      break;
    case BeadsStatus.Blocked:
      status = TaskStatus.Blocked;
      break;
    default:
      // Unknown status defaults to Pending with warning
      console.warn(`Unknown beads status "${issue.status}", defaulting to Pending`);
      status = TaskStatus.Pending;
  }

  // Map priority if present
  let priority: TaskPriority | undefined;
  if (issue.priority) {
    const priorityLower = issue.priority.toLowerCase();
    if (priorityLower === 'critical') priority = TaskPriority.Critical;
    else if (priorityLower === 'high') priority = TaskPriority.High;
    else if (priorityLower === 'normal') priority = TaskPriority.Normal;
    else if (priorityLower === 'low') priority = TaskPriority.Low;
  }

  // Parse timestamps
  const createdAt = issue.created_at ? new Date(issue.created_at) : null;
  const updatedAt = issue.updated_at ? new Date(issue.updated_at) : null;

  // Determine start/completion times based on status
  let startTime: Date | null = null;
  let completionTime: Date | null = null;
  let assignedAgent: string | null = issue.assignee ?? null;

  if (status === TaskStatus.InProgress || status === TaskStatus.Blocked) {
    startTime = createdAt;
  } else if (status === TaskStatus.Completed || status === TaskStatus.Failed) {
    startTime = createdAt;
    completionTime = updatedAt ?? new Date();
  }

  // Build TaskState
  const taskState: TaskState = {
    id: issue.id,
    phaseId,
    status,
    assignedAgent,
    dependencies,
    startTime,
    completionTime,
    priority,
    metadata: {
      title: issue.title,
      description: issue.description,
      tags: issue.tags,
      executionType: TaskExecutionType.SingleStep,
      // Store beads metadata
      beadsMetadata: issue.metadata,
      // Store original beads status
      originalBeadsStatus: issue.status
    }
  };

  return taskState;
}

/**
 * Map beads dependency to TaskDependency
 */
export function mapBeadsDependencyToTaskDependency(
  dep: BeadsDependency
): TaskDependency {
  return {
    taskId: dep.to,
    type: dep.type === BeadsDependencyType.Required ? 'required' : 'optional',
    description: `Beads ${dep.type} dependency`
  };
}

/**
 * Invalidate query cache
 *
 * Clears cached query results to force fresh data retrieval.
 * Call after write operations that modify beads state.
 */
export function invalidateQueryCache(pattern?: RegExp): void {
  if (pattern) {
    queryCache.invalidatePattern(pattern);
  } else {
    queryCache.clear();
  }
}

/**
 * Get query cache statistics
 */
export function getQueryCacheStats(): { size: number; keys: string[] } {
  return queryCache.getStats();
}

/**
 * Export cache instance for testing
 */
export { queryCache };
