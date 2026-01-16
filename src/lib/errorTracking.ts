/**
 * Enhanced Error Tracking System
 * Provides structured error tracking, categorization, and trend analysis
 */

import { supabase } from "@/integrations/supabase/client";

export type ErrorCategory = 
  | 'database_constraint'
  | 'rls_policy'
  | 'api_error'
  | 'validation'
  | 'network'
  | 'authentication'
  | 'component_crash'
  | 'edge_function'
  | 'unknown';

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface TrackedError {
  id?: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  context: {
    component?: string;
    action?: string;
    userId?: string;
    pageUrl?: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
  };
  fingerprint: string; // For deduplication
  occurrences?: number;
}

/**
 * Generate a fingerprint for error deduplication
 */
function generateFingerprint(error: Error | string, context?: string): string {
  const message = error instanceof Error ? error.message : error;
  const baseString = `${message}:${context || ''}`;
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < baseString.length; i++) {
    const char = baseString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Categorize an error based on its message and context
 */
export function categorizeError(error: Error | string): ErrorCategory {
  const message = (error instanceof Error ? error.message : error).toLowerCase();
  
  if (message.includes('row-level security') || message.includes('rls')) {
    return 'rls_policy';
  }
  if (message.includes('constraint') || message.includes('violates') || message.includes('duplicate key')) {
    return 'database_constraint';
  }
  if (message.includes('validation') || message.includes('invalid') || message.includes('required')) {
    return 'validation';
  }
  if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
    return 'network';
  }
  if (message.includes('auth') || message.includes('unauthorized') || message.includes('jwt')) {
    return 'authentication';
  }
  if (message.includes('edge function') || message.includes('function invocation')) {
    return 'edge_function';
  }
  if (message.includes('api') || message.includes('500') || message.includes('404')) {
    return 'api_error';
  }
  
  return 'unknown';
}

/**
 * Determine severity based on error category and context
 */
export function determineSeverity(
  category: ErrorCategory, 
  error: Error | string
): ErrorSeverity {
  const message = (error instanceof Error ? error.message : error).toLowerCase();
  
  // Critical: Security, data loss, or system-wide failures
  if (category === 'rls_policy' || category === 'authentication') {
    return 'critical';
  }
  
  // High: Database issues, constraint violations
  if (category === 'database_constraint') {
    return 'high';
  }
  
  // Medium: API errors, validation failures
  if (category === 'api_error' || category === 'validation' || category === 'edge_function') {
    return 'medium';
  }
  
  // Check for keywords that increase severity
  if (message.includes('critical') || message.includes('fatal') || message.includes('crash')) {
    return 'critical';
  }
  
  return 'low';
}

/**
 * Track an error with full context
 */
export async function trackError(
  error: Error | string,
  context?: {
    component?: string;
    action?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<TrackedError> {
  const category = categorizeError(error);
  const severity = determineSeverity(category, error);
  const message = error instanceof Error ? error.message : error;
  const stack = error instanceof Error ? error.stack : undefined;
  
  const { data: { user } } = await supabase.auth.getUser();
  
  const trackedError: TrackedError = {
    category,
    severity,
    message,
    stack,
    context: {
      component: context?.component,
      action: context?.action,
      userId: user?.id,
      pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
      timestamp: new Date().toISOString(),
      metadata: context?.metadata,
    },
    fingerprint: generateFingerprint(error, context?.component),
  };
  
  // Log to console for development
  console.error(`[${severity.toUpperCase()}] [${category}]`, message, {
    component: context?.component,
    action: context?.action,
  });
  
  // Store in bug_reports table
  try {
    await supabase.from('bug_reports').insert({
      user_id: user?.id || null,
      title: `[Auto] ${category}: ${message.slice(0, 100)}`,
      description: formatErrorDescription(trackedError),
      severity: severity,
      page_url: trackedError.context.pageUrl,
      browser_info: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    });
  } catch (dbError) {
    console.error('Failed to store error in database:', dbError);
  }
  
  return trackedError;
}

/**
 * Format error description for bug reports
 */
function formatErrorDescription(error: TrackedError): string {
  let description = `**Category:** ${error.category}\n`;
  description += `**Severity:** ${error.severity}\n`;
  description += `**Message:** ${error.message}\n\n`;
  
  if (error.context.component) {
    description += `**Component:** ${error.context.component}\n`;
  }
  if (error.context.action) {
    description += `**Action:** ${error.context.action}\n`;
  }
  
  if (error.stack) {
    description += `\n**Stack Trace:**\n\`\`\`\n${error.stack}\n\`\`\`\n`;
  }
  
  if (error.context.metadata) {
    description += `\n**Additional Context:**\n\`\`\`json\n${JSON.stringify(error.context.metadata, null, 2)}\n\`\`\``;
  }
  
  return description;
}

/**
 * Wrapper for async functions with automatic error tracking
 */
export function withErrorTracking<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  context: { component: string; action: string }
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      await trackError(
        error instanceof Error ? error : new Error(String(error)),
        context
      );
      throw error;
    }
  }) as T;
}

/**
 * Get error statistics for monitoring dashboard
 */
export async function getErrorStats(days: number = 7): Promise<{
  total: number;
  byCategory: Record<ErrorCategory, number>;
  bySeverity: Record<ErrorSeverity, number>;
  recentErrors: Array<{
    id: string;
    title: string;
    severity: string;
    created_at: string;
  }>;
}> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const { data: errors } = await supabase
    .from('bug_reports')
    .select('id, title, severity, created_at')
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: false })
    .limit(100);
  
  const byCategory: Record<ErrorCategory, number> = {
    database_constraint: 0,
    rls_policy: 0,
    api_error: 0,
    validation: 0,
    network: 0,
    authentication: 0,
    component_crash: 0,
    edge_function: 0,
    unknown: 0,
  };
  
  const bySeverity: Record<ErrorSeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  
  (errors || []).forEach(error => {
    const severity = error.severity as ErrorSeverity;
    if (severity in bySeverity) {
      bySeverity[severity]++;
    }
    
    // Try to extract category from title
    const categoryMatch = error.title?.match(/\[Auto\] (\w+):/);
    if (categoryMatch && categoryMatch[1] in byCategory) {
      byCategory[categoryMatch[1] as ErrorCategory]++;
    } else {
      byCategory.unknown++;
    }
  });
  
  return {
    total: errors?.length || 0,
    byCategory,
    bySeverity,
    recentErrors: errors || [],
  };
}
