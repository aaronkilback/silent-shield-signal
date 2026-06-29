/**
 * Standardized Supabase client utilities for edge functions.
 * 
 * CRITICAL: All edge functions must import from this module to ensure:
 * - Consistent npm: specifier usage (prevents bundle timeouts)
 * - Proper authentication patterns
 * - Centralized error handling
 * 
 * Usage:
 *   import { createServiceClient, corsHeaders, handleCors } from "../_shared/supabase-client.ts";
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════════════════
//                           CORS HEADERS
// ═══════════════════════════════════════════════════════════════════════════

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ═══════════════════════════════════════════════════════════════════════════
//                           CLIENT CREATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a Supabase client with service role privileges.
 * Use for admin operations that bypass RLS.
 */
export function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  }
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Creates a Supabase client with the anon key.
 * Use for operations that should respect RLS policies.
 */
export function createAnonClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  
  if (!supabaseUrl || !anonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
  }
  
  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Creates a Supabase client authenticated with a user's JWT token.
 * Respects RLS policies for the authenticated user.
 */
export function createUserClient(token: string): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  
  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//                           AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════════════

export interface AuthResult {
  userId: string | null;
  user: any | null;
  error: string | null;
}

/**
 * Extract and validate user from request authorization header.
 * Use this pattern when verify_jwt = false in config.toml.
 */
export async function getUserFromRequest(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization');
  
  if (!authHeader) {
    return { userId: null, user: null, error: 'No authorization header' };
  }
  
  const token = authHeader.replace('Bearer ', '');
  
  if (!token) {
    return { userId: null, user: null, error: 'No token in authorization header' };
  }
  
  try {
    const supabase = createServiceClient();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return { userId: null, user: null, error: error?.message || 'Invalid token' };
    }
    
    return { userId: user.id, user, error: null };
  } catch (err) {
    console.error('[Auth] Error validating token:', err);
    return { userId: null, user: null, error: 'Token validation failed' };
  }
}

/**
 * Require authentication - returns user or throws error response.
 */
export async function requireAuth(req: Request): Promise<{ userId: string; user: any }> {
  const { userId, user, error } = await getUserFromRequest(req);

  if (!userId || !user) {
    throw errorResponse(error || 'Authentication required', 401);
  }

  return { userId, user };
}

// ═══════════════════════════════════════════════════════════════════════════
//   F-026 caller-identity gate (service-role aware) + tenant access checks
//
//   Used by edge functions with verify_jwt=false that must distinguish
//   trusted internal callers (service role) from user JWT callers (must bind
//   tenant). Originally introduced in 60006a89 for F-025 (generate-daily-
//   briefing, generate-executive-report); extended in f2965d9c for F-026
//   (ingest-signal).
//
//   Three exports here:
//     - getCallerIdentity        — resolves a request to service_role / user /
//                                  unauthorized. Drop-in for any function that
//                                  needs to distinguish trusted internal vs
//                                  user-JWT callers under verify_jwt=false.
//     - userCanAccessClient      — singular: does THIS user have access to
//                                  THIS one client_id? Cheap, prefer when the
//                                  caller knows the single client_id ahead.
//     - getAccessibleClientIds   — plural: which client_ids does THIS user
//                                  have access to? Used when the caller must
//                                  validate against a set or list. Calls the
//                                  canonical parameterized RPC (migration
//                                  20260520235000); SAME join as the no-arg
//                                  RPC used by RLS on `clients`.
//
//   Both helpers fail-CLOSED: any error returns "no access" rather than
//   "all access" — the gate code interprets empty access as a 403.
// ═══════════════════════════════════════════════════════════════════════════

export type CallerIdentity =
  | { kind: 'service_role' }
  | { kind: 'user'; userId: string; user: any }
  | { kind: 'unauthorized'; error: string; status: number };

export async function getCallerIdentity(req: Request): Promise<CallerIdentity> {
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
    return { kind: 'unauthorized', error: 'authentication required', status: 401 };
  }
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { kind: 'unauthorized', error: 'authentication required', status: 401 };
  }

  // Service-role check covers two real paths the codebase actually uses:
  //   (a) callers that read Deno.env.SUPABASE_SERVICE_ROLE_KEY directly
  //       (scheduled-report-delivery, dashboard-ai-assistant report tool)
  //   (b) callers that use the rotated vault key via the
  //       get_current_service_role_key() RPC (May 6 2026 rotation pattern)
  // Either must be accepted; env and vault values can diverge during a
  // rotation window, and rejecting one would 401 legitimate inter-function calls.
  const envKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (envKey.length > 0 && token === envKey) {
    return { kind: 'service_role' };
  }
  try {
    const probe = createServiceClient();
    const { data: vaultKey } = await probe.rpc('get_current_service_role_key');
    if (typeof vaultKey === 'string' && vaultKey.length > 0 && token === vaultKey) {
      return { kind: 'service_role' };
    }
  } catch (_) {
    // Vault probe failed — fall through to user-JWT path. We do not treat
    // vault failure as fatal because (a) the RPC may not exist on every
    // environment yet, and (b) the env-key path above already handled the
    // common service-role caller. User JWT validation still works.
  }

  try {
    const supabase = createServiceClient();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return { kind: 'unauthorized', error: error?.message || 'invalid or expired token', status: 401 };
    }
    return { kind: 'user', userId: user.id, user };
  } catch (err) {
    console.error('[getCallerIdentity] token validation threw:', err);
    return { kind: 'unauthorized', error: 'token validation failed', status: 401 };
  }
}

/**
 * F-025 helper — check whether a specific user can access a specific client.
 * Cheap (single-row check). Prefer over getAccessibleClientIds() when the
 * caller already knows the single client_id to validate.
 */
export async function userCanAccessClient(
  supabase: SupabaseClient,
  userId: string,
  clientId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, tenant_id, tenant_users!inner(user_id)')
    .eq('id', clientId)
    .eq('tenant_users.user_id', userId)
    .limit(1);
  if (error) {
    console.error('[userCanAccessClient] lookup error:', error);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * F-026 helper — return the full set of client_ids a user can access via
 * their tenant_users membership. Calls the canonical parameterized RPC
 * `get_user_accessible_client_ids(_user_id)`, which uses the SAME join as
 * the no-arg RPC used by RLS on `clients`. Any divergence between this
 * helper and RLS is a bug — both must point at the same SQL function.
 *
 * Fail-closed: any error returns empty array. Caller treats empty as
 * "no accessible clients" → gate rejects the request.
 */
export async function getAccessibleClientIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .rpc('get_user_accessible_client_ids', { _user_id: userId });
  if (error) {
    console.error('[getAccessibleClientIds] RPC error:', error);
    return [];
  }
  return (data ?? [])
    .map((row: { client_id: string }) => row?.client_id)
    .filter((id: string | undefined): id is string => typeof id === 'string');
}

/**
 * INC-SIGNALS-CLIENT-SCOPE helper — is this user a platform operator
 * (super_admin)? Operators legitimately read across a tenant's clients, so the
 * client-scope containment skips client narrowing for them. Calls the canonical
 * `is_super_admin(_user_id)` SQL function (the same predicate RLS uses).
 *
 * Fail-closed: any error returns FALSE (treated as a normal, client-scoped
 * caller) — an error must never silently grant operator-wide visibility.
 */
export async function isSuperAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .rpc('is_super_admin', { _user_id: userId });
  if (error) {
    console.error('[isSuperAdmin] RPC error:', error);
    return false;
  }
  return data === true;
}

// ═══════════════════════════════════════════════════════════════════════════
//                           RESPONSE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle CORS preflight requests.
 */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  return null;
}

/**
 * Create a JSON success response with CORS headers.
 */
export function successResponse(data: unknown, status: number = 200): Response {
  return new Response(
    JSON.stringify(data),
    { 
      status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Create a JSON error response with CORS headers.
 */
export function errorResponse(message: string, status: number = 400): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { 
      status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//                           SAFE ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Safely execute an async operation with proper error logging.
 * Use this instead of silent .catch(() => {}) patterns.
 */
export async function safeExecute<T>(
  operation: () => Promise<T>,
  context: string,
  fallback?: T
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    console.error(`[${context}] Operation failed:`, error);
    return fallback;
  }
}

/**
 * Safely execute with required result - throws if operation fails.
 */
export async function safeExecuteRequired<T>(
  operation: () => Promise<T>,
  context: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error(`[${context}] Required operation failed:`, error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//                           ENVIRONMENT HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get environment variable with optional fallback.
 */
export function getEnv(key: string, fallback?: string): string {
  const value = Deno.env.get(key);
  if (!value && fallback === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || fallback || '';
}

/**
 * Get the Supabase URL.
 */
export function getSupabaseUrl(): string {
  return getEnv('SUPABASE_URL');
}

/**
 * Get the Supabase anon key.
 */
export function getSupabaseAnonKey(): string {
  return getEnv('SUPABASE_ANON_KEY');
}

// Re-export types for convenience
export type { SupabaseClient };
