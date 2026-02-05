/**
 * Proactive Health Monitoring System
 * Detects issues before users report them
 */

import { supabase } from "@/integrations/supabase/client";

export type HealthStatus = 'healthy' | 'degraded' | 'critical' | 'unknown';

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message: string;
  responseTime?: number;
  metadata?: Record<string, unknown>;
}

export interface SystemHealthReport {
  timestamp: string;
  overallStatus: HealthStatus;
  checks: HealthCheckResult[];
  degradedServices: string[];
  criticalIssues: string[];
}

/**
 * Check database connectivity and query performance
 */
async function checkDatabaseHealth(): Promise<HealthCheckResult> {
  const start = performance.now();
  
  try {
    // Simple query to test connectivity
    const { data, error } = await supabase
      .from('signals')
      .select('id')
      .limit(1);
    
    const responseTime = performance.now() - start;
    
    if (error) {
      return {
        name: 'Database',
        status: 'critical',
        message: `Database error: ${error.message}`,
        responseTime,
      };
    }
    
    // Flag slow responses
    if (responseTime > 3000) {
      return {
        name: 'Database',
        status: 'degraded',
        message: `Slow response: ${Math.round(responseTime)}ms`,
        responseTime,
      };
    }
    
    return {
      name: 'Database',
      status: 'healthy',
      message: 'Connected',
      responseTime,
    };
  } catch (err) {
    return {
      name: 'Database',
      status: 'critical',
      message: `Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      responseTime: performance.now() - start,
    };
  }
}

/**
 * Check authentication service
 */
async function checkAuthHealth(): Promise<HealthCheckResult> {
  const start = performance.now();
  
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    const responseTime = performance.now() - start;
    
    if (error) {
      return {
        name: 'Authentication',
        status: 'critical',
        message: `Auth error: ${error.message}`,
        responseTime,
      };
    }
    
    return {
      name: 'Authentication',
      status: session ? 'healthy' : 'degraded',
      message: session ? 'Active session' : 'No active session',
      responseTime,
    };
  } catch (err) {
    return {
      name: 'Authentication',
      status: 'critical',
      message: `Auth check failed: ${err instanceof Error ? err.message : 'Unknown'}`,
      responseTime: performance.now() - start,
    };
  }
}

/**
 * Check edge function responsiveness
 */
async function checkEdgeFunctionHealth(): Promise<HealthCheckResult> {
  const start = performance.now();
  
  try {
    const { data, error } = await supabase.functions.invoke('system-health-check', {
      body: {},
    });
    
    const responseTime = performance.now() - start;
    
    if (error) {
      return {
        name: 'Edge Functions',
        status: 'degraded',
        message: `Edge function error: ${error.message}`,
        responseTime,
      };
    }
    
    // Check if the health check itself reports issues
    if (data?.status === 'unhealthy') {
      return {
        name: 'Edge Functions',
        status: 'degraded',
        message: `Backend reported issues: ${data.failed_checks?.join(', ') || 'Unknown'}`,
        responseTime,
        metadata: data,
      };
    }
    
    return {
      name: 'Edge Functions',
      status: 'healthy',
      message: 'Responsive',
      responseTime,
    };
  } catch (err) {
    return {
      name: 'Edge Functions',
      status: 'critical',
      message: `Edge functions unreachable: ${err instanceof Error ? err.message : 'Unknown'}`,
      responseTime: performance.now() - start,
    };
  }
}

/**
 * Check for stale monitoring sources
 */
async function checkMonitoringSourceHealth(): Promise<HealthCheckResult> {
  const start = performance.now();
  const staleThreshold = new Date();
  staleThreshold.setHours(staleThreshold.getHours() - 6); // 6 hours without ingestion
  
  try {
    // monitoring_history uses source_name, not source_type
    const { data: staleSources, error } = await supabase
      .from('monitoring_history')
      .select('source_name, scan_completed_at')
      .lt('scan_completed_at', staleThreshold.toISOString())
      .limit(10);
    
    const responseTime = performance.now() - start;
    
    if (error) {
      return {
        name: 'Monitoring Sources',
        status: 'unknown',
        message: `Could not check: ${error.message}`,
        responseTime,
      };
    }
    
    if (staleSources && staleSources.length > 0) {
      return {
        name: 'Monitoring Sources',
        status: 'degraded',
        message: `${staleSources.length} stale sources detected`,
        responseTime,
        metadata: { staleSources: staleSources.map(s => s.source_name) },
      };
    }
    return {
      name: 'Monitoring Sources',
      status: 'healthy',
      message: 'All sources active',
      responseTime,
    };
  } catch (err) {
    return {
      name: 'Monitoring Sources',
      status: 'unknown',
      message: `Check failed: ${err instanceof Error ? err.message : 'Unknown'}`,
      responseTime: performance.now() - start,
    };
  }
}

/**
 * Check for orphaned data (integrity check)
 */
async function checkDataIntegrity(): Promise<HealthCheckResult> {
  const start = performance.now();
  const issues: string[] = [];
  
  try {
    // Check for signals without client_id when they should have one
    const { data: orphanedSignals, error: signalError } = await supabase
      .from('signals')
      .select('id')
      .is('client_id', null)
      .not('category', 'eq', 'global') // Global signals don't need client_id
      .limit(5);
    
    if (!signalError && orphanedSignals && orphanedSignals.length > 0) {
      issues.push(`${orphanedSignals.length}+ orphaned signals`);
    }
    
    // Check for entities without client_id
    const { data: orphanedEntities, error: entityError } = await supabase
      .from('entities')
      .select('id')
      .is('client_id', null)
      .eq('is_active', true)
      .limit(5);
    
    if (!entityError && orphanedEntities && orphanedEntities.length > 0) {
      issues.push(`${orphanedEntities.length}+ orphaned entities`);
    }
    
    const responseTime = performance.now() - start;
    
    if (issues.length > 0) {
      return {
        name: 'Data Integrity',
        status: 'degraded',
        message: issues.join(', '),
        responseTime,
        metadata: { issues },
      };
    }
    
    return {
      name: 'Data Integrity',
      status: 'healthy',
      message: 'No orphaned data detected',
      responseTime,
    };
  } catch (err) {
    return {
      name: 'Data Integrity',
      status: 'unknown',
      message: `Integrity check failed: ${err instanceof Error ? err.message : 'Unknown'}`,
      responseTime: performance.now() - start,
    };
  }
}

/**
 * Check recent error rate from bug_reports
 */
async function checkErrorRate(): Promise<HealthCheckResult> {
  const start = performance.now();
  const oneHourAgo = new Date();
  oneHourAgo.setHours(oneHourAgo.getHours() - 1);
  
  try {
    const { count, error } = await supabase
      .from('bug_reports')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', oneHourAgo.toISOString())
      .eq('status', 'open');
    
    const responseTime = performance.now() - start;
    
    if (error) {
      return {
        name: 'Error Rate',
        status: 'unknown',
        message: `Could not check: ${error.message}`,
        responseTime,
      };
    }
    
    const errorCount = count || 0;
    
    if (errorCount > 10) {
      return {
        name: 'Error Rate',
        status: 'critical',
        message: `${errorCount} errors in last hour`,
        responseTime,
        metadata: { errorCount },
      };
    }
    
    if (errorCount > 5) {
      return {
        name: 'Error Rate',
        status: 'degraded',
        message: `${errorCount} errors in last hour`,
        responseTime,
        metadata: { errorCount },
      };
    }
    
    return {
      name: 'Error Rate',
      status: 'healthy',
      message: `${errorCount} errors in last hour`,
      responseTime,
      metadata: { errorCount },
    };
  } catch (err) {
    return {
      name: 'Error Rate',
      status: 'unknown',
      message: `Check failed: ${err instanceof Error ? err.message : 'Unknown'}`,
      responseTime: performance.now() - start,
    };
  }
}

/**
 * Run all health checks and generate report
 */
export async function runHealthCheck(): Promise<SystemHealthReport> {
  const checks = await Promise.all([
    checkDatabaseHealth(),
    checkAuthHealth(),
    checkEdgeFunctionHealth(),
    checkMonitoringSourceHealth(),
    checkDataIntegrity(),
    checkErrorRate(),
  ]);
  
  const degradedServices = checks
    .filter(c => c.status === 'degraded')
    .map(c => c.name);
  
  const criticalIssues = checks
    .filter(c => c.status === 'critical')
    .map(c => `${c.name}: ${c.message}`);
  
  // Determine overall status
  let overallStatus: HealthStatus = 'healthy';
  if (criticalIssues.length > 0) {
    overallStatus = 'critical';
  } else if (degradedServices.length > 0) {
    overallStatus = 'degraded';
  } else if (checks.some(c => c.status === 'unknown')) {
    overallStatus = 'unknown';
  }
  
  return {
    timestamp: new Date().toISOString(),
    overallStatus,
    checks,
    degradedServices,
    criticalIssues,
  };
}

/**
 * Store health check results for trend analysis
 */
export async function storeHealthCheckResult(report: SystemHealthReport): Promise<void> {
  try {
    await supabase.from('automation_metrics').insert({
      metric_date: new Date().toISOString().split('T')[0],
      accuracy_rate: report.checks.filter(c => c.status === 'healthy').length / report.checks.length,
      false_positive_rate: report.degradedServices.length / report.checks.length,
    });
  } catch (err) {
    console.error('[HealthMonitor] Failed to store results:', err);
  }
}

/**
 * Get historical health trends
 */
export async function getHealthTrends(days: number = 7): Promise<{
  dates: string[];
  healthScores: number[];
  degradedCounts: number[];
}> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const { data, error } = await supabase
    .from('automation_metrics')
    .select('metric_date, accuracy_rate, false_positive_rate')
    .gte('metric_date', startDate.toISOString().split('T')[0])
    .order('metric_date', { ascending: true });
  
  if (error || !data) {
    return { dates: [], healthScores: [], degradedCounts: [] };
  }
  
  return {
    dates: data.map(d => d.metric_date),
    healthScores: data.map(d => (d.accuracy_rate || 0) * 100),
    degradedCounts: data.map(d => Math.round((d.false_positive_rate || 0) * 6)), // Approximate
  };
}
