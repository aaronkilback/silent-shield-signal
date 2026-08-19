// TEMPORARY proof (delete after). Reads SERPER_API_KEY from env (secret, never in chat), runs the 3
// target queries against Serper.dev, returns RAW results. Surfaces http status + error DISTINCTLY from
// empty organic[] — a failed request and a zero-result response must not look the same (the exact
// ambiguity that sent the CSE diagnosis down the wrong path this morning).
const QUERIES = [
  '"Olynyk v. Kilback"',
  'Kilback "malicious prosecution" wiselaw',
  '"Aaron Kilback"',
];
Deno.serve(async () => {
  const key = Deno.env.get("SERPER_API_KEY") ?? "";
  if (!key) return new Response(JSON.stringify({ error: "SERPER_API_KEY secret not set" }), { status: 400, headers: { "Content-Type": "application/json" } });
  const out: any[] = [];
  for (const q of QUERIES) {
    const entry: any = { query: q, http: null, request_ok: false, error: null, organic_count: 0, organic_top10: [], response_keys: null };
    try {
      const r = await fetch("https://google.serper.dev/search", {
        method: "POST", headers: { "X-API-KEY": key, "Content-Type": "application/json" }, body: JSON.stringify({ q, num: 10 }),
      });
      entry.http = r.status;
      entry.request_ok = r.ok;                                  // request-level success (distinct from empty results)
      const d: any = await r.json();
      entry.response_keys = Object.keys(d);
      entry.error = (!r.ok) ? (d.message || d.error || `HTTP ${r.status}`) : null;   // error ONLY on failed request
      (d.organic || []).slice(0, 10).forEach((o: any, i: number) => entry.organic_top10.push({ rank: o.position ?? i + 1, title: o.title, link: o.link, snippet: (o.snippet || "").slice(0, 160) }));
      entry.organic_count = (d.organic || []).length;
    } catch (e) { entry.error = e instanceof Error ? e.message : String(e); }
    out.push(entry);
  }
  return new Response(JSON.stringify({ key_len: key.length, results: out }, null, 2), { headers: { "Content-Type": "application/json" } });
});
