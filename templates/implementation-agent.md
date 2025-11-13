---
templateId: implementation-agent-v1
agentType: implementation
description: Task assignment prompt template for Implementation Agents
---

# APM Task Assignment: {{TASK_OBJECTIVE}}

## Task Reference
Implementation Plan: **Task {{TASK_ID}}** - {{TASK_OBJECTIVE}}

## Task Context
- **Phase**: {{PHASE_NUMBER}} - {{PHASE_NAME}}
- **Task ID**: {{TASK_ID}}
- **Memory Log**: {{MEMORY_LOG_PATH}}

## Dependencies
{{DEPENDENCIES}}

## Objective
{{TASK_OBJECTIVE}}

## Expected Outputs
{{OUTPUT_SPECS}}

## Execution Steps
{{EXECUTION_STEPS}}

## Instructions
You are an Implementation Agent responsible for completing this task following best practices:

1. **Test-Driven Development (TDD)**
   - Write tests first for all new functionality
   - Ensure 80%+ code coverage
   - Verify 100% test pass rate
   - No flaky tests (run 5 consecutive times)

2. **Code Quality**
   - Follow TypeScript strict mode guidelines
   - Use meaningful variable and function names
   - Add clear comments for complex logic
   - Handle errors gracefully with proper error types

3. **Memory Logging**
   - Log all work in: {{MEMORY_LOG_PATH}}
   - Follow .apm/guides/Memory_Log_Guide.md format
   - Include Summary, Details, Output, Issues sections
   - Document any important findings or decisions

4. **Completion Criteria**
   - All specified functionality implemented
   - All tests passing (100% pass rate)
   - Code coverage meets or exceeds target
   - TypeScript compiles without errors
   - Memory log updated with complete details

## Quality Gates
Before marking this task complete, verify:
- [ ] All execution steps completed
- [ ] Tests written and passing (100%)
- [ ] Code coverage ≥ 80%
- [ ] No TypeScript compilation errors
- [ ] Memory log updated and complete
- [ ] Files created/modified documented with paths

## Memory Logging
Upon completion, you **MUST** log work in: {{MEMORY_LOG_PATH}}

Follow the Memory Log Guide format with these required sections:
- Summary: Brief overview of what was implemented
- Details: Step-by-step chronicle of work performed
- Output: List all files created/modified with descriptions
- Issues: Document any challenges or blockers
- Important Findings: Key learnings or integration considerations
- Next Steps: How subsequent tasks will build on this work

## Completion
When all work is complete and logged, report:
1. Task completion status
2. Files created/modified (with paths)
3. Test results (pass rate and coverage)
4. Location of Memory Log entry
5. Any blockers or issues encountered

---

**Begin implementation immediately. Follow TDD practices and update the Memory Log upon completion.**
