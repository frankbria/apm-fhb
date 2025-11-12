/**
 * Beads Query Functions Test Suite
 * Tests query caching, blocker detection, and state mapping
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getReadyTasks,
  getAllIssues,
  getIssueDetails,
  getDependencies,
  getBlockers,
  mapBeadsIssueToTaskState,
  mapBeadsDependencyToTaskDependency,
  invalidateQueryCache,
  getQueryCacheStats,
  BeadsStatus,
  BeadsDependencyType,
  TaskStatus,
  TaskPriority
} from '../../src/beads/index.js';
import * as cli from '../../src/beads/cli.js';

// Mock CLI functions
vi.mock('../../src/beads/cli.js', async () => {
  const actual = await vi.importActual('../../src/beads/cli.js');
  return {
    ...actual,
    getBeadsReady: vi.fn(),
    getBeadsList: vi.fn(),
    getBeadsShow: vi.fn(),
    getBeadsDependencyTree: vi.fn()
  };
});

describe('Beads Query Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateQueryCache();
  });

  afterEach(() => {
    invalidateQueryCache();
  });

  describe('getReadyTasks', () => {
    it('should return ready tasks from beads', async () => {
      const mockReady = {
        ready: [
          {
            id: 'issue-1',
            title: 'Ready Task 1',
            status: BeadsStatus.Pending,
            tags: ['feature']
          },
          {
            id: 'issue-2',
            title: 'Ready Task 2',
            status: BeadsStatus.Pending,
            tags: ['bug']
          }
        ],
        count: 2
      };

      vi.mocked(cli.getBeadsReady).mockResolvedValue(mockReady);

      const result = await getReadyTasks();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('issue-1');
      expect(result[1].id).toBe('issue-2');
    });

    it('should cache results with TTL', async () => {
      const mockReady = {
        ready: [
          {
            id: 'issue-1',
            title: 'Cached Task',
            status: BeadsStatus.Pending,
            tags: []
          }
        ],
        count: 1
      };

      vi.mocked(cli.getBeadsReady).mockResolvedValue(mockReady);

      // First call - cache miss
      await getReadyTasks();
      expect(cli.getBeadsReady).toHaveBeenCalledTimes(1);

      // Second call - cache hit
      await getReadyTasks();
      expect(cli.getBeadsReady).toHaveBeenCalledTimes(1); // Not called again

      // Verify cache stats
      const stats = getQueryCacheStats();
      expect(stats.size).toBeGreaterThan(0);
    });

    it('should respect cache TTL expiration', async () => {
      const mockReady = {
        ready: [],
        count: 0
      };

      vi.mocked(cli.getBeadsReady).mockResolvedValue(mockReady);

      // Call with very short TTL
      await getReadyTasks({ cacheTtl: 10 }); // 10ms TTL
      expect(cli.getBeadsReady).toHaveBeenCalledTimes(1);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 20));

      // Call again - should be cache miss
      await getReadyTasks({ cacheTtl: 10 });
      expect(cli.getBeadsReady).toHaveBeenCalledTimes(2);
    });

    it('should support cache bypass', async () => {
      const mockReady = {
        ready: [],
        count: 0
      };

      vi.mocked(cli.getBeadsReady).mockResolvedValue(mockReady);

      // Call with caching
      await getReadyTasks();
      expect(cli.getBeadsReady).toHaveBeenCalledTimes(1);

      // Call with cache bypass
      await getReadyTasks({ useCache: false });
      expect(cli.getBeadsReady).toHaveBeenCalledTimes(2);
    });
  });

  describe('getAllIssues', () => {
    it('should return all issues', async () => {
      const mockList = {
        issues: [
          {
            id: 'issue-1',
            title: 'Issue 1',
            status: BeadsStatus.Pending,
            tags: []
          },
          {
            id: 'issue-2',
            title: 'Issue 2',
            status: BeadsStatus.InProgress,
            tags: []
          }
        ],
        count: 2
      };

      vi.mocked(cli.getBeadsList).mockResolvedValue(mockList);

      const result = await getAllIssues();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('issue-1');
      expect(result[1].id).toBe('issue-2');
    });

    it('should support filtering by status', async () => {
      const mockList = {
        issues: [],
        count: 0
      };

      vi.mocked(cli.getBeadsList).mockResolvedValue(mockList);

      await getAllIssues({ status: BeadsStatus.Completed });

      expect(cli.getBeadsList).toHaveBeenCalledWith(
        { status: BeadsStatus.Completed },
        expect.any(Object)
      );
    });

    it('should cache results separately per filter', async () => {
      const mockList = {
        issues: [],
        count: 0
      };

      vi.mocked(cli.getBeadsList).mockResolvedValue(mockList);

      // Different filters should create separate cache entries
      await getAllIssues({ status: BeadsStatus.Pending });
      await getAllIssues({ status: BeadsStatus.Completed });

      expect(cli.getBeadsList).toHaveBeenCalledTimes(2);

      // Same filter should use cache
      await getAllIssues({ status: BeadsStatus.Pending });
      expect(cli.getBeadsList).toHaveBeenCalledTimes(2); // Not called again
    });
  });

  describe('getIssueDetails', () => {
    it('should return issue details', async () => {
      const mockIssue = {
        id: 'issue-1',
        title: 'Detailed Issue',
        status: BeadsStatus.InProgress,
        tags: ['feature'],
        description: 'Long description'
      };

      vi.mocked(cli.getBeadsShow).mockResolvedValue(mockIssue);

      const result = await getIssueDetails('issue-1');

      expect(result.id).toBe('issue-1');
      expect(result.title).toBe('Detailed Issue');
      expect(result.description).toBe('Long description');
    });

    it('should cache issue details by ID', async () => {
      const mockIssue = {
        id: 'issue-1',
        title: 'Issue',
        status: BeadsStatus.Pending,
        tags: []
      };

      vi.mocked(cli.getBeadsShow).mockResolvedValue(mockIssue);

      await getIssueDetails('issue-1');
      await getIssueDetails('issue-1');

      expect(cli.getBeadsShow).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDependencies', () => {
    it('should return dependency tree', async () => {
      const mockTree = {
        issue: {
          id: 'issue-1',
          title: 'Main',
          status: BeadsStatus.Pending,
          tags: []
        },
        dependencies: [
          {
            issue: {
              id: 'issue-2',
              title: 'Dep',
              status: BeadsStatus.Completed,
              tags: []
            },
            dependencies: [],
            dependencyType: BeadsDependencyType.Required
          }
        ]
      };

      vi.mocked(cli.getBeadsDependencyTree).mockResolvedValue(mockTree);

      const result = await getDependencies('issue-1');

      expect(result.issue.id).toBe('issue-1');
      expect(result.dependencies).toHaveLength(1);
    });

    it('should cache dependency trees', async () => {
      const mockTree = {
        issue: {
          id: 'issue-1',
          title: 'Main',
          status: BeadsStatus.Pending,
          tags: []
        },
        dependencies: []
      };

      vi.mocked(cli.getBeadsDependencyTree).mockResolvedValue(mockTree);

      await getDependencies('issue-1');
      await getDependencies('issue-1');

      expect(cli.getBeadsDependencyTree).toHaveBeenCalledTimes(1);
    });
  });

  describe('getBlockers', () => {
    it('should identify blocking dependencies', async () => {
      const mockList = {
        issues: [
          {
            id: 'issue-1',
            title: 'Blocked Task',
            status: BeadsStatus.Pending,
            tags: []
          },
          {
            id: 'issue-2',
            title: 'Blocking Task',
            status: BeadsStatus.InProgress,
            tags: []
          }
        ],
        count: 2
      };

      const mockTree = {
        issue: {
          id: 'issue-1',
          title: 'Blocked Task',
          status: BeadsStatus.Pending,
          tags: []
        },
        dependencies: [
          {
            issue: {
              id: 'issue-2',
              title: 'Blocking Task',
              status: BeadsStatus.InProgress,
              tags: []
            },
            dependencies: [],
            dependencyType: BeadsDependencyType.Required
          }
        ]
      };

      vi.mocked(cli.getBeadsList).mockResolvedValue(mockList);
      vi.mocked(cli.getBeadsDependencyTree).mockResolvedValue(mockTree);

      const result = await getBlockers({ useCache: false });

      expect(result).toHaveLength(1);
      expect(result[0].blockerId).toBe('issue-2');
      expect(result[0].blockedId).toBe('issue-1');
      expect(result[0].dependencyType).toBe(BeadsDependencyType.Required);
    });

    it('should not identify completed dependencies as blockers', async () => {
      const mockList = {
        issues: [
          {
            id: 'issue-1',
            title: 'Task',
            status: BeadsStatus.Pending,
            tags: []
          },
          {
            id: 'issue-2',
            title: 'Completed Dep',
            status: BeadsStatus.Completed,
            tags: []
          }
        ],
        count: 2
      };

      const mockTree = {
        issue: {
          id: 'issue-1',
          title: 'Task',
          status: BeadsStatus.Pending,
          tags: []
        },
        dependencies: [
          {
            issue: {
              id: 'issue-2',
              title: 'Completed Dep',
              status: BeadsStatus.Completed,
              tags: []
            },
            dependencies: [],
            dependencyType: BeadsDependencyType.Required
          }
        ]
      };

      vi.mocked(cli.getBeadsList).mockResolvedValue(mockList);
      vi.mocked(cli.getBeadsDependencyTree).mockResolvedValue(mockTree);

      const result = await getBlockers({ useCache: false });

      expect(result).toHaveLength(0);
    });

    it('should ignore optional dependencies as blockers', async () => {
      const mockList = {
        issues: [
          {
            id: 'issue-1',
            title: 'Task',
            status: BeadsStatus.Pending,
            tags: []
          },
          {
            id: 'issue-2',
            title: 'Optional Dep',
            status: BeadsStatus.Pending,
            tags: []
          }
        ],
        count: 2
      };

      const mockTree = {
        issue: {
          id: 'issue-1',
          title: 'Task',
          status: BeadsStatus.Pending,
          tags: []
        },
        dependencies: [
          {
            issue: {
              id: 'issue-2',
              title: 'Optional Dep',
              status: BeadsStatus.Pending,
              tags: []
            },
            dependencies: [],
            dependencyType: BeadsDependencyType.Optional
          }
        ]
      };

      vi.mocked(cli.getBeadsList).mockResolvedValue(mockList);
      vi.mocked(cli.getBeadsDependencyTree).mockResolvedValue(mockTree);

      const result = await getBlockers({ useCache: false });

      expect(result).toHaveLength(0);
    });
  });

  describe('mapBeadsIssueToTaskState', () => {
    it('should map pending status correctly', () => {
      const beadsIssue = {
        id: 'issue-1',
        title: 'Test Issue',
        status: BeadsStatus.Pending,
        tags: ['bug']
      };

      const taskState = mapBeadsIssueToTaskState(beadsIssue, 'phase-1');

      expect(taskState.id).toBe('issue-1');
      expect(taskState.phaseId).toBe('phase-1');
      expect(taskState.status).toBe(TaskStatus.Pending);
      expect(taskState.metadata.title).toBe('Test Issue');
      expect(taskState.metadata.tags).toEqual(['bug']);
    });

    it('should map in_progress status correctly', () => {
      const beadsIssue = {
        id: 'issue-1',
        title: 'In Progress',
        status: BeadsStatus.InProgress,
        tags: [],
        assignee: 'john'
      };

      const taskState = mapBeadsIssueToTaskState(beadsIssue);

      expect(taskState.status).toBe(TaskStatus.InProgress);
      expect(taskState.assignedAgent).toBe('john');
      expect(taskState.startTime).not.toBeNull();
    });

    it('should map completed status correctly', () => {
      const beadsIssue = {
        id: 'issue-1',
        title: 'Completed',
        status: BeadsStatus.Completed,
        tags: [],
        assignee: 'jane',
        created_at: '2025-01-01T10:00:00Z',
        updated_at: '2025-01-01T12:00:00Z'
      };

      const taskState = mapBeadsIssueToTaskState(beadsIssue);

      expect(taskState.status).toBe(TaskStatus.Completed);
      expect(taskState.assignedAgent).toBe('jane');
      expect(taskState.startTime).not.toBeNull();
      expect(taskState.completionTime).not.toBeNull();
    });

    it('should map failed status correctly', () => {
      const beadsIssue = {
        id: 'issue-1',
        title: 'Failed',
        status: BeadsStatus.Failed,
        tags: []
      };

      const taskState = mapBeadsIssueToTaskState(beadsIssue);

      expect(taskState.status).toBe(TaskStatus.Failed);
    });

    it('should map blocked status correctly', () => {
      const beadsIssue = {
        id: 'issue-1',
        title: 'Blocked',
        status: BeadsStatus.Blocked,
        tags: []
      };

      const taskState = mapBeadsIssueToTaskState(beadsIssue);

      expect(taskState.status).toBe(TaskStatus.Blocked);
    });

    it('should map priority correctly', () => {
      const beadsIssue = {
        id: 'issue-1',
        title: 'High Priority',
        status: BeadsStatus.Pending,
        tags: [],
        priority: 'high'
      };

      const taskState = mapBeadsIssueToTaskState(beadsIssue);

      expect(taskState.priority).toBe(TaskPriority.High);
    });

    it('should handle unknown status with warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const beadsIssue = {
        id: 'issue-1',
        title: 'Unknown',
        status: 'unknown' as BeadsStatus,
        tags: []
      };

      const taskState = mapBeadsIssueToTaskState(beadsIssue);

      expect(taskState.status).toBe(TaskStatus.Pending);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should include dependencies if provided', () => {
      const beadsIssue = {
        id: 'issue-1',
        title: 'Task',
        status: BeadsStatus.Pending,
        tags: []
      };

      const dependencies = [
        { taskId: 'dep-1', type: 'required' as const }
      ];

      const taskState = mapBeadsIssueToTaskState(beadsIssue, 'phase-1', dependencies);

      expect(taskState.dependencies).toEqual(dependencies);
    });
  });

  describe('mapBeadsDependencyToTaskDependency', () => {
    it('should map required dependency', () => {
      const beadsDep = {
        from: 'issue-1',
        to: 'issue-2',
        type: BeadsDependencyType.Required
      };

      const taskDep = mapBeadsDependencyToTaskDependency(beadsDep);

      expect(taskDep.taskId).toBe('issue-2');
      expect(taskDep.type).toBe('required');
    });

    it('should map optional dependency', () => {
      const beadsDep = {
        from: 'issue-1',
        to: 'issue-2',
        type: BeadsDependencyType.Optional
      };

      const taskDep = mapBeadsDependencyToTaskDependency(beadsDep);

      expect(taskDep.taskId).toBe('issue-2');
      expect(taskDep.type).toBe('optional');
    });
  });

  describe('Cache Management', () => {
    it('should invalidate all cache', () => {
      const mockReady = {
        ready: [],
        count: 0
      };

      vi.mocked(cli.getBeadsReady).mockResolvedValue(mockReady);

      // Populate cache
      getReadyTasks();

      const statsBefore = getQueryCacheStats();
      expect(statsBefore.size).toBeGreaterThan(0);

      // Invalidate
      invalidateQueryCache();

      const statsAfter = getQueryCacheStats();
      expect(statsAfter.size).toBe(0);
    });

    it('should invalidate by pattern', async () => {
      const mockReady = { ready: [], count: 0 };
      const mockList = { issues: [], count: 0 };

      vi.mocked(cli.getBeadsReady).mockResolvedValue(mockReady);
      vi.mocked(cli.getBeadsList).mockResolvedValue(mockList);

      // Populate cache
      await getReadyTasks();
      await getAllIssues();

      // Invalidate only ready tasks
      invalidateQueryCache(/^ready_/);

      // Ready tasks should require new query
      await getReadyTasks();
      expect(cli.getBeadsReady).toHaveBeenCalledTimes(2);

      // All issues should still be cached
      await getAllIssues();
      expect(cli.getBeadsList).toHaveBeenCalledTimes(1);
    });
  });
});
