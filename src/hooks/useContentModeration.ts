import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ModerationResult {
  allowed: boolean;
  violations: Array<{
    term: string;
    category: string;
    severity: string;
  }>;
  action: 'allow' | 'warn' | 'block' | 'escalate';
  message?: string;
}

interface UseContentModerationOptions {
  contentType?: string;
  tenantId?: string;
  actionType?: string;
  showWarnings?: boolean;
}

export function useContentModeration(options: UseContentModerationOptions = {}) {
  const [isChecking, setIsChecking] = useState(false);
  const [lastResult, setLastResult] = useState<ModerationResult | null>(null);

  const checkContent = useCallback(async (content: string): Promise<ModerationResult> => {
    if (!content.trim()) {
      return { allowed: true, violations: [], action: 'allow' };
    }

    setIsChecking(true);

    try {
      const { data, error } = await supabase.functions.invoke('guardian-check', {
        body: {
          content,
          content_type: options.contentType || 'chat_message',
          tenant_id: options.tenantId,
          action_type: options.actionType || 'message'
        }
      });

      if (error) {
        console.error('[useContentModeration] Error:', error);
        // Fail open - allow if check fails
        return { allowed: true, violations: [], action: 'allow' };
      }

      const result = data as ModerationResult;
      setLastResult(result);

      // Show appropriate toast based on action
      if (options.showWarnings !== false) {
        if (result.action === 'warn' && result.message) {
          toast.warning("Content Warning", {
            description: result.message
          });
        } else if (result.action === 'block' && result.message) {
          toast.error("Content Blocked", {
            description: result.message
          });
        } else if (result.action === 'escalate' && result.message) {
          toast.error("Content Flagged", {
            description: result.message
          });
        }
      }

      return result;
    } catch (error) {
      console.error('[useContentModeration] Error:', error);
      // Fail open
      return { allowed: true, violations: [], action: 'allow' };
    } finally {
      setIsChecking(false);
    }
  }, [options.contentType, options.tenantId, options.actionType, options.showWarnings]);

  const clearResult = useCallback(() => {
    setLastResult(null);
  }, []);

  return {
    checkContent,
    isChecking,
    lastResult,
    clearResult
  };
}
