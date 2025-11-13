/**
 * Task Assignment Prompt Generator
 *
 * Generates comprehensive Task Assignment Prompts for Implementation agents
 * by combining Implementation Plan task metadata with prompt templates.
 */

import fs from 'fs/promises';
import path from 'path';
import {
  PromptTemplateEngine,
  createPromptTemplateEngine,
  type TaskContext,
} from '../spawn/prompt-templates.js';
import {
  parseImplementationPlan,
  type TaskMetadata,
  type ImplementationPlan,
} from '../scope/filter.js';

/**
 * Execution type for task
 */
export type ExecutionType = 'single-step' | 'multi-step';

/**
 * Task assignment prompt with metadata
 */
export interface TaskAssignmentPrompt {
  /** Task reference */
  taskRef: string;
  /** Agent assignment */
  agentAssignment: string;
  /** Memory log path */
  memoryLogPath: string;
  /** Execution type */
  executionType: ExecutionType;
  /** Has cross-agent dependencies */
  dependencyContext: boolean;
  /** Full rendered prompt markdown */
  prompt: string;
}

/**
 * Dependency information with agent context
 */
export interface DependencyInfo {
  taskId: string;
  agentAssignment?: string;
}

/**
 * Prompt Generator Configuration
 */
export interface PromptGeneratorConfig {
  /** Path to Implementation Plan file */
  implementationPlanPath: string;
  /** Path to templates directory */
  templatesPath: string;
  /** Base path for memory logs */
  memoryBasePath: string;
}

/**
 * Prompt Generator
 * Generates Task Assignment Prompts from Implementation Plan
 */
export class PromptGenerator {
  private templateEngine: PromptTemplateEngine;
  private config: PromptGeneratorConfig;
  private plan: ImplementationPlan | null = null;

  constructor(config: PromptGeneratorConfig) {
    this.config = config;
    this.templateEngine = createPromptTemplateEngine();
  }

  /**
   * Initialize the generator by loading templates and Implementation Plan
   */
  async initialize(): Promise<void> {
    // Load templates
    await this.templateEngine.loadTemplates(this.config.templatesPath);

    // Load and parse Implementation Plan
    const planContent = await fs.readFile(this.config.implementationPlanPath, 'utf-8');
    this.plan = parseImplementationPlan(planContent);
  }

  /**
   * Generate Task Assignment Prompt for a specific task
   *
   * @param taskId - Task ID (e.g., "4.1" or "Task 4.1")
   * @returns Task Assignment Prompt with metadata
   */
  async generateTaskPrompt(taskId: string): Promise<TaskAssignmentPrompt> {
    if (!this.plan) {
      throw new Error('Prompt generator not initialized. Call initialize() first.');
    }

    // Normalize task ID (remove "Task " prefix if present)
    const normalizedTaskId = taskId.replace(/^Task\s+/, '');

    // Get task metadata from Implementation Plan
    const taskMetadata = this.plan.tasks.get(normalizedTaskId);
    if (!taskMetadata) {
      throw new Error(`Task ${normalizedTaskId} not found in Implementation Plan`);
    }

    // Determine execution type from subtasks format
    const executionType = this.determineExecutionType(taskMetadata);

    // Parse dependencies
    const dependencies = this.parseDependencies(taskMetadata);

    // Check for cross-agent dependencies
    const dependencyContext = this.hasCrossAgentDependencies(
      dependencies,
      taskMetadata.agentAssignment
    );

    // Get phase information
    const phaseInfo = this.plan.phases.find(p => p.phaseNumber === taskMetadata.phase);
    if (!phaseInfo) {
      throw new Error(`Phase ${taskMetadata.phase} not found in Implementation Plan`);
    }

    // Construct memory log path
    const memoryLogPath = this.constructMemoryLogPath(taskMetadata, phaseInfo.title);

    // Prepare template context
    const context = this.buildTaskContext(
      taskMetadata,
      phaseInfo.title,
      dependencies,
      memoryLogPath,
      executionType
    );

    // Render prompt using template engine
    const renderedPrompt = this.templateEngine.renderPrompt('implementation-agent-v1', context);

    // Add YAML frontmatter
    const promptWithFrontmatter = this.addFrontmatter({
      taskRef: `Task ${normalizedTaskId} - ${taskMetadata.title}`,
      agentAssignment: taskMetadata.agentAssignment,
      memoryLogPath,
      executionType,
      dependencyContext,
      prompt: renderedPrompt,
    });

    return {
      taskRef: `Task ${normalizedTaskId} - ${taskMetadata.title}`,
      agentAssignment: taskMetadata.agentAssignment,
      memoryLogPath,
      executionType,
      dependencyContext,
      prompt: promptWithFrontmatter,
    };
  }

  /**
   * Determine execution type from task content
   */
  private determineExecutionType(taskMetadata: TaskMetadata): ExecutionType {
    const content = taskMetadata.fullContent;

    // Check for numbered list pattern (multi-step)
    // Pattern: lines starting with "1. ", "2. ", etc.
    const numberedListPattern = /^\d+\.\s+\*\*[^*]+\*\*/m;
    if (numberedListPattern.test(content)) {
      return 'multi-step';
    }

    // Otherwise it's single-step (bulleted list or simple format)
    return 'single-step';
  }

  /**
   * Parse dependencies from guidance field
   */
  private parseDependencies(taskMetadata: TaskMetadata): DependencyInfo[] {
    const dependencies: DependencyInfo[] = [];

    if (!taskMetadata.guidance) {
      return dependencies;
    }

    // Pattern: "Depends on Task X.Y Output and Task A.B Output by Agent Z"
    // Extract individual task dependencies directly
    const taskPattern = /Task\s+([\d.]+)\s+Output(?:\s+by\s+(Agent_[\w]+))?/gi;
    let taskMatch;

    while ((taskMatch = taskPattern.exec(taskMetadata.guidance)) !== null) {
      const depTaskId = taskMatch[1];
      const depAgent = taskMatch[2]; // may be undefined

      dependencies.push({
        taskId: depTaskId,
        agentAssignment: depAgent,
      });
    }

    return dependencies;
  }

  /**
   * Check if task has cross-agent dependencies
   */
  private hasCrossAgentDependencies(
    dependencies: DependencyInfo[],
    currentAgent: string
  ): boolean {
    if (!this.plan) return false;

    for (const dep of dependencies) {
      // If explicit agent specified and differs from current
      if (dep.agentAssignment && dep.agentAssignment !== currentAgent) {
        return true;
      }

      // If no explicit agent, check actual agent assignment from plan
      const depTask = this.plan.tasks.get(dep.taskId);
      if (depTask && depTask.agentAssignment !== currentAgent) {
        return true;
      }
    }

    return false;
  }

  /**
   * Construct memory log path
   */
  private constructMemoryLogPath(taskMetadata: TaskMetadata, phaseTitle: string): string {
    // Convert phase title to directory name (replace spaces with underscores)
    const phaseDirName = phaseTitle.replace(/\s+/g, '_');

    // Convert task ID to filename (replace dots with underscores)
    const taskFileName = taskMetadata.taskId.replace(/\./g, '_');

    // Convert task title to filename-safe format
    const titleSlug = taskMetadata.title
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '_')
      .replace(/-+/g, '_');

    const phaseNumber = String(taskMetadata.phase).padStart(2, '0');

    return `${this.config.memoryBasePath}/Phase_${phaseNumber}_${phaseDirName}/Task_${taskFileName}_${titleSlug}.md`;
  }

  /**
   * Build template context from task metadata
   */
  private buildTaskContext(
    taskMetadata: TaskMetadata,
    phaseTitle: string,
    dependencies: DependencyInfo[],
    memoryLogPath: string,
    executionType: ExecutionType
  ): TaskContext {
    // Format dependencies
    const dependenciesText = this.formatDependencies(dependencies);

    // Extract execution steps from task content
    const executionSteps = this.extractExecutionSteps(taskMetadata, executionType);

    return {
      taskId: taskMetadata.taskId,
      taskObjective: taskMetadata.objective || taskMetadata.title,
      phaseNumber: String(taskMetadata.phase),
      phaseName: phaseTitle,
      dependencies: dependenciesText.split('\n'), // Convert to array
      outputSpecs: taskMetadata.output || 'See task requirements',
      memoryLogPath,
      executionSteps,
    };
  }

  /**
   * Format dependencies for display
   */
  private formatDependencies(dependencies: DependencyInfo[]): string {
    if (dependencies.length === 0) {
      return 'None';
    }

    const lines = dependencies.map(dep => {
      if (dep.agentAssignment) {
        return `- Task ${dep.taskId} (by ${dep.agentAssignment})`;
      }
      return `- Task ${dep.taskId}`;
    });

    return lines.join('\n');
  }

  /**
   * Extract execution steps from task content
   */
  private extractExecutionSteps(
    taskMetadata: TaskMetadata,
    executionType: ExecutionType
  ): string[] {
    const content = taskMetadata.fullContent;
    const steps: string[] = [];

    // Split content into lines
    const lines = content.split('\n');

    if (executionType === 'multi-step') {
      // Extract numbered subtasks: "1. **Title:** description"
      for (const line of lines) {
        const match = line.match(/^\d+\.\s+\*\*([^*]+):\*\*\s+(.+)$/);
        if (match) {
          const title = match[1].trim();
          const description = match[2].trim();

          // Escape {{VARIABLE}} patterns that are documentation examples, not template variables
          const escapedDescription = this.escapeTemplateVariables(description);

          steps.push(`${title}: ${escapedDescription}`);
        }
      }
    } else {
      // Extract bulleted subtasks: "- description"
      let inSubtasks = false;
      for (const line of lines) {
        // Start extracting after task header
        if (line.match(/^###\s+Task/)) {
          inSubtasks = true;
          continue;
        }

        // Stop at next section marker
        if (inSubtasks && line.match(/^##/)) {
          break;
        }

        // Extract bulleted items
        if (inSubtasks && line.match(/^-\s+[^*]/)) {
          const step = line.substring(2).trim();
          if (step && !step.match(/^\*\*(?:Objective|Output|Guidance):/)) {
            // Escape {{VARIABLE}} patterns
            const escapedStep = this.escapeTemplateVariables(step);
            steps.push(escapedStep);
          }
        }
      }
    }

    // If no steps found, return a default message
    if (steps.length === 0) {
      return ['Complete task as specified in Implementation Plan'];
    }

    return steps;
  }

  /**
   * Escape template variable patterns in text
   * Converts {{VARIABLE}} to \{\{VARIABLE\}\} to prevent template engine from trying to replace them
   */
  private escapeTemplateVariables(text: string): string {
    // Replace {{VARIABLE}} with plain text representation
    // Remove the curly braces to avoid template engine errors
    return text.replace(/{{([A-Z0-9_]+)}}/g, '$1');
  }

  /**
   * Add YAML frontmatter to prompt
   */
  private addFrontmatter(data: TaskAssignmentPrompt): string {
    const frontmatter = [
      '---',
      `task_ref: "${data.taskRef}"`,
      `agent_assignment: "${data.agentAssignment}"`,
      `memory_log_path: "${data.memoryLogPath}"`,
      `execution_type: "${data.executionType}"`,
      `dependency_context: ${data.dependencyContext}`,
      `ad_hoc_delegation: false`,
      '---',
      '',
    ].join('\n');

    return frontmatter + data.prompt;
  }

  /**
   * Validate prompt completeness
   */
  validatePrompt(prompt: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for remaining template variables
    const remainingVars = prompt.match(/{{[A-Z0-9_]+}}/g);
    if (remainingVars) {
      errors.push(`Unreplaced template variables: ${remainingVars.join(', ')}`);
    }

    // Check for required sections
    const requiredSections = [
      'Task Reference',
      'Task Context',
      'Objective',
      'Expected Outputs',
      'Execution Steps',
    ];

    for (const section of requiredSections) {
      if (!prompt.includes(section)) {
        errors.push(`Missing required section: ${section}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Create a new PromptGenerator instance
 */
export function createPromptGenerator(config: PromptGeneratorConfig): PromptGenerator {
  return new PromptGenerator(config);
}
