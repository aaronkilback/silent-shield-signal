// WO-CI-SECURITY-GATE-01 — the four checks. AST-based (checks 2/3), SQL-statement-scan (check 4).
import ts from "typescript";
import {
  parse, walk, lineOf, calleeName, leftmostId, collectRequestVars,
  readsRequestScopeId, hasMembershipCheck, usesServiceRole,
} from "../lib/ast.mjs";

function ancestorIsCase(node) {
  let p = node.parent;
  while (p) { if (ts.isCaseClause(p) || ts.isDefaultClause(p)) return true; p = p.parent; }
  return false;
}
function caseLabel(clause) {
  if (ts.isDefaultClause(clause)) return "default";
  const e = clause.expression;
  return ts.isStringLiteral(e) ? e.text : e.getText();
}

// CHECK 2 — service-role + request-derived scope without a caller-membership check. Per-branch.
export function check2(fileName, sf) {
  const out = [];
  if (!usesServiceRole(sf)) return out;
  const reqVars = collectRequestVars(sf);

  // A membership check that is NOT inside any case clause gates the whole function.
  let topLevelMembership = false;
  walk(sf, (n) => {
    if (topLevelMembership) return;
    const isMem =
      (ts.isStringLiteral(n) && n.text === "tenant_users") ||
      (ts.isCallExpression(n) && ["get_user_accessible_client_ids", "getAccessibleClientIds"].includes(calleeName(n))) ||
      (ts.isCallExpression(n) && calleeName(n) === "rpc" && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) && /get_user_accessible_client_ids/.test(n.arguments[0].text));
    if (isMem && !ancestorIsCase(n)) topLevelMembership = true;
  });
  if (topLevelMembership) return out;

  const cases = [];
  walk(sf, (n) => { if (ts.isCaseClause(n) || ts.isDefaultClause(n)) cases.push(n); });

  if (cases.length) {
    for (const c of cases) {
      const reads = readsRequestScopeId(c, reqVars, sf);
      if (reads.length && !hasMembershipCheck(c)) {
        out.push({ check: "check2", file: fileName, symbol: `case ${caseLabel(c)}`, line: reads[0].line,
          detail: `reads request-scope id(s) [${[...new Set(reads.map(r => r.name))].join(", ")}] via service-role with no caller/tenant_users membership check` });
      }
    }
  } else {
    const reads = readsRequestScopeId(sf, reqVars, sf);
    if (reads.length && !hasMembershipCheck(sf)) {
      out.push({ check: "check2", file: fileName, symbol: "<function>", line: reads[0].line,
        detail: `reads request-scope id(s) [${[...new Set(reads.map(r => r.name))].join(", ")}] via service-role with no caller/tenant_users membership check` });
    }
  }
  return out;
}

// CHECK 3 — role written from request-derived input without an allowlist; super_admin never grantable.
const ROLE_TABLES = new Set(["user_roles", "operator_invites", "tenant_invitations", "tenant_users"]);
function fromTableInChain(insertCall) {
  let t = null;
  walk(insertCall.expression, (m) => {
    if (ts.isCallExpression(m) && calleeName(m) === "from" && m.arguments[0] && ts.isStringLiteral(m.arguments[0])) t = m.arguments[0].text;
  });
  return t;
}
function readsRequestRole(sf, reqVars) {
  let found = false;
  walk(sf, (n) => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === "role") {
      const r = leftmostId(n.expression); if (r && reqVars.has(r)) found = true;
    }
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer) {
      const root = leftmostId(n.initializer);
      if (root && reqVars.has(root)) for (const el of n.name.elements) {
        const p = el.propertyName || el.name; if (ts.isIdentifier(p) && p.text === "role") found = true;
      }
    }
  });
  return found;
}
function hasRoleAllowlist(sf) {
  let found = false;
  const roleset = ["viewer", "analyst", "admin", "super_admin"];
  walk(sf, (n) => {
    if (ts.isArrayLiteralExpression(n)) {
      const strs = n.elements.filter(ts.isStringLiteral).map((s) => s.text).filter((s) => roleset.includes(s));
      if (strs.length >= 2) found = true;
    }
    if (ts.isObjectLiteralExpression(n)) {
      const keys = n.properties.map((p) => (p.name && ts.isIdentifier(p.name) ? p.name.text : null)).filter(Boolean);
      if (keys.filter((k) => roleset.includes(k)).length >= 2) found = true;
    }
    if (ts.isStringLiteral(n) && n.text === "super_admin") found = true; // explicit super_admin guard
  });
  return found;
}
export function check3(fileName, sf) {
  const out = [];
  let write = null;
  walk(sf, (n) => {
    if (ts.isCallExpression(n) && ["insert", "upsert"].includes(calleeName(n))) {
      const t = fromTableInChain(n);
      if (t && ROLE_TABLES.has(t)) write = { table: t, line: lineOf(sf, n) };
    }
  });
  if (!write) return out;
  const reqVars = collectRequestVars(sf);
  if (!readsRequestRole(sf, reqVars)) return out;        // role not request-derived
  if (hasRoleAllowlist(sf)) return out;                  // allowlist present
  out.push({ check: "check3", file: fileName, symbol: `write ${write.table}`, line: write.line,
    detail: `writes ${write.table} with a request-derived role and no allowlist (super_admin would be grantable)` });
  return out;
}

// CHECK 4 — migration creating a table without RLS + a policy in the same file.
export function check4Migration(fileName, sql) {
  const out = [];
  const stripped = sql.replace(/--[^\n]*/g, " ").replace(/\$\$[\s\S]*?\$\$/g, " $$ ");
  const lower = stripped.toLowerCase();
  const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["']?([a-z0-9_]+)["']?/g;
  let m;
  const created = [];
  while ((m = tableRe.exec(lower)) !== null) created.push(m[1]);
  for (const tbl of created) {
    const rls = new RegExp(`alter\\s+table\\s+(?:public\\.)?["']?${tbl}["']?\\s+enable\\s+row\\s+level\\s+security`).test(lower);
    const policy = new RegExp(`create\\s+policy[\\s\\S]*?on\\s+(?:public\\.)?["']?${tbl}["']?`).test(lower);
    if (!rls || !policy) {
      out.push({ check: "check4", file: fileName, symbol: `table ${tbl}`, line: 1,
        detail: `create table without ${!rls ? "ENABLE ROW LEVEL SECURITY" : ""}${!rls && !policy ? " and " : ""}${!policy ? "a policy" : ""} in the same migration` });
    }
  }
  return out;
}

// CHECK 1 — verify_jwt=false must be allowlisted. (config-driven; evaluated in run.mjs)
export function check1(funcName, verifyJwtFalse, allowlisted) {
  if (verifyJwtFalse && !allowlisted) {
    return [{ check: "check1", file: `supabase/functions/${funcName}`, symbol: funcName, line: 1,
      detail: "verify_jwt=false without an entry in public-endpoints.json" }];
  }
  return [];
}

export { parse };
