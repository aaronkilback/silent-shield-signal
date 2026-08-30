// Synthesis Primitives — deterministic, TEMPLATE-ONLY synthesis over subject exposure findings.
//
// INVARIANTS (ratified 2026-08-30):
//  1. NO MODEL in the sentence path. Every emitted phrase is a fixed template with slots filled
//     ONLY from finding-row values (names, counts, domains, dates, data-classes). No LLM generates
//     any part of any sentence.
//  2. Every emitted claim CITES the subject_exposure_items / subject_devices row ids it rests on.
//     A primitive whose required rows are absent is NOT_ASSERTED — first-class output, as informative
//     as an established claim, and never fabricates an absence into good news.
//  3. DECLARED vs DISCOVERED. A primitive asserting adversary reachability rests ONLY on DISCOVERED
//     rows (data_breach / data_broker / source_corroboration / legal). DECLARED rows (environmental
//     coordinates, subject_devices) are labelled declared, never presented as public exposure.
//  4. finding_basis carried through: any 'analyst_assessment' row -> 'assessment'; else 'measured'.
//
// OUTPUT SHAPE: each primitive renders as THREE short, plain-language parts a client reads in ~10s:
//   found     — what we found (the evidence: names + dates kept, jargon dropped).
//   means     — what it means for the subject, in plain words.
//   notSaying — the caveat: what we are explicitly NOT claiming.
// Two sentences maximum each.

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
  // Report vocabulary: established (asserted from cited rows) / qualified (asserted with a stated
  // limit) / not_asserted (checked, no basis — declined).
  status: "established" | "qualified" | "not_asserted";
  found: string;
  means: string;
  notSaying: string;
  cited_row_ids: string[];
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

// Display normalization — canonical casing for known brand tokens; RAW row values are PRESERVED,
// this affects the rendered sentence only. Never changes meaning, only presentation.
const BRAND_CANON: Record<string, string> = {
  iphone: "iPhone", ipad: "iPad", ipod: "iPod", macbook: "MacBook", imac: "iMac",
  macos: "macOS", ios: "iOS", ipados: "iPadOS", tvos: "tvOS", watchos: "watchOS", airpods: "AirPods",
  "tp-link": "TP-Link", asus: "ASUS", netgear: "Netgear", ubiquiti: "Ubiquiti", "wi-fi": "Wi-Fi",
};
const normToken = (w: string): string => {
  const key = w.toLowerCase();
  if (BRAND_CANON[key]) return BRAND_CANON[key];
  if (/[0-9]/.test(w)) return w; // keep versions / model numbers verbatim
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
};
const displayLabel = (raw: string): string =>
  raw.trim().split(/\s+/).map(normToken).filter(Boolean).join(" ");
// Plain-English list join: "a, b and c" (no Oxford comma — reads more naturally to a layperson).
const andList = (a: string[]): string => a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;

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
// A not-asserted primitive: `found` states plainly what we checked and did not find; means/notSaying
// are generic so an absence never reads as either a claim or a clean bill of health.
const notAsserted = (key: string, name: string, found: string, cited: string[]): PrimitiveResult =>
  ({ key, name, status: "not_asserted", found,
    means: "We make no claim here.",
    notSaying: "This is not proof of the opposite — only that this scan found no basis for it.",
    cited_row_ids: cited, basis: "none" });

// ── P1 · Credential Compromise Path (discovered) ─────────────────────────────
export function credentialCompromise(items: ExposureItem[]): PrimitiveResult {
  const pw = breaches(items).filter((b) => hasClass(b, /password/i));
  if (pw.length === 0) {
    return notAsserted("P1", "Credential Compromise Path",
      "No leaked password was found for your email addresses in this scan.", []);
  }
  const named = pw.map((b) => `${breachName(b.title)} (${breachYear(b.summary)})`);
  const active = pw.filter((b) => /stealer|combolist|credential stuffing|synthient/i.test(b.title))
    .map((b) => `${breachName(b.title)} (${breachYear(b.summary)})`);
  const found =
    `Your passwords appear in ${pw.length} leaked databases — ${named.slice(0, 4).join(", ")}${pw.length > 4 ? `, and ${pw.length - 4} more` : ""}.` +
    (active.length ? ` ${active.length} ${active.length > 1 ? "are" : "is"} recent and actively traded (${active.join(", ")}).` : "");
  return {
    key: "P1", name: "Credential Compromise Path", status: "established",
    found,
    means: "If you still use any of those passwords anywhere, someone could get into that account.",
    notSaying: "We are not saying any of your accounts has been broken into.",
    cited_row_ids: pw.map((b) => b.id), basis: basisOf(pw),
  };
}

// ── P2 · Identity / Impersonation Kit (discovered) ───────────────────────────
export function identityKit(items: ExposureItem[]): PrimitiveResult {
  const brk = brokers(items);
  const brc = breaches(items);
  const parts: string[] = ["name"];
  const rows: string[] = [];
  const add = (phrase: string, rws: ExposureItem[]) => { if (rws.length) { parts.push(phrase); rows.push(...rws.map((r) => r.id)); } };
  add("job and employer", [...brk, ...brc.filter((b) => hasClass(b, /employer|job title/i))]);
  add("email and phone", [...brk, ...brc.filter((b) => hasClass(b, /phone number/i))]);
  add("date of birth", brc.filter((b) => hasClass(b, /date of birth/i)));
  add("a home address", brc.filter((b) => hasClass(b, /physical address/i)));
  add("part of a payment card", brc.filter((b) => hasClass(b, /credit card/i)));
  if (brk.length === 0 && parts.length < 3) {
    return notAsserted("P2", "Identity / Impersonation Kit",
      "Too few personal details were found in public sources to build an identity picture.", []);
  }
  const cited = [...new Set(rows)];
  const brokerDomains = [...new Set(brk.flatMap(domainsOf))];
  return {
    key: "P2", name: "Identity / Impersonation Kit", status: "established",
    found: brk.length
      ? `Your ${andList(parts)} are gathered on public broker sites (${andList(brokerDomains)}) and in leaked data.`
      : `Your ${andList(parts)} are gathered in leaked data.`,
    means: `Someone could use these details to pretend to be you, or to answer "security questions" meant to prove your identity.`,
    notSaying: "We did not find your SIN, and we did not find your family members.",
    cited_row_ids: cited, basis: basisOf(brc.concat(brk).filter((r) => cited.includes(r.id))),
  };
}

// ── P3 · Physical Locatability (discovered vs declared) ──────────────────────
export function physicalLocatability(items: ExposureItem[]): PrimitiveResult {
  const brk = brokers(items);
  const resBrokers = brk.filter(isResidenceBroker);
  const contactBrokers = brk.filter((b) => !isResidenceBroker(b));
  const addrBreaches = breaches(items).filter((b) => hasClass(b, /physical address/i));
  const declared = coordRows(items);

  if (resBrokers.length === 0 && addrBreaches.length === 0) {
    const f = contactBrokers.length
      ? "No home address for you was found in public sources; the broker listings show your employer, not your home."
      : "No home address for you was found in public sources.";
    return notAsserted("P3", "Physical Locatability", f, declared.map((c) => c.id));
  }
  const srcNames = addrBreaches.map((b) => breachName(b.title)).slice(0, 4).join(", ");
  const declaredNote = declared.length
    ? " The home, school and cabin locations we hold are ones you gave us for monitoring, not things we found online."
    : "";
  return {
    key: "P3", name: "Physical Locatability",
    status: resBrokers.length ? "established" : "qualified",
    found: `A home or mailing address for you shows up in ${addrBreaches.length} leaked database${addrBreaches.length > 1 ? "s" : ""} (${srcNames}${addrBreaches.length > 4 ? ", and more" : ""}).`,
    means: "These are old records, so any address listed may be a past one, not where you live now.",
    notSaying: `We are not saying your current home can be found from this.${declaredNote}`,
    cited_row_ids: [...resBrokers, ...addrBreaches].map((r) => r.id), basis: basisOf([...resBrokers, ...addrBreaches]),
  };
}

// ── P4 · Professional / Role Targeting (discovered) ──────────────────────────
export function roleTargeting(items: ExposureItem[]): PrimitiveResult {
  const corr = corroborated(items);
  if (corr.length < 2) {
    return notAsserted("P4", "Professional / Role Targeting",
      "Fewer than two independent public sources about your work were found.", corr.map((c) => c.id));
  }
  const domains = [...new Set(corr.flatMap(domainsOf))];
  return {
    key: "P4", name: "Professional / Role Targeting", status: "established",
    found: `Your work history is public and confirmed by ${corr.length} separate sources (${domains.slice(0, 4).join(", ")}${domains.length > 4 ? ", and more" : ""}).`,
    means: "Someone targeting you could sound convincing by referring to your real career and public work.",
    notSaying: "This is your normal public profile, not a sign anyone is actually targeting you.",
    cited_row_ids: corr.map((c) => c.id), basis: basisOf(corr),
  };
}

// ── P5 · Device Attack Surface (declared) ────────────────────────────────────
export function deviceAttackSurface(devices: DeviceRow[]): PrimitiveResult {
  const exposed = devices.filter((d) => d.internet_exposed);
  if (exposed.length === 0) {
    return notAsserted("P5", "Device Attack Surface", "No internet-connected device was recorded for you.", []);
  }
  const label = (d: DeviceRow) => displayLabel(`${d.vendor} ${d.product}`); // display only; raw row values preserved
  const assessable = exposed.filter((d) => d.version && d.version.trim() !== "" && !d.version_unknown);
  const unversioned = exposed.filter((d) => d.version_unknown || !(d.version && d.version.trim() !== ""));
  const means =
    (assessable.length ? `${assessable.map(label).join(", ")} we can check against known security flaws. ` : "") +
    (unversioned.length ? `${unversioned.map(label).join(", ")} we cannot check yet, because ${unversioned.length > 1 ? "their versions were" : "its version was"} not recorded.` : "");
  const notSaying = "We are not saying any device has a flaw right now — " +
    [assessable.length ? "the check still has to run" : "", unversioned.length ? "the version is needed first" : ""].filter(Boolean).join(", and ") + ".";
  return {
    key: "P5", name: "Device Attack Surface",
    status: unversioned.length && assessable.length ? "qualified" : "established",
    found: `You use ${exposed.length} device${exposed.length > 1 ? "s" : ""} that connect${exposed.length > 1 ? "" : "s"} to the internet: ${andList(exposed.map(label))}.`,
    means, notSaying,
    cited_row_ids: exposed.map((d) => d.id), basis: "measured",
  };
}

// ── P6 · Litigation / Adversarial Relationship (discovered) ──────────────────
export function litigationExposure(items: ExposureItem[], subjectName: string = ""): PrimitiveResult {
  const legal = legalRows(items);
  if (legal.length === 0) {
    return notAsserted("P6", "Litigation / Adversarial Relationship", "No court case naming you was found in this scan.", []);
  }
  const l = legal[0];
  const caseName = l.title.replace(/^Legal case:\s*/i, "").trim();
  const surname = (subjectName || "").trim().split(/\s+/).pop() || "";
  const counter = (() => {
    const m = caseName.match(/^(.+?)\s+v\.?s?\.?\s+(.+?)$/i);
    if (!m) return "";
    const sides = [m[1].trim(), m[2].trim()];
    const other = surname ? sides.find((s) => !new RegExp(surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(s)) : sides[1];
    return other || "";
  })();
  const domains = [...new Set(domainsOf(l))].filter((d) => /\./.test(d));
  return {
    key: "P6", name: "Litigation / Adversarial Relationship", status: "established",
    found: `A court case with your name on it — ${caseName} — appears on ${domains.length} public website${domains.length > 1 ? "s" : ""} (${domains.slice(0, 3).join(", ")}${domains.length > 3 ? ", and more" : ""}).`,
    means: `Anyone looking into you can find this${counter ? `, and it names the other party (${counter})` : ""}.`,
    notSaying: "We are not calling the other party a threat — they are simply named in the case record.",
    cited_row_ids: legal.map((r) => r.id), basis: basisOf(legal),
  };
}

// ── runner ───────────────────────────────────────────────────────────────────
export function runSynthesis(items: ExposureItem[], devices: DeviceRow[], subjectName: string = ""): PrimitiveResult[] {
  return [
    credentialCompromise(items),
    identityKit(items),
    physicalLocatability(items),
    roleTargeting(items),
    deviceAttackSurface(devices),
    litigationExposure(items, subjectName),
  ];
}

// ── report renderer ──────────────────────────────────────────────────────────
// Emits the inner HTML of the Synthesis section (the report template wraps the <h2> + intro).
// Each primitive renders as three labelled parts (Found / Means / Not saying). NOT_ASSERTED
// primitives render EXPLICITLY — the refusal is part of the value. Machine-traceable row ids ride
// in data-cited-rows so the client-visible line stays readable while the audit trail is preserved.
const STATE_LABEL: Record<string, string> = {
  established: "ESTABLISHED", qualified: "QUALIFIED", not_asserted: "NOT ASSERTED",
};
const escHtml = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<string, string>)[c]!);

export function renderSynthesisSection(results: PrimitiveResult[]): string {
  return results.map((r) => {
    const cite = r.cited_row_ids.length
      ? `Based on ${r.cited_row_ids.length} finding${r.cited_row_ids.length > 1 ? "s" : ""} listed later in this report.`
      : "No supporting findings in this scan.";
    return `<div class="synth synth-${escHtml(r.status)}" data-cited-rows="${escHtml(r.cited_row_ids.join(","))}">` +
      `<h4>${escHtml(r.name)} <span class="synth-state">${STATE_LABEL[r.status] || escHtml(r.status)}</span></h4>` +
      `<p class="synth-part"><span class="synth-lab">Found</span> ${escHtml(r.found)}</p>` +
      `<p class="synth-part"><span class="synth-lab">Means</span> ${escHtml(r.means)}</p>` +
      `<p class="synth-part"><span class="synth-lab">Not saying</span> ${escHtml(r.notSaying)}</p>` +
      `<div class="isum">${escHtml(cite)}</div></div>`;
  }).join("");
}
