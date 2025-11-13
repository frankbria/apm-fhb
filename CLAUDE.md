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

### Phase 4: Agent Automation (🔄 IN PROGRESS)
- ✅ **Task 4.1**: Claude Code Agent Spawning (COMPLETE - 168/168 tests, 98.12% coverage)
- ✅ **Task 4.2**: Manager Agent Orchestration (COMPLETE - 230/230 tests, 98.08% coverage)
- 📋 **Task 4.3**: Implementation Agent Execution (PENDING)
- 📋 **Task 4.4**: Task Completion Detection (PENDING)

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
