/**
 * APM Communication Protocol
 * Version: 1.0.0
 *
 * This is the main entry point for the APM communication protocol.
 * It exports all types, schemas, and utilities needed for message
 * serialization, deserialization, and validation.
 */

// ============================================================================
// Type Definitions
// ============================================================================

export * from './types';

// ============================================================================
// Validation Schemas
// ============================================================================

export * from './schemas';

// ============================================================================
// Serialization Utilities
// ============================================================================

export * from './serialization';

// ============================================================================
// Error Definitions and Handling
// ============================================================================

export * from './errors';

// ============================================================================
// Validation Framework
// ============================================================================

export * from './validator';

// ============================================================================
// Error Handler
// ============================================================================

export * from './error-handler';

// ============================================================================
// Version Information
// ============================================================================

import { PROTOCOL_VERSION } from './types';

/**
 * Get current protocol version
 */
export function getProtocolVersion(): string {
  return PROTOCOL_VERSION;
}

/**
 * Get protocol information
 */
export function getProtocolInfo() {
  return {
    version: PROTOCOL_VERSION,
    name: 'APM Communication Protocol',
    description: 'File-based inter-agent communication protocol with WebSocket-like semantics',
    features: [
      'NDJSON message format',
      'At-least-once delivery',
      'Request-response correlation',
      'Message lifecycle tracking',
      'Schema validation',
      'UTF-8 encoding',
      'Optional gzip compression'
    ],
    messageTypes: [
      'TASK_ASSIGNMENT',
      'TASK_UPDATE',
      'STATE_SYNC',
      'ERROR_REPORT',
      'HANDOFF_REQUEST',
      'ACK',
      'NACK'
    ]
  };
}
