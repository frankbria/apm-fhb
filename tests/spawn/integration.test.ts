/**
 * Integration Tests for Agent Spawning
 * End-to-end tests for the complete agent spawning workflow
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { ConnectionManager, createConnectionManager, TEST_CONFIG } from '../../src/db/connection.js';
import { setupTestDatabase } from '../../src/db/init.js';
import { AgentPersistenceManager, createAgentPersistence } from '../../src/state/persistence.js';
import { AgentStatus } from '../../src/types/agent.js';
import { ClaudeCLI } from '../../src/spawn/claude-cli.js';
import { ProcessManager, ProcessStatus } from '../../src/spawn/process-manager.js';
import { PromptTemplateEngine } from '../../src/spawn/prompt-templates.js';
import { ProcessTracker } from '../../src/spawn/process-tracker.js';
import { SpawnErrorHandler, SpawnErrorCode } from '../../src/spawn/error-handler.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, '../../templates');

describe('Agent Spawning Integration', () => {
  let connectionManager: ConnectionManager;
  let persistence: AgentPersistenceManager;
  let processManager: ProcessManager;
  let templateEngine: PromptTemplateEngine;
  let processTracker: ProcessTracker;
  let errorHandler: SpawnErrorHandler;

  beforeEach(async () => {
    // Setup database
    connectionManager = createConnectionManager(TEST_CONFIG);
    await connectionManager.connect();
    await setupTestDatabase(connectionManager);

    persistence = createAgentPersistence(connectionManager);
    await persistence.ensureIndexes();

    // Initialize components
    processManager = new ProcessManager();
    templateEngine = new PromptTemplateEngine();
    processTracker = new ProcessTracker(persistence);
    errorHandler = new SpawnErrorHandler();

    // Load templates
    await templateEngine.loadTemplates(TEMPLATES_DIR);
  });

  afterEach(async () => {
    await connectionManager.disconnect();
  });

  describe('End-to-End Spawn Workflow', () => {
    it('should render template and track spawn in database', async () => {
      // Step 1: Render prompt from template
      const taskContext = {
        taskId: '4.1',
        taskObjective: 'Implement agent spawning',
        phaseNumber: '4',
        phaseName: 'Agent Automation',
        dependencies: ['3.1', '3.2'],
        outputSpecs: 'Complete spawning system',
        memoryLogPath: '.apm/Memory/Phase_04/Task_4_1.md',
        executionSteps: ['Create CLI wrapper', 'Add process management'],
      };

      const prompt = templateEngine.renderPrompt('implementation-agent-v1', taskContext);

      expect(prompt).toContain('Task 4.1');
      expect(prompt).toContain('Implement agent spawning');
      expect(prompt).not.toContain('{{');

      // Step 2: Record spawn to database
      const spawnMetadata = {
        processId: 12345,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.1',
        workingDirectory: '/home/user/project',
      };

      const agent = await processTracker.recordSpawn('agent_integration', spawnMetadata);

      expect(agent.id).toBe('agent_integration');
      expect(agent.status).toBe(AgentStatus.Active);

      // Step 3: Verify spawn recorded in database
      const retrievedAgent = await persistence.getAgentState('agent_integration');
      expect(retrievedAgent?.status).toBe(AgentStatus.Active);
      expect(retrievedAgent?.metadata.custom_metadata?.process.taskId).toBe('4.1');
    });

    it('should manage process lifecycle with output capture', async () => {
      // Create mock process
      const mockProc = new EventEmitter() as ChildProcess;
      mockProc.pid = 999;
      mockProc.stdout = new EventEmitter() as any;
      mockProc.stderr = new EventEmitter() as any;
      mockProc.kill = vi.fn().mockReturnValue(true);

      // Register process
      const info = processManager.registerProcess('agent_lifecycle', mockProc);

      expect(info.status).toBe(ProcessStatus.Running);
      expect(info.pid).toBe(999);

      // Capture output
      mockProc.stdout?.emit('data', Buffer.from('Starting task...\n'));
      mockProc.stdout?.emit('data', Buffer.from('[APM_STATUS:READY]\n'));

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 10));

      const output = processManager.getOutput('agent_lifecycle');
      expect(output?.stdout.length).toBeGreaterThan(0);
      expect(output?.stdout.some(line => line.includes('Starting task'))).toBe(true);

      // Process exit
      mockProc.emit('exit', 0, null);

      await new Promise(resolve => setTimeout(resolve, 10));

      const finalInfo = processManager.getProcessInfo('agent_lifecycle');
      expect(finalInfo?.status).toBe(ProcessStatus.Exited);
    });

    it('should handle template validation errors', async () => {
      // Invalid context missing required variables
      const invalidContext = {
        taskId: '4.1',
        // Missing other required fields
      } as any;

      const validation = templateEngine.validateTemplate('implementation-agent-v1', invalidContext);

      expect(validation.valid).toBe(false);
      expect(validation.missing.length).toBeGreaterThan(0);

      // Should include missing variables like TASK_OBJECTIVE, PHASE_NUMBER, etc.
      expect(validation.missing).toContain('TASK_OBJECTIVE');
    });

    it('should provide error guidance for spawn failures', async () => {
      const error = new Error('spawn claude ENOENT');
      const context = errorHandler.createErrorContextFromError(error);

      expect(context.code).toBe(SpawnErrorCode.CLI_NOT_FOUND);
      expect(context.retryable).toBe(false);
      expect(context.guidance).toContain('Install Claude CLI');

      const formatted = errorHandler.formatError(context);
      expect(formatted).toContain('[SPAWN_E001]');
      expect(formatted).toContain('Guidance:');
    });

    it('should update heartbeats and calculate metrics', async () => {
      // Record spawn
      const spawnMetadata = {
        processId: 777,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.2',
        workingDirectory: '/home/user/project',
      };

      await processTracker.recordSpawn('agent_metrics', spawnMetadata);

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));

      // Update heartbeat
      await processTracker.updateHeartbeat('agent_metrics');

      // Wait again
      await new Promise(resolve => setTimeout(resolve, 50));

      // Get metrics
      const metrics = await processTracker.getProcessMetrics('agent_metrics');

      expect(metrics).toBeDefined();
      expect(metrics!.agentId).toBe('agent_metrics');
      expect(metrics!.runtime).toBeGreaterThan(50);
      expect(metrics!.status).toBe(AgentStatus.Active);
      expect(metrics!.heartbeatAge).toBeGreaterThan(0);
    });

    it('should handle process exit with database update', async () => {
      // Record spawn
      const spawnMetadata = {
        processId: 888,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.3',
        workingDirectory: '/home/user/project',
      };

      await processTracker.recordSpawn('agent_exit', spawnMetadata);

      // Verify active
      let agent = await persistence.getAgentState('agent_exit');
      expect(agent?.status).toBe(AgentStatus.Active);

      // Record exit
      await processTracker.recordExit('agent_exit', 0, null);

      // Verify terminated
      agent = await persistence.getAgentState('agent_exit');
      expect(agent?.status).toBe(AgentStatus.Terminated);

      // Check history
      const history = await persistence.getAgentHistory('agent_exit');
      const terminationTransition = history.find(t => t.toState === AgentStatus.Terminated);
      expect(terminationTransition).toBeDefined();
    });

    it('should list active agents across multiple spawns', async () => {
      // Spawn multiple agents
      await processTracker.recordSpawn('agent_001', {
        processId: 101,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.1',
        workingDirectory: '/home/user/project',
      });

      await processTracker.recordSpawn('agent_002', {
        processId: 102,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.2',
        workingDirectory: '/home/user/project',
      });

      await processTracker.recordSpawn('agent_003', {
        processId: 103,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.3',
        workingDirectory: '/home/user/project',
      });

      // Terminate one agent
      await processTracker.recordExit('agent_002', 0, null);

      // Get active agents
      const activeAgents = await processTracker.getActiveAgents();

      expect(activeAgents).toHaveLength(2);
      expect(activeAgents.map(a => a.id)).toContain('agent_001');
      expect(activeAgents.map(a => a.id)).toContain('agent_003');
      expect(activeAgents.map(a => a.id)).not.toContain('agent_002');
    });

    it('should handle crashed process with proper error tracking', async () => {
      // Record spawn
      await processTracker.recordSpawn('agent_crash', {
        processId: 999,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.4',
        workingDirectory: '/home/user/project',
      });

      // Record crash (non-zero exit code)
      await processTracker.recordExit('agent_crash', 1, null);

      // Verify terminated status
      const agent = await persistence.getAgentState('agent_crash');
      expect(agent?.status).toBe(AgentStatus.Terminated);

      // Check error context
      const errorContext = errorHandler.createErrorContext(
        SpawnErrorCode.PROCESS_CRASHED,
        { agentId: 'agent_crash', exitCode: 1 }
      );

      expect(errorContext.retryable).toBe(true);
      expect(errorContext.guidance).toContain('logs');
    });

    it('should load multiple templates and list them', async () => {
      const templates = templateEngine.listTemplates();

      expect(templates.length).toBeGreaterThanOrEqual(2);

      const implementationTemplate = templates.find(
        t => t.templateId === 'implementation-agent-v1'
      );
      const managerTemplate = templates.find(
        t => t.templateId === 'manager-agent-v1'
      );

      expect(implementationTemplate).toBeDefined();
      expect(implementationTemplate?.agentType).toBe('implementation');

      expect(managerTemplate).toBeDefined();
      expect(managerTemplate?.agentType).toBe('manager');
    });

    it('should track process metrics over time', async () => {
      // Spawn agent
      await processTracker.recordSpawn('agent_metrics_track', {
        processId: 555,
        promptTemplateId: 'implementation-agent-v1',
        taskAssignment: '4.5',
        workingDirectory: '/home/user/project',
      });

      // Initial metrics
      const metrics1 = await processTracker.getProcessMetrics('agent_metrics_track');
      expect(metrics1!.runtime).toBeGreaterThanOrEqual(0);

      // Wait and check again
      await new Promise(resolve => setTimeout(resolve, 100));

      const metrics2 = await processTracker.getProcessMetrics('agent_metrics_track');
      expect(metrics2!.runtime).toBeGreaterThan(metrics1!.runtime);

      // Update heartbeat
      await processTracker.updateHeartbeat('agent_metrics_track');

      const metrics3 = await processTracker.getProcessMetrics('agent_metrics_track');
      expect(metrics3!.heartbeatAge).toBeLessThan(metrics2!.heartbeatAge);
    });
  });

  describe('Error Recovery Scenarios', () => {
    it('should identify retryable vs non-retryable errors', () => {
      const retryableCodes = [
        SpawnErrorCode.SPAWN_TIMEOUT,
        SpawnErrorCode.TOO_MANY_FILES,
        SpawnErrorCode.RESOURCE_UNAVAILABLE,
        SpawnErrorCode.DATABASE_ERROR,
      ];

      const nonRetryableCodes = [
        SpawnErrorCode.CLI_NOT_FOUND,
        SpawnErrorCode.PERMISSION_DENIED,
        SpawnErrorCode.TEMPLATE_NOT_FOUND,
      ];

      for (const code of retryableCodes) {
        expect(errorHandler.isRetryable(code)).toBe(true);
      }

      for (const code of nonRetryableCodes) {
        expect(errorHandler.isRetryable(code)).toBe(false);
      }
    });

    it('should provide different guidance for different error types', () => {
      const cliError = errorHandler.createErrorContext(SpawnErrorCode.CLI_NOT_FOUND);
      const dbError = errorHandler.createErrorContext(SpawnErrorCode.DATABASE_ERROR);
      const templateError = errorHandler.createErrorContext(SpawnErrorCode.TEMPLATE_NOT_FOUND);

      expect(cliError.guidance).toContain('Install');
      expect(dbError.guidance).toContain('database');
      expect(templateError.guidance).toContain('template');

      // Verify they're all different
      expect(cliError.guidance).not.toBe(dbError.guidance);
      expect(dbError.guidance).not.toBe(templateError.guidance);
    });
  });
});
