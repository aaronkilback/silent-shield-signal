/**
 * Reliability Framework
 * Centralized exports for all reliability utilities
 */

// Health Monitoring
export {
  runHealthCheck,
  storeHealthCheckResult,
  getHealthTrends,
  type HealthStatus,
  type HealthCheckResult,
  type SystemHealthReport,
} from './healthMonitor';

// Data Integrity
export {
  runIntegrityCheck,
  autoFixIssues,
  validateSignal,
  validateEntity,
  type IntegrityIssue,
  type IntegrityReport,
} from './dataIntegrity';

// Silent Failure Detection
export {
  trackOperation,
  expectChange,
  wrapWithDetection,
  invokeWithDetection,
  checkStateConsistency,
  type SilentFailure,
} from './silentFailureDetector';

// Performance Monitoring
export {
  recordMetric,
  measure,
  startTimer,
  getPerformanceReport,
  getSlowOperations,
  clearMetrics,
  setThreshold,
  usePerformanceTracker,
  type PerformanceMetric,
  type PerformanceReport,
} from './performanceMonitor';

// Re-export from existing resilience utilities
export {
  invokeWithResilience,
  withTimeout,
  batchWithConcurrency,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
  resetAllCircuitBreakers,
} from '../resilience';

// Re-export from existing error tracking
export {
  trackError,
  categorizeError,
  determineSeverity,
  withErrorTracking,
  getErrorStats,
  type ErrorCategory,
  type ErrorSeverity,
  type TrackedError,
} from '../errorTracking';

// Re-export from existing retry utilities
export {
  useRetry,
  retryAsync,
  CircuitBreaker,
} from '../../hooks/useRetry';
