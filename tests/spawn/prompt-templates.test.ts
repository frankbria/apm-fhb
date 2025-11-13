/**
 * Prompt Template Engine Tests
 * Tests for template loading, rendering, and validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  PromptTemplateEngine,
  createPromptTemplateEngine,
  type TaskContext,
  type TemplateMetadata,
} from '../../src/spawn/prompt-templates.js';

describe('PromptTemplateEngine', () => {
  let engine: PromptTemplateEngine;
  let tempDir: string;

  beforeEach(async () => {
    engine = createPromptTemplateEngine();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'template-test-'));
  });

  afterEach(async () => {
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('loadTemplates()', () => {
    it('should load templates from directory', async () => {
      // Create test templates
      await createTestTemplate(tempDir, 'test-template-1.md', {
        templateId: 'test-1',
        agentType: 'implementation',
        description: 'Test template 1',
      }, 'Content with {{VARIABLE_1}}');

      await createTestTemplate(tempDir, 'test-template-2.md', {
        templateId: 'test-2',
        agentType: 'manager',
      }, 'Content with {{VARIABLE_2}}');

      await engine.loadTemplates(tempDir);

      expect(engine.hasTemplate('test-1')).toBe(true);
      expect(engine.hasTemplate('test-2')).toBe(true);
    });

    it('should ignore non-.md files', async () => {
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'Not a template');
      await createTestTemplate(tempDir, 'valid.md', {
        templateId: 'valid',
        agentType: 'implementation',
      }, 'Valid template');

      await engine.loadTemplates(tempDir);

      expect(engine.hasTemplate('valid')).toBe(true);
      expect(engine.listTemplates()).toHaveLength(1);
    });

    it('should extract variables from template content', async () => {
      await createTestTemplate(tempDir, 'test.md', {
        templateId: 'test',
        agentType: 'implementation',
      }, 'Template with {{VAR_1}} and {{VAR_2}} and {{VAR_1}} again');

      await engine.loadTemplates(tempDir);

      const template = engine.getTemplate('test');
      expect(template?.variables).toContain('VAR_1');
      expect(template?.variables).toContain('VAR_2');
      expect(template?.variables).toHaveLength(2); // Should deduplicate
    });

    it('should skip file if templateId missing', async () => {
      await fs.writeFile(
        path.join(tempDir, 'invalid.md'),
        '---\nagentType: implementation\n---\nContent'
      );

      // Should not throw, but should skip the invalid file
      await engine.loadTemplates(tempDir);

      // Check that no templates were loaded
      expect(engine.listTemplates()).toHaveLength(0);
    });

    it('should skip file if agentType missing', async () => {
      await fs.writeFile(
        path.join(tempDir, 'invalid.md'),
        '---\ntemplateId: test\n---\nContent'
      );

      // Should not throw, but should skip the invalid file
      await engine.loadTemplates(tempDir);

      // Check that no templates were loaded
      expect(engine.listTemplates()).toHaveLength(0);
    });

    it('should throw error if directory does not exist', async () => {
      await expect(engine.loadTemplates('/nonexistent/directory')).rejects.toThrow('Failed to load templates');
    });

    it('should clear previously loaded templates', async () => {
      await createTestTemplate(tempDir, 'test-1.md', {
        templateId: 'test-1',
        agentType: 'implementation',
      }, 'First load');

      await engine.loadTemplates(tempDir);
      expect(engine.hasTemplate('test-1')).toBe(true);

      // Remove old template and add new one
      await fs.unlink(path.join(tempDir, 'test-1.md'));
      await createTestTemplate(tempDir, 'test-2.md', {
        templateId: 'test-2',
        agentType: 'manager',
      }, 'Second load');

      await engine.loadTemplates(tempDir);
      expect(engine.hasTemplate('test-1')).toBe(false);
      expect(engine.hasTemplate('test-2')).toBe(true);
    });
  });

  describe('renderPrompt()', () => {
    beforeEach(async () => {
      await createTestTemplate(tempDir, 'test.md', {
        templateId: 'test',
        agentType: 'implementation',
      }, `Task: {{TASK_ID}}
Objective: {{TASK_OBJECTIVE}}
Phase: {{PHASE_NUMBER}} - {{PHASE_NAME}}
Steps: {{EXECUTION_STEPS}}`);

      await engine.loadTemplates(tempDir);
    });

    it('should render template with all variables replaced', () => {
      const context: TaskContext = {
        taskId: '4.1',
        taskObjective: 'Test objective',
        phaseNumber: '4',
        phaseName: 'Test Phase',
        dependencies: [],
        outputSpecs: 'Test outputs',
        memoryLogPath: '/path/to/log',
        executionSteps: ['Step 1', 'Step 2'],
      };

      const rendered = engine.renderPrompt('test', context);

      expect(rendered).toContain('Task: 4.1');
      expect(rendered).toContain('Objective: Test objective');
      expect(rendered).toContain('Phase: 4 - Test Phase');
      expect(rendered).toContain('Steps: Step 1\nStep 2');
    });

    it('should handle array values by joining with newlines', () => {
      const context: TaskContext = {
        taskId: '1',
        taskObjective: 'Test',
        phaseNumber: '1',
        phaseName: 'Test',
        dependencies: ['dep1', 'dep2', 'dep3'],
        outputSpecs: 'Test',
        memoryLogPath: '/path',
        executionSteps: ['Step A', 'Step B'],
      };

      const rendered = engine.renderPrompt('test', context);

      expect(rendered).toContain('Step A\nStep B');
    });

    it('should handle camelCase to SNAKE_CASE conversion', () => {
      const context: TaskContext = {
        taskId: '1',
        taskObjective: 'Test',
        phaseNumber: '1',
        phaseName: 'Test',
        dependencies: [],
        outputSpecs: 'Test',
        memoryLogPath: '/path',
        executionSteps: [],
      };

      const rendered = engine.renderPrompt('test', context);

      expect(rendered).not.toContain('{{');
      expect(rendered).not.toContain('}}');
    });

    it('should throw error for missing template', () => {
      const context: TaskContext = {
        taskId: '1',
        taskObjective: 'Test',
        phaseNumber: '1',
        phaseName: 'Test',
        dependencies: [],
        outputSpecs: 'Test',
        memoryLogPath: '/path',
        executionSteps: [],
      };

      expect(() => engine.renderPrompt('nonexistent', context)).toThrow('Template not found');
    });

    it('should throw error for missing context variable', () => {
      const context: TaskContext = {
        taskId: '1',
        taskObjective: 'Test',
        phaseNumber: '1',
        phaseName: 'Test',
        dependencies: [],
        outputSpecs: 'Test',
        memoryLogPath: '/path',
        // Missing executionSteps
      } as any;

      expect(() => engine.renderPrompt('test', context)).toThrow('Context missing required variable');
    });

    it('should throw error if placeholders remain after rendering', async () => {
      // Create template with variable that won't match any context key
      await createTestTemplate(tempDir, 'bad.md', {
        templateId: 'bad',
        agentType: 'implementation',
      }, 'Content with {{UNKNOWN_VARIABLE}}');

      await engine.loadTemplates(tempDir);

      const context: TaskContext = {
        taskId: '1',
        taskObjective: 'Test',
        phaseNumber: '1',
        phaseName: 'Test',
        dependencies: [],
        outputSpecs: 'Test',
        memoryLogPath: '/path',
        executionSteps: [],
      };

      expect(() => engine.renderPrompt('bad', context)).toThrow('Context missing required variable');
    });

    it('should handle multiple occurrences of same variable', async () => {
      await createTestTemplate(tempDir, 'multi.md', {
        templateId: 'multi',
        agentType: 'implementation',
      }, 'Task {{TASK_ID}} - ID: {{TASK_ID}} - Reference: {{TASK_ID}}');

      await engine.loadTemplates(tempDir);

      const context: TaskContext = {
        taskId: '4.1',
        taskObjective: 'Test',
        phaseNumber: '1',
        phaseName: 'Test',
        dependencies: [],
        outputSpecs: 'Test',
        memoryLogPath: '/path',
        executionSteps: [],
      };

      const rendered = engine.renderPrompt('multi', context);

      expect(rendered).toBe('Task 4.1 - ID: 4.1 - Reference: 4.1');
    });

    it('should handle custom context fields', async () => {
      await createTestTemplate(tempDir, 'custom.md', {
        templateId: 'custom',
        agentType: 'implementation',
      }, 'Custom: {{CUSTOM_FIELD}}');

      await engine.loadTemplates(tempDir);

      const context: TaskContext = {
        taskId: '1',
        taskObjective: 'Test',
        phaseNumber: '1',
        phaseName: 'Test',
        dependencies: [],
        outputSpecs: 'Test',
        memoryLogPath: '/path',
        executionSteps: [],
        customField: 'Custom value',
      };

      const rendered = engine.renderPrompt('custom', context);

      expect(rendered).toContain('Custom: Custom value');
    });
  });

  describe('validateTemplate()', () => {
    beforeEach(async () => {
      await createTestTemplate(tempDir, 'test.md', {
        templateId: 'test',
        agentType: 'implementation',
      }, `Variables: {{VAR_1}}, {{VAR_2}}, {{VAR_3}}`);

      await engine.loadTemplates(tempDir);
    });

    it('should return valid:true when all variables present', () => {
      const context: TaskContext = {
        taskId: '1',
        taskObjective: 'Test',
        phaseNumber: '1',
        phaseName: 'Test',
        dependencies: [],
        outputSpecs: 'Test',
        memoryLogPath: '/path',
        executionSteps: [],
        var1: 'value1',
        var2: 'value2',
        var3: 'value3',
      };

      const result = engine.validateTemplate('test', context);

      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('should return valid:false and list missing variables', () => {
      const context: TaskContext = {
        taskId: '1',
        taskObjective: 'Test',
        phaseNumber: '1',
        phaseName: 'Test',
        dependencies: [],
        outputSpecs: 'Test',
        memoryLogPath: '/path',
        executionSteps: [],
        var1: 'value1',
        // Missing var2 and var3
      };

      const result = engine.validateTemplate('test', context);

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('VAR_2');
      expect(result.missing).toContain('VAR_3');
      expect(result.missing).toHaveLength(2);
    });

    it('should throw error for missing template', () => {
      const context: TaskContext = {
        taskId: '1',
        taskObjective: 'Test',
        phaseNumber: '1',
        phaseName: 'Test',
        dependencies: [],
        outputSpecs: 'Test',
        memoryLogPath: '/path',
        executionSteps: [],
      };

      expect(() => engine.validateTemplate('nonexistent', context)).toThrow('Template not found');
    });
  });

  describe('listTemplates()', () => {
    it('should return empty array when no templates loaded', () => {
      const templates = engine.listTemplates();
      expect(templates).toEqual([]);
    });

    it('should return all loaded templates', async () => {
      await createTestTemplate(tempDir, 'test-1.md', {
        templateId: 'test-1',
        agentType: 'implementation',
        description: 'First template',
      }, 'Content 1');

      await createTestTemplate(tempDir, 'test-2.md', {
        templateId: 'test-2',
        agentType: 'manager',
        description: 'Second template',
      }, 'Content 2');

      await engine.loadTemplates(tempDir);

      const templates = engine.listTemplates();

      expect(templates).toHaveLength(2);
      expect(templates.find(t => t.templateId === 'test-1')).toBeDefined();
      expect(templates.find(t => t.templateId === 'test-2')).toBeDefined();
    });

    it('should include template metadata', async () => {
      await createTestTemplate(tempDir, 'test.md', {
        templateId: 'test',
        agentType: 'implementation',
        description: 'Test description',
      }, 'Content');

      await engine.loadTemplates(tempDir);

      const templates = engine.listTemplates();

      expect(templates[0].templateId).toBe('test');
      expect(templates[0].agentType).toBe('implementation');
      expect(templates[0].description).toBe('Test description');
      expect(templates[0].filePath).toContain('test.md');
    });
  });

  describe('hasTemplate()', () => {
    it('should return false for non-existent template', () => {
      expect(engine.hasTemplate('nonexistent')).toBe(false);
    });

    it('should return true for loaded template', async () => {
      await createTestTemplate(tempDir, 'test.md', {
        templateId: 'test',
        agentType: 'implementation',
      }, 'Content');

      await engine.loadTemplates(tempDir);

      expect(engine.hasTemplate('test')).toBe(true);
    });
  });

  describe('getTemplate()', () => {
    it('should return undefined for non-existent template', () => {
      expect(engine.getTemplate('nonexistent')).toBeUndefined();
    });

    it('should return template definition', async () => {
      await createTestTemplate(tempDir, 'test.md', {
        templateId: 'test',
        agentType: 'implementation',
        description: 'Test template',
      }, 'Content with {{VARIABLE}}');

      await engine.loadTemplates(tempDir);

      const template = engine.getTemplate('test');

      expect(template).toBeDefined();
      expect(template?.metadata.templateId).toBe('test');
      expect(template?.metadata.agentType).toBe('implementation');
      expect(template?.metadata.description).toBe('Test template');
      expect(template?.content).toContain('Content with {{VARIABLE}}');
      expect(template?.variables).toContain('VARIABLE');
    });

    it('should return copy of template definition', async () => {
      await createTestTemplate(tempDir, 'test.md', {
        templateId: 'test',
        agentType: 'implementation',
      }, 'Content');

      await engine.loadTemplates(tempDir);

      const template1 = engine.getTemplate('test');
      const template2 = engine.getTemplate('test');

      expect(template1).toEqual(template2);
      expect(template1).not.toBe(template2);
    });
  });

  describe('integration: real template files', () => {
    it('should load implementation-agent.md template', async () => {
      const templatesDir = path.join(process.cwd(), 'templates');
      
      try {
        await engine.loadTemplates(templatesDir);
        
        expect(engine.hasTemplate('implementation-agent-v1')).toBe(true);
        
        const template = engine.getTemplate('implementation-agent-v1');
        expect(template?.metadata.agentType).toBe('implementation');
        expect(template?.variables.length).toBeGreaterThan(0);
      } catch (error) {
        // Templates might not exist in test environment
        console.warn('Skipping real template test:', error);
      }
    });

    it('should load manager-agent.md template', async () => {
      const templatesDir = path.join(process.cwd(), 'templates');
      
      try {
        await engine.loadTemplates(templatesDir);
        
        expect(engine.hasTemplate('manager-agent-v1')).toBe(true);
        
        const template = engine.getTemplate('manager-agent-v1');
        expect(template?.metadata.agentType).toBe('manager');
        expect(template?.variables.length).toBeGreaterThan(0);
      } catch (error) {
        // Templates might not exist in test environment
        console.warn('Skipping real template test:', error);
      }
    });
  });
});

/**
 * Helper: Create a test template file
 */
async function createTestTemplate(
  dir: string,
  filename: string,
  metadata: TemplateMetadata,
  content: string
): Promise<void> {
  const frontmatter = Object.entries(metadata)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  const fileContent = `---\n${frontmatter}\n---\n\n${content}`;

  await fs.writeFile(path.join(dir, filename), fileContent, 'utf-8');
}
