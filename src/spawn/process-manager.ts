/**
 * Process Manager
 *
 * Manages lifecycle of spawned Claude agent processes with output capture,
 * status tracking, and graceful termination.
 */

import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import type { Readable } from 'stream';

/**
 * Process status
 */
export enum ProcessStatus {
  Spawning = 'spawning',
  Running = 'running',
  Exited = 'exited',
  Failed = 'failed',
}

/**
 * Process information
 */
export interface ProcessInfo {
  /** Agent ID */
  agentId: string;
  /** Process ID */
  pid: number;
  /** Spawn timestamp */
  spawnedAt: Date;
  /** Current status */
  status: ProcessStatus;
  /** Exit code (if exited) */
  exitCode?: number;
  /** Exit signal (if killed) */
  exitSignal?: string;
}

/**
 * Output buffer for a single stream
 */
interface OutputBuffer {
  /** Buffered lines (max 1000) */
  lines: string[];
  /** Maximum buffer size */
  maxSize: number;
}

/**
 * Tracked process with buffers
 */
interface TrackedProcess {
  /** Process info */
  info: ProcessInfo;
  /** Child process reference */
  process: ChildProcess;
  /** Stdout buffer */
  stdoutBuffer: OutputBuffer;
  /** Stderr buffer */
  stderrBuffer: OutputBuffer;
}

/**
 * Status marker patterns
 */
const STATUS_MARKERS = {
  READY: /\[APM_STATUS:READY\]/,
  ERROR: /\[APM_STATUS:ERROR\]/,
  COMPLETE: /\[APM_STATUS:COMPLETE\]/,
  BLOCKED: /\[APM_STATUS:BLOCKED\]/,
};

/**
 * Process Manager Event Types
 */
export interface ProcessManagerEvents {
  'process-spawned': (agentId: string, pid: number) => void;
  'process-output': (agentId: string, stream: 'stdout' | 'stderr', data: string) => void;
  'process-error': (agentId: string, error: Error) => void;
  'process-exit': (agentId: string, code: number | null, signal: string | null) => void;
  'status-marker': (agentId: string, marker: string, line: string) => void;
}

/**
 * Process Manager
 * Manages spawned Claude agent processes with output capture and lifecycle tracking
 */
export class ProcessManager extends EventEmitter {
  private processes: Map<string, TrackedProcess> = new Map();
  private readonly defaultMaxBufferSize = 1000;

  /**
   * Register a spawned process for tracking
   * 
   * @param agentId - Unique agent identifier
   * @param process - Spawned child process
   * @returns ProcessInfo for the registered process
   */
  registerProcess(agentId: string, process: ChildProcess): ProcessInfo {
    if (this.processes.has(agentId)) {
      throw new Error(`Process with agentId ${agentId} is already registered`);
    }

    if (!process.pid) {
      throw new Error('Process does not have a PID');
    }

    // Create process info
    const info: ProcessInfo = {
      agentId,
      pid: process.pid,
      spawnedAt: new Date(),
      status: ProcessStatus.Spawning,
    };

    // Create tracked process
    const tracked: TrackedProcess = {
      info,
      process,
      stdoutBuffer: {
        lines: [],
        maxSize: this.defaultMaxBufferSize,
      },
      stderrBuffer: {
        lines: [],
        maxSize: this.defaultMaxBufferSize,
      },
    };

    // Store tracked process
    this.processes.set(agentId, tracked);

    // Attach stream handlers
    this.attachStreamHandlers(agentId, tracked);

    // Attach exit handler
    this.attachExitHandler(agentId, tracked);

    // Update status to running
    tracked.info.status = ProcessStatus.Running;

    // Emit spawned event
    this.emit('process-spawned', agentId, process.pid);

    return { ...info };
  }

  /**
   * Capture output from a stream
   * 
   * @param agentId - Agent identifier
   * @param stream - Stream type ('stdout' or 'stderr')
   * @param data - Output data
   */
  captureOutput(agentId: string, stream: 'stdout' | 'stderr', data: string): void {
    const tracked = this.processes.get(agentId);
    if (!tracked) {
      return;
    }

    // Select buffer based on stream
    const buffer = stream === 'stdout' ? tracked.stdoutBuffer : tracked.stderrBuffer;

    // Split data into lines
    const lines = data.toString().split('\n');

    // Add lines to buffer (FIFO with size limit)
    for (const line of lines) {
      if (line.trim()) {
        // Check if buffer is full
        if (buffer.lines.length >= buffer.maxSize) {
          // Remove oldest line (FIFO)
          buffer.lines.shift();
        }
        buffer.lines.push(line);

        // Parse for status markers
        this.parseStatusMarkers(agentId, line);
      }
    }

    // Emit output event
    this.emit('process-output', agentId, stream, data);
  }

  /**
   * Get buffered output for an agent
   * 
   * @param agentId - Agent identifier
   * @returns Buffered stdout and stderr, or undefined if not found
   */
  getOutput(agentId: string): { stdout: string[]; stderr: string[] } | undefined {
    const tracked = this.processes.get(agentId);
    if (!tracked) {
      return undefined;
    }

    return {
      stdout: [...tracked.stdoutBuffer.lines],
      stderr: [...tracked.stderrBuffer.lines],
    };
  }

  /**
   * Terminate a process gracefully (SIGTERM) with fallback to SIGKILL
   * 
   * @param agentId - Agent identifier
   * @param timeout - Timeout in milliseconds before SIGKILL (default: 10000ms)
   * @returns Promise that resolves when process is terminated
   */
  async terminateProcess(agentId: string, timeout: number = 10000): Promise<void> {
    const tracked = this.processes.get(agentId);
    if (!tracked) {
      throw new Error(`Process with agentId ${agentId} not found`);
    }

    const { process } = tracked;

    // Check if already exited
    if (process.killed || process.exitCode !== null) {
      return;
    }

    // Send SIGTERM
    const terminated = process.kill('SIGTERM');
    if (!terminated) {
      // Process already dead or couldn't send signal
      return;
    }

    // Wait for graceful exit with timeout
    return new Promise<void>((resolve) => {
      let timeoutId: NodeJS.Timeout | undefined;
      let resolved = false;

      const onExit = () => {
        if (!resolved) {
          resolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          resolve();
        }
      };

      // Listen for exit
      process.once('exit', onExit);

      // Set timeout for SIGKILL
      timeoutId = setTimeout(() => {
        if (!resolved && !process.killed) {
          // Force kill with SIGKILL
          process.kill('SIGKILL');
          onExit();
        }
      }, timeout);
    });
  }

  /**
   * Check if a process is still running
   * 
   * @param agentId - Agent identifier
   * @returns True if process is running, false otherwise
   */
  isRunning(agentId: string): boolean {
    const tracked = this.processes.get(agentId);
    if (!tracked) {
      return false;
    }

    const { info, process } = tracked;
    return (
      info.status === ProcessStatus.Running &&
      !process.killed &&
      process.exitCode === null
    );
  }

  /**
   * Get all active processes
   * 
   * @returns Array of ProcessInfo for active processes
   */
  getActiveProcesses(): ProcessInfo[] {
    const activeProcesses: ProcessInfo[] = [];

    for (const tracked of this.processes.values()) {
      if (this.isRunning(tracked.info.agentId)) {
        activeProcesses.push({ ...tracked.info });
      }
    }

    return activeProcesses;
  }

  /**
   * Get process info by agent ID
   * 
   * @param agentId - Agent identifier
   * @returns ProcessInfo or undefined if not found
   */
  getProcessInfo(agentId: string): ProcessInfo | undefined {
    const tracked = this.processes.get(agentId);
    return tracked ? { ...tracked.info } : undefined;
  }

  /**
   * Cleanup a process from tracking
   * 
   * @param agentId - Agent identifier
   */
  private cleanup(agentId: string): void {
    this.processes.delete(agentId);
  }

  /**
   * Attach stream handlers to process
   */
  private attachStreamHandlers(agentId: string, tracked: TrackedProcess): void {
    const { process } = tracked;

    // Attach stdout handler
    if (process.stdout) {
      process.stdout.on('data', (data: Buffer) => {
        this.captureOutput(agentId, 'stdout', data.toString());
      });
    }

    // Attach stderr handler
    if (process.stderr) {
      process.stderr.on('data', (data: Buffer) => {
        this.captureOutput(agentId, 'stderr', data.toString());
      });
    }

    // Attach error handler
    process.on('error', (error: Error) => {
      this.emit('process-error', agentId, error);
    });
  }

  /**
   * Attach exit handler to process
   */
  private attachExitHandler(agentId: string, tracked: TrackedProcess): void {
    const { process } = tracked;

    process.on('exit', (code: number | null, signal: string | null) => {
      // Update process info
      tracked.info.exitCode = code ?? undefined;
      tracked.info.exitSignal = signal ?? undefined;
      tracked.info.status = code === 0 ? ProcessStatus.Exited : ProcessStatus.Failed;

      // Emit exit event
      this.emit('process-exit', agentId, code, signal);

      // Cleanup after a delay to allow final output capture
      setTimeout(() => {
        this.cleanup(agentId);
      }, 1000);
    });
  }

  /**
   * Parse status markers from output line
   */
  private parseStatusMarkers(agentId: string, line: string): void {
    // Check for each status marker
    for (const [marker, pattern] of Object.entries(STATUS_MARKERS)) {
      if (pattern.test(line)) {
        this.emit('status-marker', agentId, marker, line);
      }
    }
  }
}

/**
 * Create a new ProcessManager instance
 */
export function createProcessManager(): ProcessManager {
  return new ProcessManager();
}
