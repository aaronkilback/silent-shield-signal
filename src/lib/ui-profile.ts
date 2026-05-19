/**
 * Tenant UI profile gate (Phase 3, 2026-05-18).
 *
 * Tenants whose settings.ui_profile === 'crt' see a restricted nav surface
 * — only the operational pages CRT needs for the BC Place engagement. The
 * default ('operator') is the full Silent Shield Operations surface.
 *
 * Source of truth: tenant.settings.ui_profile. Set at provisioning time.
 *
 * Visibility model:
 *   active  → render and click through
 *   greyed  → render but disabled (Calvin/Vince can see we have it; can't enter)
 *   hidden  → don't render at all (internal/admin/dev tooling)
 */

export type UiProfile = 'operator' | 'crt';

const CRT_ACTIVE_PATHS = new Set<string>([
  '/',                  // Aegis (home / chat surface)
  '/signals',
  '/incidents',
  '/clients',
  '/entities',
  '/sources',
  '/reports',           // Executive Report Generator
  '/investigations',
]);

const CRT_GREYED_PATHS = new Set<string>([
  '/vip-deep-scan',     // Vulnerability Scan
  '/travel',
  '/site-audits',
]);

export type NavVisibility = 'active' | 'greyed' | 'hidden';

export function getUiProfile(settings?: Record<string, unknown> | null): UiProfile {
  if (settings && typeof settings === 'object' && (settings as Record<string, unknown>).ui_profile === 'crt') {
    return 'crt';
  }
  return 'operator';
}

export function getNavVisibility(profile: UiProfile, path: string): NavVisibility {
  if (profile === 'operator') return 'active';
  // Delegate the access decision to canAccessRoute so the route guard
  // and the nav dropdowns can never disagree about whether a path is
  // allowed. canAccessRoute is the single source of truth.
  if (canAccessRoute(profile, path)) return 'active';
  if (CRT_GREYED_PATHS.has(path)) return 'greyed';
  return 'hidden';
}

// Sub-route prefixes that should be accessible whenever the parent
// list view is in CRT_ACTIVE_PATHS. The dashboard uses singular detail
// routes (/client/:id, /investigation/:id) and a nested config route
// (/clients/:id/arcgis) that don't match the plural list paths via
// strict Set.has() comparison.
const CRT_ACTIVE_PREFIXES: string[] = [
  '/client/',         // detail for an item from /clients
  '/clients/',        // sub-config under /clients/:id/...
  '/investigation/',  // detail for an item from /investigations
];

/**
 * Route-level access check. Returns true if a user on this UI profile
 * may load the given path (direct URL or programmatic navigation).
 *
 * Used by ProtectedRoute as the source-of-truth gate so direct URL
 * access to a route that is hidden/greyed in the CRT nav is blocked.
 * Without this gate, hiding an item in the dropdown is only cosmetic.
 */
export function canAccessRoute(profile: UiProfile, path: string): boolean {
  if (profile === 'operator') return true;
  if (CRT_ACTIVE_PATHS.has(path)) return true;
  if (CRT_ACTIVE_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return false;
}

/**
 * Tenant-noun terminology. CRT pilots think of their workspace as containing
 * "monitored environments" (BC Place is one environment, future end-clients
 * would each be another environment). Silent Shield operators still see
 * "Clients" — they manage paying clients directly. Pure presentation layer:
 * the DB column is still `client_id`, the route is still `/clients`.
 */
export interface ClientNounSet {
  /** Singular, title case (e.g., "Client" or "Environment") */
  singular: string;
  /** Plural, title case (e.g., "Clients" or "Environments") */
  plural: string;
  /** Singular, lower case (e.g., "client" or "environment") */
  singularLower: string;
  /** Plural, lower case (e.g., "clients" or "environments") */
  pluralLower: string;
}

export function getClientNoun(settings?: Record<string, unknown> | null): ClientNounSet {
  if (getUiProfile(settings) === 'crt') {
    return {
      singular: 'Environment',
      plural: 'Environments',
      singularLower: 'environment',
      pluralLower: 'environments',
    };
  }
  return {
    singular: 'Client',
    plural: 'Clients',
    singularLower: 'client',
    pluralLower: 'clients',
  };
}
