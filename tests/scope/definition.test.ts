/**
 * Scope Definition Tests
 *
 * Tests scope definition extraction, validation, and combinators.
 */

import { describe, it, expect } from 'vitest';
import {
  ScopeDefinition,
  parsePhaseRange,
  normalizeTaskId,
  normalizeAgentFilters,
  matchesAgentPattern,
  extractScopeDefinition,
  getScopeSummary,
} from '../../src/scope/definition.js';

describe('Scope Definition', () => {
  describe('Phase Range Parsing', () => {
    it('should parse single number string', () => {
      const range = parsePhaseRange('1');
      expect(range).toEqual({ start: 1, end: 1 });
    });

    it('should parse range string', () => {
      const range = parsePhaseRange('1-3');
      expect(range).toEqual({ start: 1, end: 3 });
    });

    it('should parse numeric input', () => {
      const range = parsePhaseRange(5);
      expect(range).toEqual({ start: 5, end: 5 });
    });

    it('should handle whitespace', () => {
      const range = parsePhaseRange(' 2-4 ');
      expect(range).toEqual({ start: 2, end: 4 });
    });

    it('should throw on invalid range (start > end)', () => {
      expect(() => parsePhaseRange('3-1')).toThrow('start 3 > end 1');
    });

    it('should throw on negative phase', () => {
      expect(() => parsePhaseRange('-1')).toThrow('Invalid phase format');
    });

    it('should throw on zero phase', () => {
      expect(() => parsePhaseRange('0')).toThrow('must be positive');
    });

    it('should throw on invalid format', () => {
      expect(() => parsePhaseRange('abc')).toThrow('Invalid phase format');
    });

    it('should throw on invalid range format', () => {
      expect(() => parsePhaseRange('1-2-3')).toThrow('Invalid phase format');
    });
  });

  describe('Task ID Normalization', () => {
    it('should normalize valid task ID', () => {
      expect(normalizeTaskId('1.1')).toBe('1.1');
      expect(normalizeTaskId('2.3')).toBe('2.3');
      expect(normalizeTaskId('10.5')).toBe('10.5');
    });

    it('should handle whitespace', () => {
      expect(normalizeTaskId(' 1.1 ')).toBe('1.1');
    });

    it('should throw on invalid format (no dot)', () => {
      expect(() => normalizeTaskId('11')).toThrow('expected format: X.Y');
    });

    it('should throw on invalid format (letters)', () => {
      expect(() => normalizeTaskId('abc.def')).toThrow('expected format: X.Y');
    });

    it('should throw on negative numbers', () => {
      expect(() => normalizeTaskId('-1.1')).toThrow('Invalid task ID format');
    });

    it('should throw on zero phase', () => {
      expect(() => normalizeTaskId('0.1')).toThrow('must be positive');
    });

    it('should throw on zero task', () => {
      expect(() => normalizeTaskId('1.0')).toThrow('must be positive');
    });
  });

  describe('Agent Filter Normalization', () => {
    it('should convert string to array', () => {
      expect(normalizeAgentFilters('Agent1')).toEqual(['Agent1']);
    });

    it('should preserve array', () => {
      expect(normalizeAgentFilters(['Agent1', 'Agent2'])).toEqual(['Agent1', 'Agent2']);
    });

    it('should trim whitespace', () => {
      expect(normalizeAgentFilters(' Agent1 ')).toEqual(['Agent1']);
      expect(normalizeAgentFilters([' Agent1 ', ' Agent2 '])).toEqual(['Agent1', 'Agent2']);
    });

    it('should filter out empty strings', () => {
      expect(normalizeAgentFilters(['Agent1', '', '  ', 'Agent2'])).toEqual(['Agent1', 'Agent2']);
    });
  });

  describe('Agent Pattern Matching', () => {
    it('should match exact name', () => {
      expect(matchesAgentPattern('Agent_Foundation', 'Agent_Foundation')).toBe(true);
      expect(matchesAgentPattern('Agent_Foundation', 'Agent_CLI')).toBe(false);
    });

    it('should match prefix wildcard', () => {
      expect(matchesAgentPattern('Orchestration_Foundation', 'Orchestration*')).toBe(true);
      expect(matchesAgentPattern('Orchestration_CLI', 'Orchestration*')).toBe(true);
      expect(matchesAgentPattern('Manager_Agent', 'Orchestration*')).toBe(false);
    });

    it('should match suffix wildcard', () => {
      expect(matchesAgentPattern('Orchestration_CLI', '*_CLI')).toBe(true);
      expect(matchesAgentPattern('Manager_CLI', '*_CLI')).toBe(true);
      expect(matchesAgentPattern('Orchestration_Foundation', '*_CLI')).toBe(false);
    });

    it('should match contains wildcard', () => {
      expect(matchesAgentPattern('Agent_Orchestration_Foundation', '*Orchestration*')).toBe(true);
      expect(matchesAgentPattern('Orchestration_CLI', '*Orchestration*')).toBe(true);
      expect(matchesAgentPattern('Manager_Agent', '*Orchestration*')).toBe(false);
    });

    it('should match multiple wildcards', () => {
      expect(matchesAgentPattern('Agent_Orchestration_CLI', '*Orchestration*CLI')).toBe(true);
      expect(matchesAgentPattern('Agent_Orchestration_Foundation', '*Orchestration*CLI')).toBe(false);
    });
  });

  describe('Scope Definition Class', () => {
    it('should detect empty scope', () => {
      const scope = new ScopeDefinition();
      expect(scope.isEmpty()).toBe(true);
    });

    it('should detect non-empty scope with phase', () => {
      const scope = new ScopeDefinition({ phaseRange: { start: 1, end: 3 } });
      expect(scope.isEmpty()).toBe(false);
    });

    it('should detect non-empty scope with tasks', () => {
      const scope = new ScopeDefinition({ taskList: ['1.1'] });
      expect(scope.isEmpty()).toBe(false);
    });

    it('should generate correct toString for phase range', () => {
      const scope = new ScopeDefinition({ phaseRange: { start: 1, end: 1 } });
      expect(scope.toString()).toBe('Phase 1');
    });

    it('should generate correct toString for phase range (multiple)', () => {
      const scope = new ScopeDefinition({ phaseRange: { start: 1, end: 3 } });
      expect(scope.toString()).toBe('Phases 1-3');
    });

    it('should generate correct toString for all fields', () => {
      const scope = new ScopeDefinition({
        phaseRange: { start: 1, end: 2 },
        taskList: ['1.1', '1.2'],
        agentFilters: ['Orchestration*'],
        tags: ['backend'],
      });

      const str = scope.toString();
      expect(str).toContain('Phases 1-2');
      expect(str).toContain('Tasks [1.1, 1.2]');
      expect(str).toContain('Agents matching [Orchestration*]');
      expect(str).toContain('Tags [backend]');
    });

    it('should return "Empty scope" for empty scope', () => {
      const scope = new ScopeDefinition();
      expect(scope.toString()).toBe('Empty scope');
    });
  });

  describe('Scope Combinators', () => {
    it('should union phase ranges', () => {
      const scope1 = new ScopeDefinition({ phaseRange: { start: 1, end: 2 } });
      const scope2 = new ScopeDefinition({ phaseRange: { start: 2, end: 3 } });
      const union = scope1.union(scope2);

      expect(union.phaseRange).toEqual({ start: 1, end: 3 });
    });

    it('should union task lists', () => {
      const scope1 = new ScopeDefinition({ taskList: ['1.1', '1.2'] });
      const scope2 = new ScopeDefinition({ taskList: ['1.2', '2.3'] });
      const union = scope1.union(scope2);

      expect(union.taskList).toEqual(['1.1', '1.2', '2.3']);
    });

    it('should union agent filters', () => {
      const scope1 = new ScopeDefinition({ agentFilters: ['Agent1'] });
      const scope2 = new ScopeDefinition({ agentFilters: ['Agent2'] });
      const union = scope1.union(scope2);

      expect(union.agentFilters).toEqual(['Agent1', 'Agent2']);
    });

    it('should intersect phase ranges', () => {
      const scope1 = new ScopeDefinition({ phaseRange: { start: 1, end: 3 } });
      const scope2 = new ScopeDefinition({ phaseRange: { start: 2, end: 4 } });
      const intersect = scope1.intersect(scope2);

      expect(intersect.phaseRange).toEqual({ start: 2, end: 3 });
    });

    it('should intersect task lists', () => {
      const scope1 = new ScopeDefinition({ taskList: ['1.1', '1.2', '2.1'] });
      const scope2 = new ScopeDefinition({ taskList: ['1.2', '2.1', '2.3'] });
      const intersect = scope1.intersect(scope2);

      expect(intersect.taskList).toEqual(['1.2', '2.1']);
    });

    it('should combine agent filters on intersection', () => {
      const scope1 = new ScopeDefinition({ agentFilters: ['Agent1'] });
      const scope2 = new ScopeDefinition({ agentFilters: ['Agent2'] });
      const intersect = scope1.intersect(scope2);

      expect(intersect.agentFilters).toEqual(['Agent1', 'Agent2']);
    });

    it('should handle non-overlapping phase ranges', () => {
      const scope1 = new ScopeDefinition({ phaseRange: { start: 1, end: 2 } });
      const scope2 = new ScopeDefinition({ phaseRange: { start: 3, end: 4 } });
      const intersect = scope1.intersect(scope2);

      expect(intersect.phaseRange).toBeUndefined();
    });
  });

  describe('Extract Scope Definition', () => {
    it('should extract complete scope', () => {
      const frontmatter = {
        phase: '1-3',
        tasks: ['1.1', '1.2'],
        agents: 'Orchestration*',
        tags: ['backend'],
      };

      const scope = extractScopeDefinition(frontmatter);

      expect(scope.phaseRange).toEqual({ start: 1, end: 3 });
      expect(scope.taskList).toEqual(['1.1', '1.2']);
      expect(scope.agentFilters).toEqual(['Orchestration*']);
      expect(scope.tags).toEqual(['backend']);
    });

    it('should extract numeric phase', () => {
      const frontmatter = { phase: 2 };
      const scope = extractScopeDefinition(frontmatter);

      expect(scope.phaseRange).toEqual({ start: 2, end: 2 });
    });

    it('should normalize agent array', () => {
      const frontmatter = { agents: ['Agent1', 'Agent2'] };
      const scope = extractScopeDefinition(frontmatter);

      expect(scope.agentFilters).toEqual(['Agent1', 'Agent2']);
    });

    it('should throw on invalid phase', () => {
      const frontmatter = { phase: 'invalid' };

      expect(() => extractScopeDefinition(frontmatter)).toThrow('Scope extraction failed');
    });

    it('should throw on invalid task ID', () => {
      const frontmatter = { tasks: ['invalid'] };

      expect(() => extractScopeDefinition(frontmatter)).toThrow('Scope extraction failed');
    });
  });

  describe('Get Scope Summary', () => {
    it('should generate summary for empty scope', () => {
      const scope = new ScopeDefinition();
      expect(getScopeSummary(scope)).toBe('No scope filters defined (will process all tasks)');
    });

    it('should generate summary for non-empty scope', () => {
      const scope = new ScopeDefinition({
        phaseRange: { start: 1, end: 3 },
        taskList: ['1.1'],
      });

      const summary = getScopeSummary(scope);
      expect(summary).toContain('Phases 1-3');
      expect(summary).toContain('Tasks [1.1]');
    });
  });
});
