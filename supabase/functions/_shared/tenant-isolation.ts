// Tenant Isolation & Security Utilities for Edge Functions

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

/**
 * Tenant validation result
 */
export interface TenantValidation {
  isValid: boolean;
  tenantId: string | null;
  userId: string | null;
  userRole: string | null;
  error?: string;
}

/**
 * Intelligence-style ratings (Police Model)
 */
export type SourceReliability = 'unknown' | 'usually_reliable' | 'reliable';
export type InformationAccuracy = 'cannot_be_judged' | 'possibly_true' | 'confirmed';

export interface IntelligenceRating {
  sourceReliability: SourceReliability;
  informationAccuracy: InformationAccuracy;
  reviewedBy?: string;
  reviewedAt?: string;
}

/**
 * Default rating for new user inputs
 */
export const DEFAULT_INTELLIGENCE_RATING: IntelligenceRating = {
  sourceReliability: 'unknown',
  informationAccuracy: 'cannot_be_judged'
};

/**
 * Environment configuration
 */
export interface EnvironmentConfig {
  environmentName: 'production' | 'staging' | 'test';
  allowUntrustedInputs: boolean;
  requireEvidence: boolean;
}

/**
 * Create an authenticated Supabase client for edge functions
 */
export function createServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
}

/**
 * Extract and validate user from authorization header
 */
export async function validateUserFromRequest(
  req: Request,
  supabase: SupabaseClient
): Promise<{ userId: string | null; error?: string }> {
  const authHeader = req.headers.get('Authorization');
  
  if (!authHeader) {
    return { userId: null, error: 'No authorization header' };
  }

  const token = authHeader.replace('Bearer ', '');
  
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return { userId: null, error: error?.message || 'Invalid token' };
  }

  return { userId: user.id };
}

/**
 * CRITICAL: Validate tenant access before ANY data operation
 * This is the core security gate for multi-tenant isolation
 */
export async function validateTenantAccess(
  req: Request,
  supabase: SupabaseClient,
  requiredTenantId?: string
): Promise<TenantValidation> {
  // First validate user
  const { userId, error: userError } = await validateUserFromRequest(req, supabase);
  
  if (!userId) {
    return {
      isValid: false,
      tenantId: null,
      userId: null,
      userRole: null,
      error: userError || 'Authentication required'
    };
  }

  // Get user's tenant memberships
  const { data: memberships, error: membershipError } = await supabase
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', userId);

  if (membershipError) {
    console.error('[TenantValidation] Error fetching memberships:', membershipError);
    return {
      isValid: false,
      tenantId: null,
      userId,
      userRole: null,
      error: 'Failed to validate tenant access'
    };
  }

  if (!memberships || memberships.length === 0) {
    return {
      isValid: false,
      tenantId: null,
      userId,
      userRole: null,
      error: 'User has no tenant membership. Invite required.'
    };
  }

  // If specific tenant required, verify access
  if (requiredTenantId) {
    const membership = memberships.find(m => m.tenant_id === requiredTenantId);
    
    if (!membership) {
      return {
        isValid: false,
        tenantId: null,
        userId,
        userRole: null,
        error: 'Access denied to requested tenant'
      };
    }

    return {
      isValid: true,
      tenantId: requiredTenantId,
      userId,
      userRole: membership.role
    };
  }

  // Return first tenant if no specific one requested
  const primaryMembership = memberships[0];
  return {
    isValid: true,
    tenantId: primaryMembership.tenant_id,
    userId,
    userRole: primaryMembership.role
  };
}

/**
 * Get current environment configuration
 */
export async function getEnvironmentConfig(
  supabase: SupabaseClient
): Promise<EnvironmentConfig> {
  const { data, error } = await supabase
    .from('environment_config')
    .select('*')
    .eq('is_active', true)
    .single();

  if (error || !data) {
    console.warn('[EnvironmentConfig] Using default production settings');
    return {
      environmentName: 'production',
      allowUntrustedInputs: false,
      requireEvidence: true
    };
  }

  return {
    environmentName: data.environment_name,
    allowUntrustedInputs: data.allow_untrusted_inputs,
    requireEvidence: data.require_evidence
  };
}

/**
 * Log audit event for compliance
 */
export async function logAuditEvent(
  supabase: SupabaseClient,
  event: {
    userId?: string;
    tenantId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  }
): Promise<void> {
  try {
    await supabase.from('audit_events').insert({
      user_id: event.userId,
      tenant_id: event.tenantId,
      action: event.action,
      resource: event.resource,
      resource_id: event.resourceId,
      metadata: event.metadata,
      ip_address: event.ipAddress
    });
  } catch (error) {
    console.error('[AuditLog] Failed to log event:', error);
    // Don't throw - audit logging should not break the operation
  }
}

/**
 * Standard CORS headers for edge functions
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Create error response with proper CORS
 */
export function errorResponse(message: string, status: number = 400): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { 
      status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  );
}

/**
 * Create success response with proper CORS
 */
export function successResponse(data: unknown, status: number = 200): Response {
  return new Response(
    JSON.stringify(data),
    { 
      status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  );
}

/**
 * Check if user has specific role in tenant
 */
export async function checkTenantRole(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
  requiredRoles: string[]
): Promise<boolean> {
  const { data } = await supabase
    .from('tenant_users')
    .select('role')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .single();

  if (!data) return false;
  return requiredRoles.includes(data.role);
}

/**
 * Validate that data write is allowed in current environment
 */
export async function validateWriteOperation(
  supabase: SupabaseClient,
  hasEvidence: boolean
): Promise<{ allowed: boolean; reason?: string }> {
  const config = await getEnvironmentConfig(supabase);
  
  if (config.environmentName === 'production') {
    if (config.requireEvidence && !hasEvidence) {
      return {
        allowed: false,
        reason: 'Production environment requires evidence for all data entries'
      };
    }
  }
  
  return { allowed: true };
}

/**
 * Get IP address from request for audit logging
 */
export function getClientIP(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
         req.headers.get('x-real-ip') || 
         null;
}
