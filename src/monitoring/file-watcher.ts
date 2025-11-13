/**
 * APM Memory File Watcher
 *
 * Implements file watching for .apm/Memory/ directory:
 * - Cross-platform file watching using chokidar
 * - Lifecycle management (start, stop, pause, resume)
 * - Error handling with automatic restart
 * - Status monitoring and event emission
 * - Discovery of existing files on startup
 */

import * as chokidar from 'chokidar';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Watcher state
 */
export enum WatcherState {
  STOPPED = 'STOPPED',
  STARTING = 'STARTING',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  ERROR = 'ERROR',
}

/**
 * File event types
 */
export enum FileEventType {
  ADD = 'add',
  CHANGE = 'change',
  UNLINK = 'unlink',
}

/**
 * File event payload
 */
export interface FileEvent {
  /** Event type */
  eventType: FileEventType;
  /** Absolute file path */
  filePath: string;
  /** File stats (if available) */
  stats?: fs.Stats;
  /** Event timestamp */
  timestamp: Date;
}

/**
 * Watcher status
 */
export interface WatcherStatus {
  /** Current state */
  state: WatcherState;
  /** Directory being watched */
  watchedDirectory: string;
  /** Files currently being watched */
  watchedFilesCount: number;
  /** Error count (consecutive) */
  errorCount: number;
  /** Last error (if any) */
  lastError?: {
    message: string;
    timestamp: Date;
  };
  /** Started timestamp (if active) */
  startedAt?: Date;
}

/**
 * Watcher configuration
 */
export interface WatcherConfig {
  /** Directory to watch */
  watchDirectory: string;
  /** Debounce delay for write completion (ms) */
  stabilityThreshold?: number;
  /** Poll interval for write completion check (ms) */
  pollInterval?: number;
  /** Auto-restart on error (default: true) */
  autoRestart?: boolean;
  /** Auto-restart delay (ms) */
  restartDelay?: number;
  /** Max consecutive failures before giving up */
  maxConsecutiveFailures?: number;
}

// ============================================================================
// MemoryFileWatcher Class
// ============================================================================

/**
 * File watcher for .apm/Memory/ directory
 *
 * Uses chokidar for cross-platform file watching with:
 * - Lifecycle management
 * - Error handling and auto-restart
 * - Status monitoring
 * - Event emission via EventEmitter
 */
export class MemoryFileWatcher extends EventEmitter {
  private readonly config: Required<WatcherConfig>;
  private watcher?: chokidar.FSWatcher;
  private state: WatcherState = WatcherState.STOPPED;
  private errorCount = 0;
  private watchedFiles = new Set<string>();
  private startedAt?: Date;
  private lastError?: { message: string; timestamp: Date };
  private restartTimer?: NodeJS.Timeout;
  private isPaused = false;

  /**
   * Create a new memory file watcher
   */
  constructor(config: WatcherConfig) {
    super();

    this.config = {
      watchDirectory: config.watchDirectory,
      stabilityThreshold: config.stabilityThreshold ?? 200,
      pollInterval: config.pollInterval ?? 100,
      autoRestart: config.autoRestart ?? true,
      restartDelay: config.restartDelay ?? 5000,
      maxConsecutiveFailures: config.maxConsecutiveFailures ?? 3,
    };
  }

  // ==========================================================================
  // Lifecycle Management
  // ==========================================================================

  /**
   * Start watching directory
   */
  async start(): Promise<void> {
    if (this.state === WatcherState.ACTIVE || this.state === WatcherState.STARTING) {
      console.warn('[MemoryFileWatcher] Already started or starting');
      return;
    }

    try {
      this.setState(WatcherState.STARTING);

      // Verify directory exists
      if (!fs.existsSync(this.config.watchDirectory)) {
        throw new Error(`Watch directory does not exist: ${this.config.watchDirectory}`);
      }

      // Create chokidar watcher
      this.watcher = chokidar.watch(this.config.watchDirectory, {
        persistent: true,
        ignoreInitial: false, // Discover existing files
        awaitWriteFinish: {
          stabilityThreshold: this.config.stabilityThreshold,
          pollInterval: this.config.pollInterval,
        },
        ignored: ['**/.git/**', '**/node_modules/**', '**/*.tmp', '**/.DS_Store'],
        // Only watch .md files in Memory directory
        depth: undefined, // Watch recursively
      });

      // Setup event handlers
      this.setupEventHandlers();

      // Wait for ready event
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Watcher initialization timeout'));
        }, 10000);

        this.watcher!.on('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.watcher!.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      this.setState(WatcherState.ACTIVE);
      this.startedAt = new Date();
      this.errorCount = 0; // Reset error count on successful start

      console.log(
        `[MemoryFileWatcher] Started watching ${this.config.watchDirectory}`,
        `(${this.watchedFiles.size} files)`
      );

      this.emit('watcher-started', {
        directory: this.config.watchDirectory,
        filesCount: this.watchedFiles.size,
      });
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  /**
   * Stop watching directory
   */
  async stop(): Promise<void> {
    if (this.state === WatcherState.STOPPED) {
      console.warn('[MemoryFileWatcher] Already stopped');
      return;
    }

    // Cancel restart timer if exists
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }

    // Close watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
    }

    this.setState(WatcherState.STOPPED);
    this.watchedFiles.clear();
    this.startedAt = undefined;
    this.isPaused = false;

    console.log('[MemoryFileWatcher] Stopped');

    this.emit('watcher-stopped');
  }

  /**
   * Pause file event processing
   */
  pause(): void {
    if (this.state !== WatcherState.ACTIVE) {
      console.warn('[MemoryFileWatcher] Cannot pause - not active');
      return;
    }

    this.isPaused = true;
    this.setState(WatcherState.PAUSED);

    console.log('[MemoryFileWatcher] Paused');

    this.emit('watcher-paused');
  }

  /**
   * Resume file event processing
   */
  resume(): void {
    if (this.state !== WatcherState.PAUSED) {
      console.warn('[MemoryFileWatcher] Cannot resume - not paused');
      return;
    }

    this.isPaused = false;
    this.setState(WatcherState.ACTIVE);

    console.log('[MemoryFileWatcher] Resumed');

    this.emit('watcher-resumed');
  }

  /**
   * Check if currently watching
   */
  isWatching(): boolean {
    return this.state === WatcherState.ACTIVE || this.state === WatcherState.PAUSED;
  }

  /**
   * Get current watcher status
   */
  getStatus(): WatcherStatus {
    return {
      state: this.state,
      watchedDirectory: this.config.watchDirectory,
      watchedFilesCount: this.watchedFiles.size,
      errorCount: this.errorCount,
      lastError: this.lastError,
      startedAt: this.startedAt,
    };
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * Setup chokidar event handlers
   */
  private setupEventHandlers(): void {
    if (!this.watcher) {
      return;
    }

    // File added
    this.watcher.on('add', (filePath: string, stats?: fs.Stats) => {
      // Only process .md files
      if (!filePath.endsWith('.md')) {
        return;
      }

      this.watchedFiles.add(filePath);

      // Skip if paused
      if (this.isPaused) {
        return;
      }

      const event: FileEvent = {
        eventType: FileEventType.ADD,
        filePath: path.resolve(filePath),
        stats,
        timestamp: new Date(),
      };

      this.emit('file-event', event);
    });

    // File changed
    this.watcher.on('change', (filePath: string, stats?: fs.Stats) => {
      // Only process .md files
      if (!filePath.endsWith('.md')) {
        return;
      }

      // Skip if paused
      if (this.isPaused) {
        return;
      }

      const event: FileEvent = {
        eventType: FileEventType.CHANGE,
        filePath: path.resolve(filePath),
        stats,
        timestamp: new Date(),
      };

      this.emit('file-event', event);
    });

    // File removed
    this.watcher.on('unlink', (filePath: string) => {
      // Only process .md files
      if (!filePath.endsWith('.md')) {
        return;
      }

      this.watchedFiles.delete(filePath);

      // Skip if paused
      if (this.isPaused) {
        return;
      }

      const event: FileEvent = {
        eventType: FileEventType.UNLINK,
        filePath: path.resolve(filePath),
        timestamp: new Date(),
      };

      this.emit('file-event', event);
    });

    // Watcher error
    this.watcher.on('error', (error: Error) => {
      this.handleError(error);
    });
  }

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  /**
   * Handle watcher error
   */
  private handleError(error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);

    this.errorCount++;
    this.lastError = {
      message: errorMessage,
      timestamp: new Date(),
    };

    console.error(
      `[MemoryFileWatcher] Error (${this.errorCount}/${this.config.maxConsecutiveFailures}):`,
      errorMessage
    );

    this.emit('watcher-error', {
      error: errorMessage,
      errorCount: this.errorCount,
      timestamp: this.lastError.timestamp,
    });

    // Check if we should give up
    if (this.errorCount >= this.config.maxConsecutiveFailures) {
      this.setState(WatcherState.ERROR);

      console.error(
        `[MemoryFileWatcher] Max consecutive failures reached (${this.config.maxConsecutiveFailures})`
      );

      this.emit('watcher-failed', {
        error: errorMessage,
        errorCount: this.errorCount,
      });

      // Stop trying
      this.stop();
      return;
    }

    // Auto-restart if enabled
    if (this.config.autoRestart && this.state !== WatcherState.STOPPED) {
      console.log(
        `[MemoryFileWatcher] Scheduling restart in ${this.config.restartDelay}ms...`
      );

      this.restartTimer = setTimeout(() => {
        this.attemptRestart();
      }, this.config.restartDelay);
    } else {
      this.setState(WatcherState.ERROR);
    }
  }

  /**
   * Attempt to restart watcher after error
   */
  private async attemptRestart(): Promise<void> {
    console.log('[MemoryFileWatcher] Attempting restart...');

    try {
      // Close existing watcher
      if (this.watcher) {
        await this.watcher.close();
        this.watcher = undefined;
      }

      // Restart
      await this.start();

      console.log('[MemoryFileWatcher] Restart successful');
    } catch (error) {
      console.error('[MemoryFileWatcher] Restart failed:', error);
      // handleError will be called again
    }
  }

  // ==========================================================================
  // State Management
  // ==========================================================================

  /**
   * Update watcher state and emit event
   */
  private setState(newState: WatcherState): void {
    const oldState = this.state;
    this.state = newState;

    if (oldState !== newState) {
      console.log(`[MemoryFileWatcher] State: ${oldState} → ${newState}`);

      this.emit('state-changed', {
        oldState,
        newState,
        timestamp: new Date(),
      });
    }
  }
}
