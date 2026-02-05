/**
 * Data Integrity Validation and Repair
 * Prevents and detects orphaned records, missing references, and data corruption
 */

import { supabase } from "@/integrations/supabase/client";

export interface IntegrityIssue {
  table: string;
  issueType: 'orphaned_record' | 'missing_reference' | 'null_required_field' | 'invalid_foreign_key' | 'duplicate';
  recordId: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  autoFixable: boolean;
  fixAction?: string;
}

export interface IntegrityReport {
  timestamp: string;
  issuesFound: number;
  issuesFixed: number;
  issues: IntegrityIssue[];
  duration: number;
}

/**
 * Check for orphaned signals (no client when expected)
 */
async function checkOrphanedSignals(): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  
  const { data: orphaned, error } = await supabase
    .from('signals')
    .select('id, normalized_text, source_id, category')
    .is('client_id', null)
    .not('category', 'in', '("global","weather","earthquake")') // These are okay without client
    .limit(100);
  
  if (!error && orphaned) {
    for (const record of orphaned) {
      issues.push({
        table: 'signals',
        issueType: 'orphaned_record',
        recordId: record.id,
        description: `Signal "${record.normalized_text?.slice(0, 50) || 'Untitled'}" has no client_id (source_id: ${record.source_id})`,
        severity: 'medium',
        autoFixable: false,
        fixAction: 'Associate with appropriate client or mark as global',
      });
    }
  }
  
  return issues;
}

/**
 * Check for orphaned entities
 */
async function checkOrphanedEntities(): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  
  const { data: orphaned, error } = await supabase
    .from('entities')
    .select('id, name, type')
    .is('client_id', null)
    .eq('is_active', true)
    .limit(100);
  
  if (!error && orphaned) {
    for (const record of orphaned) {
      issues.push({
        table: 'entities',
        issueType: 'orphaned_record',
        recordId: record.id,
        description: `Entity "${record.name}" (${record.type}) has no client_id`,
        severity: 'high',
        autoFixable: false,
        fixAction: 'Associate with appropriate client',
      });
    }
  }
  
  return issues;
}

/**
 * Check for investigations without valid client references
 */
async function checkInvestigationIntegrity(): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  
  // Check for investigations with invalid client_id
  const { data: investigations, error } = await supabase
    .from('investigations')
    .select('id, file_number, client_id')
    .not('client_id', 'is', null)
    .limit(100);
  
  if (!error && investigations) {
    // Get all valid client IDs
    const { data: clients } = await supabase
      .from('clients')
      .select('id');
    
    const validClientIds = new Set(clients?.map(c => c.id) || []);
    
    for (const inv of investigations) {
      if (inv.client_id && !validClientIds.has(inv.client_id)) {
        issues.push({
          table: 'investigations',
          issueType: 'invalid_foreign_key',
          recordId: inv.id,
          description: `Investigation "${inv.file_number || inv.id}" references non-existent client`,
          severity: 'critical',
          autoFixable: false,
          fixAction: 'Re-associate with valid client',
        });
      }
    }
  }
  
  return issues;
}

/**
 * Check for signals missing required fields
 */
async function checkSignalRequiredFields(): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  
  // Check for signals without normalized_text
  const { data: missingText, error } = await supabase
    .from('signals')
    .select('id, source_id, category')
    .is('normalized_text', null)
    .limit(50);
  
  if (!error && missingText) {
    for (const record of missingText) {
      issues.push({
        table: 'signals',
        issueType: 'null_required_field',
        recordId: record.id,
        description: `Signal (source_id: ${record.source_id}, category: ${record.category}) missing normalized_text`,
        severity: 'medium',
        autoFixable: false,
        fixAction: 'Re-process or delete signal',
      });
    }
  }
  
  return issues;
}

/**
 * Check for duplicate content hashes (potential duplicate signals)
 */
async function checkDuplicateSignals(): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  
  // Find content_hash duplicates in recent signals
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  
  const { data: recentSignals, error } = await supabase
    .from('signals')
    .select('id, content_hash, client_id')
    .gte('created_at', oneDayAgo.toISOString())
    .not('content_hash', 'is', null)
    .limit(500);
  
  if (!error && recentSignals) {
    const hashMap = new Map<string, string[]>();
    
    for (const signal of recentSignals) {
      if (signal.content_hash) {
        const key = `${signal.content_hash}-${signal.client_id || 'global'}`;
        const existing = hashMap.get(key) || [];
        existing.push(signal.id);
        hashMap.set(key, existing);
      }
    }
    
    // Report duplicates
    for (const [hash, ids] of hashMap.entries()) {
      if (ids.length > 1) {
        issues.push({
          table: 'signals',
          issueType: 'duplicate',
          recordId: ids[0],
          description: `${ids.length} signals with same content hash (keep newest, archive others)`,
          severity: 'low',
          autoFixable: true,
          fixAction: `Archive duplicate signals: ${ids.slice(1).join(', ')}`,
        });
      }
    }
  }
  
  return issues;
}

/**
 * Check for feedback events referencing deleted objects
 */
async function checkOrphanedFeedback(): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  
  // feedback_events uses object_type and object_id, not signal_id
  const { data: feedback, error } = await supabase
    .from('feedback_events')
    .select('id, object_type, object_id')
    .eq('object_type', 'signal')
    .limit(100);
  
  if (!error && feedback) {
    // Get all signal IDs
    const { data: signals } = await supabase
      .from('signals')
      .select('id');
    
    const validSignalIds = new Set(signals?.map(s => s.id) || []);
    
    for (const fb of feedback) {
      if (fb.object_id && !validSignalIds.has(fb.object_id)) {
        issues.push({
          table: 'feedback_events',
          issueType: 'invalid_foreign_key',
          recordId: fb.id,
          description: `Feedback references deleted signal ${fb.object_id}`,
          severity: 'low',
          autoFixable: true,
          fixAction: 'Delete orphaned feedback record',
        });
      }
    }
  }
  
  return issues;
}

/**
 * Run comprehensive data integrity check
 */
export async function runIntegrityCheck(): Promise<IntegrityReport> {
  const start = performance.now();
  
  const allIssues = await Promise.all([
    checkOrphanedSignals(),
    checkOrphanedEntities(),
    checkInvestigationIntegrity(),
    checkSignalRequiredFields(),
    checkDuplicateSignals(),
    checkOrphanedFeedback(),
  ]);
  
  const issues = allIssues.flat();
  const duration = performance.now() - start;
  
  return {
    timestamp: new Date().toISOString(),
    issuesFound: issues.length,
    issuesFixed: 0,
    issues,
    duration,
  };
}

/**
 * Auto-fix issues that are marked as autoFixable
 */
export async function autoFixIssues(issues: IntegrityIssue[]): Promise<{
  fixed: number;
  failed: number;
  errors: string[];
}> {
  let fixed = 0;
  let failed = 0;
  const errors: string[] = [];
  
  for (const issue of issues.filter(i => i.autoFixable)) {
    try {
      switch (issue.issueType) {
        case 'null_required_field':
          // Log for manual review - no automatic backfill RPC exists
          console.warn(`[DataIntegrity] Manual fix needed for ${issue.table}: ${issue.description}`);
          break;
          
        case 'invalid_foreign_key':
          if (issue.table === 'feedback_events') {
            // Delete orphaned feedback
            const { error } = await supabase
              .from('feedback_events')
              .delete()
              .eq('id', issue.recordId);
            if (error) throw error;
            fixed++;
          }
          break;
          
        case 'duplicate':
          // For duplicates, we log but don't auto-archive (needs human review)
          console.warn(`[DataIntegrity] Duplicate detected: ${issue.description}`);
          break;
          
        default:
          console.log(`[DataIntegrity] No auto-fix for ${issue.issueType}`);
      }
    } catch (err) {
      failed++;
      errors.push(`Failed to fix ${issue.recordId}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }
  
  return { fixed, failed, errors };
}

/**
 * Validate data before insertion to prevent integrity issues
 */
export function validateSignal(signal: {
  title?: string;
  normalized_text?: string;
  source?: string;
  category?: string;
  client_id?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!signal.title && !signal.normalized_text) {
    errors.push('Signal must have either title or normalized_text');
  }
  
  if (!signal.source) {
    errors.push('Signal must have a source');
  }
  
  if (!signal.category) {
    errors.push('Signal must have a category');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate entity before creation
 */
export function validateEntity(entity: {
  name?: string;
  type?: string;
  client_id?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const validTypes = ['person', 'organization', 'location', 'vehicle', 'event', 'asset'];
  
  if (!entity.name || entity.name.trim().length < 2) {
    errors.push('Entity must have a name with at least 2 characters');
  }
  
  if (!entity.type || !validTypes.includes(entity.type)) {
    errors.push(`Entity type must be one of: ${validTypes.join(', ')}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
