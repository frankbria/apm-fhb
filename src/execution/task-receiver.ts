/**
 * Task Receipt and Parsing
 *
 * Processes Task Assignment Prompts from Manager agent, parses YAML frontmatter
 * and markdown sections, validates required fields, initializes memory logs,
 * and loads dependency data.
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';

/**
 * Task Assignment structure
 */
export interface TaskAssignment {
  /** Task reference (e.g., "Task 4.3 - Implementation Agent Execution") */
  taskRef: string;
  /** Agent assignment (e.g., "Agent_Orchestration_Automation") */
  agentAssignment: string;
  /** Memory log file path */
  memoryLogPath: string;
  /** Execution type */
  executionType: 'single-step' | 'multi-step';
  /** Has dependency context section */
  dependencyContext: boolean;
  /** Ad-hoc delegation flag */
  adHocDelegation: boolean;
  /** Task objective (one-sentence goal) */
  objective: string;
  /** Detailed instruction steps */
  detailedInstructions: string[];
  /** Expected output description */
  expectedOutput: string;
  /** Dependency data (if dependencyContext true) */
  dependencies?: DependencyData[];
  /** Full prompt content */
  rawContent: string;
}

/**
 * Dependency data from producer tasks
 */
export interface DependencyData {
  /** Task ID (e.g., "4.2") */
  taskId: string;
  /** Memory log file path */
  memoryLogPath: string;
  /** Outputs from dependency task */
  outputs: string[];
  /** Important findings from dependency task */
  importantFindings?: string[];
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Is task assignment valid */
  valid: boolean;
  /** Validation errors */
  errors: string[];
}

/**
 * Task Receiver configuration
 */
export interface TaskReceiverConfig {
  /** Base memory path (default: .apm/Memory) */
  memoryBasePath?: string;
  /** Agent ID for memory log initialization */
  agentId: string;
}

/**
 * Task Receiver
 * Processes Task Assignment Prompts and initializes task execution
 */
export class TaskReceiver {
  private config: TaskReceiverConfig;
  private memoryBasePath: string;

  constructor(config: TaskReceiverConfig) {
    this.config = config;
    this.memoryBasePath = config.memoryBasePath ?? '.apm/Memory';
  }

  /**
   * Receive and parse Task Assignment Prompt
   *
   * @param promptContent - Full Task Assignment Prompt markdown string
   * @returns Parsed task assignment
   */
  async receiveTaskAssignment(promptContent: string): Promise<TaskAssignment> {
    // Parse YAML frontmatter and content
    const parsed = matter(promptContent);
    const frontmatter = parsed.data;
    const content = parsed.content;

    // Extract frontmatter fields
    const taskRef = frontmatter.task_ref ?? '';
    const agentAssignment = frontmatter.agent_assignment ?? '';
    const memoryLogPath = frontmatter.memory_log_path ?? '';
    const executionType = frontmatter.execution_type ?? 'multi-step';
    const dependencyContext = frontmatter.dependency_context ?? false;
    const adHocDelegation = frontmatter.ad_hoc_delegation ?? false;

    // Parse markdown sections
    const objective = this.extractSection(content, 'Objective');
    const detailedInstructions = this.extractInstructionSteps(content, executionType);
    const expectedOutput = this.extractSection(content, 'Expected Output');

    // Load dependency data if present
    let dependencies: DependencyData[] | undefined;
    if (dependencyContext) {
      dependencies = await this.loadDependencyData(content);
    }

    return {
      taskRef,
      agentAssignment,
      memoryLogPath,
      executionType,
      dependencyContext,
      adHocDelegation,
      objective,
      detailedInstructions,
      expectedOutput,
      dependencies,
      rawContent: promptContent,
    };
  }

  /**
   * Validate task assignment
   *
   * @param taskAssignment - Task assignment to validate
   * @returns Validation result
   */
  validateTaskAssignment(taskAssignment: TaskAssignment): ValidationResult {
    const errors: string[] = [];

    // Check required fields
    if (!taskAssignment.taskRef || taskAssignment.taskRef.trim() === '') {
      errors.push('Missing required field: task_ref');
    }

    if (!taskAssignment.agentAssignment || taskAssignment.agentAssignment.trim() === '') {
      errors.push('Missing required field: agent_assignment');
    }

    if (!taskAssignment.memoryLogPath || taskAssignment.memoryLogPath.trim() === '') {
      errors.push('Missing required field: memory_log_path');
    }

    // Validate memory log path format
    if (taskAssignment.memoryLogPath) {
      const pathPattern = /\.apm\/Memory\/Phase_\d+_[\w]+\/Task_[\d_]+[\w]+\.md/;
      if (!pathPattern.test(taskAssignment.memoryLogPath)) {
        errors.push(
          'Invalid memory_log_path format. Expected: .apm/Memory/Phase_XX_Name/Task_X_Y_Title.md'
        );
      }
    }

    // Validate execution type
    if (taskAssignment.executionType !== 'single-step' && taskAssignment.executionType !== 'multi-step') {
      errors.push('Invalid execution_type. Must be "single-step" or "multi-step"');
    }

    // Validate content sections
    if (!taskAssignment.objective || taskAssignment.objective.trim() === '') {
      errors.push('Missing required section: Objective');
    }

    if (!taskAssignment.detailedInstructions || taskAssignment.detailedInstructions.length === 0) {
      errors.push('Missing required section: Detailed Instructions');
    }

    if (!taskAssignment.expectedOutput || taskAssignment.expectedOutput.trim() === '') {
      errors.push('Missing required section: Expected Output');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Initialize memory log file
   *
   * @param taskAssignment - Task assignment with memory log path
   */
  async initializeMemoryLog(taskAssignment: TaskAssignment): Promise<void> {
    const { memoryLogPath, taskRef } = taskAssignment;

    // Create directory if missing
    const logDir = path.dirname(memoryLogPath);
    await fs.mkdir(logDir, { recursive: true });

    // Create memory log with YAML frontmatter and basic structure
    const memoryLogContent = `---
agent: ${this.config.agentId}
task_ref: ${taskRef}
status: InProgress
ad_hoc_delegation: ${taskAssignment.adHocDelegation}
compatibility_issues: false
important_findings: false
---

# Task Log: ${taskRef}

## Summary
[To be filled upon completion]

## Details
[Work performed, decisions made, steps taken in logical order]

## Output
[File paths for created/modified files, deliverables, and results]

## Issues
None

## Next Steps
[Follow-up actions or "None"]
`;

    await fs.writeFile(memoryLogPath, memoryLogContent, 'utf-8');
  }

  /**
   * Load dependency data from memory logs
   *
   * @param content - Task assignment content
   * @returns Dependency data array
   */
  async loadDependencyData(content: string): Promise<DependencyData[]> {
    // Extract dependency section
    const dependencySection = this.extractSection(content, 'Context from Dependencies');
    if (!dependencySection) {
      return [];
    }

    // Parse task IDs from producer output summaries
    // Look for patterns like "Task 4.2" or "Task X.Y"
    const taskIdPattern = /Task\s+([\d.]+)/gi;
    const matches = [...dependencySection.matchAll(taskIdPattern)];
    const taskIds = [...new Set(matches.map(m => m[1]))]; // Deduplicate

    // Load dependency memory logs
    const dependencies: DependencyData[] = [];
    for (const taskId of taskIds) {
      try {
        const depData = await this.loadDependencyMemoryLog(taskId);
        if (depData) {
          dependencies.push(depData);
        }
      } catch (error) {
        // Skip dependencies that can't be loaded
        continue;
      }
    }

    return dependencies;
  }

  /**
   * Load dependency memory log by task ID
   *
   * @param taskId - Task ID (e.g., "4.2")
   * @returns Dependency data or null
   */
  private async loadDependencyMemoryLog(taskId: string): Promise<DependencyData | null> {
    // Search for memory log matching task ID
    // Pattern: Task_4_2_*.md
    const [major, minor] = taskId.split('.');
    const pattern = `Task_${major}_${minor}_*.md`;

    // Search all phase directories
    const memoryDir = this.memoryBasePath;
    const phaseDirs = await fs.readdir(memoryDir);

    for (const phaseDir of phaseDirs) {
      if (!phaseDir.startsWith('Phase_')) continue;

      const phasePath = path.join(memoryDir, phaseDir);
      const stat = await fs.stat(phasePath);
      if (!stat.isDirectory()) continue;

      // Search for matching task file
      const files = await fs.readdir(phasePath);
      const taskFile = files.find(f => {
        const filePattern = pattern.replace('*', '[\\w]+');
        return new RegExp(filePattern).test(f);
      });

      if (taskFile) {
        const memoryLogPath = path.join(phasePath, taskFile);
        const content = await fs.readFile(memoryLogPath, 'utf-8');

        // Parse memory log
        const parsed = matter(content);
        const outputs = this.extractOutputs(parsed.content);
        const importantFindings = this.extractImportantFindings(parsed.content);

        return {
          taskId,
          memoryLogPath,
          outputs,
          importantFindings,
        };
      }
    }

    return null;
  }

  /**
   * Extract markdown section by heading
   *
   * @param content - Markdown content
   * @param heading - Section heading (without ##)
   * @returns Section content
   */
  private extractSection(content: string, heading: string): string {
    // Split content into lines
    const lines = content.split('\n');
    let inSection = false;
    const sectionLines: string[] = [];

    for (const line of lines) {
      // Check if this is the target heading
      if (line.match(new RegExp(`^##\\s+${heading}\\s*$`, 'i'))) {
        inSection = true;
        continue;
      }

      // Check if we've hit another level-2 heading
      if (inSection && line.match(/^##\s+/)) {
        break;
      }

      // Collect lines within the section
      if (inSection) {
        sectionLines.push(line);
      }
    }

    return sectionLines.join('\n').trim();
  }

  /**
   * Extract instruction steps based on execution type
   *
   * @param content - Markdown content
   * @param executionType - single-step or multi-step
   * @returns Instruction steps array
   */
  private extractInstructionSteps(
    content: string,
    executionType: 'single-step' | 'multi-step'
  ): string[] {
    const instructionSection = this.extractSection(content, 'Detailed Instructions');
    if (!instructionSection) {
      return [];
    }

    if (executionType === 'multi-step') {
      // Parse numbered list: "1. **Title:**" or "### Step 1:"
      const steps: string[] = [];

      // Match both "### Step N:" and "N. **Title:**" patterns at line start
      const stepPattern = /(^###\s+Step\s+\d+:[^\n]*|^\d+\.\s+\*\*[^*]+\*\*[^\n]*)/gm;
      const matches = [...instructionSection.matchAll(stepPattern)];

      if (matches.length === 0) {
        // No structured steps found, return entire section
        return [instructionSection];
      }

      for (let i = 0; i < matches.length; i++) {
        const startIndex = matches[i].index!;
        const endIndex = i < matches.length - 1 ? matches[i + 1].index! : instructionSection.length;
        const stepContent = instructionSection.substring(startIndex, endIndex).trim();
        steps.push(stepContent);
      }

      return steps;
    } else {
      // Single-step: return entire section as one step
      return [instructionSection];
    }
  }

  /**
   * Extract outputs from memory log
   *
   * @param content - Memory log content
   * @returns Output items
   */
  private extractOutputs(content: string): string[] {
    const outputSection = this.extractSection(content, 'Output');
    if (!outputSection) {
      return [];
    }

    // Parse list items (- or *)
    const lines = outputSection.split('\n');
    const outputs: string[] = [];
    let currentItem = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // Check if this is a new list item
      if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        // Save previous item if exists
        if (currentItem) {
          outputs.push(currentItem);
        }
        // Start new item
        currentItem = trimmed.substring(1).trim();
      } else if (currentItem && trimmed.length > 0) {
        // Continuation of current item
        currentItem += ' ' + trimmed;
      } else if (!currentItem && trimmed.length > 0) {
        // Non-list item, add as is
        outputs.push(trimmed);
      }
    }

    // Add last item
    if (currentItem) {
      outputs.push(currentItem);
    }

    return outputs;
  }

  /**
   * Extract important findings from memory log
   *
   * @param content - Memory log content
   * @returns Important findings
   */
  private extractImportantFindings(content: string): string[] | undefined {
    const findingsSection = this.extractSection(content, 'Important Findings');
    if (!findingsSection) {
      return undefined;
    }

    // Parse list items
    const lines = findingsSection.split('\n');
    const findings: string[] = [];
    let currentItem = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // Check if this is a new list item
      if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        // Save previous item if exists
        if (currentItem) {
          findings.push(currentItem);
        }
        // Start new item
        currentItem = trimmed.substring(1).trim();
      } else if (currentItem && trimmed.length > 0 && !trimmed.startsWith('#')) {
        // Continuation of current item
        currentItem += ' ' + trimmed;
      } else if (!currentItem && trimmed.length > 0 && !trimmed.startsWith('#')) {
        // Non-list item, add as is
        findings.push(trimmed);
      }
    }

    // Add last item
    if (currentItem) {
      findings.push(currentItem);
    }

    return findings.length > 0 ? findings : undefined;
  }
}

/**
 * Create a TaskReceiver instance
 *
 * @param config - TaskReceiver configuration
 * @returns TaskReceiver instance
 */
export function createTaskReceiver(config: TaskReceiverConfig): TaskReceiver {
  return new TaskReceiver(config);
}
