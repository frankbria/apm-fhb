/**
 * Beads Integration Test Suite
 * Tests database synchronization, state mapping, and periodic sync
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionManager, TEST_CONFIG } from '../../src/db/connection.js';
import { setupTestDatabase } from '../../src/db/init.js';
import {
  syncBeadsToDatabase,
  syncDependencies,
  determineReadyTasks,
  startPeriodicSync,
  getReadyTasksFromDatabase,
  BeadsStatus,
  BeadsDependencyType,
  TaskStatus
} from '../../src/beads/index.js';
import * as queries from '../../src/beads/queries.js';

// Mock query functions
vi.mock('../../src/beads/queries.js', async () => {
  const actual = await vi.importActual('../../src/beads/queries.js');
  return {
    ...actual,
    getAllIssues: vi.fn(),
    getReadyTasks: vi.fn(),
    getDependencies: vi.fn(),
    getBlockers: vi.fn(),
    invalidateQueryCache: vi.fn()
  };
});

describe('Beads Integration', () => {
  let connectionManager: ConnectionManager;

  beforeEach(async () => {
    connectionManager = new ConnectionManager(TEST_CONFIG);
    await setupTestDatabase(connectionManager);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (connectionManager.isConnected()) {
      await connectionManager.disconnect();
    }
  });

  describe('syncBeadsToDatabase', () => {
    it('should sync issues to database', async () => {
      const mockIssues = [
        {
          id: 'issue-1',
          title: 'Test Issue 1',
          status: BeadsStatus.Pending,
          tags: ['feature'],
          description: 'Test description'
        },
        {
          id: 'issue-2',
          title: 'Test Issue 2',
          status: BeadsStatus.InProgress,
          tags: ['bug'],
          assignee: 'john'
        }
      ];

      vi.mocked(queries.getAllIssues).mockResolvedValue(mockIssues);
      vi.mocked(queries.getDependencies).mockResolvedValue({
        issue: mockIssues[0],
        dependencies: []
      });

      const result = await syncBeadsToDatabase(connectionManager);

      expect(result.tasksSynced).toBe(2);
      expect(result.errors).toHaveLength(0);

      // Verify tasks in database
      const tasks = await connectionManager.query('SELECT * FROM tasks');
      expect(tasks).toHaveLength(2);
    });

    it('should update existing tasks', async () => {
      // Insert initial task
      await connectionManager.execute(`
        INSERT INTO tasks (id, phase_id, status, assigned_agent, metadata)
        VALUES ('issue-1', 'phase-1', 'Pending', NULL, json('{"title":"Old Title"}'))
      `);

      const mockIssues = [
        {
          id: 'issue-1',
          title: 'Updated Title',
          status: BeadsStatus.InProgress,
          tags: [],
          assignee: 'jane'
        }
      ];

      vi.mocked(queries.getAllIssues).mockResolvedValue(mockIssues);
      vi.mocked(queries.getDependencies).mockResolvedValue({
        issue: mockIssues[0],
        dependencies: []
      });

      const result = await syncBeadsToDatabase(connectionManager, {
        phaseId: 'phase-1',
        trackTransitions: true
      });

      expect(result.tasksSynced).toBe(1);

      // Verify task was updated
      const task = await connectionManager.get<any>(
        'SELECT * FROM tasks WHERE id = ?',
        ['issue-1']
      );
      expect(task?.status).toBe('InProgress');
      expect(task?.assigned_agent).toBe('jane');

      // Verify state transition was recorded
      const transitions = await connectionManager.query(
        'SELECT * FROM state_transitions WHERE entity_id = ?',
        ['issue-1']
      );
      expect(transitions.length).toBeGreaterThan(0);
    });

    it('should track state transitions for new tasks', async () => {
      const mockIssues = [
        {
          id: 'issue-1',
          title: 'New Task',
          status: BeadsStatus.Pending,
          tags: []
        }
      ];

      vi.mocked(queries.getAllIssues).mockResolvedValue(mockIssues);
      vi.mocked(queries.getDependencies).mockResolvedValue({
        issue: mockIssues[0],
        dependencies: []
      });

      const result = await syncBeadsToDatabase(connectionManager, {
        trackTransitions: true
      });

      expect(result.transitionsRecorded).toBe(1);

      const transitions = await connectionManager.query(
        'SELECT * FROM state_transitions WHERE entity_id = ?',
        ['issue-1']
      );
      expect(transitions).toHaveLength(1);
    });

    it('should handle sync errors gracefully', async () => {
      const mockIssues = [
        {
          id: 'issue-1',
          title: 'Valid Issue',
          status: BeadsStatus.Pending,
          tags: []
        }
      ];

      vi.mocked(queries.getAllIssues).mockResolvedValue(mockIssues);
      vi.mocked(queries.getDependencies).mockRejectedValue(new Error('Dependency error'));

      const result = await syncBeadsToDatabase(connectionManager);

      // Should still sync tasks even if dependencies fail
      expect(result.tasksSynced).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should use transactions for atomicity', async () => {
      const mockIssues = [
        {
          id: 'issue-1',
          title: 'Task 1',
          status: BeadsStatus.Pending,
          tags: []
        },
        {
          id: 'issue-2',
          title: 'Task 2',
          status: BeadsStatus.Pending,
          tags: []
        }
      ];

      vi.mocked(queries.getAllIssues).mockResolvedValue(mockIssues);
      vi.mocked(queries.getDependencies).mockResolvedValue({
        issue: mockIssues[0],
        dependencies: []
      });

      await syncBeadsToDatabase(connectionManager);

      // All tasks should be inserted in single transaction
      const tasks = await connectionManager.query('SELECT * FROM tasks');
      expect(tasks).toHaveLength(2);
    });
  });

  describe('syncDependencies', () => {
    it('should populate task_dependencies table', async () => {
      // Create tasks first
      await connectionManager.execute(`
        INSERT INTO tasks (id, phase_id, status, assigned_agent, metadata)
        VALUES
          ('issue-1', 'phase-1', 'Pending', NULL, json('{"title":"Task 1"}')),
          ('issue-2', 'phase-1', 'Completed', NULL, json('{"title":"Task 2"}'))
      `);

      const mockIssues = [
        {
          id: 'issue-1',
          title: 'Task 1',
          status: BeadsStatus.Pending,
          tags: []
        }
      ];

      const mockDepTree = {
        issue: mockIssues[0],
        dependencies: [
          {
            issue: {
              id: 'issue-2',
              title: 'Task 2',
              status: BeadsStatus.Completed,
              tags: []
            },
            dependencies: [],
            dependencyType: BeadsDependencyType.Required
          }
        ]
      };

      vi.mocked(queries.getDependencies).mockResolvedValue(mockDepTree);

      const result = await syncDependencies(connectionManager, mockIssues);

      expect(result.dependenciesSynced).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify dependency in database
      const deps = await connectionManager.query('SELECT * FROM task_dependencies');
      expect(deps).toHaveLength(1);
      expect((deps[0] as any).dependent_task_id).toBe('issue-1');
      expect((deps[0] as any).dependency_task_id).toBe('issue-2');
      expect((deps[0] as any).dependency_type).toBe('required');
    });

    it('should map dependency types correctly', async () => {
      await connectionManager.execute(`
        INSERT INTO tasks (id, phase_id, status, assigned_agent, metadata)
        VALUES
          ('issue-1', 'phase-1', 'Pending', NULL, json('{"title":"Task 1"}')),
          ('issue-2', 'phase-1', 'Pending', NULL, json('{"title":"Task 2"}'))
      `);

      const mockIssues = [
        {
          id: 'issue-1',
          title: 'Task 1',
          status: BeadsStatus.Pending,
          tags: []
        }
      ];

      const mockDepTree = {
        issue: mockIssues[0],
        dependencies: [
          {
            issue: {
              id: 'issue-2',
              title: 'Task 2',
              status: BeadsStatus.Pending,
              tags: []
            },
            dependencies: [],
            dependencyType: BeadsDependencyType.Optional
          }
        ]
      };

      vi.mocked(queries.getDependencies).mockResolvedValue(mockDepTree);

      await syncDependencies(connectionManager, mockIssues);

      const deps = await connectionManager.query('SELECT * FROM task_dependencies');
      expect((deps[0] as any).dependency_type).toBe('optional');
    });

    it('should handle nested dependencies', async () => {
      await connectionManager.execute(`
        INSERT INTO tasks (id, phase_id, status, assigned_agent, metadata)
        VALUES
          ('issue-1', 'phase-1', 'Pending', NULL, json('{"title":"Task 1"}')),
          ('issue-2', 'phase-1', 'Pending', NULL, json('{"title":"Task 2"}')),
          ('issue-3', 'phase-1', 'Pending', NULL, json('{"title":"Task 3"}'))
      `);

      const mockIssues = [
        {
          id: 'issue-1',
          title: 'Task 1',
          status: BeadsStatus.Pending,
          tags: []
        }
      ];

      const mockDepTree = {
        issue: mockIssues[0],
        dependencies: [
          {
            issue: {
              id: 'issue-2',
              title: 'Task 2',
              status: BeadsStatus.Pending,
              tags: []
            },
            dependencies: [
              {
                issue: {
                  id: 'issue-3',
                  title: 'Task 3',
                  status: BeadsStatus.Pending,
                  tags: []
                },
                dependencies: [],
                dependencyType: BeadsDependencyType.Required
              }
            ],
            dependencyType: BeadsDependencyType.Required
          }
        ]
      };

      vi.mocked(queries.getDependencies).mockResolvedValue(mockDepTree);

      const result = await syncDependencies(connectionManager, mockIssues);

      expect(result.dependenciesSynced).toBe(2); // issue-1 -> issue-2, issue-2 -> issue-3
    });

    it('should clear existing dependencies before sync', async () => {
      // Insert initial dependency
      await connectionManager.execute(`
        INSERT INTO tasks (id, phase_id, status, assigned_agent, metadata)
        VALUES
          ('issue-1', 'phase-1', 'Pending', NULL, json('{"title":"Task 1"}')),
          ('issue-2', 'phase-1', 'Pending', NULL, json('{"title":"Task 2"}'))
      `);

      await connectionManager.execute(`
        INSERT INTO task_dependencies (dependent_task_id, dependency_task_id, dependency_type)
        VALUES ('issue-1', 'issue-2', 'required')
      `);

      const mockIssues = [
        {
          id: 'issue-1',
          title: 'Task 1',
          status: BeadsStatus.Pending,
          tags: []
        }
      ];

      vi.mocked(queries.getDependencies).mockResolvedValue({
        issue: mockIssues[0],
        dependencies: []
      });

      await syncDependencies(connectionManager, mockIssues);

      // Old dependency should be removed
      const deps = await connectionManager.query('SELECT * FROM task_dependencies');
      expect(deps).toHaveLength(0);
    });
  });

  describe('determineReadyTasks', () => {
    it('should return ready task IDs', async () => {
      const mockReadyTasks = [
        {
          id: 'issue-1',
          title: 'Ready Task',
          status: BeadsStatus.Pending,
          tags: []
        }
      ];

      vi.mocked(queries.getReadyTasks).mockResolvedValue(mockReadyTasks);
      vi.mocked(queries.getBlockers).mockResolvedValue([]);

      const result = await determineReadyTasks();

      expect(result.readyTaskIds).toEqual(['issue-1']);
      expect(result.blockedTasks).toHaveLength(0);
    });

    it('should return blocked tasks with blocker info', async () => {
      vi.mocked(queries.getReadyTasks).mockResolvedValue([]);
      vi.mocked(queries.getBlockers).mockResolvedValue([
        {
          blockerId: 'issue-2',
          blockedId: 'issue-1',
          blockedIssue: {
            id: 'issue-1',
            title: 'Blocked',
            status: BeadsStatus.Blocked,
            tags: []
          },
          blockingIssue: {
            id: 'issue-2',
            title: 'Blocker',
            status: BeadsStatus.InProgress,
            tags: []
          },
          reason: 'Required dependency not completed',
          dependencyType: BeadsDependencyType.Required
        }
      ]);

      const result = await determineReadyTasks();

      expect(result.blockedTasks).toHaveLength(1);
      expect(result.blockedTasks[0].taskId).toBe('issue-1');
      expect(result.blockedTasks[0].blockers).toContain('issue-2');
    });
  });

  describe('getReadyTasksFromDatabase', () => {
    it('should return tasks with no unsatisfied dependencies', async () => {
      // Create tasks
      await connectionManager.execute(`
        INSERT INTO tasks (id, phase_id, status, assigned_agent, metadata)
        VALUES
          ('task-1', 'phase-1', 'Pending', NULL, json('{"title":"Ready Task"}')),
          ('task-2', 'phase-1', 'Pending', NULL, json('{"title":"Blocked Task"}')),
          ('task-3', 'phase-1', 'Completed', NULL, json('{"title":"Completed"}'))
      `);

      // Create dependency: task-2 depends on task-3 (completed - should not block)
      await connectionManager.execute(`
        INSERT INTO task_dependencies (dependent_task_id, dependency_task_id, dependency_type)
        VALUES ('task-2', 'task-3', 'required')
      `);

      const readyTasks = await getReadyTasksFromDatabase(connectionManager);

      // Both task-1 (no deps) and task-2 (dep completed) should be ready
      expect(readyTasks.length).toBe(2);
      const taskIds = readyTasks.map(t => t.id);
      expect(taskIds).toContain('task-1');
      expect(taskIds).toContain('task-2');
    });

    it('should exclude tasks with unsatisfied dependencies', async () => {
      await connectionManager.execute(`
        INSERT INTO tasks (id, phase_id, status, assigned_agent, metadata)
        VALUES
          ('task-1', 'phase-1', 'Pending', NULL, json('{"title":"Blocked Task"}')),
          ('task-2', 'phase-1', 'Pending', NULL, json('{"title":"Blocking Task"}'))
      `);

      // task-1 depends on task-2 (pending - should block)
      await connectionManager.execute(`
        INSERT INTO task_dependencies (dependent_task_id, dependency_task_id, dependency_type)
        VALUES ('task-1', 'task-2', 'required')
      `);

      const readyTasks = await getReadyTasksFromDatabase(connectionManager);

      // Only task-2 should be ready
      expect(readyTasks).toHaveLength(1);
      expect(readyTasks[0].id).toBe('task-2');
    });
  });

  describe('startPeriodicSync', () => {
    it('should execute sync on interval', async () => {
      vi.useFakeTimers();

      const mockIssues = [
        {
          id: 'issue-1',
          title: 'Task',
          status: BeadsStatus.Pending,
          tags: []
        }
      ];

      vi.mocked(queries.getAllIssues).mockResolvedValue(mockIssues);
      vi.mocked(queries.getDependencies).mockResolvedValue({
        issue: mockIssues[0],
        dependencies: []
      });

      const handle = startPeriodicSync(connectionManager, 1000, { verbose: false });

      expect(handle.isRunning()).toBe(true);
      expect(handle.getInterval()).toBe(1000);

      // Wait for initial sync
      await vi.runAllTimersAsync();
      expect(queries.getAllIssues).toHaveBeenCalled();

      // Advance time and check sync runs again
      vi.mocked(queries.getAllIssues).mockClear();
      await vi.advanceTimersByTimeAsync(1000);
      expect(queries.getAllIssues).toHaveBeenCalled();

      handle.stop();
      expect(handle.isRunning()).toBe(false);

      vi.useRealTimers();
    });

    it('should stop periodic sync', async () => {
      vi.useFakeTimers();

      const mockIssues: any[] = [];
      vi.mocked(queries.getAllIssues).mockResolvedValue(mockIssues);
      vi.mocked(queries.getDependencies).mockResolvedValue({
        issue: { id: 'test', title: 'Test', status: BeadsStatus.Pending, tags: [] },
        dependencies: []
      });

      const handle = startPeriodicSync(connectionManager, 1000);

      await vi.runAllTimersAsync();

      handle.stop();

      // Clear mock calls
      vi.mocked(queries.getAllIssues).mockClear();

      // Advance time - sync should not run
      await vi.advanceTimersByTimeAsync(2000);
      expect(queries.getAllIssues).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('Graceful Degradation', () => {
    it('should handle beads unavailability gracefully', async () => {
      vi.mocked(queries.getAllIssues).mockRejectedValue(new Error('Beads CLI not available'));

      const result = await syncBeadsToDatabase(connectionManager);

      expect(result.tasksSynced).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should continue on per-issue errors', async () => {
      const mockIssues = [
        {
          id: 'issue-1',
          title: 'Valid Issue',
          status: BeadsStatus.Pending,
          tags: []
        },
        {
          id: 'issue-2',
          title: 'Invalid Issue',
          status: BeadsStatus.Pending,
          tags: []
        }
      ];

      vi.mocked(queries.getAllIssues).mockResolvedValue(mockIssues);
      vi.mocked(queries.getDependencies)
        .mockResolvedValueOnce({
          issue: mockIssues[0],
          dependencies: []
        })
        .mockRejectedValueOnce(new Error('Dependency error'));

      const result = await syncBeadsToDatabase(connectionManager);

      // Should sync first issue despite second issue error
      expect(result.tasksSynced).toBe(2);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
