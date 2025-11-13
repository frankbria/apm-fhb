/**
 * Agent Selector Tests
 * Tests for agent selection logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AgentSelector,
  createAgentSelector,
  type AgentSelectorConfig,
  type AgentInfo,
  type SelectionCriteria,
} from '../../src/orchestration/agent-selector.js';
import { AgentType, AgentStatus, AgentDomain, type AgentState } from '../../src/types/agent.js';
import { type ImplementationPlan, type TaskMetadata } from '../../src/scope/filter.js';
import { type AgentPersistenceManager } from '../../src/state/persistence.js';

// Mock Implementation Plan
function createMockImplementationPlan(): ImplementationPlan {
  const tasks = new Map<string, TaskMetadata>();

  tasks.set('1.1', {
    taskId: '1.1',
    title: 'Database Schema Design',
    phase: 1,
    agentAssignment: 'Agent_Orchestration_Foundation',
    dependencies: [],
    objective: 'Create database schema',
    output: 'Schema files',
    guidance: 'No dependencies',
    fullContent: 'Full task content...',
  });

  tasks.set('2.1', {
    taskId: '2.1',
    title: 'CLI Structure',
    phase: 2,
    agentAssignment: 'Agent_Orchestration_CLI',
    dependencies: ['1.1'],
    objective: 'Build CLI framework',
    output: 'CLI files',
    guidance: 'Depends on Task 1.1',
    fullContent: 'Full task content...',
  });

  tasks.set('3.1', {
    taskId: '3.1',
    title: 'Communication Protocol',
    phase: 3,
    agentAssignment: 'Agent_Communication',
    dependencies: [],
    objective: 'Implement messaging',
    output: 'Protocol implementation',
    guidance: 'No dependencies',
    fullContent: 'Full task content...',
  });

  tasks.set('4.1', {
    taskId: '4.1',
    title: 'Agent Spawning',
    phase: 4,
    agentAssignment: 'Agent_Agent_Orchestration_Automation',
    dependencies: ['1.1', '3.1'],
    objective: 'Implement agent spawning',
    output: 'Spawning system',
    guidance: 'Depends on Task 1.1 and Task 3.1',
    fullContent: 'Full task content...',
  });

  return {
    tasks,
    phases: [
      { phaseNumber: 1, title: 'Foundation', totalTasks: 1 },
      { phaseNumber: 2, title: 'CLI', totalTasks: 1 },
      { phaseNumber: 3, title: 'Communication', totalTasks: 1 },
      { phaseNumber: 4, title: 'Agent Automation', totalTasks: 1 },
    ],
  };
}

// Mock agents
function createMockAgent(
  id: string,
  type: AgentType,
  status: AgentStatus,
  domain?: AgentDomain,
  currentTask?: string | null
): AgentState {
  return {
    id,
    type,
    status,
    currentTask: currentTask ?? null,
    metadata: {
      domain,
      spawnedAt: new Date(),
      lastActivityAt: new Date(),
    },
  };
}

// Mock Persistence Manager
function createMockPersistence(agents: AgentState[]): AgentPersistenceManager {
  return {
    getAgentState: vi.fn(async (agentId: string) => {
      return agents.find(a => a.id === agentId) || null;
    }),
    getAllAgents: vi.fn(async () => {
      return agents;
    }),
  } as unknown as AgentPersistenceManager;
}

describe('AgentSelector', () => {
  let selector: AgentSelector;
  let mockPlan: ImplementationPlan;
  let mockAgents: AgentState[];
  let config: AgentSelectorConfig;

  beforeEach(() => {
    mockPlan = createMockImplementationPlan();

    mockAgents = [
      createMockAgent(
        'agent_foundation_1',
        AgentType.Implementation,
        AgentStatus.Idle,
        AgentDomain.Orchestration_Foundation
      ),
      createMockAgent(
        'agent_foundation_2',
        AgentType.Implementation,
        AgentStatus.Active,
        AgentDomain.Orchestration_Foundation,
        'some_task'
      ),
      createMockAgent(
        'agent_cli_1',
        AgentType.Implementation,
        AgentStatus.Idle,
        AgentDomain.Orchestration_CLI
      ),
      createMockAgent(
        'agent_comm_1',
        AgentType.Implementation,
        AgentStatus.Waiting,
        AgentDomain.Communication
      ),
      createMockAgent('manager_1', AgentType.Manager, AgentStatus.Active),
      createMockAgent(
        'agent_terminated',
        AgentType.Implementation,
        AgentStatus.Terminated,
        AgentDomain.Orchestration_Foundation
      ),
    ];

    const mockPersistence = createMockPersistence(mockAgents);

    config = {
      implementationPlan: mockPlan,
      persistence: mockPersistence,
    };

    selector = createAgentSelector(config);
  });

  describe('Initialization', () => {
    it('should create AgentSelector instance', () => {
      expect(selector).toBeInstanceOf(AgentSelector);
    });

    it('should accept configuration', () => {
      const newSelector = createAgentSelector(config);
      expect(newSelector).toBeDefined();
    });
  });

  describe('selectAgentForTask()', () => {
    it('should select agent for task based on Implementation Plan', async () => {
      const result = await selector.selectAgentForTask('1.1');

      expect(result).toBeDefined();
      expect(result?.domain).toBe(AgentDomain.Orchestration_Foundation);
      expect(result?.type).toBe(AgentType.Implementation);
    });

    it('should normalize task ID with "Task " prefix', async () => {
      const result = await selector.selectAgentForTask('Task 1.1');

      expect(result).toBeDefined();
      expect(result?.domain).toBe(AgentDomain.Orchestration_Foundation);
    });

    it('should throw error for non-existent task', async () => {
      await expect(selector.selectAgentForTask('99.99')).rejects.toThrow(
        'Task 99.99 not found in Implementation Plan'
      );
    });

    it('should prefer Idle agents over Active agents', async () => {
      const result = await selector.selectAgentForTask('1.1');

      expect(result?.agentId).toBe('agent_foundation_1');
      expect(result?.status).toBe(AgentStatus.Idle);
    });

    it('should select agent for CLI task', async () => {
      const result = await selector.selectAgentForTask('2.1');

      expect(result?.domain).toBe(AgentDomain.Orchestration_CLI);
      expect(result?.agentId).toBe('agent_cli_1');
    });

    it('should select agent for Communication task', async () => {
      const result = await selector.selectAgentForTask('3.1');

      expect(result?.domain).toBe(AgentDomain.Communication);
      expect(result?.agentId).toBe('agent_comm_1');
    });

    it('should handle Agent_Orchestration_Automation domain', async () => {
      const result = await selector.selectAgentForTask('4.1');

      expect(result).toBeNull(); // No agent with this domain in mock
    });

    it('should exclude terminated agents', async () => {
      // Remove all agents except terminated one
      mockAgents = [
        createMockAgent(
          'agent_terminated',
          AgentType.Implementation,
          AgentStatus.Terminated,
          AgentDomain.Orchestration_Foundation
        ),
      ];

      const mockPersistence = createMockPersistence(mockAgents);
      const newConfig = { ...config, persistence: mockPersistence };
      const newSelector = createAgentSelector(newConfig);

      const result = await newSelector.selectAgentForTask('1.1');

      expect(result).toBeNull();
    });

    it('should exclude spawning agents', async () => {
      mockAgents = [
        createMockAgent(
          'agent_spawning',
          AgentType.Implementation,
          AgentStatus.Spawning,
          AgentDomain.Orchestration_Foundation
        ),
      ];

      const mockPersistence = createMockPersistence(mockAgents);
      const newConfig = { ...config, persistence: mockPersistence };
      const newSelector = createAgentSelector(newConfig);

      const result = await newSelector.selectAgentForTask('1.1');

      expect(result).toBeNull();
    });

    it('should respect custom selection criteria', async () => {
      const criteria: SelectionCriteria = {
        preferredStatus: AgentStatus.Active,
        excludeBusy: false,
      };

      const result = await selector.selectAgentForTask('1.1', criteria);

      expect(result?.status).toBe(AgentStatus.Active);
      expect(result?.agentId).toBe('agent_foundation_2');
    });
  });

  describe('isAgentAvailable()', () => {
    it('should return true for Idle agent', async () => {
      const available = await selector.isAgentAvailable('agent_foundation_1');

      expect(available).toBe(true);
    });

    it('should return true for Active agent', async () => {
      const available = await selector.isAgentAvailable('agent_foundation_2');

      expect(available).toBe(true);
    });

    it('should return false for Terminated agent', async () => {
      const available = await selector.isAgentAvailable('agent_terminated');

      expect(available).toBe(false);
    });

    it('should return false for non-existent agent', async () => {
      const available = await selector.isAgentAvailable('nonexistent');

      expect(available).toBe(false);
    });

    it('should return false for Waiting agent', async () => {
      const available = await selector.isAgentAvailable('agent_comm_1');

      expect(available).toBe(false);
    });

    it('should handle persistence errors gracefully', async () => {
      const errorPersistence = {
        getAgentState: vi.fn().mockRejectedValue(new Error('Database error')),
      } as unknown as AgentPersistenceManager;

      const errorConfig = { ...config, persistence: errorPersistence };
      const errorSelector = createAgentSelector(errorConfig);

      const available = await errorSelector.isAgentAvailable('agent_foundation_1');

      expect(available).toBe(false);
    });
  });

  describe('getAgentCapabilities()', () => {
    it('should return Manager capabilities', () => {
      const capabilities = selector.getAgentCapabilities(AgentType.Manager);

      expect(capabilities.type).toBe(AgentType.Manager);
      expect(capabilities.canSpawnAgents).toBe(true);
      expect(capabilities.canCoordinate).toBe(true);
      expect(capabilities.canImplement).toBe(false);
      expect(capabilities.maxConcurrentTasks).toBe(10);
      expect(capabilities.description).toContain('Manager agent');
    });

    it('should return Implementation capabilities', () => {
      const capabilities = selector.getAgentCapabilities(AgentType.Implementation);

      expect(capabilities.type).toBe(AgentType.Implementation);
      expect(capabilities.canSpawnAgents).toBe(false);
      expect(capabilities.canCoordinate).toBe(false);
      expect(capabilities.canImplement).toBe(true);
      expect(capabilities.maxConcurrentTasks).toBe(1);
      expect(capabilities.supportedDomains).toBeDefined();
      expect(capabilities.supportedDomains?.length).toBeGreaterThan(0);
    });

    it('should return AdHoc capabilities', () => {
      const capabilities = selector.getAgentCapabilities(AgentType.AdHoc);

      expect(capabilities.type).toBe(AgentType.AdHoc);
      expect(capabilities.canSpawnAgents).toBe(false);
      expect(capabilities.canCoordinate).toBe(false);
      expect(capabilities.canImplement).toBe(true);
      expect(capabilities.maxConcurrentTasks).toBe(1);
      expect(capabilities.description).toContain('Ad-hoc agent');
    });

    it('should throw error for unknown agent type', () => {
      expect(() => {
        selector.getAgentCapabilities('UnknownType' as AgentType);
      }).toThrow('Unknown agent type');
    });
  });

  describe('findAvailableAgents()', () => {
    it('should find all available agents', async () => {
      const agents = await selector.findAvailableAgents({});

      expect(agents.length).toBeGreaterThan(0);
      expect(agents.every(a => a.status !== AgentStatus.Terminated)).toBe(true);
      expect(agents.every(a => a.status !== AgentStatus.Spawning)).toBe(true);
    });

    it('should filter by agent type', async () => {
      const agents = await selector.findAvailableAgents({
        requiredType: AgentType.Implementation,
      });

      expect(agents.every(a => a.type === AgentType.Implementation)).toBe(true);
    });

    it('should filter by domain', async () => {
      const agents = await selector.findAvailableAgents({
        requiredDomain: AgentDomain.Orchestration_Foundation,
      });

      expect(agents.every(a => a.domain === AgentDomain.Orchestration_Foundation)).toBe(true);
      expect(agents.length).toBeGreaterThan(0);
    });

    it('should filter by preferred status', async () => {
      const agents = await selector.findAvailableAgents({
        preferredStatus: AgentStatus.Idle,
      });

      expect(agents.every(a => a.status === AgentStatus.Idle)).toBe(true);
    });

    it('should exclude busy agents when requested', async () => {
      const agents = await selector.findAvailableAgents({
        excludeBusy: true,
      });

      expect(agents.every(a => a.currentTask === null)).toBe(true);
    });

    it('should include busy agents when not excluded', async () => {
      const agents = await selector.findAvailableAgents({
        excludeBusy: false,
      });

      expect(agents.some(a => a.currentTask !== null)).toBe(true);
    });

    it('should combine multiple criteria', async () => {
      const agents = await selector.findAvailableAgents({
        requiredType: AgentType.Implementation,
        requiredDomain: AgentDomain.Orchestration_Foundation,
        excludeBusy: true,
      });

      expect(agents.every(a => a.type === AgentType.Implementation)).toBe(true);
      expect(agents.every(a => a.domain === AgentDomain.Orchestration_Foundation)).toBe(true);
      expect(agents.every(a => a.currentTask === null)).toBe(true);
    });

    it('should return empty array when no agents match criteria', async () => {
      const agents = await selector.findAvailableAgents({
        requiredDomain: AgentDomain.Documentation,
      });

      expect(agents).toEqual([]);
    });

    it('should exclude Terminated agents', async () => {
      const agents = await selector.findAvailableAgents({});

      expect(agents.every(a => a.status !== AgentStatus.Terminated)).toBe(true);
    });

    it('should exclude Spawning agents', async () => {
      const agents = await selector.findAvailableAgents({});

      expect(agents.every(a => a.status !== AgentStatus.Spawning)).toBe(true);
    });
  });

  describe('getTaskAgentAssignment()', () => {
    it('should return agent assignment for task', () => {
      const assignment = selector.getTaskAgentAssignment('1.1');

      expect(assignment).toBe('Agent_Orchestration_Foundation');
    });

    it('should normalize task ID', () => {
      const assignment = selector.getTaskAgentAssignment('Task 1.1');

      expect(assignment).toBe('Agent_Orchestration_Foundation');
    });

    it('should throw error for non-existent task', () => {
      expect(() => {
        selector.getTaskAgentAssignment('99.99');
      }).toThrow('Task 99.99 not found in Implementation Plan');
    });
  });

  describe('getTaskDomain()', () => {
    it('should return domain for task', () => {
      const domain = selector.getTaskDomain('1.1');

      expect(domain).toBe(AgentDomain.Orchestration_Foundation);
    });

    it('should handle different domain types', () => {
      const cliDomain = selector.getTaskDomain('2.1');
      const commDomain = selector.getTaskDomain('3.1');

      expect(cliDomain).toBe(AgentDomain.Orchestration_CLI);
      expect(commDomain).toBe(AgentDomain.Communication);
    });

    it('should normalize task ID', () => {
      const domain = selector.getTaskDomain('Task 1.1');

      expect(domain).toBe(AgentDomain.Orchestration_Foundation);
    });

    it('should throw error for non-existent task', () => {
      expect(() => {
        selector.getTaskDomain('99.99');
      }).toThrow('Task 99.99 not found in Implementation Plan');
    });
  });

  describe('Agent Priority Selection', () => {
    it('should prioritize Idle over Active', async () => {
      mockAgents = [
        createMockAgent(
          'agent_active',
          AgentType.Implementation,
          AgentStatus.Active,
          AgentDomain.Orchestration_Foundation,
          null
        ),
        createMockAgent(
          'agent_idle',
          AgentType.Implementation,
          AgentStatus.Idle,
          AgentDomain.Orchestration_Foundation
        ),
      ];

      const mockPersistence = createMockPersistence(mockAgents);
      const newConfig = { ...config, persistence: mockPersistence };
      const newSelector = createAgentSelector(newConfig);

      const result = await newSelector.selectAgentForTask('1.1');

      expect(result?.agentId).toBe('agent_idle');
    });

    it('should prioritize Active over Waiting', async () => {
      mockAgents = [
        createMockAgent(
          'agent_waiting',
          AgentType.Implementation,
          AgentStatus.Waiting,
          AgentDomain.Orchestration_Foundation
        ),
        createMockAgent(
          'agent_active',
          AgentType.Implementation,
          AgentStatus.Active,
          AgentDomain.Orchestration_Foundation,
          null
        ),
      ];

      const mockPersistence = createMockPersistence(mockAgents);
      const newConfig = { ...config, persistence: mockPersistence };
      const newSelector = createAgentSelector(newConfig);

      const result = await newSelector.selectAgentForTask('1.1');

      expect(result?.agentId).toBe('agent_active');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty agent list', async () => {
      const emptyPersistence = createMockPersistence([]);
      const emptyConfig = { ...config, persistence: emptyPersistence };
      const emptySelector = createAgentSelector(emptyConfig);

      const result = await emptySelector.selectAgentForTask('1.1');

      expect(result).toBeNull();
    });

    it('should handle task with no matching agents', async () => {
      // Create plan with task requiring non-existent domain
      const customPlan = createMockImplementationPlan();
      customPlan.tasks.set('5.1', {
        taskId: '5.1',
        title: 'Documentation Task',
        phase: 5,
        agentAssignment: 'Agent_Documentation',
        dependencies: [],
        objective: 'Write docs',
        output: 'Documentation',
        guidance: 'No dependencies',
        fullContent: 'Full task content...',
      });

      const customConfig = { ...config, implementationPlan: customPlan };
      const customSelector = createAgentSelector(customConfig);

      const result = await customSelector.selectAgentForTask('5.1');

      expect(result).toBeNull();
    });

    it('should handle unknown agent assignment gracefully', async () => {
      const customPlan = createMockImplementationPlan();
      customPlan.tasks.set('6.1', {
        taskId: '6.1',
        title: 'Unknown Task',
        phase: 6,
        agentAssignment: 'Agent_Unknown_Domain',
        dependencies: [],
        objective: 'Test',
        output: 'Test output',
        guidance: 'No dependencies',
        fullContent: 'Full task content...',
      });

      const customConfig = { ...config, implementationPlan: customPlan };
      const customSelector = createAgentSelector(customConfig);

      await expect(async () => {
        await customSelector.selectAgentForTask('6.1');
      }).rejects.toThrow('Unknown agent assignment');
    });
  });

  describe('createAgentSelector()', () => {
    it('should create AgentSelector instance', () => {
      const newSelector = createAgentSelector(config);
      expect(newSelector).toBeInstanceOf(AgentSelector);
    });
  });
});
