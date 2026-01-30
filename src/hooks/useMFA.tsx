import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface MFASettings {
  id: string;
  user_id: string;
  phone_number: string | null;
  phone_verified: boolean;
  mfa_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export const useMFA = () => {
  const queryClient = useQueryClient();

  const { data: mfaSettings, isLoading, error } = useQuery({
    queryKey: ['mfa-settings'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // Cast to any until types are regenerated for new table
      const { data, error } = await (supabase as any)
        .from('user_mfa_settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        console.error('[useMFA] Error fetching settings:', error);
        throw error;
      }

      return data as MFASettings | null;
    },
  });

  const sendCodeMutation = useMutation({
    mutationFn: async ({ phoneNumber, purpose }: { phoneNumber: string; purpose: 'enrollment' | 'login' }) => {
      const { data, error } = await supabase.functions.invoke('send-mfa-code', {
        body: { phone_number: phoneNumber, purpose },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
  });

  const verifyCodeMutation = useMutation({
    mutationFn: async ({ code, purpose }: { code: string; purpose: 'enrollment' | 'login' }) => {
      const { data, error } = await supabase.functions.invoke('verify-mfa-code', {
        body: { code, purpose },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mfa-settings'] });
    },
  });

  const disableMFAMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Cast to any until types are regenerated for new table
      const { error } = await (supabase as any)
        .from('user_mfa_settings')
        .update({ mfa_enabled: false })
        .eq('user_id', user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mfa-settings'] });
    },
  });

  return {
    mfaSettings,
    isLoading,
    error,
    isMFAEnabled: mfaSettings?.mfa_enabled ?? false,
    phoneNumber: mfaSettings?.phone_number ?? null,
    sendCode: sendCodeMutation.mutateAsync,
    verifyCode: verifyCodeMutation.mutateAsync,
    disableMFA: disableMFAMutation.mutateAsync,
    isSendingCode: sendCodeMutation.isPending,
    isVerifying: verifyCodeMutation.isPending,
    isDisabling: disableMFAMutation.isPending,
  };
};
