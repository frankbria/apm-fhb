/**
 * Agent Selection Logic
 *
 * Determines which agent should execute a task based on Implementation Plan
 * assignments, checks agent availability, and provides agent capability information.
 */

import { AgentType, AgentStatus, AgentDomain, type AgentState } from '../types/agent.js';
import { type AgentPersistenceManager } from '../state/persistence.js';
import { type ImplementationPlan } from '../scope/filter.js';

/**
 * Agent information for task assignment
 */
export interface AgentInfo {
  /** Unique agent identifier */
  agentId: string;
  /** Type of agent */
  type: AgentType;
  /** Domain specialization for Implementation agents */
  domain?: AgentDomain;
  /** Current status */
  status: AgentStatus;
  /** Current task assignment (if any) */
  currentTask: string | null;
}

/**
 * Agent capabilities definition
 */
export interface AgentCapabilities {
  /** Agent type */
  type: AgentType;
  /** Supported domains (for Implementation agents) */
  supportedDomains?: AgentDomain[];
  /** Can spawn other agents */
  canSpawnAgents: boolean;
  /** Can coordinate multiple tasks */
  canCoordinate: boolean;
  /** Can execute implementation work */
  canImplement: boolean;
  /** Maximum concurrent tasks */
  maxConcurrentTasks: number;
  /** Description of capabilities */
  description: string;
}

/**
 * Agent selection criteria
 */
export interface SelectionCriteria {
  /** Required agent type */
  requiredType?: AgentType;
  /** Required domain */
  requiredDomain?: AgentDomain;
  /** Exclude agents currently assigned to tasks */
  excludeBusy?: boolean;
  /** Prefer agents with specific status */
  preferredStatus?: AgentStatus;
}

/**
 * Agent Selector Configuration
 */
export interface AgentSelectorConfig {
  /** Implementation Plan for task-agent mapping */
  implementationPlan: ImplementationPlan;
  /** Agent persistence manager for availability checks */
  persistence: AgentPersistenceManager;
}

/**
 * Agent Selector
 * Handles agent selection logic for task assignments
 */
export class AgentSelector {
  private config: AgentSelectorConfig;

  constructor(config: AgentSelectorConfig) {
    this.config = config;
  }

  /**
   * Select an agent for a specific task
   *
   * @param taskId - Task ID to select agent for
   * @param criteria - Optional selection criteria
   * @returns Agent information or null if no suitable agent found
   */
  async selectAgentForTask(
    taskId: string,
    criteria?: SelectionCriteria
  ): Promise<AgentInfo | null> {
    // Normalize task ID
    const normalizedTaskId = taskId.replace(/^Task\s+/, '');

    // Get task metadata from Implementation Plan
    const taskMetadata = this.config.implementationPlan.tasks.get(normalizedTaskId);
    if (!taskMetadata) {
      throw new Error(`Task ${normalizedTaskId} not found in Implementation Plan`);
    }

    // Determine required domain from agent assignment
    const domain = this.mapAgentAssignmentToDomain(taskMetadata.agentAssignment);

    // Build selection criteria
    const effectiveCriteria: SelectionCriteria = {
      requiredType: AgentType.Implementation,
      requiredDomain: domain,
      excludeBusy: true,
      ...criteria,
    };

    // Query available agents
    const availableAgents = await this.findAvailableAgents(effectiveCriteria);

    // Select best agent (prefer Idle, then Active with capacity)
    const selectedAgent = this.selectBestAgent(availableAgents, effectiveCriteria);

    return selectedAgent;
  }

  /**
   * Check if a specific agent is available
   *
   * @param agentId - Agent ID to check
   * @returns True if agent exists and is available
   */
  async isAgentAvailable(agentId: string): Promise<boolean> {
    try {
      const agent = await this.config.persistence.getAgentState(agentId);
      if (!agent) {
        return false;
      }

      // Available if Idle or Active (but not busy with critical work)
      return agent.status === AgentStatus.Idle || agent.status === AgentStatus.Active;
    } catch (error) {
      // If error querying agent, consider unavailable
      return false;
    }
  }

  /**
   * Get capabilities for an agent type
   *
   * @param agentType - Type of agent
   * @returns Agent capabilities
   */
  getAgentCapabilities(agentType: AgentType): AgentCapabilities {
    switch (agentType) {
      case AgentType.Manager:
        return {
          type: AgentType.Manager,
          canSpawnAgents: true,
          canCoordinate: true,
          canImplement: false,
          maxConcurrentTasks: 10,
          description:
            'Manager agent responsible for orchestration, coordination, and spawning Implementation agents',
        };

      case AgentType.Implementation:
        return {
          type: AgentType.Implementation,
          supportedDomains: Object.values(AgentDomain),
          canSpawnAgents: false,
          canCoordinate: false,
          canImplement: true,
          maxConcurrentTasks: 1,
          description: 'Implementation agent for executing specific tasks within a domain',
        };

      case AgentType.AdHoc:
        return {
          type: AgentType.AdHoc,
          canSpawnAgents: false,
          canCoordinate: false,
          canImplement: true,
          maxConcurrentTasks: 1,
          description:
            'Ad-hoc agent for temporary specialized tasks like debugging or research',
        };

      default:
        throw new Error(`Unknown agent type: ${agentType}`);
    }
  }

  /**
   * Get all available agents matching criteria
   *
   * @param criteria - Selection criteria
   * @returns Array of agent info
   */
  async findAvailableAgents(criteria: SelectionCriteria): Promise<AgentInfo[]> {
    // Get all agents from database
    const allAgents = await this.config.persistence.getAllAgents();

    // Filter based on criteria
    const filteredAgents = allAgents.filter(agent => {
      // Check type
      if (criteria.requiredType && agent.type !== criteria.requiredType) {
        return false;
      }

      // Check domain (for Implementation agents)
      if (criteria.requiredDomain) {
        const agentDomain = agent.metadata.domain;
        if (agentDomain !== criteria.requiredDomain) {
          return false;
        }
      }

      // Check status
      if (criteria.preferredStatus && agent.status !== criteria.preferredStatus) {
        return false;
      }

      // Exclude busy agents if requested
      if (criteria.excludeBusy && agent.currentTask !== null) {
        return false;
      }

      // Exclude non-available statuses
      if (
        agent.status === AgentStatus.Terminated ||
        agent.status === AgentStatus.Spawning
      ) {
        return false;
      }

      return true;
    });

    // Convert to AgentInfo
    return filteredAgents.map(agent => this.convertToAgentInfo(agent));
  }

  /**
   * Select the best agent from available options
   *
   * @param agents - Available agents
   * @param criteria - Selection criteria
   * @returns Best agent or null
   */
  private selectBestAgent(
    agents: AgentInfo[],
    criteria: SelectionCriteria
  ): AgentInfo | null {
    if (agents.length === 0) {
      return null;
    }

    // Prioritize by status: Idle > Active > Waiting
    const statusPriority = {
      [AgentStatus.Idle]: 1,
      [AgentStatus.Active]: 2,
      [AgentStatus.Waiting]: 3,
      [AgentStatus.Spawning]: 4,
      [AgentStatus.Terminated]: 5,
    };

    const sorted = agents.sort((a, b) => {
      const priorityA = statusPriority[a.status];
      const priorityB = statusPriority[b.status];
      return priorityA - priorityB;
    });

    return sorted[0];
  }

  /**
   * Map agent assignment string to AgentDomain enum
   *
   * @param assignment - Agent assignment from Implementation Plan
   * @returns AgentDomain enum value
   */
  private mapAgentAssignmentToDomain(assignment: string): AgentDomain {
    // Remove "Agent_" prefix if present
    const normalized = assignment.replace(/^Agent_/, '');

    // Map to enum
    const domainMap: Record<string, AgentDomain> = {
      Orchestration_Foundation: AgentDomain.Orchestration_Foundation,
      Orchestration_CLI: AgentDomain.Orchestration_CLI,
      Communication: AgentDomain.Communication,
      Agent_Orchestration_Automation: AgentDomain.Agent_Orchestration_Automation,
      Parallel_Execution: AgentDomain.Parallel_Execution,
      Quality_Assurance: AgentDomain.Quality_Assurance,
      Monitoring: AgentDomain.Monitoring,
      Session_Management: AgentDomain.Session_Management,
      Configuration: AgentDomain.Configuration,
      Documentation: AgentDomain.Documentation,
      General: AgentDomain.General,
    };

    const domain = domainMap[normalized];
    if (!domain) {
      throw new Error(`Unknown agent assignment: ${assignment}`);
    }

    return domain;
  }

  /**
   * Convert AgentState to AgentInfo
   *
   * @param agent - Agent state from database
   * @returns Agent info
   */
  private convertToAgentInfo(agent: AgentState): AgentInfo {
    return {
      agentId: agent.id,
      type: agent.type,
      domain: agent.metadata.domain,
      status: agent.status,
      currentTask: agent.currentTask,
    };
  }

  /**
   * Get agent assignment for a task
   *
   * @param taskId - Task ID
   * @returns Agent assignment string from Implementation Plan
   */
  getTaskAgentAssignment(taskId: string): string {
    const normalizedTaskId = taskId.replace(/^Task\s+/, '');
    const taskMetadata = this.config.implementationPlan.tasks.get(normalizedTaskId);
    if (!taskMetadata) {
      throw new Error(`Task ${normalizedTaskId} not found in Implementation Plan`);
    }
    return taskMetadata.agentAssignment;
  }

  /**
   * Get domain for a task
   *
   * @param taskId - Task ID
   * @returns AgentDomain for the task
   */
  getTaskDomain(taskId: string): AgentDomain {
    const assignment = this.getTaskAgentAssignment(taskId);
    return this.mapAgentAssignmentToDomain(assignment);
  }
}

/**
 * Create an AgentSelector instance
 */
export function createAgentSelector(config: AgentSelectorConfig): AgentSelector {
  return new AgentSelector(config);
}
