/**
 * Prompt Generator Tests
 * Tests for Task Assignment Prompt generation
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  PromptGenerator,
  createPromptGenerator,
  type PromptGeneratorConfig,
  type ExecutionType,
} from '../../src/orchestration/prompt-generator.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const TEMPLATES_DIR = path.join(__dirname, '../../templates');
const TEST_DATA_DIR = path.join(__dirname, '../test-data/orchestration');
const IMPLEMENTATION_PLAN_PATH = path.join(__dirname, '../../.apm/Implementation_Plan.md');

describe('PromptGenerator', () => {
  let generator: PromptGenerator;
  let config: PromptGeneratorConfig;

  beforeAll(async () => {
    // Ensure test data directory exists
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
  });

  beforeEach(async () => {
    config = {
      implementationPlanPath: IMPLEMENTATION_PLAN_PATH,
      templatesPath: TEMPLATES_DIR,
      memoryBasePath: '.apm/Memory',
    };

    generator = createPromptGenerator(config);
    await generator.initialize();
  });

  describe('Initialization', () => {
    it('should create PromptGenerator instance', () => {
      expect(generator).toBeInstanceOf(PromptGenerator);
    });

    it('should load templates during initialization', async () => {
      const newGenerator = createPromptGenerator(config);
      await newGenerator.initialize();
      // If initialization succeeds, templates are loaded
      expect(newGenerator).toBeDefined();
    });

    it('should throw error if generateTaskPrompt called before initialization', async () => {
      const uninitializedGenerator = createPromptGenerator(config);
      await expect(uninitializedGenerator.generateTaskPrompt('4.1')).rejects.toThrow(
        'Prompt generator not initialized'
      );
    });
  });

  describe('generateTaskPrompt()', () => {
    it('should generate prompt for simple task', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      expect(result.taskRef).toBe('Task 4.1 - Claude Code Agent Spawning');
      expect(result.agentAssignment).toBe('Agent_Orchestration_Automation');
      expect(result.executionType).toBeDefined();
      expect(result.dependencyContext).toBeDefined();
      expect(result.memoryLogPath).toContain('.apm/Memory/Phase_04_');
      expect(result.prompt).toBeTruthy();
      expect(result.prompt.length).toBeGreaterThan(100);
    });

    it('should normalize task ID with "Task " prefix', async () => {
      const result = await generator.generateTaskPrompt('Task 4.1');

      expect(result.taskRef).toBe('Task 4.1 - Claude Code Agent Spawning');
    });

    it('should throw error for non-existent task', async () => {
      await expect(generator.generateTaskPrompt('99.99')).rejects.toThrow(
        'Task 99.99 not found in Implementation Plan'
      );
    });

    it('should include YAML frontmatter', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      expect(result.prompt).toMatch(/^---\n/);
      expect(result.prompt).toContain('task_ref:');
      expect(result.prompt).toContain('agent_assignment:');
      expect(result.prompt).toContain('memory_log_path:');
      expect(result.prompt).toContain('execution_type:');
      expect(result.prompt).toContain('dependency_context:');
      expect(result.prompt).toContain('ad_hoc_delegation: false');
    });

    it('should not have unreplaced template variables', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      // Check for remaining {{VARIABLE}} patterns
      expect(result.prompt).not.toMatch(/{{[A-Z_]+}}/);
    });

    it('should include task ID in prompt', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      expect(result.prompt).toContain('Task 4.1');
    });

    it('should include task objective in prompt', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      // Should include the objective text
      expect(result.prompt).toContain('Claude Code Agent Spawning');
    });

    it('should include phase information', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      expect(result.prompt).toContain('- **Phase**: 4');
      expect(result.prompt).toContain('Agent Automation');
    });
  });

  describe('Execution Type Detection', () => {
    it('should detect multi-step execution type', async () => {
      // Task 1.1 has numbered subtasks
      const result = await generator.generateTaskPrompt('1.1');

      expect(result.executionType).toBe('multi-step');
    });

    it('should detect single-step execution type for tasks without numbered list', async () => {
      // Need to find a task without numbered subtasks
      // Let's check what we get for task 1.3 which has bullet format
      const result = await generator.generateTaskPrompt('1.3');

      // Task 1.3 has bullet points without numbers, so should be single-step
      expect(result.executionType).toBe('single-step');
    });

    it('should include execution_type in frontmatter', async () => {
      const result = await generator.generateTaskPrompt('1.1');

      expect(result.prompt).toContain(`execution_type: "${result.executionType}"`);
    });
  });

  describe('Dependency Parsing', () => {
    it('should parse simple dependency', async () => {
      // Task 1.1 depends on Task 1.3
      const result = await generator.generateTaskPrompt('1.1');

      expect(result.prompt).toContain('Dependencies');
      expect(result.prompt).toContain('Task 1.3');
    });

    it('should detect no dependencies for independent tasks', async () => {
      // Task 1.3 has no dependencies (it's the type definitions)
      const result = await generator.generateTaskPrompt('1.3');

      expect(result.dependencyContext).toBe(false);
      expect(result.prompt).toContain('Dependencies');
      expect(result.prompt).toContain('None');
    });

    it('should parse cross-agent dependency', async () => {
      // Task 2.3 depends on Task 1.1 Output by Agent_Orchestration_Foundation
      const result = await generator.generateTaskPrompt('2.3');

      expect(result.dependencyContext).toBe(true);
    });

    it('should set dependency_context to true for cross-agent deps', async () => {
      const result = await generator.generateTaskPrompt('2.3');

      expect(result.prompt).toContain('dependency_context: true');
    });

    it('should set dependency_context to false for same-agent deps', async () => {
      const result = await generator.generateTaskPrompt('1.3');

      expect(result.prompt).toContain('dependency_context: false');
    });
  });

  describe('Memory Log Path Construction', () => {
    it('should construct memory log path with phase directory', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      expect(result.memoryLogPath).toMatch(/\.apm\/Memory\/Phase_\d{2}_/);
    });

    it('should construct memory log path with task filename', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      expect(result.memoryLogPath).toContain('Task_4_1_');
    });

    it('should construct memory log path with .md extension', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      expect(result.memoryLogPath).toMatch(/\.md$/);
    });

    it('should replace dots with underscores in task ID', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      expect(result.memoryLogPath).toContain('Task_4_1_');
      expect(result.memoryLogPath).not.toMatch(/Task_4\.1/);
    });

    it('should replace spaces with underscores in phase title', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      // Phase 4 is "Agent Automation"
      expect(result.memoryLogPath).toMatch(/Phase_04_Agent_Automation/);
    });

    it('should sanitize task title for filename', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      // Task title is "Claude Code Agent Spawning"
      expect(result.memoryLogPath).toContain('Claude_Code_Agent_Spawning');
    });
  });

  describe('Execution Steps Extraction', () => {
    it('should extract numbered steps for multi-step tasks', async () => {
      const result = await generator.generateTaskPrompt('1.1');

      expect(result.prompt).toContain('Execution Steps');
      // Task 1.1 has steps like "Schema Design", "Connection Manager Implementation"
      expect(result.prompt).toContain('Schema Design');
    });

    it('should extract bulleted steps for single-step tasks', async () => {
      const result = await generator.generateTaskPrompt('1.3');

      expect(result.prompt).toContain('Execution Steps');
    });

    it('should provide default step if no steps found', async () => {
      // Create a minimal test task without subtasks
      const testPlanContent = `
# Test Plan

## Phase 1: Test Phase

### Task 1.1 – Simple Task │ Agent_Test

- **Objective:** Test objective
- **Output:** Test output
- **Guidance:** No dependencies

No additional content.
`;

      const testPlanPath = path.join(TEST_DATA_DIR, 'test-plan.md');
      await fs.writeFile(testPlanPath, testPlanContent);

      const testConfig: PromptGeneratorConfig = {
        implementationPlanPath: testPlanPath,
        templatesPath: TEMPLATES_DIR,
        memoryBasePath: '.apm/Memory',
      };

      const testGenerator = createPromptGenerator(testConfig);
      await testGenerator.initialize();

      const result = await testGenerator.generateTaskPrompt('1.1');

      expect(result.prompt).toContain('Complete task as specified in Implementation Plan');

      // Cleanup
      await fs.unlink(testPlanPath);
    });
  });

  describe('Prompt Validation', () => {
    it('should validate complete prompt successfully', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      const validation = generator.validatePrompt(result.prompt);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect missing required sections', () => {
      const invalidPrompt = '# Incomplete Prompt\n\nSome content';

      const validation = generator.validatePrompt(invalidPrompt);

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors.some(e => e.includes('Missing required section'))).toBe(true);
    });

    it('should detect unreplaced template variables', () => {
      const promptWithVars = `
---
task_ref: "Test"
---

# Task {{TASK_ID}}

{{UNREPLACED_VAR}}
`;

      const validation = generator.validatePrompt(promptWithVars);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Unreplaced template variables'))).toBe(true);
    });
  });

  describe('Agent Assignment', () => {
    it('should include correct agent assignment', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      expect(result.agentAssignment).toBe('Agent_Orchestration_Automation');
      expect(result.prompt).toContain('Agent_Orchestration_Automation');
    });

    it('should handle different agent types', async () => {
      // Task 1.1 is assigned to Agent_Orchestration_Foundation
      const result = await generator.generateTaskPrompt('1.1');

      expect(result.agentAssignment).toBe('Agent_Orchestration_Foundation');
    });
  });

  describe('Complete Prompt Structure', () => {
    it('should generate well-formed prompt with all sections', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      // Check for all major sections
      expect(result.prompt).toContain('APM Task Assignment');
      expect(result.prompt).toContain('Task Reference');
      expect(result.prompt).toContain('Task Context');
      expect(result.prompt).toContain('Dependencies');
      expect(result.prompt).toContain('Objective');
      expect(result.prompt).toContain('Expected Outputs');
      expect(result.prompt).toContain('Execution Steps');
      expect(result.prompt).toContain('Instructions');
      expect(result.prompt).toContain('Memory Logging');
    });

    it('should include quality gates checklist', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      expect(result.prompt).toContain('Quality Gates');
      expect(result.prompt).toContain('[ ]');
    });

    it('should include TDD instructions', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      expect(result.prompt).toContain('Test-Driven Development');
      expect(result.prompt).toContain('80%+ code coverage');
    });

    it('should include memory log path in multiple locations', async () => {
      const result = await generator.generateTaskPrompt('4.1');

      // Memory log path should appear in:
      // 1. Frontmatter
      expect(result.prompt).toContain(`memory_log_path: "${result.memoryLogPath}"`);

      // 2. Instructions section
      const instructionsMatch = result.prompt.match(/Log all work in: (.+\.md)/);
      expect(instructionsMatch).toBeTruthy();

      // 3. Memory Logging section
      const memoryLoggingMatch = result.prompt.match(/you \*\*MUST\*\* log work in: (.+\.md)/);
      expect(memoryLoggingMatch).toBeTruthy();
    });
  });

  describe('createPromptGenerator()', () => {
    it('should create PromptGenerator instance', () => {
      const newGenerator = createPromptGenerator(config);
      expect(newGenerator).toBeInstanceOf(PromptGenerator);
    });
  });
});
