// WO-CI-SECURITY-GATE-01 — AST helpers (TypeScript compiler API, NOT regex).
// Fail-closed: helpers err toward flagging. False positives are absorbed by the baseline;
// false negatives are the failure mode this gate exists to prevent.
import ts from "typescript";

export function parse(fileName, source) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TS);
}

export function walk(node, cb) {
  cb(node);
  ts.forEachChild(node, (c) => walk(c, cb));
}

export function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

// Root identifier of a property-access chain (a.b.c -> "a").
export function leftmostId(expr) {
  let e = expr;
  while (e && ts.isPropertyAccessExpression(e)) e = e.expression;
  if (e && ts.isCallExpression(e)) return leftmostId(e.expression);
  return e && ts.isIdentifier(e) ? e.text : null;
}

// Text of a callee (a.b.c(...) -> "a.b.c"), best-effort.
export function calleeName(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

// Request-supplied scope ids. incident_id/signal_id/investigation_id added 2026-08-26
// (INC-BRIEFING-XTENANT): a service-role function that loads an incident/signal/investigation by a
// caller-supplied id with no membership check is the SAME cross-tenant shape as a client_id read —
// generate-incident-briefing (incident_id-only) slipped the gate because these were missing.
const SCOPE_IDS = new Set([
  "client_id", "tenant_id", "entity_id", "incident_id", "signal_id", "investigation_id",
  "clientId", "tenantId", "entityId", "incidentId", "signalId", "investigationId",
]);
const DEFAULT_REQUEST_VARS = new Set([
  "req", "request", "body", "reqBody", "requestBody", "parameters", "params",
  "payload", "input", "args", "filters",
]);

function initializerIsRequestSource(init) {
  if (!init) return false;
  let e = init;
  if (ts.isAwaitExpression(e)) e = e.expression;
  if (ts.isCallExpression(e)) {
    const name = calleeName(e);
    // req.json(), req.text(), JSON.parse(...)
    if (name === "json" || name === "text") return true;
    if (name === "parse") return true;
  }
  const root = ts.isIdentifier(e) ? e.text : leftmostId(e);
  return root ? DEFAULT_REQUEST_VARS.has(root) : false;
}

// Variables that carry request-controlled data in this source file.
export function collectRequestVars(sf) {
  const vars = new Set(DEFAULT_REQUEST_VARS);
  // Deno.serve((req) => ...) / (request) => ... : the first param is the request.
  walk(sf, (n) => {
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parameters.length) {
      const p0 = n.parameters[0].name;
      if (ts.isIdentifier(p0)) vars.add(p0.text);
    }
    if (ts.isVariableDeclaration(n) && n.initializer && initializerIsRequestSource(n.initializer)) {
      if (ts.isIdentifier(n.name)) vars.add(n.name.text);
      else if (ts.isObjectBindingPattern(n.name)) {
        for (const el of n.name.elements) if (ts.isIdentifier(el.name)) vars.add(el.name.text);
      }
    }
  });
  return vars;
}

// Does this subtree READ a client_id/tenant_id/entity_id from a request-derived object?
export function readsRequestScopeId(node, requestVars, sf) {
  const hits = [];
  walk(node, (n) => {
    // body.client_id / parameters.tenant_id / filters.client_id
    if (ts.isPropertyAccessExpression(n) && SCOPE_IDS.has(n.name.text)) {
      const root = leftmostId(n.expression);
      if (root && requestVars.has(root)) hits.push({ name: n.name.text, line: lineOf(sf, n) });
    }
    // const { entity_id: x, tenant_id } = parameters / = await req.json()
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer) {
      const fromReq =
        initializerIsRequestSource(n.initializer) ||
        (leftmostId(n.initializer) && requestVars.has(leftmostId(n.initializer)));
      if (fromReq) {
        for (const el of n.name.elements) {
          const prop = el.propertyName ? el.propertyName : el.name;
          const pn = ts.isIdentifier(prop) ? prop.text : null;
          if (pn && SCOPE_IDS.has(pn)) hits.push({ name: pn, line: lineOf(sf, n) });
        }
      }
    }
    // url.searchParams.get('client_id')
    if (ts.isCallExpression(n) && calleeName(n) === "get" && n.arguments.length === 1) {
      const a = n.arguments[0];
      if (ts.isStringLiteral(a) && SCOPE_IDS.has(a.text)) hits.push({ name: a.text, line: lineOf(sf, n) });
    }
  });
  return hits;
}

// A membership check = resolving the CALLER's identity against tenant_users, OR the approved
// helper get_user_accessible_client_ids / getAccessibleClientIds. NOTE: getUser()/getCallerIdentity
// alone is IDENTITY, not MEMBERSHIP — insufficient. A .eq('tenant_id', <caller-supplied>) is NOT this.
export function hasMembershipCheck(node) {
  let found = false;
  walk(node, (n) => {
    if (ts.isStringLiteral(n) && n.text === "tenant_users") found = true;
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      if (name === "get_user_accessible_client_ids" || name === "getAccessibleClientIds") found = true;
      // userCanAccessClient(supabase, userId, clientId) — resolves the caller's accessible clients and
      // checks membership (it calls getAccessibleClientIds internally). A genuine caller-membership check.
      if (name === "userCanAccessClient") found = true;
      // requireInternalCaller / checkInternalCaller — the shared internal-caller gate (WO-CHECK5-BURNDOWN-01).
      // A machine-only function reachable ONLY by holders of FORTRESS_INTERNAL_SECRET has no cross-tenant
      // exposure from request-derived scope: every caller is a trusted internal caller. This is the correct
      // resolution for cron/service-to-service functions (which have no tenant/user caller to bind to).
      if (name === "requireInternalCaller" || name === "checkInternalCaller") found = true;
      // supabase.rpc('get_user_accessible_client_ids')
      if (name === "rpc" && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) &&
          /get_user_accessible_client_ids/.test(n.arguments[0].text)) found = true;
    }
  });
  return found;
}

export function usesServiceRole(sf) {
  let found = false;
  walk(sf, (n) => {
    if (ts.isStringLiteral(n) && (n.text === "SUPABASE_SERVICE_ROLE_KEY" || n.text === "SERVICE_ROLE_JWT")) found = true;
    if (ts.isCallExpression(n) && calleeName(n) === "createServiceClient") found = true;
  });
  return found;
}

// ── CHECK 5 support ──
// The request parameter identifier(s) of the Deno.serve handler. Falls back to the
// conventional names if the handler shape can't be resolved (fail-closed).
export function serveRequestParams(sf) {
  const names = new Set();
  walk(sf, (n) => {
    if (ts.isCallExpression(n) && calleeName(n) === "serve") {
      const cb = n.arguments[0];
      if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && cb.parameters.length) {
        const p0 = cb.parameters[0].name;
        if (ts.isIdentifier(p0)) names.add(p0.text);
      }
    }
  });
  if (names.size === 0) { names.add("req"); names.add("request"); }
  return names;
}

// Does the handler READ request data — anything beyond req.method (the CORS/OPTIONS probe)?
// req.json()/text()/formData()/headers/url/body/… all count; req.method alone does NOT.
// Returns the first such read { line, prop } or null.
export function readsRequestBeyondMethod(sf, reqParams) {
  let hit = null;
  walk(sf, (n) => {
    if (hit) return;
    if (ts.isPropertyAccessExpression(n)) {
      const root = leftmostId(n.expression);
      if (root && reqParams.has(root) && n.name.text !== "method") {
        hit = { line: lineOf(sf, n), prop: n.name.text };
      }
    }
  });
  return hit;
}

// The shared identity / accessible-client surface in _shared/supabase-client.ts.
// Referencing ANY of these (import or call) counts as routing through the shared helper.
const SHARED_AUTH_HELPERS = new Set([
  "getCallerIdentity", "getUserFromRequest", "requireAuth",
  "getAccessibleClientIds", "userCanAccessClient",
  "getAccessibleRowOrNull", "filterAccessibleRows",
  // WO-CHECK5-BURNDOWN-01 — the shared internal-caller gate for machine-only functions.
  "requireInternalCaller", "checkInternalCaller",
]);
export function usesSharedAuthHelper(sf) {
  let found = false;
  walk(sf, (n) => {
    if (ts.isIdentifier(n) && SHARED_AUTH_HELPERS.has(n.text)) found = true;
  });
  return found;
}

export { SCOPE_IDS, SHARED_AUTH_HELPERS };
