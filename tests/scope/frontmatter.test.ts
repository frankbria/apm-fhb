/**
 * Frontmatter Parser Tests
 *
 * Tests YAML frontmatter parsing, validation, and error handling.
 */

import { describe, it, expect } from 'vitest';
import { parseFrontmatter, validateParsedScope, hasScopeDefinition } from '../../src/scope/frontmatter.js';

describe('Frontmatter Parser', () => {
  describe('Valid Frontmatter Parsing', () => {
    it('should parse frontmatter with all fields', () => {
      const content = `---
phase: 1-3
tasks: ["1.1", "1.2", "2.3"]
agents: Orchestration*
tags: ["backend", "api"]
---
# Content here`;

      const result = parseFrontmatter(content);

      expect(result.scope).toBeDefined();
      expect(result.scope?.phase).toBe('1-3');
      expect(result.scope?.tasks).toEqual(['1.1', '1.2', '2.3']);
      expect(result.scope?.agents).toBe('Orchestration*');
      expect(result.scope?.tags).toEqual(['backend', 'api']);
      expect(result.content).toContain('# Content here');
      expect(result.isEmpty).toBe(false);
      expect(result.hasErrors).toBe(false);
      expect(result.errors).toHaveLength(0);
    });

    it('should parse frontmatter with single phase number', () => {
      const content = `---
phase: 1
---
# Content`;

      const result = parseFrontmatter(content);

      expect(result.scope?.phase).toBe(1);
      expect(result.isEmpty).toBe(false);
    });

    it('should parse frontmatter with agents as array', () => {
      const content = `---
agents: ["Agent1", "Agent2"]
---
# Content`;

      const result = parseFrontmatter(content);

      expect(result.scope?.agents).toEqual(['Agent1', 'Agent2']);
      expect(result.isEmpty).toBe(false);
    });

    it('should parse frontmatter with only phase field', () => {
      const content = `---
phase: 2-4
---
# Content`;

      const result = parseFrontmatter(content);

      expect(result.scope?.phase).toBe('2-4');
      expect(result.scope?.tasks).toBeUndefined();
      expect(result.scope?.agents).toBeUndefined();
      expect(result.isEmpty).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle no frontmatter', () => {
      const content = '# Just a heading\nNo frontmatter here.';

      const result = parseFrontmatter(content);

      expect(result.scope).toBeNull();
      expect(result.content).toBe(content);
      expect(result.isEmpty).toBe(true);
      expect(result.hasErrors).toBe(false);
    });

    it('should handle empty frontmatter', () => {
      const content = `---
---
# Content`;

      const result = parseFrontmatter(content);

      expect(result.scope).toEqual({});
      expect(result.isEmpty).toBe(true);
      expect(result.hasErrors).toBe(false);
    });

    it('should ignore unknown fields without error', () => {
      const content = `---
phase: 1
unknownField: value
anotherUnknown: 123
---
# Content`;

      const result = parseFrontmatter(content);

      expect(result.scope?.phase).toBe(1);
      expect(result.hasErrors).toBe(false);
      expect(result.scope).toHaveProperty('unknownField', 'value');
      expect(result.scope).toHaveProperty('anotherUnknown', 123);
    });

    it('should handle frontmatter with leading whitespace (not recognized)', () => {
      const content = `  ---
phase: 1
---
# Content`;

      const result = parseFrontmatter(content);

      // gray-matter doesn't recognize frontmatter with leading whitespace
      // This is treated as no frontmatter
      expect(result.scope).toEqual({});
      expect(result.isEmpty).toBe(true);
    });
  });

  describe('Invalid Field Types', () => {
    it('should error on invalid phase type (array)', () => {
      const content = `---
phase: ["invalid"]
---
# Content`;

      const result = parseFrontmatter(content);

      expect(result.hasErrors).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Invalid scope field \'phase\'');
      expect(result.errors[0]).toContain('expected string or number');
    });

    it('should error on invalid tasks type (non-array)', () => {
      const content = `---
tasks: "not an array"
---
# Content`;

      const result = parseFrontmatter(content);

      expect(result.hasErrors).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Invalid scope field \'tasks\'');
      expect(result.errors[0]).toContain('expected array');
    });

    it('should error on tasks array with non-string elements', () => {
      const content = `---
tasks: [1, 2, 3]
---
# Content`;

      const result = parseFrontmatter(content);

      expect(result.hasErrors).toBe(true);
      expect(result.errors[0]).toContain('all elements must be strings');
    });

    it('should error on invalid agents type (number)', () => {
      const content = `---
agents: 123
---
# Content`;

      const result = parseFrontmatter(content);

      expect(result.hasErrors).toBe(true);
      expect(result.errors[0]).toContain('Invalid scope field \'agents\'');
      expect(result.errors[0]).toContain('expected string or array');
    });

    it('should error on tags non-array', () => {
      const content = `---
tags: "single tag"
---
# Content`;

      const result = parseFrontmatter(content);

      expect(result.hasErrors).toBe(true);
      expect(result.errors[0]).toContain('Invalid scope field \'tags\'');
      expect(result.errors[0]).toContain('expected array');
    });
  });

  describe('YAML Syntax Errors', () => {
    it('should throw on malformed YAML', () => {
      const content = `---
phase: {unclosed
tasks: []
---
# Content`;

      expect(() => parseFrontmatter(content)).toThrow('Invalid YAML syntax');
    });

    it('should throw on unclosed string', () => {
      const content = `---
phase: "unclosed string
tasks: []
---
# Content`;

      expect(() => parseFrontmatter(content)).toThrow('Invalid YAML syntax');
    });
  });

  describe('Helper Functions', () => {
    it('validateParsedScope should throw on errors', () => {
      const parsed = {
        scope: null,
        content: '',
        isEmpty: false,
        hasErrors: true,
        errors: ['Error 1', 'Error 2'],
      };

      expect(() => validateParsedScope(parsed)).toThrow('Scope validation failed');
      expect(() => validateParsedScope(parsed)).toThrow('Error 1');
      expect(() => validateParsedScope(parsed)).toThrow('Error 2');
    });

    it('validateParsedScope should not throw on valid scope', () => {
      const parsed = {
        scope: { phase: '1' },
        content: '',
        isEmpty: false,
        hasErrors: false,
        errors: [],
      };

      expect(() => validateParsedScope(parsed)).not.toThrow();
    });

    it('hasScopeDefinition should return true for non-empty scope', () => {
      const parsed = {
        scope: { phase: '1' },
        content: '',
        isEmpty: false,
        hasErrors: false,
        errors: [],
      };

      expect(hasScopeDefinition(parsed)).toBe(true);
    });

    it('hasScopeDefinition should return false for empty scope', () => {
      const parsed = {
        scope: {},
        content: '',
        isEmpty: true,
        hasErrors: false,
        errors: [],
      };

      expect(hasScopeDefinition(parsed)).toBe(false);
    });

    it('hasScopeDefinition should return false for null scope', () => {
      const parsed = {
        scope: null,
        content: '',
        isEmpty: true,
        hasErrors: false,
        errors: [],
      };

      expect(hasScopeDefinition(parsed)).toBe(false);
    });
  });
});
