/**
 * Prompt Template Engine
 *
 * Loads and renders prompt templates for agent initialization with variable substitution.
 * Supports YAML frontmatter for template metadata and Markdown content.
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';

/**
 * Template metadata from YAML frontmatter
 */
export interface TemplateMetadata {
  /** Unique template identifier */
  templateId: string;
  /** Agent type this template is for */
  agentType: 'manager' | 'implementation' | 'adhoc';
  /** Optional description */
  description?: string;
}

/**
 * Template definition
 */
export interface TemplateDefinition {
  /** Template metadata */
  metadata: TemplateMetadata;
  /** Template content with {{VARIABLE}} placeholders */
  content: string;
  /** Extracted variable names from template */
  variables: string[];
}

/**
 * Task context for template rendering
 */
export interface TaskContext {
  /** Task ID (e.g., "4.1") */
  taskId: string;
  /** Task objective description */
  taskObjective: string;
  /** Phase number */
  phaseNumber: string;
  /** Phase name */
  phaseName: string;
  /** Array of task dependencies */
  dependencies: string[];
  /** Expected output specifications */
  outputSpecs: string;
  /** Memory log file path */
  memoryLogPath: string;
  /** Execution steps (array of instructions) */
  executionSteps: string[];
  /** Additional custom fields */
  [key: string]: string | string[];
}

/**
 * Template validation result
 */
export interface ValidationResult {
  /** Whether template is valid for given context */
  valid: boolean;
  /** Missing required variables */
  missing: string[];
}

/**
 * Template list item
 */
export interface TemplateListItem {
  /** Template ID */
  templateId: string;
  /** Agent type */
  agentType: string;
  /** Description if available */
  description?: string;
  /** File path */
  filePath: string;
}

/**
 * Prompt Template Engine
 * Manages loading, rendering, and validation of prompt templates
 */
export class PromptTemplateEngine {
  private templates: Map<string, TemplateDefinition> = new Map();
  private templatesDir: string = '';

  /**
   * Load all templates from a directory
   * 
   * @param templatesDir - Directory containing template .md files
   */
  async loadTemplates(templatesDir: string): Promise<void> {
    this.templatesDir = templatesDir;
    this.templates.clear();

    try {
      // Read directory
      const files = await fs.readdir(templatesDir);

      // Filter for .md files
      const mdFiles = files.filter(file => file.endsWith('.md'));

      // Load each template (skip files that fail to load)
      for (const file of mdFiles) {
        const filePath = path.join(templatesDir, file);
        try {
          await this.loadTemplate(filePath);
        } catch (error) {
          // Skip files that can't be loaded (e.g., README.md without proper frontmatter)
          continue;
        }
      }
    } catch (error) {
      throw new Error(`Failed to load templates from ${templatesDir}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Load a single template file
   */
  private async loadTemplate(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Parse frontmatter
      const parsed = matter(content);
      const metadata = parsed.data as TemplateMetadata;

      // Validate metadata
      if (!metadata.templateId) {
        throw new Error(`Template ${filePath} missing required field: templateId`);
      }
      if (!metadata.agentType) {
        throw new Error(`Template ${filePath} missing required field: agentType`);
      }

      // Extract variables from template content (trim to remove leading newline)
      const templateContent = parsed.content.trim();
      const variables = this.extractVariables(templateContent);

      // Create template definition
      const definition: TemplateDefinition = {
        metadata,
        content: templateContent,
        variables,
      };

      // Store template
      this.templates.set(metadata.templateId, definition);
    } catch (error) {
      throw new Error(`Failed to load template ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract variable names from template content
   * Variables are in format {{VARIABLE_NAME}}
   */
  private extractVariables(content: string): string[] {
    const variablePattern = /{{([A-Z0-9_]+)}}/g;
    const variables = new Set<string>();
    let match;

    while ((match = variablePattern.exec(content)) !== null) {
      variables.add(match[1]);
    }

    return Array.from(variables);
  }

  /**
   * Render a prompt from a template
   * 
   * @param templateId - Template identifier
   * @param context - Context data for variable substitution
   * @returns Rendered prompt with all variables replaced
   */
  renderPrompt(templateId: string, context: TaskContext): string {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Start with template content
    let rendered = template.content;

    // Replace each variable
    for (const variable of template.variables) {
      const value = this.getContextValue(context, variable);
      
      // Replace all occurrences of {{VARIABLE}}
      const placeholder = `{{${variable}}}`;
      rendered = rendered.split(placeholder).join(value);
    }

    // Validate no placeholders remain
    const remainingPlaceholders = /{{[A-Z0-9_]+}}/g.exec(rendered);
    if (remainingPlaceholders) {
      throw new Error(`Template rendering incomplete. Remaining placeholders: ${remainingPlaceholders[0]}`);
    }

    return rendered;
  }

  /**
   * Get context value for a variable
   */
  private getContextValue(context: TaskContext, variable: string): string {
    // Convert SNAKE_CASE variable to camelCase for context lookup
    // e.g., "TASK_ID" -> "taskId", "PHASE_NUMBER" -> "phaseNumber", "VAR_1" -> "var1"
    const camelCase = variable.toLowerCase().replace(/_([a-z0-9])/g, (_, char) =>
      /[a-z]/.test(char) ? char.toUpperCase() : char
    );

    if (context[camelCase] !== undefined) {
      const value = context[camelCase];

      // Handle arrays (join with newlines)
      if (Array.isArray(value)) {
        return value.join('\n');
      }

      return String(value);
    }

    // Also check for exact match (case-insensitive)
    for (const key of Object.keys(context)) {
      if (key.toUpperCase() === variable) {
        const value = context[key];

        // Handle arrays (join with newlines)
        if (Array.isArray(value)) {
          return value.join('\n');
        }

        return String(value);
      }
    }

    // Not found
    throw new Error(`Context missing required variable: ${variable}`);
  }

  /**
   * Validate that a template can be rendered with given context
   * 
   * @param templateId - Template identifier
   * @param context - Context data to validate
   * @returns Validation result with missing variables
   */
  validateTemplate(templateId: string, context: TaskContext): ValidationResult {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const missing: string[] = [];

    // Check each required variable
    for (const variable of template.variables) {
      try {
        this.getContextValue(context, variable);
      } catch {
        missing.push(variable);
      }
    }

    return {
      valid: missing.length === 0,
      missing,
    };
  }

  /**
   * List all available templates
   * 
   * @returns Array of template metadata
   */
  listTemplates(): TemplateListItem[] {
    const templates: TemplateListItem[] = [];

    for (const [templateId, definition] of this.templates.entries()) {
      templates.push({
        templateId,
        agentType: definition.metadata.agentType,
        description: definition.metadata.description,
        filePath: path.join(this.templatesDir, `${templateId}.md`),
      });
    }

    return templates;
  }

  /**
   * Check if a template exists
   */
  hasTemplate(templateId: string): boolean {
    return this.templates.has(templateId);
  }

  /**
   * Get template definition
   */
  getTemplate(templateId: string): TemplateDefinition | undefined {
    const template = this.templates.get(templateId);
    return template ? { ...template } : undefined;
  }
}

/**
 * Create a new PromptTemplateEngine instance
 */
export function createPromptTemplateEngine(): PromptTemplateEngine {
  return new PromptTemplateEngine();
}
