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
  if (CRT_ACTIVE_PATHS.has(path)) return 'active';
  if (CRT_GREYED_PATHS.has(path)) return 'greyed';
  return 'hidden';
}
