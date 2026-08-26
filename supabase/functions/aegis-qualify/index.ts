// aegis-qualify — public qualification assistant (WO-AEGIS-QUALIFIER Steps 3–4, live takeover).
//
// Qualifies in three moves, then hands off. verify_jwt=false, ZERO Fortress data-plane. All persistence is
// server-side (service-role) to the CRM's deny-all-anon tables. FAIL-CLOSED: any model/gateway error → the
// fixed phone line, never a fabricated reply. Contact details come from EXPLICIT widget fields (request_call),
// never parsed from chat. On commit, the callback SMS fires immediately (the lead can never be lost); the
// visitor may then opt into a LIVE takeover attempt.
//
// HARD STOP: once a human is live (or the row is terminal), the model is never invoked — this is a code gate
// on DB status BEFORE callAiGateway is reachable, plus a post-call re-check to drop any in-flight turn. Not a
// prompt instruction.

import { callAiGateway } from "../_shared/ai-gateway.ts";
import { crmClient, ensureCrmLead, fireCallbackOnce, sendOperatorSms } from "../_shared/qualifier-handoff.ts";

const FALLBACK_LINE = "I can't continue here — please call (825) 904-8566.";

// Deterministic safety backstop. On ANY degraded path (rate-limited, per-session cap, model error) a message
// that reads as a physical-safety or stalking concern must STILL surface emergency guidance + the phone line —
// never a generic "I can't continue" error. A frightened person can send more than five messages; they cannot
// hit a dead end. Broad on purpose (err toward firing); this is a floor under the model's nuanced firing.
// No callback implication — once safety fires we stop collecting; this offers a number they may CALL, not one we take.
const SAFETY_FALLBACK = "If you feel you're in immediate danger, contact your local police or emergency services now — I'm an automated assistant, not an emergency service. You can also call Silent Shield directly at (825) 904-8566.";
const SAFETY_RE = /follow(ed|ing)?|watch(ed|ing)?|stalk|surveill|parked outside|outside (my|the) (house|home|door|work|office|building)|at (my|the) (house|home|door|school|work|office)|turn(ed)? up|show(ed|s)? up|found (me|where|my|out where)|know(s)? (my|where|about my)|not (safe|secure)|don'?t feel safe|feel unsafe|unsafe|in danger|afraid|scared|threat|weapon|hurt me|kid'?s school|my (child|kid|family)|where i (live|work)/i;
const degradedReply = (m: string) => (SAFETY_RE.test(m || "") ? SAFETY_FALLBACK : FALLBACK_LINE);
// Deterministic response on every turn AFTER safety has latched (no model, no write).
const SAFETY_CONTINUED = "If you're in immediate danger, please contact your local police or emergency services now. I'm an automated assistant and can't take this further here — you can reach Silent Shield at (825) 904-8566.";

// On safety trigger: set the latch + timestamp and ERASE all content in ONE atomic update. The row survives as a
// bare shell (latch only) so the widget can still find the session; nothing worth keeping is retained.
async function eraseAndLatch(crm: any, id: string, nowIso: string) {
  await crm.from("aegis_qualifier_conversations").update({
    safety_triggered_at: nowIso,
    transcript: [], first_name: null, contact_value: null, ip_hash: null, feedback: null,
    updated_at: nowIso,
  }).eq("id", id);
}
const callbackLine = (phone: string) => `Aaron isn't free this moment — he'll personally call you at ${phone} within one business day.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MESSAGE_CAP = Number(Deno.env.get("QUALIFY_MESSAGE_CAP") ?? "24");
const TOKEN_CAP = Number(Deno.env.get("QUALIFY_TOKEN_CAP") ?? "40000");
const NEW_SESSIONS_PER_HOUR = Number(Deno.env.get("QUALIFY_SESSIONS_PER_HOUR") ?? "5");
const MODEL = Deno.env.get("QUALIFY_MODEL") ?? "gpt-4o-mini";
const JOIN_BASE = Deno.env.get("QUALIFY_JOIN_URL_BASE") ?? "https://silentshieldsecurity.com/conversations";
const GRACE_SECONDS = 90;
const MAX_MESSAGE_LEN = 2000;
const MAX_BODY_BYTES = 12_000;
const FITS = ["principal", "family_office", "not_fit", "unknown"];
const FIT_OK = (f: string) => f === "principal" || f === "family_office";

// Typed schema for the Anthropic emit_json tool — named fields so the model fills structure instead of
// free-forming JSON into the reply string (prevents the JSON-in-reply leak).
const QUALIFY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "ONLY the words you say to the visitor. No JSON, no field names." },
    state: { type: "string", enum: ["in_progress", "not_fit"] },
    ready: { type: "boolean" },
    fit: { type: "string", enum: ["principal", "family_office", "not_fit", "unknown"] },
    safety: { type: "boolean", description: "true when this reply is a physical-safety/stalking response (STOP collecting)." },
  },
  required: ["reply", "state", "ready", "fit"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are Aegis, the intake assistant for Silent Shield, a private security-intelligence firm that helps a small number of highly exposed individuals — principals and family offices — understand and reduce their personal exposure across digital, physical, and reputational surfaces. The entry point is a private Digital Exposure Report, produced and discussed one-to-one.

You have already opened with: "Most leaders are protected. Few are prepared." and "I'm Aegis, an automated assistant. Aaron follows up himself." Do not repeat this greeting.

YOUR ONLY JOB IS TO QUALIFY, THEN HAND OFF. You do not sell, quote prices, negotiate, schedule, or close.

WHAT YOU NEED (four things). A single message often gives you more than one at once. The moment one is answered, it is SETTLED — never ask about it again, in any wording, however rephrased:
  A. The concern — what is prompting them to reach out.
  B. What changed — the event, discovery, or shift behind it. ("I found disturbing content about me," "suspicious posts," "someone approached me knowing my schedule" ALL answer B — do not then ask what changed.)
  C. Fit — that they are the exposed individual, or acting for one (a principal or family office); not a vendor or someone selling to Silent Shield.
  D. Orient to action, not dread. Once fit is confirmed, do NOT ask them to spell out what they fear could happen. If they have already described something disturbing (content about them, being researched, someone approaching or watching them), asking them to articulate their dread is the wrong move and reads as cold. Instead: acknowledge what they told you, and move toward what happens next and how Aaron can help — never toward what they are afraid of. (Only if their situation is still genuinely vague may you ask one light question about what's prompting them now.) Acknowledge without asserting, amplifying, dramatizing, or adding weight they didn't state.

  PACE THE INVITE. Do NOT bundle the invitation into the same reply where you first acknowledge a disclosure. When someone has just told you something disturbing, that reply should acknowledge it and give ONE line of real substance — what Aaron actually does about this kind of thing — and stop there, ready=false. Let them feel heard. Put the invitation on your NEXT turn, once they've had a beat. The ask for a name and number must never land on the same breath as their disclosure.

SAFETY — THIS OVERRIDES EVERYTHING BELOW. Trigger it whenever a message touches physical safety or a stalking/tracking pattern — including, and NOT limited to: a physical threat; someone contacting, approaching, or being near them in person; being followed, watched, or surveilled; someone who knows their routine, movements, schedule, or whereabouts; someone at or outside their home or workplace; someone repeatedly locating them, tracking them down, or finding their new or changed phone number, address, or other contact details; any sense of being pursued, cornered, or unsafe. Past tense, hedges, and uncertainty do NOT lower the bar. ALL of these FIRE: "I think I'm being followed", "they know my routine", "someone was outside my house", "he keeps finding my new number", "they know where I live", "someone showed up", "I'm being watched", "he found me again". If a reasonable person reading the message would feel a physical-safety or stalking concern, fire — even if it's phrased calmly, in the past tense, or as a suspicion. When you are UNSURE whether a message crosses this line, FIRE it anyway — err toward firing.

WHEN IT FIRES, YOU STOP COLLECTING — this is policy, not a preference. In that reply: (1) acknowledge plainly and calmly; (2) tell them that if they feel they are in immediate danger they should contact their local police or emergency services right now, because you are an automated assistant, not an emergency service. You MAY tell them they can call Silent Shield at (825) 904-8566 if they wish. Then set "safety" to true and "ready" to FALSE. You must NOT ask for their name or number, must NOT invite them to request a call, and must NOT say or imply that Aaron will call them back — you are not collecting contact details in a safety situation. Once safety has fired at any point in this conversation, it STAYS fired: on every later turn, never invite, never ask for a name or number, never imply a callback — keep "safety" true and "ready" false, and just respond supportively (repeat the emergency-services guidance if it still applies).

HOW TO TALK — you are an attentive person, not a form. All of these hold at once:
- Listen. Respond to the substance of what they just said, in THEIR register. Reflect the specific thing (disturbing content, suspicious posts, being researched) without adding weight they didn't state — no "urgent," "critical," "escalating," "serious," "physical threats" unless they said it. Match their intensity; never raise it.
- Never ask the same thing twice. If you already asked it in an earlier turn — what changed or fit — do not ask again, even reworded, even if their answer was partial. Take what they gave and move on. (A concern and "what changed" usually arrive together in one message; once given, they're done.)
- One short question per turn, only about something still genuinely unknown. Once you have the concern, what changed, and fit, stop asking questions — acknowledge and move to the handoff. Do NOT ask what they fear.
- No prefaces, no templates. Never start a reply with a purpose clause ("to help Aaron / me understand," "to ensure the right fit," etc.). Do not open two replies the same way — vary the first word AND the sentence shape every turn, and never lean twice on the same construction or opening word: not two "I understand…", not two "[Verb]-ing … is …", and NOT two replies beginning with "That's" ("That's" is a crutch — use it at most once). Often the cleanest reply has no preface at all: just state the substance, or ask the one question.
- Two or three sentences, maximum.
- Reaching "ready" does not end your curiosity — keep engaging whatever they say next, specifically. Give the name-and-number / request-a-call invitation EXACTLY ONCE, on the turn you first become ready; if you already gave it, never give it again — they can see the fields — just respond to what they said.

HARD OPENING RULE: across the ENTIRE conversation, at most ONE reply may begin with the word "That's" (or "That"). If you have used a "That…" opener already, open differently — with the substance, a plain word, or the question itself.

Voice — match this style, do NOT copy these lines (different situations, and note none of them opens with "That"):
  Them: "Someone's been asking my neighbours about my schedule."  →  You: "Makes sense to want eyes on that early. Is this about you, or someone you're responsible for?"
  Them: "I don't want my kids' school turning up in a search."  →  You: "Understood. What's changed recently to bring this up?"
  Them: "People are sharing photos of my house."  →  You: "Noted — that's worth acting on. Are you the person affected, or reaching out for someone else?"

You do NOT collect contact details in chat — the interface has separate Name and Phone fields and a "Request a call" button. Once you have the concern, what changed, and fit, acknowledge their situation, set "ready" to true, and — only this once — invite them to add their name and number and request a call, telling them WHEN it happens: Aaron follows up personally within one business day. Never repeat the invitation on later turns. Never ask them to type a phone number or email into the chat.

HARD BOUNDARIES:
- If asked whether you are a person, say plainly that you are an automated assistant named Aegis. Never adopt a human name, and never speak as Aaron or as any person.
- Never assert or imply anything about THIS visitor's own exposure, risk, or situation — you have made no assessment and can make none. If you illustrate how Silent Shield thinks about exposure, label it explicitly as a general illustration, not a finding about them.
- You have NO access to any data, systems, tools, scans, or records. You cannot look anyone up, run a check, assess anyone, or retrieve anything. Never imply otherwise.
- Never quote a price, discount, or package. Never create urgency, scarcity, deadlines, or pressure. Never cite statistics, success rates, or numbers — you have none. (You MAY state the one true timeline: Aaron follows up within one business day.)
- Never name, confirm, or discuss any specific client, person, company, or engagement. If asked who you work with, decline — it is confidential.
- Give no security advice, no threat analysis, no instructions. You qualify; Aaron advises.
- If someone appears to be in immediate danger — or names a physical threat, in-person contact, being followed, or someone possibly showing up where they live/work — tell them plainly to contact their local police / emergency services if they feel in immediate danger, and stop treating the exchange as routine intake (see the SAFETY block above). You are not an emergency service.

NOT A FIT (a vendor, someone selling to us, someone who only wants free advice, or clearly not the exposed party): be courteous and brief, and set state to not_fit.

OUTPUT — respond with a single JSON object and nothing else:
{"reply":"<what you say — warm, brief, professional>","state":"in_progress"|"not_fit","ready":true|false,"fit":"principal"|"family_office"|"not_fit"|"unknown"}
Set "ready" true once concern + what-changed + fit are established and you have acknowledged their situation — no "what do you fear" question is required. Use state "not_fit" only when clearly not a fit; otherwise "in_progress".
Classify "fit": "principal" if they are the exposed individual; "family_office" if acting for a principal/family office; "not_fit" for a vendor or non-exposed party; "unknown" if unclear.`;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody || "{}"); } catch { return json({ error: "invalid_json" }, 400); }

  const sessionId = String(body.session_id ?? "").trim();
  if (sessionId.length < 8 || sessionId.length > 100) return json({ error: "invalid_session_id" }, 400);
  const action = String(body.action ?? "message");

  let crm;
  try { crm = crmClient(); } catch { console.error("[aegis-qualify] CRM_SERVICE_ROLE_KEY not set"); return json({ reply: FALLBACK_LINE, status: "error", done: true }); }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const ip_hash = await sha256Hex(ip + "|" + (serviceKey || "salt"));

  const { data: existing } = await crm.from("aegis_qualifier_conversations").select("*").eq("session_id", sessionId).maybeSingle();
  let convo: any = existing;

  // ── RESUME (no model, no new turn) ────────────────────────────────────────────────────────────────────
  if (action === "resume") {
    if (!convo) return json({ turns: [], status: "in_progress", fit: null, ready: false, operator_joined: false, done: false });
    return json({
      turns: convo.transcript ?? [], status: convo.status, fit: convo.fit,
      ready: FIT_OK(convo.fit ?? "") && !convo.safety_triggered_at, safety: !!convo.safety_triggered_at,
      operator_joined: !!convo.operator_joined_at,
      callback_notified: !!convo.callback_notified_at, done: ["qualified", "not_fit"].includes(convo.status),
    });
  }

  // ── FEEDBACK (one-tap) ────────────────────────────────────────────────────────────────────────────────
  if (action === "feedback") {
    if (!convo) return json({ error: "not_found" }, 400);
    const v = String(body.value ?? "");
    if (v !== "up" && v !== "down") return json({ error: "invalid_value" }, 400);
    await crm.from("aegis_qualifier_conversations").update({ feedback: v, updated_at: new Date().toISOString() }).eq("id", convo.id);
    return json({ ok: true });
  }

  // ── REQUEST_CALL (explicit fields) → create lead + fire callback SMS immediately, then offer live ──────
  if (action === "request_call") {
    if (!convo) return json({ error: "not_found" }, 400);
    // Safety fired → collection is OFF. Refuse the callback request outright; do not create a lead, do not SMS.
    if (convo.safety_triggered_at) return json({ ok: false, reason: "safety", safety: true });
    if (convo.status === "not_fit") return json({ ok: false, reason: "not_fit" });
    if (["qualified", "waiting_operator", "live"].includes(convo.status)) return json({ ok: true, offer: true, status: convo.status });
    if (!FIT_OK(convo.fit ?? "")) return json({ ok: false, reason: "not_ready", reply: "Let's talk a little more first so I understand your situation." });
    const fn = String(body.first_name ?? "").trim().slice(0, 80);
    const cb = String(body.callback_number ?? "").trim().slice(0, 40);
    if (!fn || !cb) return json({ error: "missing_contact" }, 400);
    await crm.from("aegis_qualifier_conversations").update({ first_name: fn, contact_method: "phone", contact_value: cb, updated_at: new Date().toISOString() }).eq("id", convo.id);
    convo.first_name = fn; convo.contact_value = cb;
    await ensureCrmLead(crm, convo, fn, cb);
    const delivered = await fireCallbackOnce(crm, convo);        // lead delivered NOW — never lost
    return json({ ok: true, offer: true, status: "in_progress", callback_delivered: delivered });
  }

  // ── LIVE_CHECK (visitor's answer to "Aaron may be available now — check?") ────────────────────────────
  if (action === "live_check") {
    if (!convo) return json({ error: "not_found" }, 400);
    if (!convo.contact_value) return json({ ok: false, reason: "no_contact" });
    if (String(body.answer ?? "") === "no") {
      await crm.from("aegis_qualifier_conversations").update({ status: "qualified", updated_at: new Date().toISOString() }).eq("id", convo.id);
      return json({ status: "qualified", reply: `Thank you. Aaron will personally call you at ${convo.contact_value} within one business day.`, done: true });
    }
    const now = new Date().toISOString();
    await crm.from("aegis_qualifier_conversations").update({ status: "waiting_operator", waiting_started_at: now, updated_at: now }).eq("id", convo.id);
    if (!convo.live_sms_sent_at) {
      const prefix = convo.synthetic ? "[TEST] " : "";
      const link = `${JOIN_BASE}?s=${encodeURIComponent(sessionId)}`;
      const ok = await sendOperatorSms(`${prefix}[LIVE NOW] ${convo.first_name || "(no name)"} is waiting to speak now — join: ${link} (callback ${convo.contact_value}).`);
      if (ok) await crm.from("aegis_qualifier_conversations").update({ live_sms_sent_at: now }).eq("id", convo.id);
    }
    return json({ status: "waiting_operator", reply: "Checking if Aaron is free right now…", grace_seconds: GRACE_SECONDS, done: false });
  }

  // ══ MESSAGE (default) — a chat turn ══════════════════════════════════════════════════════════════════
  const message = String(body.message ?? "").trim();
  const nowIso = new Date().toISOString();

  if (!convo) {
    const sinceIso = new Date(Date.now() - 3_600_000).toISOString();
    const { count, error: rlErr } = await crm.from("aegis_qualifier_conversations")
      .select("id", { count: "exact", head: true }).eq("ip_hash", ip_hash).gte("created_at", sinceIso);
    if (rlErr || (count ?? 0) >= NEW_SESSIONS_PER_HOUR) {
      if (rlErr) console.error("[aegis-qualify] rate-limit check failed — failing closed:", rlErr.message);
      return json({ reply: degradedReply(message), status: "rate_limited", done: true }, rlErr ? 503 : 429);
    }
    if (!message || message.length > MAX_MESSAGE_LEN) return json({ error: "invalid_message" }, 400);
    // If the FIRST message is a safety concern, insert a bare SHELL row (latched, no content, NO ip_hash) and
    // stop — nothing is stored, nothing goes to the model.
    const safetyFirst = SAFETY_RE.test(message);
    const { data, error } = await crm.from("aegis_qualifier_conversations")
      .insert(safetyFirst
        ? { session_id: sessionId, status: "in_progress", transcript: [], synthetic: body.synthetic === true, safety_triggered_at: nowIso, ip_hash: null }
        : { session_id: sessionId, ip_hash, status: "in_progress", transcript: [], synthetic: body.synthetic === true }
      ).select("*").single();
    if (error || !data) { console.error("[aegis-qualify] session insert failed:", error?.message); return json({ reply: degradedReply(message), status: "error", done: true }); }
    convo = data;
    if (safetyFirst) return json({ reply: SAFETY_FALLBACK, ready: false, safety: true, done: false });
  }

  const history = Array.isArray(convo.transcript) ? convo.transcript : [];

  // HARD STOP #1 — human/terminal states never reach the model.
  if (convo.status === "live" || convo.status === "waiting_operator") {
    // Deliver the visitor's message to the transcript (for Aaron); the model is unreachable.
    if (message && message.length <= MAX_MESSAGE_LEN) {
      await crm.from("aegis_qualifier_conversations")
        .update({ transcript: [...history, { role: "user", content: message, ts: nowIso }], message_count: (convo.message_count ?? 0) + 1, updated_at: nowIso })
        .eq("id", convo.id);
    }
    return json({ status: convo.status, reply: null, done: false, grace_seconds: convo.status === "waiting_operator" ? GRACE_SECONDS : undefined });
  }
  // Never parrot a stored contact_value back into the echo (defensive: a resumed terminal row could carry a
  // stale/dead number). A fresh visitor should never reach this branch anyway — the client only resumes
  // NON-terminal sessions.
  if (convo.status === "qualified") return json({ status: "qualified", reply: "Thank you. Aaron will be in touch within one business day.", done: true });
  if (convo.status === "not_fit") return json({ status: "not_fit", reply: "Thanks for reaching out. This doesn't look like a fit right now — all the best.", done: true });

  // SAFETY already latched → deterministic response, NO model call, NO persistence. Post-trigger messages are
  // never stored and never sent to Anthropic.
  if (convo.safety_triggered_at) return json({ reply: SAFETY_CONTINUED, ready: false, safety: true, done: false });
  // FIRST safety trigger on this session, caught deterministically → erase content + latch (atomic), no model.
  if (message && SAFETY_RE.test(message)) { await eraseAndLatch(crm, convo.id, nowIso); return json({ reply: SAFETY_FALLBACK, ready: false, safety: true, done: false }); }

  if ((convo.message_count ?? 0) >= MESSAGE_CAP) return json({ reply: degradedReply(message), status: "message_cap", done: true });
  if ((convo.tokens_used ?? 0) >= TOKEN_CAP) return json({ reply: degradedReply(message), status: "token_cap", done: true });
  if (!message || message.length > MAX_MESSAGE_LEN) return json({ error: "invalid_message" }, 400);

  // If we've already surfaced the invite (ready_at set on a prior turn), tell the model plainly this turn so it
  // does not re-invite — it just engages. This is the missing STATE the model can't reliably track itself.
  // If we've already surfaced the invite (ready_at set on a prior turn), tell the model plainly this turn so it
  // does not re-invite. (Post-trigger safety turns never reach here — they short-circuit above.)
  const systemForTurn = convo.ready_at
    ? SYSTEM_PROMPT + `\n\n[STATE: You have ALREADY invited this visitor to add their name and number and request a call, and the fields are already on their screen. Do NOT invite again, do NOT mention the fields or "request a call" — simply respond to what they just said, briefly and specifically.]`
    : SYSTEM_PROMPT;

  const messages = [
    { role: "system", content: systemForTurn },
    ...history.map((t: any) => ({ role: t.role === "operator" ? "assistant" : t.role, content: t.content })),
    { role: "user", content: message },
  ];

  let ai: { content: string | null; error: string | null; raw?: any };
  if (body.__test === "gateway_error") {
    ai = { content: null, error: "forced_test_gateway_error", raw: null };
  } else {
    try {
      ai = await callAiGateway({ model: MODEL, messages, functionName: "aegis-qualify", jsonSchema: QUALIFY_SCHEMA, extraBody: { response_format: { type: "json_object" }, max_completion_tokens: 400, temperature: 0.5 } });
    } catch (e) { ai = { content: null, error: e instanceof Error ? e.message : String(e), raw: null }; }
  }

  // HARD STOP #2 — if a human joined WHILE the model was generating, drop the in-flight bot turn.
  const { data: fresh } = await crm.from("aegis_qualifier_conversations").select("status, transcript, message_count").eq("id", convo.id).maybeSingle();
  if (fresh && ["live", "waiting_operator", "qualified", "not_fit"].includes(fresh.status)) {
    const tx = Array.isArray(fresh.transcript) ? fresh.transcript : [];
    if (message) await crm.from("aegis_qualifier_conversations").update({ transcript: [...tx, { role: "user", content: message, ts: nowIso }], message_count: (fresh.message_count ?? 0) + 1, updated_at: nowIso }).eq("id", convo.id);
    return json({ status: fresh.status, reply: fresh.status === "live" || fresh.status === "waiting_operator" ? null : FALLBACK_LINE, done: ["qualified", "not_fit"].includes(fresh.status) });
  }

  const now2 = new Date().toISOString();
  if (!ai || ai.error || !ai.content) {
    console.error("[aegis-qualify] gateway failure — failing closed:", ai?.error);
    await crm.from("aegis_qualifier_conversations").update({ transcript: [...history, { role: "user", content: message, ts: now2 }], message_count: (convo.message_count ?? 0) + 1, updated_at: now2 }).eq("id", convo.id);
    return json({ reply: degradedReply(message), status: "error", done: true });
  }

  let parsed: any = null;
  try { parsed = JSON.parse(ai.content); } catch { parsed = null; }
  if (!parsed || typeof parsed.reply !== "string" || !parsed.reply.trim()) {
    console.error("[aegis-qualify] malformed model output — failing closed");
    return json({ reply: degradedReply(message), status: "error", done: true });
  }

  // Model-detected safety (intent-based, the deterministic pre-check missed it) → erase content + latch, and do
  // NOT persist this turn's transcript. From here the session is off (post-trigger short-circuits every later turn).
  if (parsed.safety === true) {
    await eraseAndLatch(crm, convo.id, now2);
    return json({ reply: parsed.reply, ready: false, safety: true, done: false });
  }

  const state = parsed.state === "not_fit" ? "not_fit" : "in_progress";
  const ready = parsed.ready === true;
  const fitValue = FITS.includes(parsed.fit) ? parsed.fit : "unknown";
  const tokens = Number(ai.raw?.usage?.total_tokens ?? 0);
  // Permanently record the model that actually served this turn (echoed by the provider API), tied to the
  // assistant turn in the durable conversation record — so "which model served turn X" is always answerable.
  const servedModel = ai.raw?.model ?? null;
  const newTranscript = [...history, { role: "user", content: message, ts: now2 }, { role: "assistant", content: parsed.reply, ts: now2, model: servedModel }];
  const baseUpdate: Record<string, unknown> = {
    transcript: newTranscript, message_count: (convo.message_count ?? 0) + 2, tokens_used: (convo.tokens_used ?? 0) + tokens, fit: fitValue, updated_at: now2,
  };

  if (state === "not_fit") {
    const { error } = await crm.from("aegis_qualifier_conversations").update({ ...baseUpdate, status: "not_fit", fit: "not_fit" }).eq("id", convo.id);
    if (error) console.error("[aegis-qualify] not_fit update failed:", error.message);
    return json({ reply: parsed.reply, status: "not_fit", done: true });
  }

  const isReady = ready && FIT_OK(fitValue);                   // safety turns never reach here (short-circuited)
  if (isReady && !convo.ready_at) baseUpdate.ready_at = now2;  // mark first-ready so later turns don't re-invite
  const { error: ipErr } = await crm.from("aegis_qualifier_conversations").update(baseUpdate).eq("id", convo.id);
  if (ipErr) console.error("[aegis-qualify] in_progress update failed:", ipErr.message);
  return json({ reply: parsed.reply, status: "in_progress", ready: isReady, safety: false, done: false });
});
