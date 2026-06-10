// reingest-spin-workbook
// Narrow, idempotent structured-ingest path for the SPIN incident workbook(s).
//
// Why this exists: the generic ai-chat xlsx text extraction flattened the
// workbook into a single newline-free blob and dropped the per-row numeric
// columns (Date / Latitude / Longitude) — only the Crime Type + Description
// text survived. That made it impossible for Aegis to answer location,
// clustering, Alberta, or mapping questions from real platform data.
//
// This function re-parses the stored .xlsx with full column fidelity, keeps
// every usable row (Date & Time / Latitude / Longitude / Crime Type /
// Description), computes the aggregates Aegis needs (row count, date range,
// top crime types, coordinate clusters, Alberta-side records, gaps), and
// writes them back to the SAME tenant-scoped archival_documents row:
//   - content_text: BLUF summary (answers up front, within retrieval cap) +
//                   all usable rows in a structured, line-per-row form.
//   - metadata.spin_extraction: structured aggregate object.
//   - metadata.spin_rows: full structured rows (queryable structured form).
//
// It does NOT invent site names, ownership, asset criticality, response
// outcomes, or live monitoring status — only what is literally in the sheet.
//
// Scope: this is a workbook re-ingest tool, not a change to the generic
// ingestion pipeline. It is tenant-safe: it only ever touches the single
// document_id it is given and never crosses client_id boundaries.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// AB/BC border for the relevant latitudes is the 120°W meridian.
// Longitude east of -120 (i.e. > -120) is the Alberta side.
const AB_BC_BORDER_LON = -120.0;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/[^0-9.+\-]/g, "");
  if (s === "" || s === "-" || s === "+" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 16).replace("T", " ");
  // Excel serial date number
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 16).replace("T", " ");
  }
  const s = String(v).trim();
  const d = new Date(s);
  if (!isNaN(d.getTime()) && /\d{4}/.test(s)) return d.toISOString().slice(0, 16).replace("T", " ");
  return s || null;
}

// Find the column index whose header matches any of the candidate substrings.
function findCol(headers: string[], candidates: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] || "").toString().toLowerCase().trim();
    if (!h) continue;
    for (const c of candidates) {
      if (h.includes(c)) return i;
    }
  }
  return -1;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const documentId = body.document_id;
    const dryRun = body.dry_run === true;
    if (!documentId) return json({ success: false, error: "document_id is required" }, 400);

    const { data: doc, error: docErr } = await supabase
      .from("archival_documents")
      .select("id, filename, client_id, storage_path, metadata, content_text")
      .eq("id", documentId)
      .single();
    if (docErr || !doc) return json({ success: false, error: `document not found: ${docErr?.message}` }, 404);
    if (!doc.client_id) return json({ success: false, error: "document has no client_id (ownerless) — refusing" }, 400);

    const bucket = (doc.metadata && doc.metadata.storage_bucket) || "ai-chat-attachments";
    const path = doc.storage_path;
    if (!path) return json({ success: false, error: "document has no storage_path" }, 400);

    // Download the original xlsx bytes (service role; private bucket).
    const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(path);
    if (dlErr || !blob) return json({ success: false, error: `download failed from ${bucket}/${path}: ${dlErr?.message}` }, 502);
    const buf = new Uint8Array(await blob.arrayBuffer());

    const wb = XLSX.read(buf, { type: "array", cellDates: true });

    type Row = {
      sheet: string;
      date: string | null;
      lat: number | null;
      lng: number | null;
      crime: string;
      desc: string;
    };
    const rows: Row[] = [];
    const sheetsParsed: string[] = [];

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
      if (!aoa.length) continue;

      // Locate the header row: the first row that has Latitude AND Longitude.
      let headerIdx = -1;
      for (let r = 0; r < Math.min(aoa.length, 15); r++) {
        const cells = (aoa[r] || []).map((c) => (c ?? "").toString().toLowerCase());
        const hasLat = cells.some((c) => c.includes("latitude") || c === "lat");
        const hasLon = cells.some((c) => c.includes("longitude") || c === "long" || c === "lon" || c === "lng");
        if (hasLat && hasLon) { headerIdx = r; break; }
      }
      if (headerIdx === -1) continue; // not an incident sheet

      const headers = (aoa[headerIdx] || []).map((c) => (c ?? "").toString());
      const cDate = findCol(headers, ["date", "time", "incident date"]);
      const cLat = findCol(headers, ["latitude", "lat"]);
      const cLon = findCol(headers, ["longitude", "long", "lon", "lng"]);
      const cCrime = findCol(headers, ["crime", "incident type", "type", "category"]);
      const cDesc = findCol(headers, ["description", "details", "notes", "summary"]);

      sheetsParsed.push(sheetName);

      for (let r = headerIdx + 1; r < aoa.length; r++) {
        const row = aoa[r] || [];
        const lat = cLat >= 0 ? num(row[cLat]) : null;
        const lng = cLon >= 0 ? num(row[cLon]) : null;
        const date = cDate >= 0 ? isoDate(row[cDate]) : null;
        const crime = cCrime >= 0 ? (row[cCrime] ?? "").toString().trim() : "";
        const desc = cDesc >= 0 ? (row[cDesc] ?? "").toString().trim() : "";
        // Skip fully-empty rows.
        if (lat === null && lng === null && !date && !crime && !desc) continue;
        rows.push({ sheet: sheetName, date, lat, lng, crime, desc });
      }
    }

    const usable = rows.filter((r) => r.lat !== null && r.lng !== null);
    const missingCoords = rows.length - usable.length;

    // Date range over parseable dates.
    const dates = rows.map((r) => r.date).filter((d): d is string => !!d && /\d{4}-\d{2}-\d{2}/.test(d)).sort();
    const dateMin = dates.length ? dates[0] : null;
    const dateMax = dates.length ? dates[dates.length - 1] : null;

    // Top crime types.
    const crimeCounts: Record<string, number> = {};
    for (const r of rows) {
      const k = r.crime || "(unspecified)";
      crimeCounts[k] = (crimeCounts[k] || 0) + 1;
    }
    const topCrimes = Object.entries(crimeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

    // Coordinate clusters: bucket to ~0.05° (~5km) and count.
    const clusterMap: Record<string, { lat: number; lng: number; n: number }> = {};
    for (const r of usable) {
      const bl = Math.round(r.lat! / 0.05) * 0.05;
      const bo = Math.round(r.lng! / 0.05) * 0.05;
      const key = `${bl.toFixed(2)},${bo.toFixed(2)}`;
      if (!clusterMap[key]) clusterMap[key] = { lat: bl, lng: bo, n: 0 };
      clusterMap[key].n++;
    }
    const clusters = Object.values(clusterMap).sort((a, b) => b.n - a.n).slice(0, 12);

    // Alberta-side records (longitude east of -120°).
    const alberta = usable.filter((r) => r.lng! > AB_BC_BORDER_LON);

    const extraction = {
      reextracted_at: new Date().toISOString(),
      source_file: doc.filename,
      sheets_parsed: sheetsParsed,
      total_rows: rows.length,
      usable_rows: usable.length,
      missing_coordinates: missingCoords,
      date_range: { min: dateMin, max: dateMax },
      top_crime_types: topCrimes.map(([k, n]) => ({ crime: k, count: n })),
      coordinate_clusters: clusters.map((c) => ({ lat: c.lat, lng: c.lng, count: c.n })),
      alberta_side_records: alberta.length,
      alberta_sample_coords: alberta.slice(0, 8).map((r) => ({ lat: r.lat, lng: r.lng, crime: r.crime })),
      not_present: ["site names", "asset ownership", "asset criticality", "response outcomes", "live monitoring status"],
    };

    // Build the structured content_text (BLUF answers first, then all rows).
    const lines: string[] = [];
    lines.push("=== SPIN INCIDENT WORKBOOK — STRUCTURED RE-EXTRACTION ===");
    lines.push(`Source file: ${doc.filename}`);
    lines.push(`Sheets parsed: ${sheetsParsed.join(", ") || "(none matched an incident header)"}`);
    lines.push(`Usable rows (with latitude AND longitude): ${usable.length} of ${rows.length} total parsed rows.`);
    lines.push(`Records missing coordinates: ${missingCoords}.`);
    lines.push(`Columns preserved per row: Incident Date & Time | Latitude | Longitude | Crime Type | Description | Sheet.`);
    lines.push(`Date range: ${dateMin ?? "unknown"} to ${dateMax ?? "unknown"}.`);
    lines.push(`Top crime types: ${topCrimes.map(([k, n]) => `${k} (${n})`).join(", ") || "n/a"}.`);
    lines.push(`Coordinate clusters (~5km buckets, by count): ${clusters.map((c) => `${c.lat.toFixed(2)},${c.lng.toFixed(2)} (${c.n})`).join("; ") || "n/a"}.`);
    lines.push(`Alberta-side records (longitude east of -120 degrees): ${alberta.length}${alberta.length ? ` — sample: ${alberta.slice(0, 6).map((r) => `${r.lat!.toFixed(4)},${r.lng!.toFixed(4)}`).join("; ")}` : ""}.`);
    lines.push(`NOT present in this workbook (do not infer): site names, asset ownership, asset criticality, response outcomes, live monitoring status.`);
    lines.push("");
    lines.push("=== ALL USABLE ROWS (Date | Latitude | Longitude | CrimeType | Description | Sheet) ===");
    for (const r of usable) {
      const d = (r.desc || "").replace(/\s+/g, " ").slice(0, 240);
      lines.push(`${r.date ?? "?"} | ${r.lat!.toFixed(6)} | ${r.lng!.toFixed(6)} | ${r.crime || "?"} | ${d} | ${r.sheet}`);
    }
    if (missingCoords > 0) {
      lines.push("");
      lines.push("=== ROWS MISSING COORDINATES (Date | CrimeType | Description | Sheet) ===");
      for (const r of rows.filter((x) => x.lat === null || x.lng === null)) {
        const d = (r.desc || "").replace(/\s+/g, " ").slice(0, 200);
        lines.push(`${r.date ?? "?"} | ${r.crime || "?"} | ${d} | ${r.sheet}`);
      }
    }
    const contentText = lines.join("\n");

    const newSummary =
      `SPIN incident workbook — ${usable.length} usable geolocated rows (${rows.length} total), ` +
      `${dateMin ?? "?"} to ${dateMax ?? "?"}. Top: ${topCrimes.slice(0, 3).map(([k, n]) => `${k} (${n})`).join(", ")}. ` +
      `${alberta.length} Alberta-side. Structured per-row Date/Lat/Long/CrimeType/Description preserved.`;

    const verification = {
      success: true,
      document_id: documentId,
      client_id: doc.client_id,
      dry_run: dryRun,
      sheets_parsed: sheetsParsed,
      total_rows: rows.length,
      usable_rows: usable.length,
      missing_coordinates: missingCoords,
      date_range: { min: dateMin, max: dateMax },
      top_crime_types: extraction.top_crime_types,
      coordinate_clusters: extraction.coordinate_clusters,
      alberta_side_records: alberta.length,
      alberta_sample_coords: extraction.alberta_sample_coords,
      content_text_length: contentText.length,
      sample_rows: usable.slice(0, 5).map((r) => ({ date: r.date, lat: r.lat, lng: r.lng, crime: r.crime })),
    };

    if (dryRun) return json(verification);

    const newMetadata = {
      ...(doc.metadata || {}),
      processing_status: "completed",
      text_extracted: true,
      structured_reextract: true,
      spin_extraction: extraction,
      spin_rows: usable.map((r) => ({ date: r.date, lat: r.lat, lng: r.lng, crime: r.crime, desc: r.desc, sheet: r.sheet })),
    };

    const { error: updErr } = await supabase
      .from("archival_documents")
      .update({
        content_text: contentText,
        summary: newSummary,
        processing_status: "completed",
        metadata: newMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .eq("client_id", doc.client_id); // tenant-safe: never cross client boundary
    if (updErr) return json({ success: false, error: `update failed: ${updErr.message}`, verification }, 500);

    return json(verification);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ success: false, error: msg }, 500);
  }
});
