import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface CorrelateSignalEntitiesParams {
  supabase: SupabaseClient;
  signalText: string;
  clientId: string;
  additionalContext?: string;
}

/**
 * Correlates entities from a signal's text content.
 * Searches for the most recent signal matching the criteria and invokes entity correlation.
 */
export async function correlateSignalEntities({
  supabase,
  signalText,
  clientId,
  additionalContext = ''
}: CorrelateSignalEntitiesParams): Promise<void> {
  try {
    // Find the most recently created signal matching this text and client
    const { data: signalData, error: signalError } = await supabase
      .from('signals')
      .select('id')
      .eq('normalized_text', signalText)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (signalError || !signalData) {
      console.log('Could not find signal for entity correlation:', signalError?.message);
      return;
    }

    // Combine signal text with any additional context
    const fullText = additionalContext 
      ? `${signalText}. ${additionalContext}`
      : signalText;

    // Invoke entity correlation
    const { error: correlateError } = await supabase.functions.invoke('correlate-entities', {
      body: {
        text: fullText,
        sourceType: 'signal',
        sourceId: signalData.id,
        autoApprove: false
      }
    });

    if (correlateError) {
      console.error('Error correlating entities:', correlateError);
    } else {
      console.log(`Entity correlation initiated for signal ${signalData.id}`);
    }
  } catch (error) {
    console.error('Error in correlateSignalEntities:', error);
  }
}
