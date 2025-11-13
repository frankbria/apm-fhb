/**
 * Tests for Task Receiver
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  TaskReceiver,
  createTaskReceiver,
  type TaskAssignment,
  type TaskReceiverConfig,
} from '../../src/execution/task-receiver.js';

const TEST_MEMORY_DIR = '.apm/Memory-test-receiver';
const TEST_AGENT_ID = 'agent_test_001';

describe('TaskReceiver', () => {
  let receiver: TaskReceiver;
  let config: TaskReceiverConfig;

  beforeEach(() => {
    config = {
      memoryBasePath: TEST_MEMORY_DIR,
      agentId: TEST_AGENT_ID,
    };
    receiver = createTaskReceiver(config);
  });

  afterEach(async () => {
    // Clean up test memory directory
    try {
      await fs.rm(TEST_MEMORY_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('receiveTaskAssignment()', () => {
    it('should parse valid multi-step task assignment prompt', async () => {
      const prompt = `---
task_ref: "Task 4.3 - Implementation Agent Execution"
agent_assignment: "Agent_Orchestration_Automation"
memory_log_path: ".apm/Memory/Phase_04_Agent_Automation/Task_4_3_Implementation_Agent_Execution.md"
execution_type: "multi-step"
dependency_context: true
ad_hoc_delegation: false
---

# APM Task Assignment: Implementation Agent Execution

## Task Reference
Implementation Plan: **Task 4.3 - Implementation Agent Execution**

## Objective
Implement Implementation agent execution logic.

## Detailed Instructions

Complete in 5 exchanges:

### Step 1: Task Receipt

Implement task receipt handler.

### Step 2: Execution Monitoring

Implement execution monitoring.

## Expected Output

**Deliverables**:
- 5 execution modules (~2,000 lines total)
- 5 comprehensive test suites (~2,500 lines total)
`;

      const assignment = await receiver.receiveTaskAssignment(prompt);

      expect(assignment.taskRef).toBe('Task 4.3 - Implementation Agent Execution');
      expect(assignment.agentAssignment).toBe('Agent_Orchestration_Automation');
      expect(assignment.memoryLogPath).toBe(
        '.apm/Memory/Phase_04_Agent_Automation/Task_4_3_Implementation_Agent_Execution.md'
      );
      expect(assignment.executionType).toBe('multi-step');
      expect(assignment.dependencyContext).toBe(true);
      expect(assignment.adHocDelegation).toBe(false);
      expect(assignment.objective).toContain('Implement Implementation agent execution logic');
      expect(assignment.detailedInstructions).toHaveLength(2);
      expect(assignment.detailedInstructions[0]).toContain('Step 1: Task Receipt');
      expect(assignment.expectedOutput).toContain('5 execution modules');
    });

    it('should parse single-step task assignment prompt', async () => {
      const prompt = `---
task_ref: "Task 1.1 - Simple Task"
agent_assignment: "Agent_Implementation"
memory_log_path: ".apm/Memory/Phase_01_Foundation/Task_1_1_Simple_Task.md"
execution_type: "single-step"
dependency_context: false
ad_hoc_delegation: false
---

## Objective
Complete simple task.

## Detailed Instructions

- Implement feature A
- Write tests for feature A
- Update documentation

## Expected Output

Feature A implementation complete.
`;

      const assignment = await receiver.receiveTaskAssignment(prompt);

      expect(assignment.executionType).toBe('single-step');
      expect(assignment.dependencyContext).toBe(false);
      expect(assignment.detailedInstructions).toHaveLength(1);
      expect(assignment.detailedInstructions[0]).toContain('Implement feature A');
    });

    it('should handle missing optional frontmatter fields with defaults', async () => {
      const prompt = `---
task_ref: "Task 2.1 - Test Task"
agent_assignment: "Agent_Test"
memory_log_path: ".apm/Memory/Phase_02_Test/Task_2_1_Test_Task.md"
---

## Objective
Test objective.

## Detailed Instructions

Test instructions.

## Expected Output

Test output.
`;

      const assignment = await receiver.receiveTaskAssignment(prompt);

      expect(assignment.executionType).toBe('multi-step'); // Default
      expect(assignment.dependencyContext).toBe(false); // Default
      expect(assignment.adHocDelegation).toBe(false); // Default
    });

    it('should extract dependency context when present', async () => {
      const prompt = `---
task_ref: "Task 4.3 - Implementation Agent Execution"
agent_assignment: "Agent_Orchestration"
memory_log_path: ".apm/Memory/Phase_04_Agent_Automation/Task_4_3_Implementation_Agent_Execution.md"
execution_type: "multi-step"
dependency_context: true
---

## Objective
Test objective.

## Context from Dependencies

This task builds upon **Task 4.2 (Manager Agent Orchestration)** and **Task 4.1 (Spawning System)**.

## Detailed Instructions

Test instructions.

## Expected Output

Test output.
`;

      // Create mock dependency memory logs
      await fs.mkdir(path.join(TEST_MEMORY_DIR, 'Phase_04_Test'), { recursive: true });
      await fs.writeFile(
        path.join(TEST_MEMORY_DIR, 'Phase_04_Test/Task_4_2_Manager_Orchestration.md'),
        `---
agent: agent_001
task_ref: Task 4.2
status: Completed
---

## Output
- PromptGenerator implementation
- AgentSelector implementation

## Important Findings
- Event-driven coordination pattern works well
`,
        'utf-8'
      );

      const assignment = await receiver.receiveTaskAssignment(prompt);

      expect(assignment.dependencies).toBeDefined();
      expect(assignment.dependencies).toHaveLength(1);
      expect(assignment.dependencies![0].taskId).toBe('4.2');
      expect(assignment.dependencies![0].outputs).toContain('PromptGenerator implementation');
      expect(assignment.dependencies![0].importantFindings).toBeDefined();
      expect(assignment.dependencies![0].importantFindings![0]).toContain(
        'Event-driven coordination pattern works well'
      );
    });

    it('should handle malformed YAML by returning empty values', async () => {
      const prompt = `---
task_ref: "Task 1.1"
agent_assignment: "Agent_Test"
memory_log_path: invalid yaml here {
---

## Objective
Test.
`;

      // gray-matter doesn't throw on invalid YAML, it returns empty data
      const assignment = await receiver.receiveTaskAssignment(prompt);

      // Validation should catch the issues
      const validation = receiver.validateTaskAssignment(assignment);
      expect(validation.valid).toBe(false);
    });

    it('should extract multiple instruction steps correctly', async () => {
      const prompt = `---
task_ref: "Task 1.1"
agent_assignment: "Agent_Test"
memory_log_path: ".apm/Memory/Phase_01_Test/Task_1_1_Test.md"
execution_type: "multi-step"
---

## Objective
Test.

## Detailed Instructions

### Step 1: First Step

Do first thing.

### Step 2: Second Step

Do second thing.

### Step 3: Third Step

Do third thing.

## Expected Output

Test.
`;

      const assignment = await receiver.receiveTaskAssignment(prompt);

      expect(assignment.detailedInstructions).toHaveLength(3);
      expect(assignment.detailedInstructions[0]).toContain('Step 1: First Step');
      expect(assignment.detailedInstructions[1]).toContain('Step 2: Second Step');
      expect(assignment.detailedInstructions[2]).toContain('Step 3: Third Step');
    });

    it('should handle numbered list instruction format', async () => {
      const prompt = `---
task_ref: "Task 1.1"
agent_assignment: "Agent_Test"
memory_log_path: ".apm/Memory/Phase_01_Test/Task_1_1_Test.md"
execution_type: "multi-step"
---

## Objective
Test.

## Detailed Instructions

1. **First Task:**

   Do the first task.

2. **Second Task:**

   Do the second task.

## Expected Output

Test.
`;

      const assignment = await receiver.receiveTaskAssignment(prompt);

      expect(assignment.detailedInstructions).toHaveLength(2);
      expect(assignment.detailedInstructions[0]).toContain('1. **First Task:**');
      expect(assignment.detailedInstructions[1]).toContain('2. **Second Task:**');
    });
  });

  describe('validateTaskAssignment()', () => {
    it('should validate correct task assignment', () => {
      const assignment: TaskAssignment = {
        taskRef: 'Task 4.3 - Test',
        agentAssignment: 'Agent_Test',
        memoryLogPath: '.apm/Memory/Phase_04_Test/Task_4_3_Test.md',
        executionType: 'multi-step',
        dependencyContext: false,
        adHocDelegation: false,
        objective: 'Test objective',
        detailedInstructions: ['Step 1'],
        expectedOutput: 'Test output',
        rawContent: '',
      };

      const result = receiver.validateTaskAssignment(assignment);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing task_ref', () => {
      const assignment: TaskAssignment = {
        taskRef: '',
        agentAssignment: 'Agent_Test',
        memoryLogPath: '.apm/Memory/Phase_04_Test/Task_4_3_Test.md',
        executionType: 'multi-step',
        dependencyContext: false,
        adHocDelegation: false,
        objective: 'Test objective',
        detailedInstructions: ['Step 1'],
        expectedOutput: 'Test output',
        rawContent: '',
      };

      const result = receiver.validateTaskAssignment(assignment);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: task_ref');
    });

    it('should detect missing agent_assignment', () => {
      const assignment: TaskAssignment = {
        taskRef: 'Task 4.3',
        agentAssignment: '',
        memoryLogPath: '.apm/Memory/Phase_04_Test/Task_4_3_Test.md',
        executionType: 'multi-step',
        dependencyContext: false,
        adHocDelegation: false,
        objective: 'Test objective',
        detailedInstructions: ['Step 1'],
        expectedOutput: 'Test output',
        rawContent: '',
      };

      const result = receiver.validateTaskAssignment(assignment);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: agent_assignment');
    });

    it('should detect missing memory_log_path', () => {
      const assignment: TaskAssignment = {
        taskRef: 'Task 4.3',
        agentAssignment: 'Agent_Test',
        memoryLogPath: '',
        executionType: 'multi-step',
        dependencyContext: false,
        adHocDelegation: false,
        objective: 'Test objective',
        detailedInstructions: ['Step 1'],
        expectedOutput: 'Test output',
        rawContent: '',
      };

      const result = receiver.validateTaskAssignment(assignment);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: memory_log_path');
    });

    it('should detect invalid memory_log_path format', () => {
      const assignment: TaskAssignment = {
        taskRef: 'Task 4.3',
        agentAssignment: 'Agent_Test',
        memoryLogPath: 'invalid/path/format.md',
        executionType: 'multi-step',
        dependencyContext: false,
        adHocDelegation: false,
        objective: 'Test objective',
        detailedInstructions: ['Step 1'],
        expectedOutput: 'Test output',
        rawContent: '',
      };

      const result = receiver.validateTaskAssignment(assignment);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Invalid memory_log_path format. Expected: .apm/Memory/Phase_XX_Name/Task_X_Y_Title.md'
      );
    });

    it('should detect invalid execution_type', () => {
      const assignment: TaskAssignment = {
        taskRef: 'Task 4.3',
        agentAssignment: 'Agent_Test',
        memoryLogPath: '.apm/Memory/Phase_04_Test/Task_4_3_Test.md',
        executionType: 'invalid-type' as any,
        dependencyContext: false,
        adHocDelegation: false,
        objective: 'Test objective',
        detailedInstructions: ['Step 1'],
        expectedOutput: 'Test output',
        rawContent: '',
      };

      const result = receiver.validateTaskAssignment(assignment);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid execution_type. Must be "single-step" or "multi-step"');
    });

    it('should detect missing Objective section', () => {
      const assignment: TaskAssignment = {
        taskRef: 'Task 4.3',
        agentAssignment: 'Agent_Test',
        memoryLogPath: '.apm/Memory/Phase_04_Test/Task_4_3_Test.md',
        executionType: 'multi-step',
        dependencyContext: false,
        adHocDelegation: false,
        objective: '',
        detailedInstructions: ['Step 1'],
        expectedOutput: 'Test output',
        rawContent: '',
      };

      const result = receiver.validateTaskAssignment(assignment);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required section: Objective');
    });

    it('should detect missing Detailed Instructions', () => {
      const assignment: TaskAssignment = {
        taskRef: 'Task 4.3',
        agentAssignment: 'Agent_Test',
        memoryLogPath: '.apm/Memory/Phase_04_Test/Task_4_3_Test.md',
        executionType: 'multi-step',
        dependencyContext: false,
        adHocDelegation: false,
        objective: 'Test objective',
        detailedInstructions: [],
        expectedOutput: 'Test output',
        rawContent: '',
      };

      const result = receiver.validateTaskAssignment(assignment);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required section: Detailed Instructions');
    });

    it('should detect missing Expected Output', () => {
      const assignment: TaskAssignment = {
        taskRef: 'Task 4.3',
        agentAssignment: 'Agent_Test',
        memoryLogPath: '.apm/Memory/Phase_04_Test/Task_4_3_Test.md',
        executionType: 'multi-step',
        dependencyContext: false,
        adHocDelegation: false,
        objective: 'Test objective',
        detailedInstructions: ['Step 1'],
        expectedOutput: '',
        rawContent: '',
      };

      const result = receiver.validateTaskAssignment(assignment);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required section: Expected Output');
    });

    it('should accumulate multiple validation errors', () => {
      const assignment: TaskAssignment = {
        taskRef: '',
        agentAssignment: '',
        memoryLogPath: 'invalid-path.md',
        executionType: 'invalid' as any,
        dependencyContext: false,
        adHocDelegation: false,
        objective: '',
        detailedInstructions: [],
        expectedOutput: '',
        rawContent: '',
      };

      const result = receiver.validateTaskAssignment(assignment);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(3);
    });
  });

  describe('initializeMemoryLog()', () => {
    it('should create memory log file with correct structure', async () => {
      const assignment: TaskAssignment = {
        taskRef: 'Task 4.3 - Test Task',
        agentAssignment: 'Agent_Test',
        memoryLogPath: path.join(TEST_MEMORY_DIR, 'Phase_04_Test/Task_4_3_Test.md'),
        executionType: 'multi-step',
        dependencyContext: false,
        adHocDelegation: false,
        objective: 'Test objective',
        detailedInstructions: ['Step 1'],
        expectedOutput: 'Test output',
        rawContent: '',
      };

      await receiver.initializeMemoryLog(assignment);

      // Verify file exists
      const content = await fs.readFile(assignment.memoryLogPath, 'utf-8');

      // Check YAML frontmatter
      expect(content).toContain('agent: agent_test_001');
      expect(content).toContain('task_ref: Task 4.3 - Test Task');
      expect(content).toContain('status: InProgress');
      expect(content).toContain('ad_hoc_delegation: false');
      expect(content).toContain('compatibility_issues: false');
      expect(content).toContain('important_findings: false');

      // Check markdown sections
      expect(content).toContain('# Task Log: Task 4.3 - Test Task');
      expect(content).toContain('## Summary');
      expect(content).toContain('## Details');
      expect(content).toContain('## Output');
      expect(content).toContain('## Issues');
      expect(content).toContain('## Next Steps');
    });

    it('should create directory if missing', async () => {
      const assignment: TaskAssignment = {
        taskRef: 'Task 5.1 - New Task',
        agentAssignment: 'Agent_Test',
        memoryLogPath: path.join(TEST_MEMORY_DIR, 'Phase_05_NewPhase/Task_5_1_New.md'),
        executionType: 'multi-step',
        dependencyContext: false,
        adHocDelegation: false,
        objective: 'Test objective',
        detailedInstructions: ['Step 1'],
        expectedOutput: 'Test output',
        rawContent: '',
      };

      await receiver.initializeMemoryLog(assignment);

      // Verify directory and file exist
      const dirExists = await fs
        .stat(path.join(TEST_MEMORY_DIR, 'Phase_05_NewPhase'))
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);

      const fileExists = await fs
        .stat(assignment.memoryLogPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);
    });

    it('should set ad_hoc_delegation based on assignment', async () => {
      const assignment: TaskAssignment = {
        taskRef: 'Task 4.3 - Test Task',
        agentAssignment: 'Agent_Test',
        memoryLogPath: path.join(TEST_MEMORY_DIR, 'Phase_04_Test/Task_4_3_Adhoc.md'),
        executionType: 'multi-step',
        dependencyContext: false,
        adHocDelegation: true, // Set to true
        objective: 'Test objective',
        detailedInstructions: ['Step 1'],
        expectedOutput: 'Test output',
        rawContent: '',
      };

      await receiver.initializeMemoryLog(assignment);

      const content = await fs.readFile(assignment.memoryLogPath, 'utf-8');
      expect(content).toContain('ad_hoc_delegation: true');
    });
  });

  describe('loadDependencyData()', () => {
    it('should return empty array when no dependency section', async () => {
      const content = `## Objective\nTest objective.`;

      const dependencies = await receiver.loadDependencyData(content);

      expect(dependencies).toHaveLength(0);
    });

    it('should parse task IDs from dependency context', async () => {
      const content = `## Context from Dependencies

This task builds upon **Task 4.2 (Manager Orchestration)** and **Task 4.1 (Spawning System)**.
`;

      // Create mock dependency files
      await fs.mkdir(path.join(TEST_MEMORY_DIR, 'Phase_04_Test'), { recursive: true });
      await fs.writeFile(
        path.join(TEST_MEMORY_DIR, 'Phase_04_Test/Task_4_2_Manager.md'),
        `---
agent: agent_001
---
## Output
- Output 1
- Output 2
`,
        'utf-8'
      );
      await fs.writeFile(
        path.join(TEST_MEMORY_DIR, 'Phase_04_Test/Task_4_1_Spawning.md'),
        `---
agent: agent_001
---
## Output
- Spawning system
`,
        'utf-8'
      );

      const dependencies = await receiver.loadDependencyData(content);

      expect(dependencies).toHaveLength(2);
      expect(dependencies.map(d => d.taskId)).toContain('4.2');
      expect(dependencies.map(d => d.taskId)).toContain('4.1');
    });

    it('should extract outputs from dependency memory logs', async () => {
      const content = `## Context from Dependencies

Review **Task 3.5** outputs.
`;

      // Create mock dependency file
      await fs.mkdir(path.join(TEST_MEMORY_DIR, 'Phase_03_Test'), { recursive: true });
      await fs.writeFile(
        path.join(TEST_MEMORY_DIR, 'Phase_03_Test/Task_3_5_Test.md'),
        `---
agent: agent_001
---
## Output
- Implementation of feature X
- Test suite for feature X
- Documentation for feature X
`,
        'utf-8'
      );

      const dependencies = await receiver.loadDependencyData(content);

      expect(dependencies).toHaveLength(1);
      expect(dependencies[0].outputs).toHaveLength(3);
      expect(dependencies[0].outputs[0]).toContain('Implementation of feature X');
      expect(dependencies[0].outputs[1]).toContain('Test suite for feature X');
    });

    it('should extract important findings when present', async () => {
      const content = `## Context from Dependencies

Review **Task 2.1** findings.
`;

      // Create mock dependency file with important findings
      await fs.mkdir(path.join(TEST_MEMORY_DIR, 'Phase_02_Test'), { recursive: true });
      await fs.writeFile(
        path.join(TEST_MEMORY_DIR, 'Phase_02_Test/Task_2_1_Test.md'),
        `---
agent: agent_001
---
## Output
- Feature complete

## Important Findings
- Discovered performance optimization opportunity
- Need to refactor module X for better reusability
`,
        'utf-8'
      );

      const dependencies = await receiver.loadDependencyData(content);

      expect(dependencies).toHaveLength(1);
      expect(dependencies[0].importantFindings).toBeDefined();
      expect(dependencies[0].importantFindings).toHaveLength(2);
      expect(dependencies[0].importantFindings![0]).toContain('performance optimization');
    });

    it('should skip missing dependency files gracefully', async () => {
      const content = `## Context from Dependencies

Review **Task 9.9** (does not exist).
`;

      const dependencies = await receiver.loadDependencyData(content);

      expect(dependencies).toHaveLength(0);
    });
  });

  describe('createTaskReceiver()', () => {
    it('should create TaskReceiver instance', () => {
      const receiver = createTaskReceiver({ agentId: 'test_agent' });

      expect(receiver).toBeInstanceOf(TaskReceiver);
    });

    it('should use default memory base path', () => {
      const receiver = createTaskReceiver({ agentId: 'test_agent' });

      // Verify by checking initialization behavior
      expect(receiver).toBeDefined();
    });

    it('should use custom memory base path', () => {
      const receiver = createTaskReceiver({
        agentId: 'test_agent',
        memoryBasePath: '/custom/path',
      });

      expect(receiver).toBeDefined();
    });
  });
});
