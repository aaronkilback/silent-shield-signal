import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { 
  Consortium, 
  ConsortiumMember, 
  ConsortiumUserAccess,
  SharedIntelProduct,
  SharedIncident,
  PendingShare,
  TLPClassification,
  SharingGranularity,
  ConsortiumRole,
  IntelProductType
} from "@/lib/consortiumTypes";
import { toast } from "sonner";

// Fetch user's consortia
export function useUserConsortia() {
  return useQuery({
    queryKey: ['consortia', 'user'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('consortia')
        .select('*')
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      return data as Consortium[];
    },
  });
}

// Fetch single consortium with members
export function useConsortium(consortiumId: string | null) {
  return useQuery({
    queryKey: ['consortia', consortiumId],
    queryFn: async () => {
      if (!consortiumId) return null;
      
      const { data, error } = await supabase
        .from('consortia')
        .select('*')
        .eq('id', consortiumId)
        .single();
      
      if (error) throw error;
      return data as Consortium;
    },
    enabled: !!consortiumId,
  });
}

// Fetch consortium members
export function useConsortiumMembers(consortiumId: string | null) {
  return useQuery({
    queryKey: ['consortia', consortiumId, 'members'],
    queryFn: async () => {
      if (!consortiumId) return [];
      
      const { data, error } = await supabase
        .from('consortium_members')
        .select(`
          *,
          client:clients(id, name, industry),
          tenant:tenants(id, name)
        `)
        .eq('consortium_id', consortiumId)
        .eq('is_active', true)
        .order('joined_at');
      
      if (error) throw error;
      return data as ConsortiumMember[];
    },
    enabled: !!consortiumId,
  });
}

// Fetch shared intel products
export function useSharedIntelProducts(consortiumId: string | null, productType?: IntelProductType) {
  return useQuery({
    queryKey: ['consortia', consortiumId, 'products', productType],
    queryFn: async () => {
      if (!consortiumId) return [];
      
      let query = supabase
        .from('shared_intel_products')
        .select(`
          *,
          author:profiles!created_by(id, name)
        `)
        .eq('consortium_id', consortiumId)
        .order('created_at', { ascending: false });
      
      if (productType) {
        query = query.eq('product_type', productType);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      return data as SharedIntelProduct[];
    },
    enabled: !!consortiumId,
  });
}

// Fetch shared incidents
export function useSharedIncidents(consortiumId: string | null) {
  return useQuery({
    queryKey: ['consortia', consortiumId, 'incidents'],
    queryFn: async () => {
      if (!consortiumId) return [];
      
      const { data, error } = await supabase
        .from('shared_incidents')
        .select('*')
        .eq('consortium_id', consortiumId)
        .eq('is_active', true)
        .order('shared_at', { ascending: false });
      
      if (error) throw error;
      return data as SharedIncident[];
    },
    enabled: !!consortiumId,
  });
}

// Fetch pending shares
export function usePendingShares(consortiumId: string | null) {
  return useQuery({
    queryKey: ['consortia', consortiumId, 'pending'],
    queryFn: async () => {
      if (!consortiumId) return [];
      
      const { data, error } = await supabase
        .from('pending_shares')
        .select('*')
        .eq('consortium_id', consortiumId)
        .eq('status', 'pending')
        .order('submitted_at', { ascending: false });
      
      if (error) throw error;
      return data as PendingShare[];
    },
    enabled: !!consortiumId,
  });
}

// Create consortium mutation
export function useCreateConsortium() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (consortium: {
      name: string;
      description?: string;
      region?: string;
      classification_default?: TLPClassification;
      sharing_granularity_default?: SharingGranularity;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const { data, error } = await supabase
        .from('consortia')
        .insert({
          ...consortium,
          created_by: user.id,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data as Consortium;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consortia'] });
      toast.success('Consortium created successfully');
    },
    onError: (error) => {
      toast.error(`Failed to create consortium: ${error.message}`);
    },
  });
}

// Add member to consortium
export function useAddConsortiumMember() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (params: {
      consortium_id: string;
      client_id?: string;
      tenant_id?: string;
      role?: ConsortiumRole;
      sharing_incidents?: SharingGranularity;
      sharing_signals?: SharingGranularity;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const { data, error } = await supabase
        .from('consortium_members')
        .insert({
          ...params,
          invited_by: user.id,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data as ConsortiumMember;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['consortia', variables.consortium_id, 'members'] });
      toast.success('Member added to consortium');
    },
    onError: (error) => {
      toast.error(`Failed to add member: ${error.message}`);
    },
  });
}

// Create intel product
export function useCreateIntelProduct() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (product: {
      consortium_id: string;
      product_type: IntelProductType;
      title: string;
      summary?: string;
      content?: string;
      content_html?: string;
      classification?: TLPClassification;
      period_start?: string;
      period_end?: string;
      is_draft?: boolean;
      ai_generated?: boolean;
      source_signals?: string[];
      source_incidents?: string[];
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const { data, error } = await supabase
        .from('shared_intel_products')
        .insert({
          ...product,
          created_by: user.id,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data as SharedIntelProduct;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['consortia', variables.consortium_id, 'products'] });
      toast.success('Intelligence product created');
    },
    onError: (error) => {
      toast.error(`Failed to create product: ${error.message}`);
    },
  });
}

// Publish intel product
export function usePublishIntelProduct() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (productId: string) => {
      const { data, error } = await supabase
        .from('shared_intel_products')
        .update({
          is_published: true,
          is_draft: false,
          published_at: new Date().toISOString(),
        })
        .eq('id', productId)
        .select()
        .single();
      
      if (error) throw error;
      return data as SharedIntelProduct;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['consortia', data.consortium_id, 'products'] });
      toast.success('Intelligence product published');
    },
    onError: (error) => {
      toast.error(`Failed to publish: ${error.message}`);
    },
  });
}

// Share incident to consortium
export function useShareIncident() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (params: {
      consortium_id: string;
      source_incident_id: string;
      source_member_id: string;
      title: string;
      description?: string;
      incident_type?: string;
      classification?: TLPClassification;
      granularity?: SharingGranularity;
      region?: string;
      severity?: string;
      threat_category?: string;
      occurred_at?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const { data, error } = await supabase
        .from('shared_incidents')
        .insert({
          ...params,
          shared_by: user.id,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data as SharedIncident;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['consortia', variables.consortium_id, 'incidents'] });
      toast.success('Incident shared to consortium');
    },
    onError: (error) => {
      toast.error(`Failed to share incident: ${error.message}`);
    },
  });
}

// Approve/reject pending share
export function useReviewPendingShare() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (params: {
      shareId: string;
      approved: boolean;
      rejection_reason?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const { data, error } = await supabase
        .from('pending_shares')
        .update({
          status: params.approved ? 'approved' : 'rejected',
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
          rejection_reason: params.rejection_reason || null,
        })
        .eq('id', params.shareId)
        .select()
        .single();
      
      if (error) throw error;
      return data as PendingShare;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['consortia', data.consortium_id, 'pending'] });
      toast.success(data.status === 'approved' ? 'Share approved' : 'Share rejected');
    },
    onError: (error) => {
      toast.error(`Failed to review share: ${error.message}`);
    },
  });
}
