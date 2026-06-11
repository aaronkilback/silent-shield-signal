#!/usr/bin/env python3
"""
Deterministic byte-verifier for the LIVE prod threat-radar-analysis bundle.

Usage:
  1) Fetch the deployed bundle via the Supabase MCP get_edge_function
     (project_id=kpuqukppbmwebiptqmog, function_slug=threat-radar-analysis).
     The MCP saves the JSON to a tool-results/*.txt file and prints its path.
  2) python3 scripts/verify-tra-containment.py <path-to-that-json-file>
     (no arg => auto-picks the newest get_edge_function dump in the session
      tool-results dir)

Exit code 0 = PASS, 1 = FAIL. No interpretation: pure string/regex gates.

SCOPE (honest boundary of this tool):
  - It inspects ONLY the deployed prod threat-radar-analysis BACKEND bundle.
  - The client-scope gate is enforced server-side, so a PASS means every caller
    (ThreatRadar page, Aegis chat `analyze_threat_radar`, agent-chat) reaches a
    client-scoped, fail-closed backend — the backend is the security boundary.
  - It does NOT read the dashboard-ai-assistant / agent-chat deployed code, and
    it does NOT run a 2-client runtime test.
  - PASS = the prod backend bundle is scoped. PASS is NOT "Slice F safe".
    Slice F is safe ONLY after Codex's 2-client runtime proof also passes.
"""
import sys, json, glob, os, re

TOOLDIR = "/Users/aaronkilback/.claude/projects/-Users-aaronkilback/15a55949-7b83-43e6-b963-d2eb33558304/tool-results"
SOURCE_7 = ["signals", "incidents", "entities", "internal_assets",
            "threat_precursor_indicators", "sentiment_tracking", "radical_activity_tracking"]

def resolve_path():
    if len(sys.argv) > 1:
        return sys.argv[1]
    cands = sorted(glob.glob(os.path.join(TOOLDIR, "mcp-plugin_supabase_supabase-get_edge_function-*.txt")),
                   key=os.path.getmtime)
    if not cands:
        print("FATAL: no get_edge_function dump found; pass the JSON path explicitly.")
        sys.exit(2)
    return cands[-1]

def from_window(content, table):
    """Slice from .from('table') to the next .from( (or EOF)."""
    m = re.search(r"\.from\('" + re.escape(table) + r"'\)", content)
    if not m:
        return None
    nxt = content.find(".from(", m.end())
    return content[m.start(): nxt if nxt != -1 else len(content)]

def main():
    path = resolve_path()
    data = json.load(open(path))
    version = data.get("version")
    idx = next((f["content"] for f in data.get("files", [])
                if f["name"].endswith("threat-radar-analysis/index.ts")), "")
    if not idx:
        print("FATAL: threat-radar-analysis/index.ts not found in bundle.")
        sys.exit(2)

    R = []  # (label, ok, note)

    # 1. version
    R.append(("1. deployed version > 87", isinstance(version, int) and version > 87, f"version={version}"))
    # 2/3. gate markers
    R.append(("2. CLIENT_CONTEXT_MISSING present", "CLIENT_CONTEXT_MISSING" in idx, ""))
    R.append(("3. userCanAccessClient present", "userCanAccessClient" in idx, ""))
    # 4. each source read scoped by client_id
    for t in SOURCE_7:
        w = from_window(idx, t)
        ok = bool(w) and "eq('client_id', client_id)" in w
        R.append((f"4. {t} scoped by client_id", ok, "" if ok else "no client_id in its .from() window"))
    # 5. signals/incidents/entities also tenant_id-scoped
    for t, var in [("signals", "signalsQuery"), ("incidents", "incidentsQuery"), ("entities", "entitiesQuery")]:
        ok = f"{var} = {var}.eq('tenant_id', tenantId)" in idx
        R.append((f"5. {t} also scoped by tenant_id", ok, ""))
    # 6. entity_mentions scoped ONLY through in-scope signal_ids
    w = from_window(idx, "entity_mentions")
    em_ok = bool(w) and "in('signal_id', signalIds)" in w \
        and "eq('client_id'" not in w and "eq('tenant_id'" not in w
    R.append(("6. entity_mentions scoped via in-scope signal_ids only", em_ok,
              "" if em_ok else "missing signal_id scope or has a direct client/tenant eq"))
    # 7. no NULL fallback
    R.append(("7. no `client_id || null` fallback", "client_id || null" not in idx, ""))
    # 8. no unscoped global source reads remaining
    unscoped = []
    for t in SOURCE_7:
        for m in re.finditer(r"\.from\('" + re.escape(t) + r"'\)", idx):
            nxt = idx.find(".from(", m.end())
            w2 = idx[m.start(): nxt if nxt != -1 else len(idx)]
            if "eq('client_id', client_id)" not in w2:
                unscoped.append(t)
    for m in re.finditer(r"\.from\('entity_mentions'\)", idx):
        nxt = idx.find(".from(", m.end())
        w2 = idx[m.start(): nxt if nxt != -1 else len(idx)]
        if "in('signal_id', signalIds)" not in w2:
            unscoped.append("entity_mentions")
    R.append(("8. no unscoped global source reads remain", len(unscoped) == 0,
              ("unscoped: " + ",".join(sorted(set(unscoped)))) if unscoped else ""))

    allpass = all(ok for _, ok, _ in R)
    print(f"\nPROD threat-radar-analysis byte-verification  (version={version}, dump={os.path.basename(path)})")
    print("=" * 76)
    for label, ok, note in R:
        line = f"[{'PASS' if ok else 'FAIL'}] {label}"
        if note and not ok:
            line += f"   <- {note}"
        print(line)
    print("=" * 76)
    if allpass:
        print("Backend byte-verification PASS — proceed to flip THREAT_RADAR_ANALYSIS_VERIFIED and hand to Codex.")
    else:
        print("Backend byte-verification FAIL — do not flip the flag; keep ThreatRadar analysis disabled; "
              "either fix deploy or pause/delete threat-radar-analysis as temporary containment.")
    print("-" * 76)
    print("SCOPE: this checks ONLY the prod threat-radar-analysis backend bundle. The gate")
    print("is server-side, so PASS contains ALL callers (page, Aegis chat, agent-chat) at")
    print("the backend boundary. It does NOT inspect chat-function code and does NOT run a")
    print("runtime test. PASS = backend bundle scoped; PASS is NOT 'Slice F safe' — that")
    print("requires Codex's 2-client runtime proof.")
    sys.exit(0 if allpass else 1)

if __name__ == "__main__":
    main()
