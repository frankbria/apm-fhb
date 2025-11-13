/**
 * Handover Detector Tests
 * Tests for handover detection logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  HandoverDetector,
  createHandoverDetector,
  HandoverState,
  HandoverTrigger,
  type HandoverDetectorConfig,
} from '../../src/orchestration/handover-detector.js';
import { AgentStatus, AgentType, type AgentState } from '../../src/types/agent.js';
import { type AgentPersistenceManager } from '../../src/state/persistence.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_LOGS_DIR = path.join(__dirname, '../test-data/handover-detector');

// Mock agent state
function createMockAgent(
  id: string,
  status: AgentStatus,
  memoryLogPath?: string
): AgentState {
  return {
    id,
    type: AgentType.Implementation,
    status,
    currentTask: '4.1',
    metadata: {
      spawnedAt: new Date(),
      lastActivityAt: new Date(),
      custom_metadata: memoryLogPath ? { memoryLogPath } : {},
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

describe('HandoverDetector', () => {
  let detector: HandoverDetector;
  let mockPersistence: AgentPersistenceManager;
  let config: HandoverDetectorConfig;

  beforeEach(async () => {
    // Ensure test logs directory exists
    await fs.mkdir(TEST_LOGS_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test logs
    try {
      const files = await fs.readdir(TEST_LOGS_DIR);
      await Promise.all(files.map(f => fs.unlink(path.join(TEST_LOGS_DIR, f))));
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Initialization', () => {
    it('should create HandoverDetector instance', () => {
      mockPersistence = createMockPersistence([]);
      config = {
        persistence: mockPersistence,
      };

      detector = createHandoverDetector(config);
      expect(detector).toBeInstanceOf(HandoverDetector);
    });

    it('should use default thresholds', () => {
      mockPersistence = createMockPersistence([]);
      config = {
        persistence: mockPersistence,
      };

      detector = createHandoverDetector(config);
      expect(detector).toBeDefined();
    });

    it('should accept custom thresholds', () => {
      mockPersistence = createMockPersistence([]);
      config = {
        persistence: mockPersistence,
        warningThresholdPercent: 70,
        handoverThresholdPercent: 85,
        maxLogSizeBytes: 100 * 1024,
      };

      detector = createHandoverDetector(config);
      expect(detector).toBeDefined();
    });
  });

  describe('Handover Detection', () => {
    beforeEach(() => {
      mockPersistence = createMockPersistence([]);
      config = {
        persistence: mockPersistence,
        warningThresholdPercent: 80,
        handoverThresholdPercent: 90,
        maxLogSizeBytes: 50 * 1024,
      };
      detector = createHandoverDetector(config);
    });

    it('should return null for non-existent agent', async () => {
      const result = await detector.detectHandover('nonexistent');
      expect(result).toBeNull();
    });

    it('should return no handover for terminated agent', async () => {
      const agents = [createMockAgent('agent_001', AgentStatus.Terminated)];
      mockPersistence = createMockPersistence(agents);
      config = { persistence: mockPersistence };
      detector = createHandoverDetector(config);

      const result = await detector.detectHandover('agent_001');

      expect(result?.state).toBe(HandoverState.None);
    });

    it('should return no handover for agent without log', async () => {
      const agents = [createMockAgent('agent_002', AgentStatus.Active)];
      mockPersistence = createMockPersistence(agents);
      config = { persistence: mockPersistence };
      detector = createHandoverDetector(config);

      const result = await detector.detectHandover('agent_002');

      expect(result?.state).toBe(HandoverState.None);
    });

    it('should detect warning state for high context usage', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'warning.md');
      // Create 40KB file
      // With contextWindowTokens=10000 and charsPerToken=4:
      // 40KB = 40,960 bytes / 4 = 10,240 tokens = 102% of 10K window
      // But we cap at 100%, so use 35KB for ~90% usage
      await fs.writeFile(logPath, 'x'.repeat(35 * 1024));

      const agents = [createMockAgent('agent_003', AgentStatus.Active, logPath)];
      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        warningThresholdPercent: 80,
        handoverThresholdPercent: 95, // Set higher so we get Warning, not Needed
        maxLogSizeBytes: 50 * 1024, // Higher than file size
        contextWindowTokens: 10000, // Smaller window for testing
        charsPerToken: 4,
      };
      detector = createHandoverDetector(config);

      const result = await detector.detectHandover('agent_003');

      expect(result?.state).toBe(HandoverState.Warning);
      expect(result?.contextUsagePercent).toBeGreaterThan(80);
    });

    it('should detect handover needed for log size threshold', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'large.md');
      // Create 60KB file (exceeds 50KB threshold)
      await fs.writeFile(logPath, 'x'.repeat(60 * 1024));

      const agents = [createMockAgent('agent_004', AgentStatus.Active, logPath)];
      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        maxLogSizeBytes: 50 * 1024,
      };
      detector = createHandoverDetector(config);

      const result = await detector.detectHandover('agent_004');

      expect(result?.state).toBe(HandoverState.Needed);
      expect(result?.triggers).toContain(HandoverTrigger.LogSizeThreshold);
    });

    it('should detect explicit handover marker', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'marker.md');
      await fs.writeFile(logPath, 'Some content\n\n[APM_HANDOVER_NEEDED]\n\nMore content');

      const agents = [createMockAgent('agent_005', AgentStatus.Active, logPath)];
      mockPersistence = createMockPersistence(agents);
      config = { persistence: mockPersistence };
      detector = createHandoverDetector(config);

      const result = await detector.detectHandover('agent_005');

      expect(result?.state).toBe(HandoverState.Needed);
      expect(result?.hasHandoverMarker).toBe(true);
      expect(result?.triggers).toContain(HandoverTrigger.ExplicitMarker);
    });

    it('should detect various handover marker formats', async () => {
      const markers = [
        '[APM_HANDOVER]',
        'context window approaching',
        'handover needed',
        'requesting handover',
      ];

      for (let i = 0; i < markers.length; i++) {
        const logPath = path.join(TEST_LOGS_DIR, `marker-${i}.md`);
        await fs.writeFile(logPath, `Content\n\n${markers[i]}\n\nMore content`);

        const agents = [createMockAgent(`agent_00${i + 6}`, AgentStatus.Active, logPath)];
        mockPersistence = createMockPersistence(agents);
        config = { persistence: mockPersistence };
        detector = createHandoverDetector(config);

        const result = await detector.detectHandover(`agent_00${i + 6}`);

        expect(result?.hasHandoverMarker).toBe(true);
      }
    });

    it('should calculate context usage percentage', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'context.md');
      await fs.writeFile(logPath, 'x'.repeat(10 * 1024)); // 10KB

      const agents = [createMockAgent('agent_010', AgentStatus.Active, logPath)];
      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        charsPerToken: 4,
        contextWindowTokens: 200000,
      };
      detector = createHandoverDetector(config);

      const result = await detector.detectHandover('agent_010');

      expect(result?.contextUsagePercent).toBeGreaterThan(0);
      expect(result?.contextUsagePercent).toBeLessThan(100);
    });

    it('should include log size in result', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'size.md');
      const content = 'x'.repeat(5000);
      await fs.writeFile(logPath, content);

      const agents = [createMockAgent('agent_011', AgentStatus.Active, logPath)];
      mockPersistence = createMockPersistence(agents);
      config = { persistence: mockPersistence };
      detector = createHandoverDetector(config);

      const result = await detector.detectHandover('agent_011');

      expect(result?.logSizeBytes).toBe(5000);
    });

    it('should provide recommendation', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'recommendation.md');
      await fs.writeFile(logPath, '[APM_HANDOVER_NEEDED]');

      const agents = [createMockAgent('agent_012', AgentStatus.Active, logPath)];
      mockPersistence = createMockPersistence(agents);
      config = { persistence: mockPersistence };
      detector = createHandoverDetector(config);

      const result = await detector.detectHandover('agent_012');

      expect(result?.recommendation).toContain('Handover required');
      expect(result?.recommendation).toContain('explicit handover marker');
    });
  });

  describe('Multiple Agents', () => {
    it('should detect handovers for all agents', async () => {
      const logPath1 = path.join(TEST_LOGS_DIR, 'agent1.md');
      const logPath2 = path.join(TEST_LOGS_DIR, 'agent2.md');

      await fs.writeFile(logPath1, 'x'.repeat(60 * 1024)); // Over threshold
      await fs.writeFile(logPath2, 'x'.repeat(10 * 1024)); // Under threshold

      const agents = [
        createMockAgent('agent_013', AgentStatus.Active, logPath1),
        createMockAgent('agent_014', AgentStatus.Active, logPath2),
      ];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        maxLogSizeBytes: 50 * 1024,
      };
      detector = createHandoverDetector(config);

      const results = await detector.detectAllHandovers();

      expect(results).toHaveLength(2);
      expect(results.find(r => r.agentId === 'agent_013')?.state).toBe(HandoverState.Needed);
      expect(results.find(r => r.agentId === 'agent_014')?.state).toBe(HandoverState.None);
    });

    it('should get agents needing handover', async () => {
      const logPath1 = path.join(TEST_LOGS_DIR, 'needed1.md');
      const logPath2 = path.join(TEST_LOGS_DIR, 'needed2.md');

      await fs.writeFile(logPath1, '[APM_HANDOVER_NEEDED]');
      await fs.writeFile(logPath2, 'Normal content');

      const agents = [
        createMockAgent('agent_015', AgentStatus.Active, logPath1),
        createMockAgent('agent_016', AgentStatus.Active, logPath2),
      ];

      mockPersistence = createMockPersistence(agents);
      config = { persistence: mockPersistence };
      detector = createHandoverDetector(config);

      const needing = await detector.getAgentsNeedingHandover();

      expect(needing).toHaveLength(1);
      expect(needing[0].agentId).toBe('agent_015');
    });

    it('should get agents with warnings', async () => {
      const logPath1 = path.join(TEST_LOGS_DIR, 'warning1.md');
      const logPath2 = path.join(TEST_LOGS_DIR, 'warning2.md');

      // With contextWindowTokens=10000 and charsPerToken=4:
      // 34KB = 34,816 bytes / 4 = 8,704 tokens = 87% of 10K window (warning)
      // 10KB = 10,240 bytes / 4 = 2,560 tokens = 25.6% of 10K window (under threshold)
      await fs.writeFile(logPath1, 'x'.repeat(34 * 1024));
      await fs.writeFile(logPath2, 'x'.repeat(10 * 1024));

      const agents = [
        createMockAgent('agent_017', AgentStatus.Active, logPath1),
        createMockAgent('agent_018', AgentStatus.Active, logPath2),
      ];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        warningThresholdPercent: 80,
        handoverThresholdPercent: 95, // Set higher so we get Warning, not Needed
        maxLogSizeBytes: 50 * 1024,
        contextWindowTokens: 10000, // Smaller window for testing
        charsPerToken: 4,
      };
      detector = createHandoverDetector(config);

      const warnings = await detector.getAgentsWithWarnings();

      expect(warnings).toHaveLength(1);
      expect(warnings[0].agentId).toBe('agent_017');
    });
  });

  describe('Handover History', () => {
    beforeEach(() => {
      mockPersistence = createMockPersistence([]);
      config = { persistence: mockPersistence };
      detector = createHandoverDetector(config);
    });

    it('should record handover initiation', () => {
      detector.recordHandoverInitiated('agent_019', [HandoverTrigger.ExplicitMarker]);

      const history = detector.getHandoverHistory();

      expect(history).toHaveLength(1);
      expect(history[0].fromAgentId).toBe('agent_019');
      expect(history[0].state).toBe(HandoverState.InProgress);
      expect(history[0].toAgentId).toBeNull();
      expect(history[0].completedAt).toBeNull();
    });

    it('should record handover completion', () => {
      detector.recordHandoverInitiated('agent_020', [HandoverTrigger.LogSizeThreshold]);
      detector.recordHandoverCompleted('agent_020', 'agent_021');

      const history = detector.getHandoverHistory();

      expect(history[0].state).toBe(HandoverState.Completed);
      expect(history[0].toAgentId).toBe('agent_021');
      expect(history[0].completedAt).toBeInstanceOf(Date);
    });

    it('should track multiple handovers', () => {
      detector.recordHandoverInitiated('agent_022', [HandoverTrigger.ContextWindowLimit]);
      detector.recordHandoverInitiated('agent_023', [HandoverTrigger.ExplicitMarker]);
      detector.recordHandoverCompleted('agent_022', 'agent_024');

      const history = detector.getHandoverHistory();

      expect(history).toHaveLength(2);
      expect(history[0].fromAgentId).toBe('agent_023'); // Most recent first
      expect(history[1].fromAgentId).toBe('agent_022');
    });

    it('should limit history results', () => {
      for (let i = 0; i < 10; i++) {
        detector.recordHandoverInitiated(`agent_${i}`, [HandoverTrigger.Manual]);
      }

      const history = detector.getHandoverHistory(5);

      expect(history).toHaveLength(5);
    });

    it('should get agent-specific handover history', () => {
      detector.recordHandoverInitiated('agent_025', [HandoverTrigger.ExplicitMarker]);
      detector.recordHandoverInitiated('agent_026', [HandoverTrigger.LogSizeThreshold]);
      detector.recordHandoverCompleted('agent_025', 'agent_027');

      const agentHistory = detector.getAgentHandoverHistory('agent_025');

      expect(agentHistory).toHaveLength(1);
      expect(agentHistory[0].fromAgentId).toBe('agent_025');
    });

    it('should include agent as recipient in history', () => {
      detector.recordHandoverInitiated('agent_028', [HandoverTrigger.ContextWindowLimit]);
      detector.recordHandoverCompleted('agent_028', 'agent_029');

      const history = detector.getAgentHandoverHistory('agent_029');

      expect(history).toHaveLength(1);
      expect(history[0].toAgentId).toBe('agent_029');
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      mockPersistence = createMockPersistence([]);
      config = { persistence: mockPersistence };
      detector = createHandoverDetector(config);
    });

    it('should handle non-existent log file', async () => {
      const agents = [
        createMockAgent('agent_030', AgentStatus.Active, '/nonexistent/path.md'),
      ];

      mockPersistence = createMockPersistence(agents);
      config = { persistence: mockPersistence };
      detector = createHandoverDetector(config);

      const result = await detector.detectHandover('agent_030');

      expect(result?.logSizeBytes).toBe(0);
      expect(result?.hasHandoverMarker).toBe(false);
    });

    it('should cap context usage at 100%', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'huge.md');
      await fs.writeFile(logPath, 'x'.repeat(1000 * 1024)); // 1MB

      const agents = [createMockAgent('agent_031', AgentStatus.Active, logPath)];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        contextWindowTokens: 10000, // Small window
      };
      detector = createHandoverDetector(config);

      const result = await detector.detectHandover('agent_031');

      expect(result?.contextUsagePercent).toBe(100);
    });

    it('should handle empty log file', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'empty-handover.md');
      await fs.writeFile(logPath, '');

      const agents = [createMockAgent('agent_032', AgentStatus.Active, logPath)];

      mockPersistence = createMockPersistence(agents);
      config = { persistence: mockPersistence };
      detector = createHandoverDetector(config);

      const result = await detector.detectHandover('agent_032');

      expect(result?.state).toBe(HandoverState.None);
      expect(result?.logSizeBytes).toBe(0);
    });

    it('should handle multiple triggers', async () => {
      const logPath = path.join(TEST_LOGS_DIR, 'multi-trigger.md');
      // Large file with explicit marker
      await fs.writeFile(logPath, '[APM_HANDOVER_NEEDED]\n' + 'x'.repeat(60 * 1024));

      const agents = [createMockAgent('agent_033', AgentStatus.Active, logPath)];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        maxLogSizeBytes: 50 * 1024,
      };
      detector = createHandoverDetector(config);

      const result = await detector.detectHandover('agent_033');

      expect(result?.triggers).toContain(HandoverTrigger.ExplicitMarker);
      expect(result?.triggers).toContain(HandoverTrigger.LogSizeThreshold);
      expect(result?.triggers.length).toBeGreaterThan(1);
    });

    it('should only track active agents in detectAllHandovers', async () => {
      const agents = [
        createMockAgent('agent_034', AgentStatus.Active),
        createMockAgent('agent_035', AgentStatus.Terminated),
        createMockAgent('agent_036', AgentStatus.Idle),
      ];

      mockPersistence = createMockPersistence(agents);
      config = { persistence: mockPersistence };
      detector = createHandoverDetector(config);

      const results = await detector.detectAllHandovers();

      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe('agent_034');
    });
  });

  describe('Recommendation Generation', () => {
    beforeEach(() => {
      mockPersistence = createMockPersistence([]);
      config = { persistence: mockPersistence };
      detector = createHandoverDetector(config);
    });

    it('should provide different recommendations for different states', async () => {
      const logPath1 = path.join(TEST_LOGS_DIR, 'rec-needed.md');
      const logPath2 = path.join(TEST_LOGS_DIR, 'rec-warning.md');
      const logPath3 = path.join(TEST_LOGS_DIR, 'rec-none.md');

      await fs.writeFile(logPath1, '[APM_HANDOVER_NEEDED]');
      // With contextWindowTokens=10000, 34KB = ~87% usage (warning level)
      await fs.writeFile(logPath2, 'x'.repeat(34 * 1024));
      await fs.writeFile(logPath3, 'Normal content');

      const agents = [
        createMockAgent('agent_037', AgentStatus.Active, logPath1),
        createMockAgent('agent_038', AgentStatus.Active, logPath2),
        createMockAgent('agent_039', AgentStatus.Active, logPath3),
      ];

      mockPersistence = createMockPersistence(agents);
      config = {
        persistence: mockPersistence,
        warningThresholdPercent: 80,
        handoverThresholdPercent: 95, // Set higher to get Warning, not Needed
        maxLogSizeBytes: 50 * 1024,
        contextWindowTokens: 10000, // Smaller window for testing
        charsPerToken: 4,
      };
      detector = createHandoverDetector(config);

      const result1 = await detector.detectHandover('agent_037');
      const result2 = await detector.detectHandover('agent_038');
      const result3 = await detector.detectHandover('agent_039');

      expect(result1?.recommendation).toContain('Handover required');
      expect(result2?.recommendation).toContain('approaching limit');
      expect(result3?.recommendation).toContain('No handover needed');

      // All recommendations should be different
      expect(result1?.recommendation).not.toBe(result2?.recommendation);
      expect(result2?.recommendation).not.toBe(result3?.recommendation);
    });
  });

  describe('createHandoverDetector()', () => {
    it('should create HandoverDetector instance', () => {
      mockPersistence = createMockPersistence([]);
      const newDetector = createHandoverDetector({
        persistence: mockPersistence,
      });

      expect(newDetector).toBeInstanceOf(HandoverDetector);
    });
  });
});
