/**
 * Database Connection Manager for apm-auto
 *
 * Provides connection pooling, transaction support, and error handling
 * for SQLite database operations with strict TypeScript typing.
 */

import Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import type {
  AgentState,
  TaskState,
  SessionState,
  StateTransition
} from '../types/index.js';

/**
 * Database Configuration Options
 */
export interface DatabaseConfig {
  /** Path to database file (use ':memory:' for in-memory database) */
  filename: string;
  /** Enable read-only mode */
  readonly?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Connection pool size (default: 5) */
  poolSize?: number;
  /** Connection timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Maximum retry attempts for failed operations (default: 3) */
  maxRetries?: number;
  /** Base delay for exponential backoff in milliseconds (default: 100) */
  retryBaseDelay?: number;
}

/**
 * Connection Pool Statistics
 */
export interface PoolStats {
  /** Total connections in pool */
  total: number;
  /** Active (in-use) connections */
  active: number;
  /** Idle (available) connections */
  idle: number;
  /** Waiting requests */
  waiting: number;
}

/**
 * Transaction Options
 */
export interface TransactionOptions {
  /** Transaction mode (default: 'DEFERRED') */
  mode?: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE';
}

/**
 * Pooled Database Connection
 */
interface PooledConnection {
  /** Better-sqlite3 database instance */
  db: Database.Database;
  /** Whether connection is currently in use */
  inUse: boolean;
  /** Last used timestamp */
  lastUsed: Date;
}

/**
 * Database Connection Manager
 * Manages connection pooling, transactions, and error handling
 */
export class ConnectionManager extends EventEmitter {
  private config: Required<DatabaseConfig>;
  private pool: PooledConnection[] = [];
  private waitQueue: Array<(conn: PooledConnection) => void> = [];
  private isInitialized = false;
  private isClosed = false;

  constructor(config: DatabaseConfig) {
    super();
    this.config = {
      filename: config.filename,
      readonly: config.readonly ?? false,
      verbose: config.verbose ?? false,
      poolSize: config.poolSize ?? 5,
      timeout: config.timeout ?? 5000,
      maxRetries: config.maxRetries ?? 3,
      retryBaseDelay: config.retryBaseDelay ?? 100
    };
  }

  /**
   * Initialize connection pool
   */
  async connect(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('Connection manager already initialized');
    }

    if (this.isClosed) {
      throw new Error('Connection manager has been closed');
    }

    try {
      // Create pool of connections
      for (let i = 0; i < this.config.poolSize; i++) {
        const db = this.createConnection();
        this.pool.push({
          db,
          inUse: false,
          lastUsed: new Date()
        });
      }

      this.isInitialized = true;
      this.emit('connected', { poolSize: this.config.poolSize });
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to initialize connection pool: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create a new SQLite database connection
   */
  private createConnection(): Database.Database {
    const db = new Database(this.config.filename, {
      readonly: this.config.readonly,
      timeout: this.config.timeout,
      verbose: this.config.verbose ? console.log : undefined
    });

    // Configure SQLite PRAGMAs for optimal performance and data integrity
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    db.pragma('cache_size = -64000'); // 64MB cache

    return db;
  }

  /**
   * Acquire a connection from the pool
   */
  private async acquireConnection(): Promise<PooledConnection> {
    return new Promise((resolve, reject) => {
      // Try to find an idle connection
      const idleConnection = this.pool.find(conn => !conn.inUse);

      if (idleConnection) {
        idleConnection.inUse = true;
        idleConnection.lastUsed = new Date();
        resolve(idleConnection);
        return;
      }

      // No idle connections, add to wait queue with timeout
      const timeoutId = setTimeout(() => {
        const index = this.waitQueue.indexOf(resolver);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
        }
        reject(new Error(`Connection acquisition timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      const resolver = (conn: PooledConnection) => {
        clearTimeout(timeoutId);
        resolve(conn);
      };

      this.waitQueue.push(resolver);
    });
  }

  /**
   * Release a connection back to the pool
   */
  private releaseConnection(conn: PooledConnection): void {
    conn.inUse = false;
    conn.lastUsed = new Date();

    // Process wait queue
    if (this.waitQueue.length > 0) {
      const resolver = this.waitQueue.shift();
      if (resolver) {
        conn.inUse = true;
        resolver(conn);
      }
    }
  }

  /**
   * Execute operation with connection from pool
   */
  private async withConnection<T>(
    operation: (db: Database.Database) => T
  ): Promise<T> {
    if (!this.isInitialized) {
      throw new Error('Connection manager not initialized. Call connect() first.');
    }

    if (this.isClosed) {
      throw new Error('Connection manager has been closed');
    }

    const conn = await this.acquireConnection();

    try {
      const result = operation(conn.db);
      return result;
    } finally {
      this.releaseConnection(conn);
    }
  }

  /**
   * Execute operation with retry logic
   */
  async withRetry<T>(
    operation: (db: Database.Database) => T,
    retries: number = this.config.maxRetries
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.withConnection(operation);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on certain errors
        if (
          lastError.message.includes('UNIQUE constraint') ||
          lastError.message.includes('FOREIGN KEY constraint') ||
          lastError.message.includes('CHECK constraint')
        ) {
          throw lastError;
        }

        if (attempt < retries) {
          // Exponential backoff
          const delay = this.config.retryBaseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          this.emit('retry', { attempt: attempt + 1, error: lastError.message });
        }
      }
    }

    throw new Error(`Operation failed after ${retries + 1} attempts: ${lastError?.message}`);
  }

  /**
   * Execute a transaction
   */
  async transaction<T>(
    operations: (db: Database.Database) => T | Promise<T>,
    options: TransactionOptions = {}
  ): Promise<T> {
    const mode = options.mode ?? 'DEFERRED';

    return this.withConnection(async (db) => {
      // Begin transaction
      db.exec(`BEGIN ${mode}`);

      try {
        const result = await operations(db);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    });
  }

  /**
   * Execute a raw SQL query
   */
  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    return this.withRetry((db) => {
      const stmt = db.prepare(sql);
      return params ? stmt.all(...params) as T[] : stmt.all() as T[];
    });
  }

  /**
   * Execute a raw SQL statement (INSERT, UPDATE, DELETE)
   */
  async execute(sql: string, params?: any[]): Promise<Database.RunResult> {
    return this.withRetry((db) => {
      const stmt = db.prepare(sql);
      return params ? stmt.run(...params) : stmt.run();
    });
  }

  /**
   * Get a single row from query
   */
  async get<T = any>(sql: string, params?: any[]): Promise<T | undefined> {
    return this.withRetry((db) => {
      const stmt = db.prepare(sql);
      return params ? stmt.get(...params) as T | undefined : stmt.get() as T | undefined;
    });
  }

  /**
   * Check if connection manager is initialized
   */
  isConnected(): boolean {
    return this.isInitialized && !this.isClosed;
  }

  /**
   * Get database file path from configuration
   */
  getFilePath(): string {
    return this.config.filename;
  }

  /**
   * Get connection pool statistics
   */
  getPoolStats(): PoolStats {
    const active = this.pool.filter(conn => conn.inUse).length;
    const idle = this.pool.length - active;

    return {
      total: this.pool.length,
      active,
      idle,
      waiting: this.waitQueue.length
    };
  }

  /**
   * Close all connections and shutdown pool
   */
  async disconnect(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    if (this.isClosed) {
      return;
    }

    // Wait for all connections to be released
    const maxWait = 5000; // 5 seconds
    const startTime = Date.now();

    while (this.pool.some(conn => conn.inUse)) {
      if (Date.now() - startTime > maxWait) {
        throw new Error('Timeout waiting for connections to be released');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Close all connections
    for (const conn of this.pool) {
      conn.db.close();
    }

    this.pool = [];
    this.waitQueue = [];
    this.isClosed = true;
    this.isInitialized = false;

    this.emit('disconnected');
  }

  /**
   * Get underlying database instance for advanced operations
   * WARNING: Use with caution - bypasses connection pooling
   */
  async getDirectConnection(): Promise<Database.Database> {
    const conn = await this.acquireConnection();
    return conn.db;
  }

  /**
   * Release a direct connection back to the pool
   */
  releaseDirectConnection(db: Database.Database): void {
    const conn = this.pool.find(c => c.db === db);
    if (conn) {
      this.releaseConnection(conn);
    }
  }
}

/**
 * Typed Database Interface
 * Strongly-typed methods for database operations matching schema
 */
export interface TypedDatabase {
  // Agent operations
  getAgent(id: string): Promise<AgentState | undefined>;
  getAllAgents(): Promise<AgentState[]>;
  getAgentsByStatus(status: string): Promise<AgentState[]>;
  insertAgent(agent: AgentState): Promise<void>;
  updateAgent(id: string, updates: Partial<AgentState>): Promise<void>;
  deleteAgent(id: string): Promise<void>;

  // Task operations
  getTask(id: string): Promise<TaskState | undefined>;
  getAllTasks(): Promise<TaskState[]>;
  getTasksByStatus(status: string): Promise<TaskState[]>;
  getTasksByPhase(phaseId: string): Promise<TaskState[]>;
  insertTask(task: TaskState): Promise<void>;
  updateTask(id: string, updates: Partial<TaskState>): Promise<void>;
  deleteTask(id: string): Promise<void>;

  // Session operations
  getSession(id: string): Promise<SessionState | undefined>;
  getAllSessions(): Promise<SessionState[]>;
  getSessionsByStatus(status: string): Promise<SessionState[]>;
  insertSession(session: SessionState): Promise<void>;
  updateSession(id: string, updates: Partial<SessionState>): Promise<void>;
  deleteSession(id: string): Promise<void>;

  // State transition operations
  getTransition(id: string): Promise<StateTransition | undefined>;
  getTransitionsByEntity(entityType: string, entityId: string): Promise<StateTransition[]>;
  insertTransition(transition: StateTransition): Promise<void>;
}

/**
 * Create a new connection manager instance
 */
export function createConnectionManager(config: DatabaseConfig): ConnectionManager {
  return new ConnectionManager(config);
}

/**
 * Default database configuration for production
 */
export const DEFAULT_CONFIG: DatabaseConfig = {
  filename: '.apm-auto/state.db',
  readonly: false,
  verbose: false,
  poolSize: 5,
  timeout: 5000,
  maxRetries: 3,
  retryBaseDelay: 100
};

/**
 * In-memory database configuration for testing
 */
export const TEST_CONFIG: DatabaseConfig = {
  filename: ':memory:',
  readonly: false,
  verbose: false,
  poolSize: 3,
  timeout: 5000,
  maxRetries: 3,
  retryBaseDelay: 100
};
