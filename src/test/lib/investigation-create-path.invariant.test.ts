import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Source-level invariants for the Create Investigation path.
 *
 * Greps the createNewInvestigation() body in src/pages/Investigations.tsx and
 * proves the hotfix contract structurally: exactly ONE investigation mutation
 * (the create_investigation RPC), ZERO direct writes to the `investigations`
 * table (insert OR update), no client-side allocator, and NO post-create
 * mutation that could fail after a real investigation already exists.
 */
const SRC = readFileSync('src/pages/Investigations.tsx', 'utf8');

/** Extract the createNewInvestigation function body (brace-matched). */
function createBody(src: string): string {
  const start = src.indexOf('const createNewInvestigation');
  expect(start).toBeGreaterThan(-1);
  // find the first '{' after the arrow, then brace-match to its close
  const braceOpen = src.indexOf('{', src.indexOf('=>', start));
  let depth = 0;
  for (let i = braceOpen; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(braceOpen, i + 1); }
  }
  throw new Error('could not brace-match createNewInvestigation');
}
const BODY = createBody(SRC);

const countAll = (re: RegExp) => (BODY.match(re) ?? []).length;

describe('Create Investigation path — source invariants', () => {
  it('zero direct from("investigations").insert in the create path', () => {
    expect(countAll(/from\(\s*['"]investigations['"]\s*\)\s*\.insert/g)).toBe(0);
  });

  it('zero direct from("investigations").update in the create path', () => {
    expect(countAll(/from\(\s*['"]investigations['"]\s*\)\s*\.update/g)).toBe(0);
  });

  it('zero direct writes to the investigations table of ANY kind (insert/update/upsert/delete)', () => {
    expect(countAll(/from\(\s*['"]investigations['"]\s*\)\s*\.(insert|update|upsert|delete)/g)).toBe(0);
  });

  it('exactly one create_investigation RPC mutation', () => {
    const rpcCalls = countAll(/\.rpc\(\s*(CREATE_INVESTIGATION_RPC|['"]create_investigation['"])/g);
    expect(rpcCalls).toBe(1);
  });

  it('no client-side file-number allocator (length+1 / INV- / padStart / getFullYear)', () => {
    expect(countAll(/investigations\.length\s*\+\s*1/g)).toBe(0);
    expect(countAll(/INV-\$\{|padStart\(|getFullYear\(/g)).toBe(0);
  });

  it('the server-returned row id/file_number is the canonical result used for navigation', () => {
    expect(/extractInvestigationRow<\{[^}]*file_number[^}]*\}>\(data\)/.test(BODY)).toBe(true);
    expect(/navigate\(`\/investigation\/\$\{row\.id\}`\)/.test(BODY)).toBe(true);
  });

  // Eliminates duplicates caused by a successful create followed by a FAILED
  // client-side post-create write (there are none). NOTE: this does NOT prove
  // protection against a transport failure after the RPC commits but before the
  // browser receives the response — v1 has no idempotency key, so a manual retry
  // could still create a second investigation. That is out of scope here.
  it('zero client-side mutations occur AFTER the rpc() call (no failed-post-write duplicate path)', () => {
    const rpcIdx = BODY.indexOf('.rpc(');
    expect(rpcIdx).toBeGreaterThan(-1);
    const afterRpc = BODY.slice(rpcIdx + 5); // text after the single rpc() invocation
    const postWrites = (afterRpc.match(/\.(insert|update|upsert|delete)\(/g) ?? []).length;
    expect(postWrites).toBe(0);
  });
});
