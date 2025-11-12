/**
 * Beads CLI Wrapper Test Suite
 * Tests beads command execution, JSON parsing, and error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile } from 'child_process';
import {
  isBeadsAvailable,
  getBeadsReady,
  getBeadsList,
  getBeadsShow,
  getBeadsDependencyTree,
  getBeadsDependencies,
  BeadsError,
  BeadsErrorType,
  BeadsStatus,
  BeadsDependencyType,
  DEFAULT_BEADS_CONFIG
} from '../../src/beads/cli.js';

// Mock child_process
vi.mock('child_process', () => ({
  execFile: vi.fn()
}));

const mockExecFile = vi.mocked(execFile);

describe('Beads CLI Wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isBeadsAvailable', () => {
    it('should return true when beads CLI is available', async () => {
      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: 'bd version 1.0.0', stderr: '' });
      });

      const result = await isBeadsAvailable();
      expect(result).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        'bd',
        ['--version'],
        expect.objectContaining({ timeout: 5000 }),
        expect.any(Function)
      );
    });

    it('should return false when beads CLI is not available', async () => {
      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        const error: any = new Error('Command not found');
        error.code = 'ENOENT';
        callback(error, { stdout: '', stderr: '' });
      });

      const result = await isBeadsAvailable();
      expect(result).toBe(false);
    });

    it('should return false on timeout', async () => {
      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        const error: any = new Error('Timeout');
        error.killed = true;
        error.signal = 'SIGTERM';
        callback(error, { stdout: '', stderr: '' });
      });

      const result = await isBeadsAvailable();
      expect(result).toBe(false);
    });
  });

  describe('getBeadsReady', () => {
    it('should execute bd ready --json command', async () => {
      const mockOutput = JSON.stringify({
        ready: [
          {
            id: 'issue-1',
            title: 'Test Issue 1',
            status: BeadsStatus.Pending,
            tags: ['bug'],
            description: 'Test description'
          }
        ],
        count: 1
      });

      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: mockOutput, stderr: '' });
      });

      const result = await getBeadsReady();

      expect(result.ready).toHaveLength(1);
      expect(result.count).toBe(1);
      expect(result.ready[0].id).toBe('issue-1');
      expect(mockExecFile).toHaveBeenCalledWith(
        'bd',
        ['ready', '--json'],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should handle empty results', async () => {
      const mockOutput = JSON.stringify({
        ready: [],
        count: 0
      });

      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: mockOutput, stderr: '' });
      });

      const result = await getBeadsReady();

      expect(result.ready).toHaveLength(0);
      expect(result.count).toBe(0);
    });

    it('should throw BeadsError on command not found', async () => {
      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        const error: any = new Error('Command not found');
        error.code = 'ENOENT';
        callback(error, { stdout: '', stderr: '' });
      });

      await expect(getBeadsReady()).rejects.toThrow(BeadsError);
      await expect(getBeadsReady()).rejects.toThrow('not found on PATH');
    });

    it('should throw BeadsError on invalid JSON', async () => {
      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: 'invalid json{', stderr: '' });
      });

      await expect(getBeadsReady()).rejects.toThrow(BeadsError);
      await expect(getBeadsReady()).rejects.toMatchObject({
        type: BeadsErrorType.InvalidJSON
      });
    });

    it('should throw BeadsError on validation error', async () => {
      const mockOutput = JSON.stringify({
        // Missing required 'ready' field
        count: 0
      });

      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: mockOutput, stderr: '' });
      });

      await expect(getBeadsReady()).rejects.toThrow(BeadsError);
      await expect(getBeadsReady()).rejects.toMatchObject({
        type: BeadsErrorType.ValidationError
      });
    });

    it('should throw BeadsError on timeout', async () => {
      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        const error: any = new Error('Timeout');
        error.killed = true;
        error.signal = 'SIGTERM';
        callback(error, { stdout: '', stderr: '' });
      });

      await expect(getBeadsReady()).rejects.toThrow(BeadsError);
      await expect(getBeadsReady()).rejects.toMatchObject({
        type: BeadsErrorType.ExecutionTimeout
      });
    });
  });

  describe('getBeadsList', () => {
    it('should execute bd list --json command', async () => {
      const mockOutput = JSON.stringify({
        issues: [
          {
            id: 'issue-1',
            title: 'Test Issue 1',
            status: BeadsStatus.InProgress,
            tags: ['feature']
          },
          {
            id: 'issue-2',
            title: 'Test Issue 2',
            status: BeadsStatus.Completed,
            tags: ['bug']
          }
        ],
        count: 2
      });

      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: mockOutput, stderr: '' });
      });

      const result = await getBeadsList();

      expect(result.issues).toHaveLength(2);
      expect(result.count).toBe(2);
    });

    it('should support status filtering', async () => {
      const mockOutput = JSON.stringify({
        issues: [],
        count: 0
      });

      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: mockOutput, stderr: '' });
      });

      await getBeadsList({ status: BeadsStatus.Pending });

      expect(mockExecFile).toHaveBeenCalledWith(
        'bd',
        ['list', '--json', '--status', 'pending'],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should support tag filtering', async () => {
      const mockOutput = JSON.stringify({
        issues: [],
        count: 0
      });

      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: mockOutput, stderr: '' });
      });

      await getBeadsList({ tag: 'bug' });

      expect(mockExecFile).toHaveBeenCalledWith(
        'bd',
        ['list', '--json', '--tag', 'bug'],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should support assignee filtering', async () => {
      const mockOutput = JSON.stringify({
        issues: [],
        count: 0
      });

      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: mockOutput, stderr: '' });
      });

      await getBeadsList({ assignee: 'john' });

      expect(mockExecFile).toHaveBeenCalledWith(
        'bd',
        ['list', '--json', '--assignee', 'john'],
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe('getBeadsShow', () => {
    it('should execute bd show <id> --json command', async () => {
      const mockOutput = JSON.stringify({
        id: 'issue-1',
        title: 'Test Issue',
        status: BeadsStatus.InProgress,
        tags: ['feature'],
        description: 'Detailed description'
      });

      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: mockOutput, stderr: '' });
      });

      const result = await getBeadsShow('issue-1');

      expect(result.id).toBe('issue-1');
      expect(result.title).toBe('Test Issue');
      expect(mockExecFile).toHaveBeenCalledWith(
        'bd',
        ['show', 'issue-1', '--json'],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should throw error for empty issue ID', async () => {
      await expect(getBeadsShow('')).rejects.toThrow(BeadsError);
      await expect(getBeadsShow('')).rejects.toMatchObject({
        type: BeadsErrorType.InvalidIssueId
      });
    });

    it('should throw error for non-existent issue', async () => {
      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        const error: any = new Error('Issue not found');
        error.stderr = 'Issue issue-999 not found';
        callback(error, { stdout: '', stderr: error.stderr });
      });

      await expect(getBeadsShow('issue-999')).rejects.toThrow(BeadsError);
      await expect(getBeadsShow('issue-999')).rejects.toMatchObject({
        type: BeadsErrorType.InvalidIssueId
      });
    });
  });

  describe('getBeadsDependencyTree', () => {
    it('should execute bd dep tree <id> --json command', async () => {
      const mockOutput = JSON.stringify({
        issue: {
          id: 'issue-1',
          title: 'Main Task',
          status: BeadsStatus.InProgress,
          tags: []
        },
        dependencies: [
          {
            issue: {
              id: 'issue-2',
              title: 'Dependency 1',
              status: BeadsStatus.Completed,
              tags: []
            },
            dependencies: [],
            dependencyType: BeadsDependencyType.Required
          }
        ]
      });

      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: mockOutput, stderr: '' });
      });

      const result = await getBeadsDependencyTree('issue-1');

      expect(result.issue.id).toBe('issue-1');
      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0].issue.id).toBe('issue-2');
      expect(result.dependencies[0].dependencyType).toBe(BeadsDependencyType.Required);
    });

    it('should handle nested dependencies', async () => {
      const mockOutput = JSON.stringify({
        issue: {
          id: 'issue-1',
          title: 'Main Task',
          status: BeadsStatus.Pending,
          tags: []
        },
        dependencies: [
          {
            issue: {
              id: 'issue-2',
              title: 'Dep 1',
              status: BeadsStatus.InProgress,
              tags: []
            },
            dependencies: [
              {
                issue: {
                  id: 'issue-3',
                  title: 'Dep 2',
                  status: BeadsStatus.Completed,
                  tags: []
                },
                dependencies: [],
                dependencyType: BeadsDependencyType.Required
              }
            ],
            dependencyType: BeadsDependencyType.Required
          }
        ]
      });

      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: mockOutput, stderr: '' });
      });

      const result = await getBeadsDependencyTree('issue-1');

      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0].dependencies).toHaveLength(1);
      expect(result.dependencies[0].dependencies[0].issue.id).toBe('issue-3');
    });
  });

  describe('getBeadsDependencies', () => {
    it('should flatten dependency tree to array', async () => {
      const mockOutput = JSON.stringify({
        issue: {
          id: 'issue-1',
          title: 'Main Task',
          status: BeadsStatus.Pending,
          tags: []
        },
        dependencies: [
          {
            issue: {
              id: 'issue-2',
              title: 'Dep 1',
              status: BeadsStatus.InProgress,
              tags: []
            },
            dependencies: [
              {
                issue: {
                  id: 'issue-3',
                  title: 'Dep 2',
                  status: BeadsStatus.Completed,
                  tags: []
                },
                dependencies: [],
                dependencyType: BeadsDependencyType.Required
              }
            ],
            dependencyType: BeadsDependencyType.Required
          }
        ]
      });

      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: mockOutput, stderr: '' });
      });

      const result = await getBeadsDependencies('issue-1');

      expect(result).toHaveLength(2);
      expect(result[0].from).toBe('issue-1');
      expect(result[0].to).toBe('issue-2');
      expect(result[1].from).toBe('issue-2');
      expect(result[1].to).toBe('issue-3');
    });
  });

  describe('Error Handling', () => {
    it('should include command in error message', async () => {
      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        const error: any = new Error('Command failed');
        callback(error, { stdout: '', stderr: 'Error message' });
      });

      try {
        await getBeadsReady();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BeadsError);
        expect((error as BeadsError).command).toContain('bd ready');
      }
    });

    it('should capture stderr in error', async () => {
      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        const error: any = new Error('Command failed');
        error.stderr = 'Detailed error message';
        callback(error, { stdout: '', stderr: error.stderr });
      });

      try {
        await getBeadsReady();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BeadsError);
        expect((error as BeadsError).stderr).toBe('Detailed error message');
      }
    });

    it('should handle empty output as error', async () => {
      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: '', stderr: '' });
      });

      await expect(getBeadsReady()).rejects.toThrow(BeadsError);
      await expect(getBeadsReady()).rejects.toMatchObject({
        type: BeadsErrorType.EmptyResult
      });
    });
  });

  describe('Configuration', () => {
    it('should use custom timeout', async () => {
      const mockOutput = JSON.stringify({ ready: [], count: 0 });

      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: mockOutput, stderr: '' });
      });

      await getBeadsReady({ timeout: 20000 });

      expect(mockExecFile).toHaveBeenCalledWith(
        'bd',
        ['ready', '--json'],
        expect.objectContaining({ timeout: 20000 }),
        expect.any(Function)
      );
    });

    it('should use custom working directory', async () => {
      const mockOutput = JSON.stringify({ ready: [], count: 0 });

      mockExecFile.mockImplementation((cmd, args, options, callback: any) => {
        callback(null, { stdout: mockOutput, stderr: '' });
      });

      await getBeadsReady({ cwd: '/custom/path' });

      expect(mockExecFile).toHaveBeenCalledWith(
        'bd',
        ['ready', '--json'],
        expect.objectContaining({ cwd: '/custom/path' }),
        expect.any(Function)
      );
    });
  });
});
