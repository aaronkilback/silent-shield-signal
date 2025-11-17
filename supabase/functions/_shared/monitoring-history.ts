// Shared monitoring history helper functions
export async function createHistoryEntry(supabase: any, sourceName: string) {
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
