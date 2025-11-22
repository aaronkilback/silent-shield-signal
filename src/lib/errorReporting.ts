import { supabase } from "@/integrations/supabase/client";

export interface ErrorReport {
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context?: string;
  error?: Error;
}

/**
 * Automatically report errors to the bug_reports table
 */
export async function reportError(report: ErrorReport): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    let description = report.description;
    
    if (report.error) {
      description += `\n\n**Error Details:**\n${report.error.message}\n\n**Stack:**\n\`\`\`\n${report.error.stack || 'Not available'}\n\`\`\``;
    }

    if (report.context) {
      description += `\n\n**Context:** ${report.context}`;
    }

    await supabase.from('bug_reports').insert({
      user_id: user?.id || null,
      title: `[Auto] ${report.title}`,
      description,
      severity: report.severity,
      page_url: window.location.href,
      browser_info: navigator.userAgent,
    });
  } catch (err) {
    console.error('Failed to report error:', err);
  }
}

/**
 * Wrap async functions with automatic error reporting
 */
export function withErrorReporting<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  context: string,
  severity: ErrorReport['severity'] = 'medium'
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      console.error(`Error in ${context}:`, error);
      
      await reportError({
        title: `${context} Failed`,
        description: `An error occurred in ${context}`,
        severity,
        context,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      
      throw error;
    }
  }) as T;
}
