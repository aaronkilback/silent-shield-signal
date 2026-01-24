import type { DiscoveryItem } from "@/hooks/useOSINTDiscovery";

export type VIPAutoField =
  | "primaryEmail"
  | "primaryPhone"
  | "socialMediaHandles"
  | "corporateAffiliations"
  | "knownAliases";

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_LIKE_REGEX = /\+?\d[\d\s().-]{8,}\d/;

/**
 * If the backend provides `fieldMapping`, we trust it.
 * Otherwise we infer a best-effort mapping for the fields users expect to be auto-populated
 * in the top of the wizard.
 */
export function resolveVIPFieldMapping(discovery: DiscoveryItem): VIPAutoField | null {
  const explicit = discovery.fieldMapping as VIPAutoField | undefined;
  if (explicit) return explicit;

  const value = (discovery.value || "").trim();
  const label = (discovery.label || "").toLowerCase();
  const type = discovery.type;

  if (EMAIL_REGEX.test(value) || label.includes("email")) return "primaryEmail";
  if (PHONE_LIKE_REGEX.test(value) || label.includes("phone")) return "primaryPhone";
  if (type === "social_media") return "socialMediaHandles";
  if (type === "corporate") return "corporateAffiliations";
  if (label.includes("alias") || label.includes("aka")) return "knownAliases";

  return null;
}
