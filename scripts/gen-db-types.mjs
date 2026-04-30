#!/usr/bin/env node
/**
 * gen-db-types.mjs
 *
 * Regenerates src/integrations/supabase/types.ts from the live Supabase schema
 * via the Management API. The committed types.ts is the source of truth used
 * by the frontend and edge functions; running this script overwrites it with
 * what the database actually has.
 *
 * Usage:
 *   SUPABASE_PAT=sbp_... node scripts/gen-db-types.mjs            # writes to disk
 *   SUPABASE_PAT=sbp_... node scripts/gen-db-types.mjs --check    # CI mode, exits 1 on drift
 *
 * Project ref defaults to kpuqukppbmwebiptqmog (override via SUPABASE_PROJECT_REF).
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const TYPES_PATH = join(ROOT, 'src/integrations/supabase/types.ts');
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'kpuqukppbmwebiptqmog';
const PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
const CHECK_MODE = process.argv.includes('--check');

if (!PAT) {
  console.error('SUPABASE_PAT (or SUPABASE_ACCESS_TOKEN) env var is required');
  process.exit(2);
}

const apiUrl = `https://api.supabase.com/v1/projects/${PROJECT_REF}/types/typescript?included_schemas=public`;

const resp = await fetch(apiUrl, {
  headers: { 'Authorization': `Bearer ${PAT}` },
});

if (!resp.ok) {
  console.error(`Failed to fetch types: ${resp.status} ${resp.statusText}`);
  console.error(await resp.text());
  process.exit(2);
}

const body = await resp.json();
const generated = body.types;
if (typeof generated !== 'string' || generated.length === 0) {
  console.error('Empty types response from Management API');
  process.exit(2);
}

const current = (() => {
  try { return readFileSync(TYPES_PATH, 'utf8'); } catch { return ''; }
})();

if (CHECK_MODE) {
  if (normalize(current) !== normalize(generated)) {
    console.error('❌ Drift detected between committed types and live database schema.');
    console.error('   Run `npm run gen:types` locally and commit the result.');
    console.error('');
    // Show a tiny diff hint
    const curLines = current.split('\n');
    const newLines = generated.split('\n');
    const maxLines = Math.max(curLines.length, newLines.length);
    let diffsShown = 0;
    for (let i = 0; i < maxLines && diffsShown < 5; i++) {
      if (curLines[i] !== newLines[i]) {
        console.error(`   line ${i + 1}:`);
        console.error(`     committed: ${curLines[i] ?? '<missing>'}`);
        console.error(`     live:      ${newLines[i] ?? '<missing>'}`);
        diffsShown++;
      }
    }
    process.exit(1);
  }
  console.log('✅ types.ts matches live schema');
  process.exit(0);
}

writeFileSync(TYPES_PATH, generated);
console.log(`✅ Wrote ${generated.length.toLocaleString()} bytes to ${TYPES_PATH}`);

function normalize(s) {
  return s.replace(/\r\n/g, '\n').replace(/\s+$/g, '');
}
