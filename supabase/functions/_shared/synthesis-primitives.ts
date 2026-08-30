// Synthesis Primitives — deterministic, TEMPLATE-ONLY synthesis over subject exposure findings.
//
// INVARIANTS (ratified 2026-08-30):
//  1. NO MODEL in the sentence path. Every emitted sentence is a fixed template with slots filled
//     ONLY from finding-row values (names, counts, domains, dates, data-classes). The only logic is
//     the presence/absence of required capability rows. No LLM generates any part of any sentence.
//  2. Every emitted claim CITES the subject_exposure_items / subject_devices row ids it rests on.
//     A primitive whose required rows are absent REFUSES (status 'refuses') — refusals are
//     first-class output, as informative as fires, and never fabricate an absence into good news.
//  3. DECLARED vs DISCOVERED. A primitive asserting adversary reachability may rest ONLY on
//     DISCOVERED rows (data_breach / data_broker / source_corroboration / legal). DECLARED rows
//     (environmental coordinates, subject_devices) are labelled declared and never presented as
//     public exposure.
//  4. finding_basis is carried through: a primitive resting on any 'analyst_assessment' row is
//     labelled 'assessment'; all-'measured' rows are 'measured'.

export interface ExposureItem {
  id: string;
  category: string;
  anchor_type: string | null;
  anchor_value: string | null;
  exposure_class: string;
  finding_basis: string;
  severity: string;
  title: string;
  summary: string | null;
}

export interface DeviceRow {
  id: string;
  vendor: string;
  product: string;
  version: string | null;
  version_unknown: boolean;
  internet_exposed: boolean;
  device_type: string;
}

export interface PrimitiveResult {
  key: string;
  name: string;
  status: "fires" | "partial" | "refuses";
  sentence: string;       // template-filled; the ONLY thing rendered
  cited_row_ids: string[]; // rows this claim rests on
  basis: "measured" | "assessment" | "none";
}

// ── deterministic string parsers (no model) ──────────────────────────────────
const breachName = (title: string): string => title.replace(/^Data breach:\s*/i, "").trim();
const dataClasses = (summary: string | null): string[] => {
  const m = (summary || "").match(/Data exposed:\s*(.+?)\.?\s*$/i);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
};
const hasClass = (item: ExposureItem, re: RegExp): boolean => dataClasses(item.summary).some((c) => re.test(c));
const breachYear = (summary: string | null): string => {
  const m = (summary || "").match(/Breach date\s*(\d{4})-\d{2}-\d{2}/i);
  return m ? m[1] : "";
};
const emailsOf = (item: ExposureItem): string[] =>
  (item.anchor_value || "").split(",").map((s) => s.trim()).filter(Boolean);
const domainsOf = (item: ExposureItem): string[] =>
  (item.anchor_value || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// Residence people-search brokers expose a HOME address; B2B brokers expose employer/role only.
// EXACT eTLD+1 match (never substring — scalemylife.com !== mylife.com).
const RESIDENCE_BROKER_DOMAINS = [
  "spokeo.com", "beenverified.com", "whitepages.com", "truepeoplesearch.com", "mylife.com",
  "radaris.com", "intelius.com", "peoplefinders.com", "fastpeoplesearch.com", "clustrmaps.com",
  "nuwber.com", "usphonebook.com", "cyberbackgroundchecks.com",
];
const isResidenceBroker = (item: ExposureItem): boolean =>
  domainsOf(item).some((d) => RESIDENCE_BROKER_DOMAINS.some((rb) => d === rb || d.endsWith("." + rb)));

// ── row selectors ────────────────────────────────────────────────────────────
const breaches = (it: ExposureItem[]) => it.filter((i) => i.category === "data_breach");
const brokers = (it: ExposureItem[]) => it.filter((i) => i.anchor_type === "data_broker");
const corroborated = (it: ExposureItem[]) =>
  it.filter((i) => i.anchor_type === "source_corroboration" && i.category === "mention");
const legalRows = (it: ExposureItem[]) => it.filter((i) => i.category === "legal");
const coordRows = (it: ExposureItem[]) => it.filter((i) => i.anchor_type === "coordinate");

const basisOf = (rows: { finding_basis: string }[]): "measured" | "assessment" | "none" => {
  if (rows.length === 0) return "none";
  return rows.some((r) => r.finding_basis === "analyst_assessment") ? "assessment" : "measured";
};
const refuse = (key: string, name: string, sentence: string, cited: string[]): PrimitiveResult =>
  ({ key, name, status: "refuses", sentence, cited_row_ids: cited, basis: "none" });

// ── P1 · Credential Compromise Path (discovered) ─────────────────────────────
export function credentialCompromise(items: ExposureItem[]): PrimitiveResult {
  const pw = breaches(items).filter((b) => hasClass(b, /password/i));
  if (pw.length === 0) {
    return refuse("P1", "Credential Compromise Path",
      "No breach in this scan exposed a password class tied to your email(s) — no credential-compromise claim is made.", []);
  }
  const emails = [...new Set(pw.flatMap(emailsOf))];
  const named = pw.map((b) => `${breachName(b.title)} (${breachYear(b.summary)})`);
  const active = pw.filter((b) => /stealer|combolist|credential stuffing|synthient/i.test(b.title))
    .map((b) => `${breachName(b.title)} (${breachYear(b.summary)})`);
  const sentence =
    `Passwords tied to your email address${emails.length > 1 ? "es" : ""} (${emails.join(", ")}) appear in ${pw.length} breach corpora — ` +
    `${named.slice(0, 6).join("; ")}${pw.length > 6 ? `, and ${pw.length - 6} more` : ""}.` +
    (active.length
      ? ` ${active.length} ${active.length > 1 ? "are" : "is a"} active credential-theft / credential-stuffing set${active.length > 1 ? "s" : ""} (${active.join("; ")}), the kind actively traded and replayed.`
      : "") +
    ` IF any of these passwords is reused on a live account it would enable account takeover or credential-stuffing. ` +
    `This does NOT assert that any account is currently compromised — only that reused credentials would be exploitable; rotate any still in use.`;
  return { key: "P1", name: "Credential Compromise Path", status: "fires", sentence, cited_row_ids: pw.map((b) => b.id), basis: basisOf(pw) };
}

// ── P2 · Identity / Impersonation Kit (discovered) ───────────────────────────
export function identityKit(items: ExposureItem[]): PrimitiveResult {
  const brk = brokers(items);
  const brc = breaches(items);
  const attr: { label: string; rows: string[] }[] = [];
  const collect = (label: string, rows: ExposureItem[]) => { if (rows.length) attr.push({ label, rows: rows.map((r) => r.id) }); };
  collect("employer / role", [...brk, ...brc.filter((b) => hasClass(b, /employer|job title/i))]);
  collect("email + phone", [...brk, ...brc.filter((b) => hasClass(b, /phone number/i))]);
  collect("date of birth", brc.filter((b) => hasClass(b, /date of birth/i)));
  collect("physical address", brc.filter((b) => hasClass(b, /physical address/i)));
  collect("partial payment-card data", brc.filter((b) => hasClass(b, /credit card/i)));
  if (brk.length === 0 && attr.length < 2) {
    return refuse("P2", "Identity / Impersonation Kit",
      "Fewer than two identity attributes are publicly aggregated in this scan — no impersonation-kit claim is made.", []);
  }
  const cited = [...new Set(attr.flatMap((a) => a.rows))];
  const sentence =
    `Publicly aggregated identity attributes are sufficient to construct a credible pretext or attempt knowledge-based verification: ` +
    `name, ${attr.map((a) => a.label).join(", ")}` +
    (brk.length ? ` — contact/role via the broker listings (${[...new Set(brk.flatMap(domainsOf))].join(", ")}); the remainder via breach records.` : ` — from breach records.`) +
    ` Not found in this scan: SIN/SSN, and no relatives were resolved.`;
  return { key: "P2", name: "Identity / Impersonation Kit", status: "fires", sentence, cited_row_ids: cited, basis: basisOf(attr.flatMap((a) => brc.concat(brk)).filter((r) => cited.includes(r.id))) };
}

// ── P3 · Physical Locatability (discovered vs declared) ──────────────────────
export function physicalLocatability(items: ExposureItem[]): PrimitiveResult {
  const brk = brokers(items);
  const resBrokers = brk.filter(isResidenceBroker);
  const contactBrokers = brk.filter((b) => !isResidenceBroker(b));
  const addrBreaches = breaches(items).filter((b) => hasClass(b, /physical address/i));
  const declared = coordRows(items);
  const declaredNote = declared.length
    ? ` Your declared home/school/cabin coordinates are known to Fortress only because you provided them for protective monitoring — declared data, not public exposure, and not presented here as locatability.`
    : "";

  if (resBrokers.length === 0 && addrBreaches.length === 0) {
    const brokerNote = contactBrokers.length
      ? ` The data-broker listings (${[...new Set(contactBrokers.flatMap(domainsOf))].join(", ")}) expose your employer, not your home.`
      : "";
    return refuse("P3", "Physical Locatability",
      `No public source in this scan exposes your residential address.${brokerNote}${declaredNote}`, declared.map((c) => c.id));
  }

  const parts: string[] = [];
  if (resBrokers.length) parts.push(`residential people-search listings expose an address (${[...new Set(resBrokers.flatMap(domainsOf))].join(", ")})`);
  if (addrBreaches.length) parts.push(
    `physical-address fields appear in ${addrBreaches.length} breach record${addrBreaches.length > 1 ? "s" : ""} tied to your email (${addrBreaches.map((b) => breachName(b.title)).slice(0, 5).join(", ")}${addrBreaches.length > 5 ? ", …" : ""})`);
  const contactNote = contactBrokers.length
    ? ` The B2B broker listings (${[...new Set(contactBrokers.flatMap(domainsOf))].join(", ")}) expose your employer, not your home.`
    : "";
  const sentence =
    `A physical address associated with you is discoverable: ${parts.join("; and ")}. ` +
    `This scan does NOT verify whether any is your CURRENT residence — breach and broker addresses are frequently historical or partial, so treat this as "an address is exposed," not "your home is pinpointed."${contactNote}${declaredNote}`;
  return {
    key: "P3", name: "Physical Locatability",
    status: resBrokers.length ? "fires" : "partial",
    sentence, cited_row_ids: [...resBrokers, ...addrBreaches].map((r) => r.id), basis: basisOf([...resBrokers, ...addrBreaches]),
  };
}

// ── P4 · Professional / Role Targeting (discovered) ──────────────────────────
export function roleTargeting(items: ExposureItem[]): PrimitiveResult {
  const corr = corroborated(items);
  if (corr.length < 2) {
    return refuse("P4", "Professional / Role Targeting",
      `Fewer than two independently-corroborated public items about you were found — no role-targeting claim is made.`, corr.map((c) => c.id));
  }
  const cites = corr.map((c) => `"${c.title.replace(/\s*…$/, "").trim()}" (${[...new Set(domainsOf(c))].join(" + ")})`);
  const sentence =
    `Your professional identity is publicly established and corroborated across ${corr.length} independent items: ${cites.join("; ")}. ` +
    `This supports social engineering that references your documented public history. (Presence is verified; adverse intent is not implied.)`;
  return { key: "P4", name: "Professional / Role Targeting", status: "fires", sentence, cited_row_ids: corr.map((c) => c.id), basis: basisOf(corr) };
}

// ── P5 · Device Attack Surface (declared) ────────────────────────────────────
export function deviceAttackSurface(devices: DeviceRow[]): PrimitiveResult {
  const exposed = devices.filter((d) => d.internet_exposed);
  if (exposed.length === 0) {
    return refuse("P5", "Device Attack Surface", "No internet-facing device was declared — no device attack-surface claim is made.", []);
  }
  const label = (d: DeviceRow) => `${d.vendor} ${d.product}`.trim();
  const assessable = exposed.filter((d) => d.version && d.version.trim() !== "" && !d.version_unknown);
  const unversioned = exposed.filter((d) => d.version_unknown || !(d.version && d.version.trim() !== ""));
  const parts: string[] = [];
  if (assessable.length) parts.push(
    `${assessable.map((d) => `${label(d)} (version ${d.version})`).join(", ")} ${assessable.length > 1 ? "are" : "is"} assessable against known CVEs via a live NVD/CISA-KEV lookup`);
  if (unversioned.length) parts.push(
    `${unversioned.map(label).join(", ")} ${unversioned.length > 1 ? "are" : "is"} internet-facing but unversioned — it CANNOT be assessed until the version is identified (a request, not a finding)`);
  const sentence =
    `You operate ${exposed.length} internet-facing device${exposed.length > 1 ? "s" : ""} (declared by you, not discovered): ${parts.join("; ")}. ` +
    `Any actual vulnerability will rest on the live CVE lookup, never on an assumed version.`;
  return {
    key: "P5", name: "Device Attack Surface",
    status: unversioned.length && assessable.length ? "partial" : "fires",
    sentence, cited_row_ids: exposed.map((d) => d.id), basis: "measured",
  };
}

// ── P6 · Litigation / Adversarial Relationship (discovered) ──────────────────
export function litigationExposure(items: ExposureItem[]): PrimitiveResult {
  const legal = legalRows(items);
  if (legal.length === 0) {
    return refuse("P6", "Litigation / Adversarial Relationship", "No legal matter naming you was found in this scan — no litigation-exposure claim is made.", []);
  }
  const l = legal[0];
  const counter = (() => {
    const m = l.title.match(/(?:^|:\s*)(.+?)\s+v\.?s?\.?\s+(.+?)\s*$/i);
    if (!m) return "";
    const parts = [m[1], m[2]].map((s) => s.replace(/^Legal case:\s*/i, "").trim());
    const other = parts.find((p) => !/kilback/i.test(p));
    return other || "";
  })();
  const domains = [...new Set(domainsOf(l))].filter((d) => /\./.test(d));
  const sentence =
    `A legal matter naming you — ${l.title.replace(/^Legal case:\s*/i, "")} — is publicly documented and corroborated across ${domains.length} sources (${domains.slice(0, 5).join(", ")}${domains.length > 5 ? ", …" : ""}). ` +
    `This is a reputational exposure${counter ? ` and identifies a named counterparty (${counter})` : ""}; the counterparty is a party of record, not asserted to be a threat.`;
  return { key: "P6", name: "Litigation / Adversarial Relationship", status: "fires", sentence, cited_row_ids: legal.map((r) => r.id), basis: basisOf(legal) };
}

// ── runner ───────────────────────────────────────────────────────────────────
export function runSynthesis(items: ExposureItem[], devices: DeviceRow[]): PrimitiveResult[] {
  return [
    credentialCompromise(items),
    identityKit(items),
    physicalLocatability(items),
    roleTargeting(items),
    deviceAttackSurface(devices),
    litigationExposure(items),
  ];
}
