// Onboarding acceptance copy — versioned source of truth.
//
// IMPORTANT: bump the corresponding version constant below whenever you change
// the body of the corresponding section, then UPDATE
// public.onboarding_required_versions to match. Existing acceptances become
// "out of date" and every user is forced through FirstLoginAgreementGate again.
//
// Status: v1.0-pre-counsel-review. To be re-versioned to v1.1 after BC counsel
// reviews. Do not present this copy as finalized legal advice.

export const ACCEPTANCE_VERSIONS = {
  terms: "1.0-pre-counsel-review",
  ai_ack: "1.0-pre-counsel-review",
  privacy: "1.0-pre-counsel-review",
} as const;

export const ACCEPTANCE_GOVERNING_LAW = "British Columbia, Canada (placeholder pending counsel review)";

// ─────────────────────────────────────────────────────────────────────────────
// A. PLATFORM TERMS OF USE
// ─────────────────────────────────────────────────────────────────────────────
export const TERMS_OF_USE_TITLE = "Platform Terms of Use";

export const TERMS_OF_USE_SECTIONS: Array<{ heading: string; body: string }> = [
  {
    heading: "1. Nature of the Platform",
    body:
      "Fortress AEGIS is an informational intelligence decision-support platform. " +
      "It is not legal advice, not law enforcement, and not a guaranteed threat prevention service. " +
      "Outputs are intended to assist operator judgment, not replace it.",
  },
  {
    heading: "2. Best-Efforts Monitoring",
    body:
      "Monitoring, signal collection, enrichment, and alerting are performed on a best-efforts basis. " +
      "The platform makes no guarantee that all relevant signals will be detected, " +
      "that detection will occur within any specific time window, or that alerts will reach the user.",
  },
  {
    heading: "3. Third-Party Data Dependency",
    body:
      "Intelligence is derived in part from third-party public and licensed sources. " +
      "The accuracy, completeness, and availability of those sources is outside platform control. " +
      "Source outages, rate limits, content removals, or changes in third-party terms of service may degrade coverage.",
  },
  {
    heading: "4. Service Availability",
    body:
      "The platform is provided on an as-available basis. Service interruptions, scheduled maintenance, " +
      "and unplanned outages may occur and may affect monitoring continuity.",
  },
  {
    heading: "5. False Positives and False Negatives",
    body:
      "Automated correlation, classification, and threat scoring may produce false positives (alerts that do not represent real threats) " +
      "and false negatives (real threats that are not surfaced). Users acknowledge this is inherent to intelligence work " +
      "and must independently verify before taking consequential action.",
  },
  {
    heading: "6. User Responsibility for Operational Decisions",
    body:
      "Users are solely responsible for any operational, protective, legal, or business decision taken " +
      "based on platform outputs. The platform does not direct, approve, or assume responsibility for downstream action.",
  },
  {
    heading: "7. Acceptable Use",
    body:
      "Use is restricted to lawful intelligence, protective security, and incident management purposes " +
      "for parties for whom the user holds proper authorization. Harassment, surveillance of private individuals " +
      "without lawful basis, and any use prohibited by applicable Canadian or local law is forbidden.",
  },
  {
    heading: "8. Confidentiality",
    body:
      "Client matters, principal identities, investigative material, and tenant-private data are confidential. " +
      "Users must not disclose tenant-scoped information outside the authorized tenant.",
  },
  {
    heading: "9. Intellectual Property",
    body:
      "Platform code, models, prompts, and aggregated learnings are the property of Silent Shield Security. " +
      "Client-supplied data and client-specific intelligence remain the property of the originating client.",
  },
  {
    heading: "10. Account Security",
    body:
      "Users are responsible for safeguarding their credentials, enrolling multi-factor authentication, " +
      "and reporting suspected compromise. Credential sharing is prohibited.",
  },
  {
    heading: "11. Limitation of Liability",
    body:
      "To the maximum extent permitted by law, Silent Shield Security shall not be liable for indirect, " +
      "incidental, special, consequential, or punitive damages, including loss of profits, data, goodwill, " +
      "or business opportunity, arising from use of, inability to use, or reliance on the platform, " +
      "even if advised of the possibility of such damages.",
  },
  {
    heading: "12. Governing Law",
    body:
      `These terms are governed by the laws of ${ACCEPTANCE_GOVERNING_LAW}. ` +
      "Any dispute shall be addressed through good-faith negotiation prior to formal proceedings.",
  },
  {
    heading: "13. Pre-Counsel-Review Notice",
    body:
      "This document is an interim version (v1.0-pre-counsel-review) intended to establish a baseline acceptance record. " +
      "It will be revised after Canadian counsel review and re-issued as v1.1 or later, at which point users will be required to re-accept.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// B. AI ACKNOWLEDGEMENT
// ─────────────────────────────────────────────────────────────────────────────
export const AI_ACK_TITLE = "AI Acknowledgement";

export const AI_ACK_BODY =
  "This platform uses AI-assisted analysis and automation. Outputs may be incomplete, inaccurate, or probabilistic. " +
  "Users remain responsible for validating consequential decisions.";

// Additional context shown above the checkbox so users understand what they're accepting.
export const AI_ACK_CONTEXT: Array<{ heading: string; body: string }> = [
  {
    heading: "What this means in practice",
    body:
      "AEGIS and downstream agents synthesize information from many sources and generate text, summaries, " +
      "correlations, and recommendations. These outputs are probabilistic: they reflect patterns observed in source data, " +
      "not verified facts.",
  },
  {
    heading: "Sources can change",
    body:
      "Model versions, source feeds, and learned context evolve over time. Outputs generated today may differ from outputs generated tomorrow " +
      "for the same input. Treat each output as a point-in-time assistance, not a permanent record of truth.",
  },
  {
    heading: "Validate before acting",
    body:
      "For any consequential decision — protective deployment, investigative escalation, legal action, public statement — " +
      "the operator must independently corroborate AI outputs against primary sources before acting.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// C. PRIVACY / LAWFUL UPLOAD AUTHORITY
// ─────────────────────────────────────────────────────────────────────────────
export const PRIVACY_TITLE = "Privacy and Lawful Upload Authority";

export const PRIVACY_BODY =
  "I confirm I am authorized to upload, process, and analyze the materials I provide through this platform.";

export const PRIVACY_CONTEXT: Array<{ heading: string; body: string }> = [
  {
    heading: "Uploaded content is processed",
    body:
      "Documents, images, and other artifacts uploaded to the platform may be processed by automated extraction, " +
      "classification, entity recognition, and AI summarization pipelines for the purpose of supporting the user's authorized investigation.",
  },
  {
    heading: "Public-source collection",
    body:
      "The platform performs public-source intelligence collection on subjects designated by the tenant. " +
      "Collection is configured by tenant-supplied keywords, entity records, and monitoring scopes.",
  },
  {
    heading: "Data retention",
    body:
      "Data is retained for the duration of the engagement and as required by tenant policy and applicable law. " +
      "Tenant administrators may request deletion. Specific retention schedules and PIPEDA-aligned controls are documented in the Data Handling Addendum (to follow).",
  },
  {
    heading: "Storage jurisdiction",
    body:
      "Platform data is currently stored in Supabase-hosted Postgres infrastructure. Region details are available on request.",
  },
  {
    heading: "Lawful authority is your responsibility",
    body:
      "By uploading material the user attests that they have lawful authority to do so on behalf of the tenant " +
      "and any subjects of the material. The platform cannot independently verify lawful authority and relies on this attestation.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// D. ACTIVITY LOGGING NOTICE (inline, not a separate checkbox)
// ─────────────────────────────────────────────────────────────────────────────
export const ACTIVITY_LOGGING_NOTICE =
  "Platform actions, uploads, access events, and queries may be logged for security, audit, and operational integrity.";

// ─────────────────────────────────────────────────────────────────────────────
// Pre-acceptance disclosure for the screen header
// ─────────────────────────────────────────────────────────────────────────────
export const GATE_HEADER =
  "Before you can use Fortress AEGIS, please review and accept the following. " +
  "These terms protect both you and your principals; they are kept short and re-issued as our legal review advances.";
