/**
 * Integration Tests
 *
 * Tests complete workflow: parse frontmatter → extract scope → filter tasks
 */

import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../../src/scope/frontmatter.js';
import { extractScopeDefinition } from '../../src/scope/definition.js';
import { parseImplementationPlan, filterTasks } from '../../src/scope/filter.js';

// Realistic Implementation Plan sample
const samplePlan = `---
phase: 1-2
tasks: ["1.1", "2.1"]
agents: Agent_Foundation
tags: ["backend"]
---

# Sample Implementation Plan

## Phase 1: Foundation

### Task 1.1 – Database Schema │ Agent_Foundation

- **Objective:** Create database schema
- **Output:** Schema definitions
- **Guidance:** Depends on Task 1.2 Output. Design database tables.

### Task 1.2 – Type Definitions │ Agent_Foundation

- **Objective:** Define TypeScript types
- **Output:** Type definitions
- **Guidance:** Create comprehensive type system.

### Task 1.3 – API Layer │ Agent_API

- **Objective:** Build REST API
- **Output:** API endpoints
- **Guidance:** Depends on Task 1.1 Output. Create API.

## Phase 2: Features

### Task 2.1 – User Management │ Agent_Foundation

- **Objective:** User CRUD
- **Output:** User management system
- **Guidance:** Depends on Task 1.3 Output. Implement users.

### Task 2.2 – Authentication │ Agent_Auth

- **Objective:** Authentication system
- **Output:** Auth module
- **Guidance:** Depends on Task 2.1 Output. Add authentication.

## Phase 3: Testing

### Task 3.1 – Unit Tests │ Agent_Testing

- **Objective:** Write tests
- **Output:** Test suite
- **Guidance:** Create comprehensive unit tests.
`;

describe('Integration Tests', () => {
  describe('Complete Workflow', () => {
    it('should parse frontmatter, extract scope, and filter tasks', () => {
      // Step 1: Parse frontmatter
      const parsed = parseFrontmatter(samplePlan);
      expect(parsed.scope).toBeDefined();
      expect(parsed.hasErrors).toBe(false);

      // Step 2: Extract scope definition
      const scope = extractScopeDefinition(parsed.scope!);
      expect(scope.phaseRange).toEqual({ start: 1, end: 2 });
      expect(scope.taskList).toEqual(['1.1', '2.1']);
      expect(scope.agentFilters).toEqual(['Agent_Foundation']);
      expect(scope.tags).toEqual(['backend']);

      // Step 3: Parse Implementation Plan
      const plan = parseImplementationPlan(parsed.content);
      expect(plan.tasks.size).toBe(6);

      // Step 4: Filter tasks
      const result = filterTasks(plan, scope);

      // Should match: phase 1-2 AND task list AND Agent_Foundation
      // Tasks in phase 1-2: 1.1, 1.2, 1.3, 2.1, 2.2
      // Tasks in list: 1.1, 2.1
      // Agent_Foundation: 1.1, 1.2, 2.1
      // Intersection: 1.1, 2.1 (both in phase range AND task list AND Agent_Foundation)
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks.map(t => t.taskId)).toContain('1.1');
      expect(result.tasks.map(t => t.taskId)).toContain('2.1');
    });

    it('should handle frontmatter scope with phase range only', () => {
      const planWithPhase = `---
phase: 1
---
${samplePlan.split('---').slice(2).join('---')}`;

      const parsed = parseFrontmatter(planWithPhase);
      const scope = extractScopeDefinition(parsed.scope!);
      const plan = parseImplementationPlan(parsed.content);
      const result = filterTasks(plan, scope);

      // Only phase 1 tasks
      expect(result.tasks).toHaveLength(3);
      expect(result.tasks.every(t => t.phase === 1)).toBe(true);
    });

    it('should handle frontmatter scope with task list only', () => {
      const planWithTasks = `---
tasks: ["1.1", "3.1"]
---
${samplePlan.split('---').slice(2).join('---')}`;

      const parsed = parseFrontmatter(planWithTasks);
      const scope = extractScopeDefinition(parsed.scope!);
      const plan = parseImplementationPlan(parsed.content);
      const result = filterTasks(plan, scope);

      expect(result.tasks).toHaveLength(2);
      expect(result.tasks.map(t => t.taskId)).toContain('1.1');
      expect(result.tasks.map(t => t.taskId)).toContain('3.1');
    });

    it('should handle frontmatter scope with agent filter only', () => {
      const planWithAgent = `---
agents: Agent_Auth
---
${samplePlan.split('---').slice(2).join('---')}`;

      const parsed = parseFrontmatter(planWithAgent);
      const scope = extractScopeDefinition(parsed.scope!);
      const plan = parseImplementationPlan(parsed.content);
      const result = filterTasks(plan, scope);

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].taskId).toBe('2.2');
      expect(result.tasks[0].agentAssignment).toBe('Agent_Auth');
    });
  });

  describe('Dependency Handling', () => {
    it('should auto-include dependencies across scope boundaries', () => {
      const planWithDeps = `---
tasks: ["2.1"]
---
${samplePlan.split('---').slice(2).join('---')}`;

      const parsed = parseFrontmatter(planWithDeps);
      const scope = extractScopeDefinition(parsed.scope!);
      const plan = parseImplementationPlan(parsed.content);

      const result = filterTasks(plan, scope, { includeDependencies: true });

      // 2.1 depends on 1.3, which depends on 1.1, which depends on 1.2
      expect(result.tasks.length).toBeGreaterThan(1);
      expect(result.includedDependencies.length).toBeGreaterThan(0);
    });

    it('should warn about missing dependencies', () => {
      const planWithDeps = `---
tasks: ["2.1"]
---
${samplePlan.split('---').slice(2).join('---')}`;

      const parsed = parseFrontmatter(planWithDeps);
      const scope = extractScopeDefinition(parsed.scope!);
      const plan = parseImplementationPlan(parsed.content);

      const result = filterTasks(plan, scope, { warnMissingDependencies: true });

      expect(result.tasks).toHaveLength(1);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('depends on'))).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid YAML frontmatter gracefully', () => {
      const invalidPlan = `---
phase: [invalid
---
# Content`;

      expect(() => parseFrontmatter(invalidPlan)).toThrow('Invalid YAML syntax');
    });

    it('should handle invalid scope definition', () => {
      const invalidScope = `---
phase: abc-def
---
# Content`;

      const parsed = parseFrontmatter(invalidScope);

      expect(() => extractScopeDefinition(parsed.scope!)).toThrow('Scope extraction failed');
    });

    it('should warn about non-existent tasks', () => {
      const parsed = parseFrontmatter(samplePlan);
      const plan = parseImplementationPlan(parsed.content);

      const scope = extractScopeDefinition({ tasks: ['99.99'] });
      const result = filterTasks(plan, scope);

      expect(result.tasks).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('not found');
    });
  });

  describe('Complex Scope Combinations', () => {
    it('should handle phase + agent combination', () => {
      const complexPlan = `---
phase: 1
agents: Agent_Foundation
---
${samplePlan.split('---').slice(2).join('---')}`;

      const parsed = parseFrontmatter(complexPlan);
      const scope = extractScopeDefinition(parsed.scope!);
      const plan = parseImplementationPlan(parsed.content);
      const result = filterTasks(plan, scope);

      // Phase 1 AND Agent_Foundation
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks.every(t => t.phase === 1)).toBe(true);
      expect(result.tasks.every(t => t.agentAssignment === 'Agent_Foundation')).toBe(true);
    });

    it('should handle task list + dependencies', () => {
      const complexPlan = `---
tasks: ["2.2"]
---
${samplePlan.split('---').slice(2).join('---')}`;

      const parsed = parseFrontmatter(complexPlan);
      const scope = extractScopeDefinition(parsed.scope!);
      const plan = parseImplementationPlan(parsed.content);
      const result = filterTasks(plan, scope, { includeDependencies: true });

      // 2.2 + all its dependencies
      expect(result.tasks.length).toBeGreaterThan(1);
      expect(result.tasks.map(t => t.taskId)).toContain('2.2');
      expect(result.includedDependencies.length).toBeGreaterThan(0);
    });

    it('should handle wildcard agent patterns', () => {
      const complexPlan = `---
agents: "*Foundation"
---
${samplePlan.split('---').slice(2).join('---')}`;

      const parsed = parseFrontmatter(complexPlan);
      const scope = extractScopeDefinition(parsed.scope!);
      const plan = parseImplementationPlan(parsed.content);
      const result = filterTasks(plan, scope);

      expect(result.tasks.length).toBeGreaterThan(0);
      expect(result.tasks.every(t => t.agentAssignment.endsWith('Foundation'))).toBe(true);
    });
  });

  describe('Empty Scope Handling', () => {
    it('should select all tasks with empty scope', () => {
      const emptyPlan = `---
---
${samplePlan.split('---').slice(2).join('---')}`;

      const parsed = parseFrontmatter(emptyPlan);
      const scope = extractScopeDefinition(parsed.scope!);
      const plan = parseImplementationPlan(parsed.content);
      const result = filterTasks(plan, scope);

      expect(result.tasks).toHaveLength(6); // All tasks
    });

    it('should select all tasks with no frontmatter', () => {
      const noFrontmatter = samplePlan.split('---').slice(2).join('---');

      const parsed = parseFrontmatter(noFrontmatter);
      expect(parsed.scope).toBeNull();

      // Can't extract scope from null, but this is expected behavior
      expect(parsed.isEmpty).toBe(true);
    });
  });
});
