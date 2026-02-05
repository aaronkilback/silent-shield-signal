/**
 * Performance Monitoring System
 * Tracks slow operations and identifies bottlenecks
 */

export interface PerformanceMetric {
  operation: string;
  duration: number;
  timestamp: number;
  threshold: number;
  exceeded: boolean;
  metadata?: Record<string, unknown>;
}

export interface PerformanceReport {
  period: string;
  totalOperations: number;
  slowOperations: number;
  averageDuration: number;
  p50: number;
  p95: number;
  p99: number;
  byOperation: Record<string, {
    count: number;
    avgDuration: number;
    maxDuration: number;
    slowCount: number;
  }>;
}

// Store metrics in memory (last 1000)
const metricsBuffer: PerformanceMetric[] = [];
const MAX_BUFFER_SIZE = 1000;

// Default thresholds (in ms)
const DEFAULT_THRESHOLDS: Record<string, number> = {
  'database_query': 1000,
  'edge_function': 5000,
  'api_call': 3000,
  'render': 100,
  'navigation': 2000,
  'default': 3000,
};

/**
 * Record a performance metric
 */
export function recordMetric(
  operation: string,
  duration: number,
  metadata?: Record<string, unknown>
): PerformanceMetric {
  const threshold = DEFAULT_THRESHOLDS[operation] || DEFAULT_THRESHOLDS.default;
  const exceeded = duration > threshold;
  
  const metric: PerformanceMetric = {
    operation,
    duration,
    timestamp: Date.now(),
    threshold,
    exceeded,
    metadata,
  };
  
  metricsBuffer.push(metric);
  
  // Keep buffer size manageable
  if (metricsBuffer.length > MAX_BUFFER_SIZE) {
    metricsBuffer.shift();
  }
  
  // Log slow operations
  if (exceeded) {
    console.warn(
      `[Performance] Slow ${operation}: ${Math.round(duration)}ms (threshold: ${threshold}ms)`,
      metadata
    );
  }
  
  return metric;
}

/**
 * Measure an async operation
 */
export async function measure<T>(
  operation: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const start = performance.now();
  
  try {
    const result = await fn();
    recordMetric(operation, performance.now() - start, metadata);
    return result;
  } catch (error) {
    recordMetric(operation, performance.now() - start, { ...metadata, error: true });
    throw error;
  }
}

/**
 * Create a timer for manual measurement
 */
export function startTimer(operation: string, metadata?: Record<string, unknown>): {
  stop: () => PerformanceMetric;
  elapsed: () => number;
} {
  const start = performance.now();
  
  return {
    stop: () => recordMetric(operation, performance.now() - start, metadata),
    elapsed: () => performance.now() - start,
  };
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Generate performance report for a time period
 */
export function getPerformanceReport(minutes: number = 60): PerformanceReport {
  const cutoff = Date.now() - minutes * 60 * 1000;
  const relevantMetrics = metricsBuffer.filter(m => m.timestamp >= cutoff);
  
  if (relevantMetrics.length === 0) {
    return {
      period: `Last ${minutes} minutes`,
      totalOperations: 0,
      slowOperations: 0,
      averageDuration: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      byOperation: {},
    };
  }
  
  const durations = relevantMetrics.map(m => m.duration).sort((a, b) => a - b);
  const slowCount = relevantMetrics.filter(m => m.exceeded).length;
  
  // Group by operation
  const byOperation: PerformanceReport['byOperation'] = {};
  for (const metric of relevantMetrics) {
    if (!byOperation[metric.operation]) {
      byOperation[metric.operation] = {
        count: 0,
        avgDuration: 0,
        maxDuration: 0,
        slowCount: 0,
      };
    }
    
    const op = byOperation[metric.operation];
    op.count++;
    op.avgDuration = (op.avgDuration * (op.count - 1) + metric.duration) / op.count;
    op.maxDuration = Math.max(op.maxDuration, metric.duration);
    if (metric.exceeded) op.slowCount++;
  }
  
  return {
    period: `Last ${minutes} minutes`,
    totalOperations: relevantMetrics.length,
    slowOperations: slowCount,
    averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    byOperation,
  };
}

/**
 * Get operations that are consistently slow
 */
export function getSlowOperations(
  minutes: number = 60,
  thresholdPercent: number = 50
): Array<{ operation: string; slowPercent: number; avgDuration: number }> {
  const report = getPerformanceReport(minutes);
  const result: Array<{ operation: string; slowPercent: number; avgDuration: number }> = [];
  
  for (const [operation, stats] of Object.entries(report.byOperation)) {
    const slowPercent = (stats.slowCount / stats.count) * 100;
    if (slowPercent >= thresholdPercent) {
      result.push({
        operation,
        slowPercent,
        avgDuration: stats.avgDuration,
      });
    }
  }
  
  return result.sort((a, b) => b.slowPercent - a.slowPercent);
}

/**
 * Clear metrics buffer
 */
export function clearMetrics(): void {
  metricsBuffer.length = 0;
}

/**
 * Set custom threshold for an operation type
 */
export function setThreshold(operation: string, thresholdMs: number): void {
  DEFAULT_THRESHOLDS[operation] = thresholdMs;
}

/**
 * Hook for React components to measure render performance
 */
export function usePerformanceTracker(componentName: string) {
  const renderStart = performance.now();
  
  return {
    onRenderComplete: () => {
      recordMetric('render', performance.now() - renderStart, { component: componentName });
    },
  };
}
