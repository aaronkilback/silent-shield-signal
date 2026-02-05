/**
 * React hook for reliability utilities
 * Provides easy access to health monitoring, performance tracking, and error detection
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  runHealthCheck,
  storeHealthCheckResult,
  SystemHealthReport,
  HealthStatus,
} from '@/lib/reliability/healthMonitor';
import {
  runIntegrityCheck,
  IntegrityReport,
} from '@/lib/reliability/dataIntegrity';
import {
  getPerformanceReport,
  getSlowOperations,
  PerformanceReport,
} from '@/lib/reliability/performanceMonitor';
import { checkStateConsistency, SilentFailure } from '@/lib/reliability/silentFailureDetector';
import {
  checkCriticalFunctions,
  CriticalCheckResult,
} from '@/lib/reliability/criticalFunctionCheck';

interface ReliabilityState {
  health: SystemHealthReport | null;
  integrity: IntegrityReport | null;
  performance: PerformanceReport | null;
  silentFailures: SilentFailure[];
  criticalFunctions: CriticalCheckResult | null;
  isLoading: boolean;
  lastCheck: Date | null;
}

interface UseReliabilityOptions {
  autoCheck?: boolean;
  checkIntervalMs?: number;
  storeResults?: boolean;
}

export function useReliability(options: UseReliabilityOptions = {}) {
  const {
    autoCheck = false,
    checkIntervalMs = 5 * 60 * 1000, // 5 minutes default
    storeResults = true,
  } = options;

  const [state, setState] = useState<ReliabilityState>({
    health: null,
    integrity: null,
    performance: null,
    silentFailures: [],
    criticalFunctions: null,
    isLoading: false,
    lastCheck: null,
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const runAllChecks = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const [health, integrity, performance, silentFailures, criticalFunctions] = await Promise.all([
        runHealthCheck(),
        runIntegrityCheck(),
        Promise.resolve(getPerformanceReport(60)),
        checkStateConsistency(),
        checkCriticalFunctions(),
      ]);

      // Optionally store health results for trending
      if (storeResults && health) {
        await storeHealthCheckResult(health);
      }

      setState({
        health,
        integrity,
        performance,
        silentFailures,
        criticalFunctions,
        isLoading: false,
        lastCheck: new Date(),
      });

      return { health, integrity, performance, silentFailures, criticalFunctions };
    } catch (error) {
      console.error('[useReliability] Check failed:', error);
      setState(prev => ({ ...prev, isLoading: false }));
      throw error;
    }
  }, [storeResults]);

  const runHealthCheckOnly = useCallback(async () => {
    const health = await runHealthCheck();
    setState(prev => ({ ...prev, health }));
    return health;
  }, []);

  const runIntegrityCheckOnly = useCallback(async () => {
    const integrity = await runIntegrityCheck();
    setState(prev => ({ ...prev, integrity }));
    return integrity;
  }, []);

  const getPerformanceStats = useCallback((minutes: number = 60) => {
    const performance = getPerformanceReport(minutes);
    setState(prev => ({ ...prev, performance }));
    return performance;
  }, []);

  const checkForSilentFailures = useCallback(async () => {
    const silentFailures = await checkStateConsistency();
    setState(prev => ({ ...prev, silentFailures }));
    return silentFailures;
  }, []);

  // Auto-check on interval if enabled
  useEffect(() => {
    if (autoCheck) {
      runAllChecks();
      intervalRef.current = setInterval(runAllChecks, checkIntervalMs);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoCheck, checkIntervalMs, runAllChecks]);

  // Computed values
  const overallStatus: HealthStatus = state.health?.overallStatus || 'unknown';
  const hasCriticalIssues = (state.health?.criticalIssues.length || 0) > 0;
  const hasDegradedServices = (state.health?.degradedServices.length || 0) > 0;
  const integrityIssueCount = state.integrity?.issuesFound || 0;
  const slowOperations = state.performance ? getSlowOperations(60, 30) : [];
  const undeployedFunctionCount = state.criticalFunctions?.failedCount || 0;
  const hasUndeployedFunctions = undeployedFunctionCount > 0;

  return {
    // State
    ...state,
    overallStatus,
    hasCriticalIssues,
    hasDegradedServices,
    integrityIssueCount,
    slowOperations,
    undeployedFunctionCount,
    hasUndeployedFunctions,

    // Actions
    runAllChecks,
    runHealthCheckOnly,
    runIntegrityCheckOnly,
    getPerformanceStats,
    checkForSilentFailures,
  };
}

/**
 * Lightweight hook just for health status badge/indicator
 */
export function useHealthStatus(autoRefresh: boolean = true, intervalMs: number = 60000) {
  const [status, setStatus] = useState<HealthStatus>('unknown');
  const [criticalCount, setCriticalCount] = useState(0);

  const checkHealth = useCallback(async () => {
    try {
      const report = await runHealthCheck();
      setStatus(report.overallStatus);
      setCriticalCount(report.criticalIssues.length);
    } catch {
      setStatus('unknown');
    }
  }, []);

  useEffect(() => {
    checkHealth();

    if (autoRefresh) {
      const interval = setInterval(checkHealth, intervalMs);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, intervalMs, checkHealth]);

  return { status, criticalCount, refresh: checkHealth };
}
