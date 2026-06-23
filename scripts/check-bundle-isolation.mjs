#!/usr/bin/env node
// Release isolation gate — single source of truth for "is this safe to publish to staging?"
//
// Two phases:
//   --phase config : the deploy target config can ONLY be the staging Cloudflare
//                    worker + the staging route. Production worker/route must be
//                    impossible to target from this release path.
//   --phase bundle : the BUILT bundle (dist/) contains the staging Supabase project
//                    only, and ZERO production Supabase references.
//
// Output contract:
//   exit 0  -> "Staging build is isolated. Ready to publish."   (sets verdict=isolated)
//   exit 1  -> "Blocked: production reference found. Nothing published."  (sets verdict=blocked)
//
// All identities are injected via env so there is exactly one place that defines
// "what staging is" and "what production is" (the workflow), and this script proves it.

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

const E = process.env;
const EXPECTED_WORKER = E.EXPECTED_WORKER || "silent-shield-signal-staging";
const EXPECTED_ROUTE  = E.EXPECTED_ROUTE  || "aegis-staging.silentshieldsecurity.com";
const STAGING_REF     = E.EXPECTED_SUPABASE_REF  || "lkvyrvuakzguszbpwnfz";
const PROD_REF        = E.FORBIDDEN_SUPABASE_REF || "kpuqukppbmwebiptqmog";
const PROD_WORKER     = E.PROD_WORKER || "silent-shield-signal";
const PROD_ROUTE      = E.PROD_ROUTE  || "fortress.silentshieldsecurity.com";

function phaseArg() {
  const eq = process.argv.find((a) => a.startsWith("--phase="));
  if (eq) return eq.split("=")[1];
  const i = process.argv.indexOf("--phase");
  return i >= 0 ? process.argv[i + 1] : "bundle";
}
const phase = phaseArg();

function setOutput(k, v) {
  if (E.GITHUB_OUTPUT) { try { appendFileSync(E.GITHUB_OUTPUT, `${k}=${v}\n`); } catch { /* noop */ } }
}
function summary(md) {
  if (E.GITHUB_STEP_SUMMARY) { try { appendFileSync(E.GITHUB_STEP_SUMMARY, md + "\n"); } catch { /* noop */ } }
}
// Block headline is intentionally uniform (the operator's release-receipt wording);
// the specific cause is carried as the reason. A second arg, if passed, is ignored.
function verdictBlocked(reason) {
  const line = "Blocked. Nothing published.";
  console.error(`✗ ${line}\n  reason: ${reason}`);
  try { writeFileSync("isolation-result.txt", `${line}\nReason: ${reason}\n`); } catch { /* noop */ }
  summary(`### ❌ ${line}\n\n> ${reason}`);
  setOutput("verdict", "blocked");
  process.exit(1);
}
function verdictIsolated(detail, warns = []) {
  const line = "Staging build is isolated. Ready for approval.";
  const warnLine = warns.length
    ? "Warning: production app domain appears only in approved branding/metadata contexts; no production data or deployment endpoint was found."
    : null;
  console.log(`✓ ${line}`);
  if (warnLine) console.log(`⚠ ${warnLine}`);
  console.log(`  ${detail}`);
  if (warns.length) {
    const by = {};
    for (const w of warns) by[w.ctx] = (by[w.ctx] || 0) + 1;
    console.log(`  approved branding/metadata: ${Object.entries(by).map(([k, v]) => `${k}×${v}`).join(", ")}`);
  }
  try {
    writeFileSync("isolation-result.txt", `${line}\n${warnLine ? warnLine + "\n" : ""}${detail}\n`);
  } catch { /* noop */ }
  summary(`### ✅ ${line}\n\n${warnLine ? `> ⚠ ${warnLine}\n\n` : ""}> ${detail}`);
  setOutput("verdict", "isolated");
  process.exit(0);
}

// ---- phase: config -------------------------------------------------------
// Prove the dedicated release wrangler config can ONLY deploy the staging
// worker/route. This is a single-purpose, staging-only file: production worker
// and production route are physically absent (impossible to target, not merely
// guarded against).
function checkConfig() {
  const cfgPath = E.RELEASE_WRANGLER_CONFIG || "wrangler.staging-preview.toml";
  if (!existsSync(cfgPath)) verdictBlocked(`release config "${cfgPath}" not found`, "Blocked: deploy target is not staging-only. Nothing published.");
  const raw = readFileSync(cfgPath, "utf8");
  // Strip comments so prose in comments can't trip (or mask) the checks.
  const cfg = raw.split(/\r?\n/).map((l) => l.replace(/#.*$/, "")).join("\n");

  // 1) worker name must be exactly the staging worker.
  const nameLine = cfg.split(/\r?\n/).find((l) => /^\s*name\s*=/.test(l));
  const name = nameLine && nameLine.split("=")[1].replace(/["']/g, "").trim();
  if (name !== EXPECTED_WORKER) {
    verdictBlocked(`release config worker is "${name}", expected "${EXPECTED_WORKER}"`, "Blocked: deploy target is not staging-only. Nothing published.");
  }

  // 2) staging route present.
  if (!cfg.includes(EXPECTED_ROUTE)) {
    verdictBlocked(`staging route "${EXPECTED_ROUTE}" not found in ${cfgPath}`, "Blocked: deploy target is not staging-only. Nothing published.");
  }

  // 3) production route / worker must be entirely absent from this file.
  if (cfg.includes(PROD_ROUTE)) {
    verdictBlocked(`production route "${PROD_ROUTE}" present in ${cfgPath}`, "Blocked: deploy target is not staging-only. Nothing published.");
  }
  if (new RegExp(`name\\s*=\\s*["']${PROD_WORKER}["']`).test(cfg)) {
    verdictBlocked(`production worker "${PROD_WORKER}" present in ${cfgPath}`, "Blocked: deploy target is not staging-only. Nothing published.");
  }

  // 4) no environment blocks — this file does one thing only.
  if (/^\s*\[env\./m.test(cfg)) {
    verdictBlocked(`${cfgPath} must not declare [env.*] blocks (single-purpose staging config)`, "Blocked: deploy target is not staging-only. Nothing published.");
  }

  console.log(`✓ config OK — ${cfgPath}: worker "${name}", route "${EXPECTED_ROUTE}", no prod target present`);
  setOutput("verdict", "config-ok");
}

// ---- phase: bundle -------------------------------------------------------
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const DIST = E.RELEASE_DIST || "dist";
const MANIFEST = E.RELEASE_MANIFEST || "dist.manifest.sha256";

function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }

// Sorted "sha256  relpath" lines for every file under DIST (relpath is relative
// to DIST so the same bytes hash identically in the verify job and publish job).
function buildManifestLines() {
  const files = walk(DIST).sort();
  return files.map((f) => `${sha256(readFileSync(f))}  ${relative(DIST, f)}`).sort();
}

// --phase manifest-write : record the exact artifact fingerprint (after scan, before upload).
function manifestWrite() {
  if (!existsSync(DIST)) verdictBlocked(`no ${DIST}/ directory — nothing to fingerprint`, "Blocked: artifact integrity check failed. Nothing published.");
  const lines = buildManifestLines();
  const aggregate = sha256(lines.join("\n"));
  writeFileSync(MANIFEST, lines.join("\n") + "\n");
  console.log(`✓ manifest written: ${lines.length} files, aggregate sha256 ${aggregate}`);
  setOutput("manifest_sha", aggregate);
}

// --phase manifest-verify : the downloaded artifact must be byte-identical to what was scanned.
function manifestVerify() {
  if (!existsSync(MANIFEST)) verdictBlocked(`manifest ${MANIFEST} missing from artifact`, "Blocked: artifact integrity check failed. Nothing published.");
  if (!existsSync(DIST)) verdictBlocked(`no ${DIST}/ directory in artifact`, "Blocked: artifact integrity check failed. Nothing published.");
  const recorded = readFileSync(MANIFEST, "utf8").trim();
  const recomputed = buildManifestLines().join("\n");
  if (sha256(recorded) !== sha256(recomputed)) {
    verdictBlocked("artifact manifest mismatch — downloaded bundle differs from the scanned build", "Blocked: artifact integrity check failed. Nothing published.");
  }
  console.log(`✓ manifest verified: downloaded artifact is byte-identical to the scanned build (aggregate ${sha256(recomputed)})`);
  setOutput("manifest_sha", sha256(recomputed));
}

function compact(s) { return s.replace(/\s+/g, " "); }

// Classify ONE occurrence of the production app domain (PROD_ROUTE) by its
// immediate, semantic context. ALLOW (warn) only the narrow approved branding/
// metadata/comment roles; everything else — and any active/endpoint/link use —
// is BLOCK. The match keys off the bytes IMMEDIATELY before the domain so an
// endpoint use (fetch/href/src/action/ws/import) can never match an inert role.
function classifyApp(txt, idx) {
  const left = txt.slice(Math.max(0, idx - 220), idx);
  const right = txt.slice(idx, idx + 140);
  const lc = compact(left);

  // APPROVED 1: Open Graph / Twitter metadata content attribute.
  //   ...property="og:url" content="https://<domain>   /   og:image / twitter:image
  if (/content\s*=\s*["']https:\/\/$/.test(lc) && /(og:url|og:image|twitter:image)/.test(lc)) {
    return { kind: "warn", ctx: "og/twitter metadata" };
  }
  // APPROVED 2: Academy inert branding text node (React children string).
  //   children:"<domain>/academy · Silent Shield Security"
  if (/children\s*:\s*["']$/.test(left) && /^fortress\.silentshieldsecurity\.com\/academy/.test(right)) {
    return { kind: "warn", ctx: "academy branding text" };
  }
  // APPROVED 3: inside a retained block comment /* ... */ (safe: "/*" never occurs in "https://").
  if (/\/\*(?:(?!\*\/)[\s\S])*$/.test(left)) {
    return { kind: "warn", ctx: "comment" };
  }
  // Everything else: active context or unapproved occurrence -> BLOCK.
  return { kind: "block", ctx: compact(left.slice(-44)) + "»" + compact(right.slice(0, 28)) };
}

function checkBundle() {
  if (!existsSync(DIST)) verdictBlocked(`no ${DIST}/ directory — nothing was built`);
  const files = walk(DIST);

  // TIER 1 — production references that are NEVER allowed anywhere in a staging
  // bundle (data plane + deploy identity). prod worker name is a prefix of the
  // staging worker name, so it is matched only when NOT followed by "-staging".
  const prodHost = `${PROD_REF}.supabase.co`;
  const extraHosts = (E.FORBIDDEN_EXTRA_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const tier1 = [
    { label: `prod Supabase project id (${PROD_REF})`, find: (t) => t.includes(PROD_REF) },
    { label: `prod Supabase host — API/auth/storage/Realtime/WS (${prodHost})`, find: (t) => t.includes(prodHost) },
    { label: `prod worker name (${PROD_WORKER})`, find: (t) => new RegExp(`${PROD_WORKER}(?!-staging)`).test(t) },
    ...extraHosts.map((h) => ({ label: `prod host (${h})`, find: (t) => t.includes(h) })),
  ];

  const tier1hits = {};
  const appBlocks = [];
  const appWarns = [];
  let stagingSeen = false;

  for (const f of files) {
    let txt;
    try { txt = readFileSync(f, "utf8"); } catch { continue; } // skip binaries
    const rel = relative(DIST, f);
    if (txt.includes(STAGING_REF)) stagingSeen = true;

    for (const c of tier1) if (c.find(txt)) (tier1hits[c.label] ||= []).push(rel);

    // TIER 2 — production app domain: classify EVERY occurrence by context.
    let i = txt.indexOf(PROD_ROUTE);
    while (i !== -1) {
      const cls = classifyApp(txt, i);
      (cls.kind === "warn" ? appWarns : appBlocks).push({ ...cls, file: rel });
      i = txt.indexOf(PROD_ROUTE, i + PROD_ROUTE.length);
    }
  }

  const t1 = Object.keys(tier1hits);
  if (t1.length) {
    verdictBlocked(`production data/deploy reference(s) — ${t1.map((k) => `${k} in ${tier1hits[k].slice(0, 3).join(", ")}`).join("; ")}`);
  }
  if (appBlocks.length) {
    const d = appBlocks.slice(0, 5).map((b) => `${b.file} [${b.ctx}]`).join("; ");
    verdictBlocked(`production app domain (${PROD_ROUTE}) used in a disallowed/active context — ${d}`);
  }
  if (!stagingSeen) {
    verdictBlocked(`staging project "${STAGING_REF}" not present in bundle — staging env did not apply`);
  }

  verdictIsolated(
    `scanned ${files.length} files — 0 production data/deploy references ` +
    `(checked: project id, supabase API/auth/storage/realtime/ws host, worker name${extraHosts.length ? ", extra hosts" : ""}); ` +
    `staging project "${STAGING_REF}" present.`,
    appWarns,
  );
}

if (phase === "config") checkConfig();
else if (phase === "manifest-write") manifestWrite();
else if (phase === "manifest-verify") manifestVerify();
else checkBundle();
