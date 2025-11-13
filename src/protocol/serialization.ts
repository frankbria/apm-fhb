/**
 * APM Communication Protocol - Serialization & Deserialization
 * Version: 1.0.0
 *
 * This file contains functions for serializing and deserializing protocol
 * messages with proper encoding, validation, and error handling.
 */

import { gzipSync, gunzipSync } from 'zlib';
import {
  MessageEnvelope,
  ProtocolMessage,
  SerializationOptions,
  DeserializationResult,
  ValidationError,
  ValidationResult,
  MessageType
} from './types';
import {
  ProtocolMessageSchema,
  MessageSchemaMap,
  MAX_MESSAGE_SIZE,
  validateProtocolVersion,
  validateMessageSize
} from './schemas';

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize a message to NDJSON format
 *
 * @param message - The message to serialize
 * @param options - Serialization options
 * @returns Serialized message as string (with newline)
 * @throws Error if serialization fails
 */
export function serializeMessage(
  message: ProtocolMessage,
  options: SerializationOptions = {}
): string {
  const {
    prettyPrint = false,
    compress = false,
    compressionThreshold = 10240 // 10KB
  } = options;

  // Validate message structure
  const validation = validateMessage(message);
  if (!validation.valid) {
    throw new Error(
      `Message validation failed: ${validation.errors?.map(e => e.message).join(', ')}`
    );
  }

  // Serialize to JSON
  const json = prettyPrint
    ? JSON.stringify(message, null, 2)
    : JSON.stringify(message);

  // Check size limit (before compression)
  if (!validateMessageSize(json)) {
    throw new Error(
      `Message size exceeds limit: ${json.length} bytes (max: ${MAX_MESSAGE_SIZE})`
    );
  }

  // Apply compression if enabled and above threshold
  if (compress && json.length > compressionThreshold) {
    const compressed = gzipSync(json);
    const compressedJson = JSON.stringify({
      compressed: true,
      data: compressed.toString('base64')
    });
    return compressedJson + '\n';
  }

  // Return as NDJSON (newline-delimited)
  return json + '\n';
}

/**
 * Serialize multiple messages to NDJSON format
 *
 * @param messages - Array of messages to serialize
 * @param options - Serialization options
 * @returns Serialized messages as single string
 */
export function serializeMessages(
  messages: ProtocolMessage[],
  options: SerializationOptions = {}
): string {
  return messages.map(msg => serializeMessage(msg, options)).join('');
}

// ============================================================================
// Deserialization
// ============================================================================

/**
 * Deserialize a message from NDJSON format
 *
 * @param line - Single line of NDJSON (with or without newline)
 * @returns Deserialization result with message or error
 */
export function deserializeMessage(line: string): DeserializationResult {
  try {
    // Remove trailing newline
    const trimmed = line.trim();
    if (!trimmed) {
      return {
        success: false,
        error: {
          code: 'E_PROTOCOL_002',
          message: 'Empty line in NDJSON stream'
        }
      };
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'E_PROTOCOL_002',
          message: 'Malformed JSON',
          details: err instanceof Error ? err.message : String(err)
        }
      };
    }

    // Check for compression
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'compressed' in parsed &&
      (parsed as any).compressed === true
    ) {
      try {
        const compressed = Buffer.from((parsed as any).data, 'base64');
        const decompressed = gunzipSync(compressed);
        parsed = JSON.parse(decompressed.toString('utf-8'));
      } catch (err) {
        return {
          success: false,
          error: {
            code: 'E_PROTOCOL_002',
            message: 'Decompression failed',
            details: err instanceof Error ? err.message : String(err)
          }
        };
      }
    }

    // Validate message structure
    const validation = validateMessage(parsed);
    if (!validation.valid) {
      return {
        success: false,
        error: {
          code: 'E_VALIDATION_004',
          message: 'Schema validation failed',
          details: validation.errors
        }
      };
    }

    return {
      success: true,
      message: parsed as ProtocolMessage
    };
  } catch (err) {
    return {
      success: false,
      error: {
        code: 'E_PROTOCOL_002',
        message: 'Deserialization failed',
        details: err instanceof Error ? err.message : String(err)
      }
    };
  }
}

/**
 * Deserialize multiple messages from NDJSON format
 *
 * @param ndjson - Multi-line NDJSON string
 * @returns Array of deserialization results
 */
export function deserializeMessages(ndjson: string): DeserializationResult[] {
  const lines = ndjson.split('\n');
  return lines
    .filter(line => line.trim()) // Skip empty lines
    .map(line => deserializeMessage(line));
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a message against protocol schemas
 *
 * @param message - The message to validate
 * @returns Validation result with errors if invalid
 */
export function validateMessage(message: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  // Basic type check
  if (typeof message !== 'object' || message === null) {
    errors.push({
      code: 'E_VALIDATION_002',
      message: 'Message must be an object',
      actualValue: typeof message
    });
    return { valid: false, errors };
  }

  // Validate envelope structure
  const envelopeResult = ProtocolMessageSchema.safeParse(message);
  if (!envelopeResult.success) {
    const zodErrors = envelopeResult.error.errors;
    for (const zodError of zodErrors) {
      errors.push({
        code: 'E_VALIDATION_004',
        message: zodError.message,
        field: zodError.path.join('.'),
        actualValue: zodError.code
      });
    }
    return { valid: false, errors };
  }

  const msg = message as MessageEnvelope;

  // Validate protocol version
  if (!validateProtocolVersion(msg.version)) {
    errors.push({
      code: 'E_PROTOCOL_001',
      message: 'Unsupported protocol version',
      field: 'version',
      expectedValue: '1.x.x',
      actualValue: msg.version,
      suggestions: ['Upgrade agent to support protocol version']
    });
  }

  // Validate message type-specific schema
  const messageSchema = MessageSchemaMap[msg.messageType as MessageType];
  if (messageSchema) {
    const typeResult = messageSchema.safeParse(message);
    if (!typeResult.success) {
      const zodErrors = typeResult.error.errors;
      for (const zodError of zodErrors) {
        errors.push({
          code: 'E_VALIDATION_004',
          message: `${msg.messageType}: ${zodError.message}`,
          field: zodError.path.join('.'),
          actualValue: zodError.code
        });
      }
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

// ============================================================================
// Encoding Utilities
// ============================================================================

/**
 * Encode string to UTF-8 bytes
 *
 * @param str - String to encode
 * @returns Uint8Array of UTF-8 bytes
 */
export function encodeUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Decode UTF-8 bytes to string
 *
 * @param bytes - UTF-8 bytes to decode
 * @returns Decoded string
 */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Calculate message size in bytes
 *
 * @param message - Message to measure
 * @returns Size in bytes
 */
export function getMessageSize(message: ProtocolMessage): number {
  const json = JSON.stringify(message);
  return encodeUtf8(json).length;
}

// ============================================================================
// NDJSON Stream Utilities
// ============================================================================

/**
 * Parse NDJSON stream incrementally
 * Useful for reading large log files line by line
 */
export class NdjsonParser {
  private buffer = '';

  /**
 * Add chunk of data to buffer and extract complete lines
   *
   * @param chunk - Data chunk to process
   * @returns Array of complete lines ready for parsing
   */
  addChunk(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');

    // Keep last incomplete line in buffer
    this.buffer = lines.pop() || '';

    return lines.filter(line => line.trim());
  }

  /**
   * Flush remaining buffer content
   *
   * @returns Final line if any
   */
  flush(): string[] {
    const lines = this.buffer.trim() ? [this.buffer] : [];
    this.buffer = '';
    return lines;
  }

  /**
   * Reset parser state
   */
  reset(): void {
    this.buffer = '';
  }
}

// ============================================================================
// Message Builder Utilities
// ============================================================================

/**
 * Generate unique message ID
 *
 * @returns Message ID in format: msg_{timestamp}_{random}
 */
export function generateMessageId(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .replace(/\..+/, '');
  const random = Math.random().toString(36).substring(2, 10);
  return `msg_${timestamp}_${random}`;
}

/**
 * Generate correlation ID for request-response pairing
 *
 * @returns Correlation ID in format: req_{timestamp}_{random}
 */
export function generateCorrelationId(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .replace(/\..+/, '');
  const random = Math.random().toString(36).substring(2, 10);
  return `req_${timestamp}_${random}`;
}

/**
 * Get current ISO 8601 timestamp
 *
 * @returns ISO 8601 UTC timestamp
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Create base message envelope with required fields
 *
 * @param messageType - Type of message
 * @param sender - Sender identification
 * @param receiver - Receiver identification
 * @param payload - Message payload
 * @param options - Optional envelope fields
 * @returns Message envelope
 */
export function createMessageEnvelope<T>(
  messageType: MessageType,
  sender: { agentId: string; type: string },
  receiver: { agentId: string; type: string },
  payload: T,
  options: {
    correlationId?: string;
    priority?: string;
    metadata?: Record<string, unknown>;
  } = {}
): MessageEnvelope<T> {
  return {
    version: '1.0.0',
    messageId: generateMessageId(),
    correlationId: options.correlationId,
    timestamp: getCurrentTimestamp(),
    sender: sender as any,
    receiver: receiver as any,
    messageType,
    priority: (options.priority as any) || 'NORMAL',
    payload,
    metadata: options.metadata
  };
}
