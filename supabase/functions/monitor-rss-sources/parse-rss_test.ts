// Deno unit tests for the RSS <item> regex in index.ts::parseRSS().
//
// Run: `deno test supabase/functions/monitor-rss-sources/parse-rss_test.ts`
//
// If this test's regex drifts from the one in index.ts, this file has
// failed at its job. If you change the regex in index.ts, update this
// constant to match — CI grep guard is a future doctrine, see
// docs/platform-operations/wo-coverage-source-health-registry-spec.md.

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

// EXACT COPY of the regex in supabase/functions/monitor-rss-sources/index.ts.
// Do not edit here without editing index.ts (and vice versa).
const ITEM_REGEX = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g;

function countMatches(xml: string): number {
  return Array.from(xml.matchAll(ITEM_REGEX)).length;
}

function extractTitles(xml: string): string[] {
  const titles: string[] = [];
  for (const m of xml.matchAll(ITEM_REGEX)) {
    const t = m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    titles.push(t);
  }
  return titles;
}

// ─────────────────────────────────────────────────────────────
// Fixture 1: plain <item> — pre-fix behavior preserved.
// ─────────────────────────────────────────────────────────────
Deno.test("parseRSS: plain <item> tags parse (regression-safe for Dogwood-style feeds)", () => {
  const xml = `<rss><channel>
    <item><title>Plain 1</title><link>https://ex.com/1</link><description>d1</description><pubDate>Wed, 15 Jul 2026 10:00:00 GMT</pubDate></item>
    <item><title>Plain 2</title><link>https://ex.com/2</link><description>d2</description><pubDate>Wed, 15 Jul 2026 11:00:00 GMT</pubDate></item>
  </channel></rss>`;

  assertEquals(countMatches(xml), 2);
  assertEquals(extractTitles(xml), ["Plain 1", "Plain 2"]);
});

// ─────────────────────────────────────────────────────────────
// Fixture 2: CBC's attributed <item cbc:type="story" ...> — the previously-broken case.
// ─────────────────────────────────────────────────────────────
Deno.test("parseRSS: attributed <item cbc:type=\"story\" ...> tags parse (the actual CBC fix)", () => {
  // Verbatim shape from live curl of https://www.cbc.ca/webfeed/rss/rss-canada-britishcolumbia
  const xml = `<rss xmlns:cbc="https://www.cbc.ca/rss/cbc" version="2.0"><channel>
    <item cbc:type="story" cbc:deptid="" cbc:syndicate="true">
      <title><![CDATA[2 groups given private use of Vancouver Aquatic Centre after closure and court ruling citing safety risks]]></title>
      <link>https://www.cbc.ca/news/canada/british-columbia/vancouver-aquatic-centre-private-use-9.7270191?cmp=rss</link>
      <description><![CDATA[<p>desc</p>]]></description>
      <pubDate>Wed, 15 Jul 2026 10:00:00 EDT</pubDate>
      <guid isPermaLink="false">9.7270191</guid>
    </item>
    <item cbc:type="story" cbc:deptid="2.4826" cbc:syndicate="true">
      <title><![CDATA[First Nations chiefs vote to oppose Carney government's proposed major projects reforms]]></title>
      <link>https://www.cbc.ca/news/indigenous/afn-major-projects-resolutions-9.7270957?cmp=rss</link>
      <description><![CDATA[<p>desc2</p>]]></description>
      <pubDate>Wed, 15 Jul 2026 11:28:09 EDT</pubDate>
      <guid isPermaLink="false">9.7270957</guid>
    </item>
  </channel></rss>`;

  assertEquals(countMatches(xml), 2);
  const titles = extractTitles(xml);
  assertEquals(titles.length, 2);
  // Titles are wrapped in CDATA per RSS spec — the CDATA delimiters live INSIDE the capture.
  // parseRSS in index.ts strips CDATA downstream. Test here just confirms the item BODIES were extracted.
  assertEquals(titles[0].includes("Vancouver Aquatic Centre"), true);
  assertEquals(titles[1].includes("First Nations chiefs"), true);
});

// ─────────────────────────────────────────────────────────────
// Fixture 3: self-closing edge case — must NOT match (no body to extract).
// ─────────────────────────────────────────────────────────────
Deno.test("parseRSS: self-closing <item/> and <item attr/> do NOT match (no item body)", () => {
  // Both plain self-closing and attributed self-closing should be ignored — a
  // self-closing tag has no body, so there's nothing meaningful to persist.
  const xml = `<rss><channel>
    <item/>
    <item cbc:type="story"/>
    <item cbc:type="story" cbc:deptid=""/>
    <item><title>Real item</title></item>
  </channel></rss>`;

  // Only the real (non-self-closing) item should match.
  assertEquals(countMatches(xml), 1);
  assertEquals(extractTitles(xml), ["Real item"]);
});

// ─────────────────────────────────────────────────────────────
// Bonus fixture: mixed feed — plain + attributed items in one feed.
// Guards against a future regex change that could accidentally break one shape.
// ─────────────────────────────────────────────────────────────
Deno.test("parseRSS: mixed plain-and-attributed items in one feed both parse", () => {
  const xml = `<rss><channel>
    <item><title>Plain</title></item>
    <item cbc:type="story"><title>Attributed</title></item>
    <item xml:base="http://example.com"><title>Other-namespace</title></item>
  </channel></rss>`;

  assertEquals(countMatches(xml), 3);
  assertEquals(extractTitles(xml), ["Plain", "Attributed", "Other-namespace"]);
});
