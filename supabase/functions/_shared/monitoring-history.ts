// Shared monitoring history helper functions

/**
 * Auto-remediate stalled entries older than 30 minutes.
 * Called opportunistically during createHistoryEntry.
 */
async function autoRemediateStalled(supabase: any) {
  try {
    await supabase
      .from('monitoring_history')
      .update({
        status: 'stalled',
        scan_completed_at: new Date().toISOString(),
        error_message: 'Auto-remediated: stuck in running state >30min',
      })
      .eq('status', 'running')
      .lt('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString());
  } catch (e) {
    console.warn('autoRemediateStalled sweep failed:', e);
  }
}

export async function createHistoryEntry(supabase: any, sourceName: string) {
  // Opportunistic cleanup of stalled entries
  await autoRemediateStalled(supabase);

  const { data, error } = await supabase
    .from('monitoring_history')
    .insert({
      source_name: sourceName,
      status: 'running'
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create monitoring history:', error);
  }

  return data;
}

export async function completeHistoryEntry(
  supabase: any,
  historyId: string,
  itemsScanned: number,
  signalsCreated: number
) {
  await supabase
    .from('monitoring_history')
    .update({
      status: 'completed',
      scan_completed_at: new Date().toISOString(),
      items_scanned: itemsScanned,
      signals_created: signalsCreated
    })
    .eq('id', historyId);
}

export async function failHistoryEntry(
  supabase: any,
  historyId: string,
  errorMessage: string
) {
  await supabase
    .from('monitoring_history')
    .update({
      status: 'failed',
      scan_completed_at: new Date().toISOString(),
      error_message: errorMessage
    })
    .eq('id', historyId);
}
