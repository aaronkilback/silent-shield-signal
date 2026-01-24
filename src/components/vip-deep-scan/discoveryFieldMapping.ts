import type { DiscoveryItem } from "@/hooks/useOSINTDiscovery";

/**
 * All VIP intake fields that can be auto-populated from OSINT discoveries.
 * Covers Step 2 (Principal Profile), Step 3 (Properties), Step 4 (Family),
 * Step 5 (Digital), Step 6 (Vehicles/Routes), Step 7 (Travel), Step 8 (Threats).
 */
export type VIPAutoField =
  // Step 2: Principal Profile
  | "primaryEmail"
  | "secondaryEmails"
  | "primaryPhone"
  | "secondaryPhones"
  | "socialMediaHandles"
  | "knownAliases"
  | "dateOfBirth"
  | "nationality"
  // Step 3: Properties
  | "propertyAddress"
  | "wildfirePreparedness"
  | "wildfireEvacuationPlan"
  // Step 4: Family & Staff
  | "householdStaff"
  | "securityPersonnel"
  | "pets"
  | "humanWildlifeConflict"
  // Step 5: Digital Footprint
  | "primaryDevices"
  | "emailProviders"
  | "cloudServices"
  | "knownUsernames"
  | "corporateAffiliations"
  // Step 6: Vehicles & Routes
  | "vehicles"
  | "regularRoutes"
  | "frequentedLocations"
  | "gymClubMemberships"
  // Step 7: Travel
  | "preferredAirlines"
  | "frequentDestinations"
  // Step 8: Threats
  | "knownAdversaries"
  | "previousIncidents"
  | "specificConcerns"
  | "industryThreats";

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_LIKE_REGEX = /\+?\d[\d\s().-]{8,}\d/;
// Matches YYYY-MM-DD or MM/DD/YYYY style dates
const DATE_REGEX = /\b(\d{4}[-/]\d{2}[-/]\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/;

/**
 * If the backend provides `fieldMapping`, we trust it.
 * Otherwise we infer a best-effort mapping for all fields users expect to be auto-populated.
 */
export function resolveVIPFieldMapping(discovery: DiscoveryItem): VIPAutoField | null {
  const explicit = discovery.fieldMapping as VIPAutoField | undefined;
  if (explicit) return explicit;

  const value = (discovery.value || "").trim();
  const label = (discovery.label || "").toLowerCase();
  const type = discovery.type;
  const category = discovery.category;

  // ============ CONTACT INFORMATION ============
  // Email detection
  if (EMAIL_REGEX.test(value) || label.includes("email")) {
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

  // ============ IDENTITY ============
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

  // Aliases
  if (label.includes("alias") || label.includes("aka") || label.includes("nickname")) {
    return "knownAliases";
  }

  // Social media
  if (type === "social_media") return "socialMediaHandles";

  // ============ PHYSICAL / PROPERTIES ============
  if (type === "property" || category === "physical") {
    if (label.includes("wildfire") || label.includes("fire risk") || label.includes("fire zone")) {
      if (label.includes("evacuation") || label.includes("route")) {
        return "wildfireEvacuationPlan";
      }
      return "wildfirePreparedness";
    }
    if (label.includes("address") || label.includes("residence") || label.includes("property") || label.includes("home") || label.includes("location")) {
      return "propertyAddress";
    }
  }

  // ============ FAMILY & WILDLIFE ============
  if (label.includes("wildlife") || label.includes("bear") || label.includes("coyote") || 
      label.includes("mountain lion") || label.includes("cougar") || label.includes("animal conflict") ||
      label.includes("snake") || label.includes("deer") || label.includes("elk") || label.includes("moose")) {
    return "humanWildlifeConflict";
  }

  if (label.includes("pet") || label.includes("dog") || label.includes("cat")) {
    return "pets";
  }

  if (label.includes("staff") || label.includes("nanny") || label.includes("housekeeper") || label.includes("driver")) {
    return "householdStaff";
  }

  if (label.includes("security") || label.includes("bodyguard") || label.includes("protection")) {
    return "securityPersonnel";
  }

  // ============ DIGITAL FOOTPRINT ============
  if (type === "corporate") return "corporateAffiliations";

  if (label.includes("username") || label.includes("handle") || label.includes("gaming") || label.includes("forum")) {
    return "knownUsernames";
  }

  if (label.includes("cloud") || label.includes("icloud") || label.includes("google drive") || 
      label.includes("dropbox") || label.includes("onedrive")) {
    return "cloudServices";
  }

  if (label.includes("device") || label.includes("iphone") || label.includes("macbook") || 
      label.includes("laptop") || label.includes("phone model")) {
    return "primaryDevices";
  }

  if (label.includes("email provider") || label.includes("gmail") || label.includes("outlook") || 
      label.includes("protonmail")) {
    return "emailProviders";
  }

  // ============ VEHICLES & ROUTES ============
  if (label.includes("vehicle") || label.includes("car") || label.includes("mercedes") || 
      label.includes("range rover") || label.includes("tesla") || label.includes("bmw") ||
      label.includes("license plate")) {
    return "vehicles";
  }

  if (label.includes("route") || label.includes("commute") || label.includes("daily drive")) {
    return "regularRoutes";
  }

  if (label.includes("restaurant") || label.includes("coffee") || label.includes("frequented") ||
      label.includes("favorite location") || label.includes("regular visit")) {
    return "frequentedLocations";
  }

  if (label.includes("gym") || label.includes("fitness") || label.includes("club") || 
      label.includes("country club") || label.includes("equinox") || label.includes("membership")) {
    return "gymClubMemberships";
  }

  // ============ TRAVEL ============
  if (label.includes("airline") || label.includes("delta") || label.includes("united") ||
      label.includes("american airlines") || label.includes("flight preference")) {
    return "preferredAirlines";
  }

  if (label.includes("travel") || label.includes("destination") || label.includes("vacation spot") ||
      label.includes("frequent flyer")) {
    return "frequentDestinations";
  }

  // ============ THREATS ============
  if (type === "threat" || category === "threat") {
    if (label.includes("adversary") || label.includes("enemy") || label.includes("threat actor") ||
        label.includes("targeting")) {
      return "knownAdversaries";
    }
    if (label.includes("incident") || label.includes("attack") || label.includes("breach history") ||
        label.includes("previous threat")) {
      return "previousIncidents";
    }
    if (label.includes("industry") || label.includes("sector threat")) {
      return "industryThreats";
    }
    // Default threat discoveries to specific concerns
    return "specificConcerns";
  }

  // Geospatial / dependency types might indicate location-based concerns
  if (type === "geospatial") {
    // Could be property or route info
    if (label.includes("route") || label.includes("path")) {
      return "regularRoutes";
    }
    return "frequentedLocations";
  }

  if (type === "dependency") {
    return "corporateAffiliations";
  }

  return null;
}
