import type { DiscoveryItem } from "@/hooks/useOSINTDiscovery";

export type VIPAutoField =
  | "primaryEmail"
  | "secondaryEmails"
  | "primaryPhone"
  | "secondaryPhones"
  | "socialMediaHandles"
  | "corporateAffiliations"
  | "knownAliases"
  | "dateOfBirth"
  | "nationality";

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_LIKE_REGEX = /\+?\d[\d\s().-]{8,}\d/;
// Matches YYYY-MM-DD or MM/DD/YYYY style dates
const DATE_REGEX = /\b(\d{4}[-/]\d{2}[-/]\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/;

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

  // Email detection
  if (EMAIL_REGEX.test(value) || label.includes("email")) {
    // If label hints at secondary/alternate, use secondaryEmails
    if (label.includes("secondary") || label.includes("alternate") || label.includes("other")) {
      return "secondaryEmails";
    }
    return "primaryEmail";
  }

  // Phone detection
  if (PHONE_LIKE_REGEX.test(value) || label.includes("phone") || label.includes("mobile") || label.includes("cell")) {
    if (label.includes("secondary") || label.includes("alternate") || label.includes("other")) {
      return "secondaryPhones";
    }
    return "primaryPhone";
  }

  // Date of birth
  if (
    label.includes("birth") ||
    label.includes("dob") ||
    label.includes("born") ||
    (label.includes("date") && DATE_REGEX.test(value))
  ) {
    return "dateOfBirth";
  }

  // Nationality / citizenship
  if (
    label.includes("nationality") ||
    label.includes("citizenship") ||
    label.includes("citizen") ||
    label.includes("passport")
  ) {
    return "nationality";
  }

  // Social media
  if (type === "social_media") return "socialMediaHandles";

  // Corporate
  if (type === "corporate") return "corporateAffiliations";

  // Aliases
  if (label.includes("alias") || label.includes("aka") || label.includes("nickname")) {
    return "knownAliases";
  }

  return null;
}
