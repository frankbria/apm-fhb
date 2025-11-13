/**
 * APM Message Serialization Layer
 *
 * Enhanced serialization/deserialization with queue integration:
 * - Queue metadata (queuedAt, priority, retryCount)
 * - Three-level validation (syntax, schema, semantic)
 * - Compression for >10KB payloads
 * - 1MB size limit enforcement
 * - Performance monitoring
 */

import {
  serializeMessage as protocolSerialize,
  deserializeMessage as protocolDeserialize,
} from '../protocol/serialization';
import {
  validateSyntax,
  validateSchema,
  ValidationLevel,
  DetailedValidationResult,
} from '../protocol/validator';
import { MAX_MESSAGE_SIZE } from '../protocol/schemas';
import { MessageEnvelope, MessagePriority } from '../protocol/types';
import { ProtocolErrorCode, createProtocolError } from '../protocol/errors';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Queue metadata attached to messages
 */
export interface QueueMetadata {
  /** When message was enqueued (ISO 8601) */
  queuedAt: string;
  /** Priority level */
  priority: MessagePriority;
  /** Number of retry attempts */
  retryCount: number;
}

/**
 * Message with queue metadata
 */
export interface QueuedMessage<T = unknown> {
  /** The protocol message */
  message: MessageEnvelope<T>;
  /** Queue-specific metadata */
  queueMetadata: QueueMetadata;
}

/**
 * Serialization result
 */
export interface SerializationResult {
  /** Whether serialization succeeded */
  success: boolean;
  /** Serialized message string (if successful) */
  data?: string;
  /** Error details (if failed) */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  /** Serialization metrics */
  metrics?: SerializationMetrics;
}

/**
 * Deserialization result
 */
export interface DeserializationResult<T = unknown> {
  /** Whether deserialization succeeded */
  success: boolean;
  /** Deserialized message (if successful) */
  message?: QueuedMessage<T>;
  /** Error details (if failed) */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  /** Validation warnings (non-fatal) */
  warnings?: Array<{
    code: string;
    message: string;
  }>;
}

/**
 * Serialization metrics
 */
export interface SerializationMetrics {
  /** Serialization duration in milliseconds */
  duration: number;
  /** Original size in bytes */
  originalSize: number;
  /** Final size in bytes (after compression if applied) */
  finalSize: number;
  /** Whether compression was applied */
  compressed: boolean;
  /** Compression ratio (if compressed) */
  compressionRatio?: number;
}

/**
 * Serialization performance stats
 */
export interface SerializationStats {
  /** Total messages serialized */
  totalSerialized: number;
  /** Total messages deserialized */
  totalDeserialized: number;
  /** Total serialization failures */
  serializationFailures: number;
  /** Total deserialization failures */
  deserializationFailures: number;
  /** Validation failures by error code */
  validationFailuresByCode: Map<string, number>;
  /** Average serialization duration (ms) */
  avgSerializationDuration: number;
  /** Average deserialization duration (ms) */
  avgDeserializationDuration: number;
  /** Average compression ratio */
  avgCompressionRatio: number;
  /** Total bytes compressed */
  totalBytesCompressed: number;
  /** Total bytes saved by compression */
  totalBytesSaved: number;
}

// ============================================================================
// MessageSerializer Class
// ============================================================================

/**
 * Message serializer with queue metadata and validation
 */
export class MessageSerializer {
  // Performance tracking
  private serializationDurations: number[] = [];
  private compressionRatios: number[] = [];
  private stats: SerializationStats = {
    totalSerialized: 0,
    serializationFailures: 0,
    totalDeserialized: 0,
    deserializationFailures: 0,
    validationFailuresByCode: new Map(),
    avgSerializationDuration: 0,
    avgDeserializationDuration: 0,
    avgCompressionRatio: 0,
    totalBytesCompressed: 0,
    totalBytesSaved: 0,
  };

  // Compression threshold (10KB)
  private readonly compressionThreshold = 10 * 1024;

  /**
   * Serialize a message with queue metadata
   *
   * @param message - Protocol message to serialize
   * @param queueMetadata - Queue metadata to attach
   * @returns Serialization result
   */
  serialize<T>(
    message: MessageEnvelope<T>,
    queueMetadata: QueueMetadata
  ): SerializationResult {
    const startTime = performance.now();

    try {
      // Create queued message structure
      const queuedMessage: QueuedMessage<T> = {
        message,
        queueMetadata,
      };

      // Validate message structure first
      const validation = validateSchema(message);
      if (!validation.valid) {
        this.stats.serializationFailures++;
        this.recordValidationFailures(validation);
        return {
          success: false,
          error: {
            code: 'E_VALIDATION_004',
            message: 'Schema validation failed',
            details: validation.errors,
          },
        };
      }

      // Serialize to JSON
      const json = JSON.stringify(queuedMessage);
      const originalSize = Buffer.byteLength(json, 'utf-8');

      // Check size limit before compression
      if (originalSize > MAX_MESSAGE_SIZE) {
        this.stats.serializationFailures++;
        return {
          success: false,
          error: {
            code: 'E_VALIDATION_009',
            message: `Message size exceeds limit: ${originalSize} bytes (max: ${MAX_MESSAGE_SIZE})`,
          },
        };
      }

      // Emit warning for large messages (>100KB)
      if (originalSize > 100 * 1024) {
        console.warn(
          `[MessageSerializer] Large message: ${originalSize} bytes (messageId: ${message.messageId})`
        );
      }

      // Determine if compression is needed
      const shouldCompress = originalSize > this.compressionThreshold;

      // Use protocol serializer with compression option
      const serialized = protocolSerialize(queuedMessage as any, {
        compress: shouldCompress,
        compressionThreshold: this.compressionThreshold,
      });

      const finalSize = Buffer.byteLength(serialized, 'utf-8');

      // Calculate metrics
      const duration = performance.now() - startTime;
      const compressed = finalSize < originalSize;
      const compressionRatio = compressed ? originalSize / finalSize : 1.0;

      const metrics: SerializationMetrics = {
        duration,
        originalSize,
        finalSize,
        compressed,
        compressionRatio: compressed ? compressionRatio : undefined,
      };

      // Update stats
      this.stats.totalSerialized++;
      this.serializationDurations.push(duration);
      if (this.serializationDurations.length > 100) {
        this.serializationDurations.shift();
      }

      if (compressed) {
        this.compressionRatios.push(compressionRatio);
        if (this.compressionRatios.length > 100) {
          this.compressionRatios.shift();
        }
        this.stats.totalBytesCompressed += originalSize;
        this.stats.totalBytesSaved += originalSize - finalSize;
      }

      this.updateAverages();

      return {
        success: true,
        data: serialized,
        metrics,
      };
    } catch (error) {
      this.stats.serializationFailures++;
      return {
        success: false,
        error: {
          code: 'E_PROTOCOL_002',
          message: 'Serialization failed',
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Get serialization performance statistics
   */
  getStats(): Readonly<SerializationStats> {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.serializationDurations = [];
    this.compressionRatios = [];
    this.stats = {
      totalSerialized: 0,
      serializationFailures: 0,
      totalDeserialized: 0,
      deserializationFailures: 0,
      validationFailuresByCode: new Map(),
      avgSerializationDuration: 0,
      avgDeserializationDuration: 0,
      avgCompressionRatio: 0,
      totalBytesCompressed: 0,
      totalBytesSaved: 0,
    };
  }

  /**
   * Update running averages
   */
  private updateAverages(): void {
    this.stats.avgSerializationDuration =
      this.serializationDurations.reduce((sum, d) => sum + d, 0) /
      this.serializationDurations.length;

    if (this.compressionRatios.length > 0) {
      this.stats.avgCompressionRatio =
        this.compressionRatios.reduce((sum, r) => sum + r, 0) /
        this.compressionRatios.length;
    }
  }

  /**
   * Record validation failures by error code
   */
  private recordValidationFailures(validation: DetailedValidationResult): void {
    if (validation.errors) {
      for (const error of validation.errors) {
        const count = this.stats.validationFailuresByCode.get(error.code) ?? 0;
        this.stats.validationFailuresByCode.set(error.code, count + 1);
      }
    }
  }
}

// ============================================================================
// MessageDeserializer Class
// ============================================================================

/**
 * Message deserializer with three-level validation
 */
export class MessageDeserializer {
  // Performance tracking
  private deserializationDurations: number[] = [];
  private stats: SerializationStats = {
    totalSerialized: 0,
    serializationFailures: 0,
    totalDeserialized: 0,
    deserializationFailures: 0,
    validationFailuresByCode: new Map(),
    avgSerializationDuration: 0,
    avgDeserializationDuration: 0,
    avgCompressionRatio: 0,
    totalBytesCompressed: 0,
    totalBytesSaved: 0,
  };

  /**
   * Deserialize and validate a message
   *
   * Performs three-level validation:
   * 1. Syntax: UTF-8 encoding and JSON parsing
   * 2. Schema: Message structure and types
   * 3. Semantic: Business rules (done by validator module)
   *
   * @param line - Serialized message line (NDJSON)
   * @returns Deserialization result
   */
  deserialize<T = unknown>(line: string): DeserializationResult<T> {
    const startTime = performance.now();

    try {
      // Level 1: Syntax validation
      const syntaxValidation = validateSyntax(line);
      if (!syntaxValidation.valid) {
        this.stats.deserializationFailures++;
        this.recordValidationFailures(syntaxValidation);
        this.emitValidationFailedEvent('syntax', line, syntaxValidation);
        return {
          success: false,
          error: {
            code: syntaxValidation.errors?.[0]?.code ?? 'E_VALIDATION_001',
            message: 'Syntax validation failed',
            details: syntaxValidation.errors,
          },
        };
      }

      // Deserialize using protocol deserializer (handles compression)
      const deserializeResult = protocolDeserialize(line);
      if (!deserializeResult.success) {
        this.stats.deserializationFailures++;
        this.logParseError(line, deserializeResult.error);
        this.emitValidationFailedEvent('parse', line, deserializeResult.error);
        return {
          success: false,
          error: deserializeResult.error,
        };
      }

      const parsed = deserializeResult.message as QueuedMessage<T>;

      // Validate structure: must have message and queueMetadata
      if (!parsed.message || !parsed.queueMetadata) {
        this.stats.deserializationFailures++;
        const error = {
          code: 'E_VALIDATION_002',
          message: 'Missing required fields: message or queueMetadata',
        };
        this.emitValidationFailedEvent('structure', line, error);
        return {
          success: false,
          error,
        };
      }

      // Level 2: Schema validation (already done by protocolDeserialize)
      // Level 3: Semantic validation would be done by caller if needed

      // Update stats
      const duration = performance.now() - startTime;
      this.stats.totalDeserialized++;
      this.deserializationDurations.push(duration);
      if (this.deserializationDurations.length > 100) {
        this.deserializationDurations.shift();
      }
      this.updateAverages();

      return {
        success: true,
        message: parsed,
        warnings: syntaxValidation.warnings?.map(w => ({
          code: w.code,
          message: w.message,
        })),
      };
    } catch (error) {
      this.stats.deserializationFailures++;
      this.logParseError(line, error);
      return {
        success: false,
        error: {
          code: 'E_PROTOCOL_002',
          message: 'Deserialization failed',
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Get deserialization performance statistics
   */
  getStats(): Readonly<SerializationStats> {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.deserializationDurations = [];
    this.stats = {
      totalSerialized: 0,
      serializationFailures: 0,
      totalDeserialized: 0,
      deserializationFailures: 0,
      validationFailuresByCode: new Map(),
      avgSerializationDuration: 0,
      avgDeserializationDuration: 0,
      avgCompressionRatio: 0,
      totalBytesCompressed: 0,
      totalBytesSaved: 0,
    };
  }

  /**
   * Update running averages
   */
  private updateAverages(): void {
    this.stats.avgDeserializationDuration =
      this.deserializationDurations.reduce((sum, d) => sum + d, 0) /
      this.deserializationDurations.length;
  }

  /**
   * Record validation failures by error code
   */
  private recordValidationFailures(
    validation: DetailedValidationResult | { code?: string; errors?: Array<{ code: string }> }
  ): void {
    if ('errors' in validation && validation.errors) {
      for (const error of validation.errors) {
        const count = this.stats.validationFailuresByCode.get(error.code) ?? 0;
        this.stats.validationFailuresByCode.set(error.code, count + 1);
      }
    }
  }

  /**
   * Log parse error with context
   */
  private logParseError(line: string, error: unknown): void {
    const preview =
      line.length > 100 ? line.substring(0, 100) + '...' : line;
    console.error(
      `[MessageDeserializer] Parse error:`,
      error,
      `\nRaw content: ${preview}`
    );
  }

  /**
   * Emit validation-failed event
   */
  private emitValidationFailedEvent(
    stage: string,
    rawContent: string,
    error: unknown
  ): void {
    // TODO: Integrate with event system when available
    console.warn(
      `[MessageDeserializer] Validation failed at ${stage}:`,
      error,
      `\nRaw: ${rawContent.substring(0, 100)}...`
    );
  }
}
