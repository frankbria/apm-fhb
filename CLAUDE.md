# apm-auto - Agentic Project Management Automation Framework

## Project Overview

apm-auto is an automation orchestration system that extends the Agentic Project Management (APM) framework to eliminate manual agent coordination. The system automates the full agent lifecycle—spawning Manager and Implementation agents via Claude Code CLI, managing inter-agent communication through file-based protocols, coordinating parallel execution, and enforcing constitutional quality gates.

## Architecture

### Phase 1: Foundation & State Management (✅ COMPLETE)
- SQLite database with connection pooling and transactions
- Beads CLI integration for dependency-driven task management
- TypeScript type system with zod validation
- Database migration framework with checksum validation

### Phase 2: CLI & Orchestration Core (✅ COMPLETE)
- Commander.js CLI framework with placeholder commands
- Scope parsing with YAML frontmatter extraction and wildcard patterns
- Agent lifecycle state management with atomic database transactions
- Configuration management with precedence-based merging

### Phase 3: Communication Protocol (✅ COMPLETE)
- Inter-agent messaging protocol with 7 message types
- NDJSON serialization with compression and 31-error-code catalog
- Chokidar-based file watcher with state machine integration
- EventBus with wildcard subscriptions and multiple emission modes

### Phase 4: Agent Automation (✅ COMPLETE)
- ✅ **Task 4.1**: Claude Code Agent Spawning (COMPLETE - 168/168 tests, 98.12% coverage)
- ✅ **Task 4.2**: Manager Agent Orchestration (COMPLETE - 230/230 tests, 98.08% coverage)
- ✅ **Task 4.3**: Implementation Agent Execution (COMPLETE - 153/153 tests, 96.74% coverage)
- ✅ **Task 4.4**: Task Completion Detection (COMPLETE - 85/85 tests, 87.94% coverage)

## Agent Spawning System (Task 4.1)

### Overview
The agent spawning system provides programmatic control over Claude Code agent lifecycle through five integrated components:

1. **Claude CLI Integration** (`src/spawn/claude-cli.ts`)
2. **Process Lifecycle Management** (`src/spawn/process-manager.ts`)
3. **Prompt Template Engine** (`src/spawn/prompt-templates.ts`)
4. **Database Process Tracking** (`src/spawn/process-tracker.ts`)
5. **Structured Error Handling** (`src/spawn/error-handler.ts`)

### Usage Examples

#### Spawning an Agent

```typescript
import { ClaudeCLI, ProcessManager, PromptTemplateEngine, ProcessTracker } from './spawn';

// 1. Check Claude CLI availability
const cli = new ClaudeCLI();
const available = await cli.checkAvailability();
if (!available) {
  throw new Error('Claude CLI not found on PATH');
}

// 2. Render prompt from template
const templateEngine = new PromptTemplateEngine();
await templateEngine.loadTemplates('./templates');

const prompt = templateEngine.renderPrompt('implementation-agent', {
  taskId: 'Task 4.2',
  taskObjective: 'Implement Manager agent orchestration logic',
  phaseNumber: '4',
  phaseName: 'Agent Automation',
  dependencies: 'Task 4.1 spawning module APIs',
  outputSpecs: 'Orchestration module with task assignment generation',
  memoryLogPath: '.apm/Memory/Phase_04_Agent_Automation/Task_4_2_Manager_Agent_Orchestration.md',
  executionSteps: '1. Generate prompts\n2. Select agents\n3. Resolve dependencies'
});

// 3. Spawn agent process
const processManager = new ProcessManager();
const child = await cli.spawnAgent(prompt, {
  timeout: 300000, // 5 minutes
  cwd: process.cwd()
});

// 4. Register process for lifecycle tracking
const processInfo = processManager.registerProcess('agent_4_2', child, {
  taskId: 'Task 4.2',
  spawnedAt: new Date()
});

// 5. Track in database
const tracker = new ProcessTracker(persistenceManager);
const agent = await tracker.recordSpawn(
  'Agent_Orchestration_Automation',
  'implementation',
  processInfo.processId,
  'implementation-agent-v1',
  'Task 4.2'
);

// 6. Monitor status
processManager.on('status-marker', ({ processId, marker }) => {
  console.log(`Agent ${processId} status: ${marker}`);
  // marker can be: READY, ERROR, COMPLETE, BLOCKED
});

processManager.on('process-exited', async ({ processId, exitCode, signal }) => {
  await tracker.recordExit(agent.id, exitCode, signal);
  console.log(`Agent exited: code=${exitCode}, signal=${signal}`);
});
```

#### Error Handling with Retry Logic

```typescript
import { ClaudeCLI, SpawnErrorHandler } from './spawn';

const cli = new ClaudeCLI();
const errorHandler = new SpawnErrorHandler();

try {
  const child = await cli.spawnWithRetry(prompt, {
    maxRetries: 3,
    initialDelay: 5000, // 5s, 10s, 20s exponential backoff
    timeout: 300000
  });
} catch (error: any) {
  const errorCode = errorHandler.mapErrorToCode(error);
  const category = errorHandler.getErrorCategory(errorCode);
  const guidance = errorHandler.getErrorGuidance(errorCode);

  console.error(`Spawn failed: ${errorCode} (${category})`);
  console.error(`Guidance: ${guidance}`);

  if (errorHandler.isRetryable(errorCode)) {
    // Retry logic already handled by spawnWithRetry()
  } else {
    // Permanent error - escalate to user
    throw error;
  }
}
```

#### Process Lifecycle Monitoring

```typescript
const processManager = new ProcessManager();

// Listen for output
processManager.on('process-output', ({ processId, stream, data }) => {
  console.log(`[${processId}][${stream}] ${data}`);
});

// Get captured output
const output = processManager.getOutput('agent_4_2');
console.log('STDOUT:', output?.stdout.join('\n'));
console.log('STDERR:', output?.stderr.join('\n'));

// Terminate gracefully
await processManager.terminateProcess('agent_4_2', {
  graceful: true,      // Send SIGTERM first
  timeout: 5000,       // Wait 5s before SIGKILL
  forceKill: true      // Use SIGKILL if graceful fails
});

// Get metrics
const metrics = processManager.getProcessMetrics('agent_4_2');
console.log('Runtime:', metrics?.runtimeMs, 'ms');
```

#### Template Management

```typescript
const engine = new PromptTemplateEngine();

// Load all templates from directory
await engine.loadTemplates('./templates');

// List available templates
const templates = engine.listTemplates();
console.log('Available:', templates);

// Get template info
const info = engine.getTemplateInfo('implementation-agent');
console.log('Template:', info?.metadata.templateId);
console.log('Agent Type:', info?.metadata.agentType);

// Extract variables from template
const variables = engine.extractVariables('implementation-agent');
console.log('Required variables:', variables);

// Validate before rendering
const validation = engine.validateTemplate('implementation-agent', {
  taskId: 'Task 4.2',
  taskObjective: '...'
  // missing other required variables
});
if (!validation.valid) {
  console.error('Missing variables:', validation.missingVariables);
}
```

### Status Markers

Agents can emit structured status markers that ProcessManager automatically parses:

- `[APM_STATUS:READY]` - Agent initialized and ready
- `[APM_STATUS:ERROR]` - Error encountered
- `[APM_STATUS:COMPLETE]` - Task completed successfully
- `[APM_STATUS:BLOCKED]` - Agent blocked, needs intervention

### Error Codes

23 structured error codes across 3 categories:

**Permanent Errors** (no retry):
- `SPAWN_E001`: CLI_NOT_FOUND
- `SPAWN_E002`: PERMISSION_DENIED
- `SPAWN_E005`: INVALID_PROMPT
- `SPAWN_E010`: PROCESS_KILLED

**Transient Errors** (can retry):
- `SPAWN_E003`: SPAWN_TIMEOUT
- `SPAWN_E006`: TOO_MANY_PROCESSES
- `SPAWN_E007`: TOO_MANY_FILES
- `SPAWN_E008`: RESOURCE_UNAVAILABLE

**Unknown Errors**:
- `SPAWN_E999`: UNKNOWN_ERROR

### Key Technical Insights

1. **JavaScript Regex Escaping**: Use unescaped braces `/{{/` not `/\{\{/` for literal matching
2. **Vitest Async Pattern**: Return Promises instead of using deprecated `done()` callback
3. **SNAKE_CASE Conversion**: Handle digits in variable names (VAR_1 → var1)
4. **YAML Frontmatter**: Always `.trim()` parsed content to remove leading newlines
5. **Process State Transitions**: `registerProcess()` → Running, `recordSpawn()` → Active
6. **Output Buffer Access**: Use `getOutput()` method, not internal `outputBuffer` property
7. **Exponential Backoff**: Formula is `delay * 2^(attempt-1)` for attempts starting at 1
8. **Database Custom Metadata**: Use JSON field for flexible process metadata without schema changes

## Manager Orchestration System (Task 4.2)

### Overview
The orchestration system provides Manager agent capabilities for task assignment generation, agent selection, dependency resolution, cross-agent coordination, progress monitoring, and handover detection through six integrated components:

1. **Prompt Generator** (`src/orchestration/prompt-generator.ts`)
2. **Agent Selector** (`src/orchestration/agent-selector.ts`)
3. **Dependency Resolver** (`src/orchestration/dependency-resolver.ts`)
4. **Cross-Agent Coordinator** (`src/orchestration/cross-agent-coordinator.ts`)
5. **Progress Monitor** (`src/orchestration/progress-monitor.ts`)
6. **Handover Detector** (`src/orchestration/handover-detector.ts`)

### Usage Examples

#### Generating Task Assignment Prompts

```typescript
import { PromptGenerator } from './orchestration';

// Initialize generator with Implementation Plan path
const generator = new PromptGenerator({
  implementationPlanPath: '.apm/Implementation_Plan.md',
  templatesPath: './templates',
  memoryBasePath: '.apm/Memory'
});

// Generate prompt for specific task
const prompt = await generator.generateTaskPrompt('Task 4.3');

// Prompt includes:
// - YAML frontmatter (task_ref, agent_assignment, execution_type, etc.)
// - Task context from Implementation Plan
// - Dependency information
// - Memory log path
// - Execution steps formatted for agent
console.log(prompt);
```

#### Agent Selection

```typescript
import { AgentSelector } from './orchestration';
import { ProcessTracker } from './spawn';

const selector = new AgentSelector(processTracker);

// Select best agent for task
const selection = await selector.selectAgentForTask({
  agentAssignment: 'Agent_Orchestration_Automation',
  taskId: 'Task 4.3'
});

// Returns: { strategy: 'spawn' | 'reuse' | 'queue', agentId?: string }
if (selection.strategy === 'reuse') {
  console.log(`Reusing agent: ${selection.agentId}`);
} else if (selection.strategy === 'spawn') {
  console.log('Spawning new agent');
}

// Check agent load balance
const loadBalance = await selector.getAgentLoadBalance('Agent_Orchestration_Automation');
console.log('Active agents:', loadBalance.activeCount);
console.log('Average load:', loadBalance.averageLoad);
```

#### Dependency Resolution

```typescript
import { DependencyResolver, parseImplementationPlan } from './orchestration';

// Parse Implementation Plan
const tasks = await parseImplementationPlan('.apm/Implementation_Plan.md');

// Build dependency graph
const resolver = new DependencyResolver();
const graph = resolver.buildDependencyGraph(tasks);

// Get execution order via topological sort
const executionOrder = resolver.getExecutionOrder(graph);
console.log('Task execution order:', executionOrder);

// Get tasks ready for execution
const completedTasks = new Set(['Task 4.1', 'Task 4.2']);
const readyTasks = resolver.getReadyTasks(graph, completedTasks);
console.log('Ready to execute:', readyTasks);

// Get parallel execution batches
const batches = resolver.getParallelBatches(graph);
console.log('Batch 1 (parallel):', batches[0]);
console.log('Batch 2 (parallel):', batches[1]);

// Detect circular dependencies
if (graph.hasCycle) {
  console.error('Circular dependency detected!');
}
```

#### Cross-Agent Coordination

```typescript
import { CrossAgentCoordinator } from './orchestration';

const coordinator = new CrossAgentCoordinator();

// Track completed tasks
coordinator.markTaskCompleted('Task 4.1', 'Agent_Orchestration_Automation');
coordinator.markTaskCompleted('Task 2.2', 'Agent_Orchestration_CLI');

// Listen for handoff events
coordinator.on('handoff-ready', ({ handoffId, consumerTask }) => {
  console.log(`Handoff ready for ${consumerTask}`);
});

coordinator.on('task-blocked', ({ taskId, reason }) => {
  console.error(`Task ${taskId} blocked: ${reason}`);
});

// Get coordination state
const state = coordinator.getCoordinationState();
console.log('Ready handoffs:', state.readyHandoffs);
console.log('Blocked tasks:', state.blockedTasks);

// Check if specific handoff is ready
const isReady = coordinator.isHandoffReady('Task_4_2_depends_on_Task_4_1');
```

#### Progress Monitoring

```typescript
import { ProgressMonitor } from './orchestration';

const monitor = new ProgressMonitor({
  memoryBasePath: '.apm/Memory',
  stallThresholdMinutes: 5
});

// Analyze task progress
const progress = await monitor.analyzeTaskProgress('Task 4.3');

console.log('Status:', progress.taskProgress); // Completed | InProgress | NotStarted
console.log('Has errors:', progress.hasErrors);
console.log('Has blockers:', progress.hasBlockers);
console.log('Minutes since activity:', progress.minutesSinceLastActivity);

// Check if task is completed
const isComplete = await monitor.isTaskCompleted('Task 4.3');

// Detect stalled agents
const activeAgents = ['agent_1', 'agent_2', 'agent_3'];
const stalledAgents = await monitor.detectStalledAgents(
  activeAgents,
  '.apm/Memory/Phase_04_Agent_Automation'
);

if (stalledAgents.length > 0) {
  console.warn('Stalled agents:', stalledAgents);
}

// Get progress summary for all agents
const summary = await monitor.getProgressSummary(
  activeAgents,
  '.apm/Memory/Phase_04_Agent_Automation'
);
console.log('Total agents:', summary.totalAgents);
console.log('Completed:', summary.completedCount);
console.log('In progress:', summary.inProgressCount);
```

#### Handover Detection

```typescript
import { HandoverDetector } from './orchestration';

const detector = new HandoverDetector({
  warningThresholdPercent: 80,
  handoverThresholdPercent: 90,
  maxLogSizeBytes: 50 * 1024, // 50KB
  charsPerToken: 4,
  contextWindowTokens: 200000
});

// Analyze agent for handover need
const analysis = await detector.analyzeAgent('agent_1', {
  logPath: '.apm/Memory/Phase_04/Task_4_3.md',
  status: 'Active'
});

console.log('Handover state:', analysis.handoverState); // None | Warning | Needed
console.log('Context usage:', analysis.contextUsagePercent, '%');
console.log('Triggers:', analysis.triggers); // ContextWindowLimit, ExplicitMarker, etc.

if (analysis.shouldHandover) {
  console.warn('Handover needed:', analysis.recommendation);
}

// Detect agents needing handover
const activeAgents = [
  { id: 'agent_1', logPath: '...', status: 'Active' },
  { id: 'agent_2', logPath: '...', status: 'Active' }
];

const needingHandover = await detector.detectAgentsNeedingHandover(activeAgents);
console.log('Agents requiring handover:', needingHandover);

// Get handover history
const history = detector.getHandoverHistory('agent_1');
console.log('Previous handovers:', history);
```

### Integration Pattern

Complete orchestration workflow combining all components:

```typescript
import {
  PromptGenerator,
  AgentSelector,
  DependencyResolver,
  CrossAgentCoordinator,
  ProgressMonitor,
  HandoverDetector,
  parseImplementationPlan
} from './orchestration';
import { ClaudeCLI, ProcessManager, ProcessTracker } from './spawn';

// Initialize components
const promptGenerator = new PromptGenerator({ /* config */ });
const agentSelector = new AgentSelector(processTracker);
const dependencyResolver = new DependencyResolver();
const coordinator = new CrossAgentCoordinator();
const progressMonitor = new ProgressMonitor({ /* config */ });
const handoverDetector = new HandoverDetector({ /* config */ });

// 1. Parse Implementation Plan and build dependency graph
const tasks = await parseImplementationPlan('.apm/Implementation_Plan.md');
const graph = dependencyResolver.buildDependencyGraph(tasks);
const executionOrder = dependencyResolver.getExecutionOrder(graph);

// 2. Execute tasks in order
for (const taskId of executionOrder) {
  // Check dependencies satisfied
  const ready = dependencyResolver.isTaskReady(graph, taskId, completedTasks);
  if (!ready) continue;

  // Generate task assignment prompt
  const prompt = await promptGenerator.generateTaskPrompt(taskId);

  // Select agent for task
  const selection = await agentSelector.selectAgentForTask({ taskId, agentAssignment });

  // Spawn or reuse agent
  let agentProcess;
  if (selection.strategy === 'spawn') {
    agentProcess = await claudeCLI.spawnAgent(prompt);
  } else {
    agentProcess = getExistingAgent(selection.agentId);
  }

  // Monitor progress
  setInterval(async () => {
    const progress = await progressMonitor.analyzeTaskProgress(taskId);
    if (progress.taskProgress === 'Completed') {
      coordinator.markTaskCompleted(taskId, agentAssignment);
      completedTasks.add(taskId);
    }
  }, 5000);

  // Check for handover
  const handoverCheck = await handoverDetector.analyzeAgent(agentId, { logPath, status });
  if (handoverCheck.shouldHandover) {
    // Trigger handover workflow
  }
}
```

### Key Technical Insights

1. **Template Variable Escaping**: Execution steps may contain `{{VARIABLE}}` as documentation examples. Strip these during extraction to prevent rendering errors.

2. **Execution Type Detection**: Pattern matching for numbered lists (`1. **Title:**`) vs bulleted lists determines single-step vs multi-step execution.

3. **Agent Priority**: Idle > Active > Waiting ensures optimal agent utilization and context continuity.

4. **Dependency Graph**: Bidirectional edges (dependencies + dependents) enable efficient readiness checking without full graph traversal.

5. **Topological Sorting**: DFS-based algorithm provides deterministic execution order while detecting cycles.

6. **Event-Driven Coordination**: CoordinationEvents enable loose coupling between orchestrator and agents for extensibility.

7. **Progress Detection**: Multiple pattern sets for completion (✓, ✅, [x], COMPLETE), errors (ERROR, FAILED), blockers (BLOCKED, waiting for).

8. **Context Estimation**: Formula `(logSizeBytes / charsPerToken) / contextWindowTokens * 100` provides reasonable approximation for handover thresholds.

9. **Handover States**: Three-tier system (None → Warning → Needed) provides early warning before critical threshold.

10. **Memory Log Path Construction**: Sanitize phase and task names by replacing special chars with underscores for filesystem compatibility.

## Implementation Agent Execution System (Task 4.3)

### Overview
The execution system provides Implementation Agent capabilities for receiving task assignments, monitoring execution progress, validating memory logs, reporting completion, and escalating blockers through five integrated components:

1. **Task Receiver** (`src/execution/task-receiver.ts`)
2. **Execution Monitor** (`src/execution/execution-monitor.ts`)
3. **Memory Log Validator** (`src/execution/memory-log-validator.ts`)
4. **Completion Reporter** (`src/execution/completion-reporter.ts`)
5. **Error Escalator** (`src/execution/error-escalator.ts`)

### Usage Examples

#### Task Receipt and Parsing

```typescript
import { TaskReceiver } from './execution';

// Initialize task receiver
const receiver = new TaskReceiver();

// Parse task assignment prompt
const taskPrompt = `---
task_ref: "Task 4.3 - Implementation Agent Execution"
agent_assignment: "Agent_Orchestration_Automation"
memory_log_path: ".apm/Memory/Phase_04/Task_4_3.md"
execution_type: "multi-step"
---

# APM Task Assignment: Implementation Agent Execution
...
`;

const assignment = receiver.parseTaskAssignment(taskPrompt);

// Assignment contains:
// - taskRef: string
// - agentAssignment: string
// - memoryLogPath: string
// - executionType: 'single-step' | 'multi-step'
// - objective: string
// - detailedInstructions: string
// - expectedOutput: string

// Load dependency data from completed tasks
const dependencies = await receiver.loadDependencyData([
  '.apm/Memory/Phase_04/Task_4_1.md',
  '.apm/Memory/Phase_04/Task_4_2.md'
]);

// Extract outputs, issues, next steps from dependency logs
console.log('Dependency outputs:', dependencies.outputs);

// Initialize memory log
await receiver.initializeMemoryLog('.apm/Memory/Phase_04/Task_4_3.md', {
  agent: 'Agent_Implementation',
  taskRef: 'Task 4.3',
  status: 'InProgress'
});
```

#### Execution Monitoring

```typescript
import { ExecutionMonitor } from './execution';

// Initialize monitor
const monitor = new ExecutionMonitor();

// Start monitoring session
monitor.startMonitoring('task_4_3', {
  estimatedDurationMs: 3600000, // 1 hour
  healthCheckIntervalMs: 5000
});

// Record milestones
monitor.recordMilestone('task_4_3', {
  type: 'SubtaskCompleted',
  description: 'Step 1: Task receipt parsing complete',
  metadata: { stepNumber: 1 }
});

monitor.recordMilestone('task_4_3', {
  type: 'TestPassed',
  description: '28/28 tests passing',
  metadata: { testsRun: 28, testsPassed: 28 }
});

monitor.recordMilestone('task_4_3', {
  type: 'CoverageReached',
  description: 'Coverage: 95.79%',
  metadata: { coveragePercent: 95.79 }
});

// Update metrics
monitor.updateMetrics('task_4_3', {
  stepsCompleted: 1,
  testsRun: 28,
  coveragePercent: 95.79,
  filesCreated: 2,
  filesModified: 0
});

// Get current status
const status = monitor.getMonitoringStatus('task_4_3');
console.log('State:', status.state); // NotStarted | Active | Paused | Stopped
console.log('Time elapsed:', status.metrics.timeElapsedMs);
console.log('ETA:', status.metrics.estimatedCompletionMs);

// Listen for events
monitor.on('milestone_reached', ({ sessionId, milestone }) => {
  console.log(`Milestone: ${milestone.description}`);
});

monitor.on('anomaly_detected', ({ sessionId, anomaly }) => {
  console.warn(`Anomaly: ${anomaly.type} - ${anomaly.description}`);
});

// Pause/resume monitoring
monitor.pauseMonitoring('task_4_3');
monitor.resumeMonitoring('task_4_3');
```

#### Memory Log Validation

```typescript
import { MemoryLogValidator } from './execution';

// Initialize validator
const validator = new MemoryLogValidator();

// Validate memory log file
const result = await validator.validateMemoryLog('.apm/Memory/Phase_04/Task_4_3.md');

console.log('Valid:', result.valid);
console.log('Errors:', result.errors);
console.log('Warnings:', result.warnings);

// Check specific aspects
console.log('Has frontmatter:', result.hasFrontmatter);
console.log('Has required sections:', result.hasRequiredSections);
console.log('Meets completion criteria:', result.meetsCompletionCriteria);

// Detect progress patterns
const patterns = await validator.detectProgressPatterns(
  '.apm/Memory/Phase_04/Task_4_3.md'
);

console.log('Completion markers found:', patterns.completionMarkers);
console.log('Error indicators:', patterns.errorIndicators);
console.log('Blocker indicators:', patterns.blockerIndicators);

// Validation result structure:
// {
//   valid: boolean,
//   hasFrontmatter: boolean,
//   frontmatterValid: boolean,
//   hasRequiredSections: boolean,
//   hasInvalidHeaders: boolean,
//   meetsCompletionCriteria: boolean,
//   errors: string[],
//   warnings: string[]
// }
```

#### Completion Reporting

```typescript
import { CompletionReporter } from './execution';

// Initialize reporter
const reporter = new CompletionReporter();

// Detect completion from memory log
const completion = await reporter.detectCompletion('.apm/Memory/Phase_04/Task_4_3.md');

if (completion) {
  console.log('Status:', completion.status); // Completed | Partial
  console.log('Summary:', completion.summary);
  console.log('Outputs:', completion.outputs);
  console.log('Issues:', completion.issues);
  console.log('Next steps:', completion.nextSteps);
  console.log('Flags:', completion.flags); // adHocDelegation, compatibilityIssues, importantFindings
}

// Listen for completion events
reporter.on('task_completed', ({ memoryLogPath, completion }) => {
  console.log(`Task completed: ${memoryLogPath}`);
  console.log('Summary:', completion.summary);
});

reporter.on('task_partial', ({ memoryLogPath, completion }) => {
  console.log(`Task partially completed: ${memoryLogPath}`);
});

// Start auto-detection with polling
reporter.startAutoDetection('.apm/Memory/Phase_04/Task_4_3.md', {
  pollingIntervalMs: 5000 // Check every 5 seconds
});

// Stop auto-detection when done
reporter.stopAutoDetection('.apm/Memory/Phase_04/Task_4_3.md');
```

#### Error Escalation

```typescript
import { ErrorEscalator } from './execution';

// Initialize escalator
const escalator = new ErrorEscalator();

// Detect blockers in memory log
const blocker = await escalator.detectBlocker('.apm/Memory/Phase_04/Task_4_3.md');

if (blocker) {
  console.log('Category:', blocker.category); // ExternalDependency | AmbiguousRequirements | TestFailures | etc.
  console.log('Description:', blocker.description);
  console.log('Severity:', blocker.severity); // Critical | High | Medium | Low
  console.log('Blocking dependency:', blocker.blockingDependency); // For ExternalDependency category
}

// Listen for blocker events
escalator.on('task_blocked', ({ memoryLogPath, blocker }) => {
  console.error(`Task blocked: ${blocker.category}`);
  console.error(`Description: ${blocker.description}`);
  console.error(`Severity: ${blocker.severity}`);
});

escalator.on('blocker_resolved', ({ memoryLogPath, resolution }) => {
  console.log(`Blocker resolved: ${resolution}`);
});

// Update memory log to blocked state
await escalator.updateMemoryLogToBlocked(
  '.apm/Memory/Phase_04/Task_4_3.md',
  {
    category: 'ExternalDependency',
    description: 'Blocked by Task 4.2 output',
    severity: 'High',
    blockingDependency: 'Task 4.2'
  }
);

// Resolve blocker
await escalator.resolveBlocker(
  '.apm/Memory/Phase_04/Task_4_3.md',
  'Task 4.2 completed, dependency satisfied'
);

// Start auto-detection for blockers
escalator.startAutoDetection('.apm/Memory/Phase_04/Task_4_3.md', {
  pollingIntervalMs: 10000 // Check every 10 seconds
});
```

### Integration Pattern

Complete Implementation Agent workflow combining all components:

```typescript
import {
  TaskReceiver,
  ExecutionMonitor,
  MemoryLogValidator,
  CompletionReporter,
  ErrorEscalator
} from './execution';

// Initialize all components
const receiver = new TaskReceiver();
const monitor = new ExecutionMonitor();
const validator = new MemoryLogValidator();
const reporter = new CompletionReporter();
const escalator = new ErrorEscalator();

// 1. Receive and parse task assignment
const assignment = receiver.parseTaskAssignment(taskPromptString);
const dependencies = await receiver.loadDependencyData([
  '.apm/Memory/Phase_04/Task_4_1.md'
]);

// 2. Initialize memory log
await receiver.initializeMemoryLog(assignment.memoryLogPath, {
  agent: assignment.agentAssignment,
  taskRef: assignment.taskRef,
  status: 'InProgress'
});

// 3. Start monitoring
monitor.startMonitoring(assignment.taskRef);

// 4. Execute task and record progress
monitor.recordMilestone(assignment.taskRef, {
  type: 'SubtaskCompleted',
  description: 'Step 1 complete'
});

// 5. Validate memory log periodically
const validationResult = await validator.validateMemoryLog(assignment.memoryLogPath);
if (!validationResult.valid) {
  console.warn('Memory log validation errors:', validationResult.errors);
}

// 6. Monitor for completion
reporter.on('task_completed', async ({ memoryLogPath, completion }) => {
  // Stop monitoring
  monitor.stopMonitoring(assignment.taskRef);

  // Final validation
  const finalValidation = await validator.validateMemoryLog(memoryLogPath);
  if (finalValidation.meetsCompletionCriteria) {
    console.log('Task completed successfully');
  }
});

// 7. Monitor for blockers
escalator.on('task_blocked', async ({ memoryLogPath, blocker }) => {
  // Pause monitoring
  monitor.pauseMonitoring(assignment.taskRef);

  // Escalate to Manager
  console.error(`Escalating blocker: ${blocker.description}`);
});

// Start auto-detection
reporter.startAutoDetection(assignment.memoryLogPath, { pollingIntervalMs: 5000 });
escalator.startAutoDetection(assignment.memoryLogPath, { pollingIntervalMs: 10000 });
```

### Key Technical Insights

1. **Line-by-Line Parsing**: TaskReceiver uses state machine approach for markdown section extraction instead of regex, providing reliability with varied formatting and blank lines.

2. **EventEmitter Pattern**: All coordination components (ExecutionMonitor, CompletionReporter, ErrorEscalator) extend EventEmitter for Manager integration via events.

3. **gray-matter Library**: Used for YAML frontmatter parsing across all components, handles malformed YAML gracefully.

4. **Pattern Reuse**: Progress patterns from Task 4.2 ProgressMonitor reused in MemoryLogValidator for consistency (✓, ✅, [x], COMPLETE for completion; ERROR, FAILED for errors; BLOCKED for blockers).

5. **Multi-Line List Parsing**: Implements currentItem accumulation pattern for parsing multi-line list items in outputs/issues/next steps sections.

6. **Auto-Detection Optional**: Both CompletionReporter and ErrorEscalator support optional auto-detection with configurable polling intervals for Manager convenience.

7. **Severity Levels**: Blockers categorized by severity (Critical, High, Medium, Low) for Manager prioritization: ExternalDependency (High), AmbiguousRequirements (Medium), TestFailures (High), ResourceConstraints (Critical), DesignDecision (Medium).

8. **Milestone Types**: ExecutionMonitor supports 6 milestone types: SubtaskCompleted, TestPassed, DeliverableCreated, CoverageReached, BuildSuccessful, Custom.

9. **Anomaly Detection**: ExecutionMonitor detects 5 anomaly types: NoProgress, RepeatedErrors, ProcessUnhealthy, HighMemoryUsage, ExecutionTimeout.

10. **ETA Calculation**: ExecutionMonitor calculates estimated completion time using average time per step based on current progress.

## Task Completion Detection System (Task 4.4)

### Overview
The completion detection system provides automated monitoring and validation of task completion through memory log polling, status parsing, format validation, and database state updates through four integrated components:

1. **Completion Poller** (`src/completion/completion-poller.ts`)
2. **Completion Parser** (`src/completion/completion-parser.ts`)
3. **Log Validator** (`src/completion/log-validator.ts`)
4. **State Updater** (`src/completion/state-updater.ts`)

### Usage Examples

#### Memory File Polling

```typescript
import { CompletionPoller, PollingState, createCompletionPoller } from './completion';
import { MemoryFileWatcher } from './monitoring';

// Initialize components
const memoryWatcher = new MemoryFileWatcher('.apm/Memory');
const poller = createCompletionPoller(memoryWatcher, {
  activeTaskInterval: 1000,      // 1s for active tasks
  queuedTaskInterval: 5000,      // 5s for queued tasks
  completedTaskInterval: 30000,  // 30s for completed tasks
  pauseThresholdPolls: 10,       // Pause after 10 unchanged polls
  maxRetries: 3,
  retryDelays: [1000, 2000, 4000] // Exponential backoff
});

// Start polling for task
poller.startPolling(
  'Task_4_4',
  '.apm/Memory/Phase_04_Agent_Automation/Task_4_4_Task_Completion_Detection.md',
  PollingState.Active
);

// Listen for state detection
poller.on('state_detected', ({ taskId, state, timestamp }) => {
  console.log(`Task ${taskId} state: ${state} at ${timestamp}`);
});

// Listen for poll events
poller.on('poll_started', ({ taskId, pollingState }) => {
  console.log(`Polling ${taskId} in ${pollingState} mode`);
});

poller.on('poll_error', ({ taskId, error, retryAttempt }) => {
  console.error(`Poll error for ${taskId}: ${error} (retry ${retryAttempt})`);
});

// Pause/resume polling
poller.pausePolling('Task_4_4');
poller.resumePolling('Task_4_4');

// Stop polling
poller.stopPolling('Task_4_4');

// Get polling state
const state = poller.getPollingState('Task_4_4');
console.log('Last poll:', state?.lastPollTime);
console.log('Poll count:', state?.pollCount);
console.log('Detected state:', state?.lastDetectedState);
```

#### Completion Parsing

```typescript
import { CompletionParser, CompletionStatus, createCompletionParser } from './completion';

// Initialize parser
const parser = createCompletionParser();

// Parse completion from memory log
const result = await parser.parseCompletion(
  '.apm/Memory/Phase_04_Agent_Automation/Task_4_4_Task_Completion_Detection.md'
);

console.log('Status:', result.status); // Completed | Partial | InProgress | Blocked | Error
console.log('Deliverables:', result.deliverables);
console.log('Test results:', result.testResults); // { total, passed, coveragePercent }
console.log('Quality gates:', result.qualityGates); // { tdd, commits, security, coverage }
console.log('Confidence:', result.confidence); // 0-100

// Check specific statuses
if (result.status === CompletionStatus.Completed) {
  console.log('Task completed with', result.deliverables.length, 'deliverables');
  console.log('Tests:', result.testResults?.passed, '/', result.testResults?.total);
  console.log('Coverage:', result.testResults?.coveragePercent, '%');
}

// Handle ambiguous completion
if (result.ambiguous) {
  console.warn('Ambiguous completion detected');
  console.warn('Reasons:', result.ambiguityReasons);
}
```

#### Memory Log Validation

```typescript
import { LogValidator, ValidationStrictness, createLogValidator } from './completion';

// Initialize validator with strictness level
const validator = createLogValidator({
  strictness: ValidationStrictness.Strict // or Lenient, Audit
});

// Validate memory log
const validation = await validator.validateMemoryLog(
  '.apm/Memory/Phase_04_Agent_Automation/Task_4_4_Task_Completion_Detection.md'
);

console.log('Valid:', validation.valid);
console.log('Format correct:', validation.formatCorrect);
console.log('Content complete:', validation.contentComplete);
console.log('Sections present:', validation.sectionsPresent);

// Check errors and warnings
if (!validation.valid) {
  console.error('Validation errors:');
  validation.errors.forEach(err => {
    console.error(`  [${err.severity}] ${err.field || 'general'}: ${err.message}`);
  });
}

if (validation.warnings.length > 0) {
  console.warn('Validation warnings:');
  validation.warnings.forEach(warn => {
    console.warn(`  [${warn.severity}] ${warn.message}`);
  });
}

// Strictness level behavior
// - Strict: Errors block validation
// - Lenient: Only errors block, warnings allowed
// - Audit: Always valid, logs all issues
```

#### Database State Updates

```typescript
import { StateUpdater, TaskUpdateData, createStateUpdater } from './completion';
import { ConnectionManager } from './db/connection';

// Initialize components
const connectionManager = new ConnectionManager({ filename: '.apm-auto/state.db' });
await connectionManager.connect();

const updater = createStateUpdater(connectionManager);

// Listen for update events
updater.on('task_completed_db', ({ taskId, completedAt, deliverables, testResults }) => {
  console.log(`Task ${taskId} completed at ${completedAt}`);
  console.log('Deliverables:', deliverables);
  console.log('Test results:', testResults);
});

updater.on('agent_state_updated', ({ agentId, newState, oldState }) => {
  console.log(`Agent ${agentId}: ${oldState} → ${newState}`);
});

// Update task completion
const updateData: TaskUpdateData = {
  taskId: 'Task_4_4',
  agentId: 'Agent_Orchestration_Automation_2',
  status: 'Completed',
  deliverables: [
    'src/completion/completion-poller.ts',
    'src/completion/completion-parser.ts',
    'src/completion/log-validator.ts',
    'src/completion/state-updater.ts'
  ],
  testResults: {
    total: 85,
    passed: 85,
    coveragePercent: 87.94
  },
  qualityGates: {
    tdd: true,
    commits: true,
    security: true,
    coverage: true
  }
};

await updater.updateTaskCompletion(updateData);

// Query task completion data
const completion = await updater.getTaskCompletionData('Task_4_4');
if (completion) {
  console.log('Completed at:', completion.completedAt);
  console.log('Agent:', completion.agentId);
  console.log('Status:', completion.status);
}

// Get all completed tasks
const allCompleted = await updater.getAllCompletedTasks();
console.log('Total completed tasks:', allCompleted.length);
```

### Integration Pattern

Complete completion detection workflow combining all components:

```typescript
import {
  CompletionPoller,
  CompletionParser,
  LogValidator,
  StateUpdater,
  PollingState,
  ValidationStrictness
} from './completion';
import { MemoryFileWatcher } from './monitoring';
import { ConnectionManager } from './db/connection';

// Initialize all components
const memoryWatcher = new MemoryFileWatcher('.apm/Memory');
const poller = new CompletionPoller(memoryWatcher);
const parser = new CompletionParser();
const validator = new LogValidator({ strictness: ValidationStrictness.Strict });
const connectionManager = new ConnectionManager({ filename: '.apm-auto/state.db' });
await connectionManager.connect();
const updater = new StateUpdater(connectionManager);

// 1. Start polling for task
const taskId = 'Task_4_4';
const memoryLogPath = '.apm/Memory/Phase_04_Agent_Automation/Task_4_4_Task_Completion_Detection.md';

poller.startPolling(taskId, memoryLogPath, PollingState.Active);

// 2. Monitor for state changes
poller.on('state_detected', async ({ taskId, state }) => {
  console.log(`State detected: ${state}`);

  // Parse completion
  const completion = await parser.parseCompletion(memoryLogPath);

  if (completion.status === 'Completed') {
    // Validate memory log
    const validation = await validator.validateMemoryLog(memoryLogPath);

    if (!validation.valid) {
      console.error('Memory log validation failed:', validation.errors);
      return;
    }

    // Update database
    await updater.updateTaskCompletion({
      taskId,
      agentId: 'Agent_Orchestration_Automation_2',
      status: completion.status,
      deliverables: completion.deliverables,
      testResults: completion.testResults,
      qualityGates: completion.qualityGates
    });

    // Stop polling
    poller.stopPolling(taskId);
  }
});

// 3. Handle errors with retry
poller.on('poll_error', ({ taskId, error, retryAttempt }) => {
  console.error(`Poll error (attempt ${retryAttempt}): ${error}`);
});
```

### Key Technical Insights

1. **Adaptive Polling**: Different intervals based on task state (1s active, 5s queued, 30s completed) reduces unnecessary file system operations.

2. **MemoryFileWatcher Integration**: Poller subscribes to file-event emissions for real-time change detection instead of pure polling.

3. **Exponential Backoff Retry**: Implements 1s, 2s, 4s delay pattern for transient file access errors (locked files, temporary unavailability).

4. **Multiple Test Result Formats**: Parser handles various documentation formats ("X/Y tests passing", "Tests: X/Y passing", "X tests, Y passed").

5. **Confidence Scoring**: Combines multiple signals (status, deliverables, test results, quality gates, content length) to calculate 0-100 confidence score.

6. **Validation Strictness Levels**: Three-tier system (Strict, Lenient, Audit) for different validation requirements - Audit mode logs issues without blocking.

7. **Conditional Section Validation**: LogValidator enforces conditional sections based on frontmatter flags (ad_hoc_delegation, compatibility_issues, important_findings).

8. **Atomic Database Transactions**: StateUpdater wraps all database operations in transactions ensuring consistency across task_completions, agents, and state_transitions tables.

9. **Agent State Transitions**: Automatically transitions agents from Active to Waiting status when task completes, clearing current_task field.

10. **Event-Driven Coordination**: All components extend EventEmitter for loose coupling and Manager integration via events.

## Quality Standards

- Test Pass Rate: 100% required (no exceptions)
- Code Coverage: 80% minimum, 90%+ target
- Zero flaky tests: Must run suite 5 times successfully
- TypeScript: Strict mode with no implicit any
- Commits: Conventional commits format required
- TDD: Tests before implementation

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run spawn module tests
npm test -- tests/spawn

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

### Code Coverage

```bash
# Generate coverage report
npm test -- --coverage

# View coverage in browser
open coverage/index.html
```

## Documentation

- Implementation Plan: `.apm/Implementation_Plan.md`
- Memory System: `.apm/Memory/Memory_Root.md`
- Task Assignments: `.apm/task-assignments/`
- APM Guides: `.apm/guides/`

## Contributing

All changes must:
1. Pass 100% of existing tests
2. Achieve 80%+ code coverage
3. Follow conventional commits format
4. Include comprehensive test suites
5. Document important findings in memory logs
