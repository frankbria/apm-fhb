/**
 * APM Monitoring Module
 *
 * Exports file watching, debouncing, log parsing, and state integration components.
 */

export {
  MemoryFileWatcher,
  WatcherState,
  FileEventType,
  type FileEvent,
  type WatcherStatus,
  type WatcherConfig,
} from './file-watcher';
export {
  FileChangeDebouncer,
  type DebouncedEvent,
  type DebouncerMetrics,
  type DebouncerConfig,
} from './debouncer';
export {
  MemoryLogParser,
  type ParsedMemoryLog,
  type ParseError,
  type ParseResult,
} from './log-parser';
export {
  StateIntegrationBridge,
  StateUpdateEventType,
  type StateUpdateEvent,
  type IntegrationConfig,
} from './state-integration';
