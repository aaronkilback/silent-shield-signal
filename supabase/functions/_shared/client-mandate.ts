// Client Mandate Model (fourth-read ruling 4 — operator doctrine).
//
// A client's authority over a subject is NOT uniform. PECL is an upstream operator; the
// LNG Canada stake belongs to PETRONAS Global (a separate company); Ksi Lisims / Uniper are
// third parties. An action brief that "tasks security" at another company's asset, or "engages
// counterparties" PECL has no standing with, is a doctrine violation — not a style nit.
//
// Three authority classes, each with a CLOSED action vocabulary. The action-item / deductions
// generators classify each signal's SUBJECT into a class BEFORE writing, and may draw ONLY from
// that class's verbs.
//
// The per-client subject lists live in clients.mandate_profile (jsonb, operator-reviewed). This
// module is the mechanism; the data is the fixture.

export type AuthorityClass = 'OPERATE' | 'AFFILIATED-INFORM' | 'EXTERNAL-MONITOR';

// Closed vocabularies. The generator may use ONLY the verbs of a subject's class.
export const AUTHORITY_VERBS: Record<AuthorityClass, string[]> = {
  // Assets PECL operates: full response vocabulary.
  'OPERATE': ['assess', 'secure', 'task', 'respond', 'deploy', 'coordinate', 'brief', 'inform'],
  // Affiliated via a PETRONAS Global stake (e.g. LNG Canada) — inform + INDIRECT-impact
  // assessment on OPERATE assets ONLY. Never task, never engage counterparties, never "update
  // protocols" for an asset PECL does not run.
  'AFFILIATED-INFORM': ['brief', 'inform stakeholders', 'assess indirect impact on PECL-operated assets'],
  // Third parties / competitors: situational awareness only.
  'EXTERNAL-MONITOR': ['monitor', 'contextualize', 'strategic assessment'],
};

export const AUTHORITY_FORBIDDEN: Record<AuthorityClass, string[]> = {
  'OPERATE': [],
  'AFFILIATED-INFORM': ['task', 'secure', 'deploy', 'respond', 'engage counterparties', 'update protocols', 'harden'],
  'EXTERNAL-MONITOR': ['task', 'secure', 'deploy', 'respond', 'brief stakeholders as if actionable', 'engage', 'update protocols'],
};

export interface MandateProfile {
  version?: string;
  default_class?: AuthorityClass;
  classes?: Partial<Record<AuthorityClass, { match?: string[] }>>;
}

// Precedence: a subject implicating a PECL-OPERATED asset is OPERATE even if third parties are
// also named (a threat to your own asset outranks context). Else AFFILIATED if an affiliated
// asset is named. Else EXTERNAL-MONITOR. Missing/empty profile → default (most restrictive).
export function classifySubject(
  profile: MandateProfile | null | undefined,
  text: string | null | undefined,
): { authorityClass: AuthorityClass; matched: string | null } {
  const hay = String(text || '').toLowerCase();
  const def = (profile?.default_class ?? 'EXTERNAL-MONITOR') as AuthorityClass;
  if (!profile?.classes || !hay) return { authorityClass: def, matched: null };

  const hit = (cls: AuthorityClass): string | null => {
    const toks = profile.classes?.[cls]?.match ?? [];
    for (const t of toks) {
      const tok = String(t || '').toLowerCase().trim();
      if (tok && hay.includes(tok)) return t;
    }
    return null;
  };

  const op = hit('OPERATE');
  if (op) return { authorityClass: 'OPERATE', matched: op };
  const aff = hit('AFFILIATED-INFORM');
  if (aff) return { authorityClass: 'AFFILIATED-INFORM', matched: aff };
  const ext = hit('EXTERNAL-MONITOR');
  if (ext) return { authorityClass: 'EXTERNAL-MONITOR', matched: ext };
  return { authorityClass: def, matched: null };
}

// Prompt block describing the model + this client's subject lists + the hard rule. Injected into
// the action-item and deductions prompts.
export function renderMandateGuidance(profile: MandateProfile | null | undefined, clientName: string): string {
  const cls = profile?.classes ?? {};
  const line = (c: AuthorityClass) => {
    const m = cls[c]?.match ?? [];
    return `  - ${c}: subjects [${m.slice(0, 12).join(', ') || '(none configured)'}] → verbs {${AUTHORITY_VERBS[c].join(', ')}}${AUTHORITY_FORBIDDEN[c].length ? ` — NEVER {${AUTHORITY_FORBIDDEN[c].join(', ')}}` : ''}`;
  };
  return `CLIENT MANDATE MODEL (authority doctrine — enforce before writing any action/deduction):
${clientName} has DIFFERENT authority over different subjects. Classify each recommendation's SUBJECT into ONE class and use ONLY that class's verbs. Do NOT recommend actions the client has no standing to take.
${line('OPERATE')}
${line('AFFILIATED-INFORM')}
${line('EXTERNAL-MONITOR')}
  - Unknown/unlisted subject → treat as ${(profile?.default_class ?? 'EXTERNAL-MONITOR')} (most restrictive).
Hard rules: An AFFILIATED-INFORM subject (e.g. an asset held via a corporate stake, not operated by the client) may only be briefed/informed and assessed for INDIRECT impact on the client's OWN operated assets — never task security, never engage its counterparties, never "update protocols" for it. An EXTERNAL-MONITOR subject (third parties, competitors) is monitor / contextualize / strategic-assessment ONLY. Prefix each action with its class in brackets, e.g. "[AFFILIATED-INFORM] ...".`;
}
