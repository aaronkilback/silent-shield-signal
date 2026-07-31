#!/usr/bin/env node
// WO-CI-SECURITY-GATE-01 — negative test (the gate on the gate).
// Known-bad fixtures MUST fail the named checks; fixed versions MUST pass.
// If a known-bad passes, the CHECKER is wrong — fix the checker, not the fixture.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanFile } from "./run.mjs";
import { check1 } from "./checks/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const F = (n) => fs.readFileSync(path.join(HERE, "fixtures", n), "utf8");

function checksHit(fileName, source) {
  const set = new Set(scanFile(fileName, source).map((v) => v.check));
  return set;
}

const cases = [
  { name: "ai-tools-query @ adce9554 (pre-containment)", file: "ai-tools-query.adce9554.BAD.ts.txt",
    verifyJwtFalse: true, allowlisted: false, expectFail: ["check1", "check2"] },
  { name: "create-operator-invite (pre-fix)", file: "create-operator-invite.prefix.BAD.ts.txt",
    verifyJwtFalse: true, allowlisted: true, expectFail: ["check2", "check3"] },
  { name: "ai-tools-query (current, 503 stub)", file: "ai-tools-query.current.GOOD.ts.txt",
    verifyJwtFalse: true, allowlisted: true, expectFail: [] },
  { name: "create-operator-invite (current, fixed)", file: "create-operator-invite.current.GOOD.ts.txt",
    verifyJwtFalse: false, allowlisted: true, expectFail: [] },
];

let allOk = true;
console.log("── security-gate NEGATIVE TEST ──\n");
for (const c of cases) {
  const hit = checksHit(c.file, F(c.file));
  if (check1(c.file, c.verifyJwtFalse, c.allowlisted).length) hit.add("check1");
  const actual = [...hit].sort();
  const expected = [...c.expectFail].sort();
  const ok = actual.length === expected.length && actual.every((x, i) => x === expected[i]);
  allOk = allOk && ok;
  console.log(`${ok ? "✅" : "❌"} ${c.name}`);
  console.log(`   expected fail: [${expected.join(", ") || "none"}]`);
  console.log(`   actual   fail: [${actual.join(", ") || "none"}]\n`);
}
console.log(allOk ? "✅ NEGATIVE TEST PASSED — checker fires on all known-bad, silent on fixed"
                  : "❌ NEGATIVE TEST FAILED — a known-bad passed or a fixed version failed; FIX THE CHECKER");
process.exit(allOk ? 0 : 1);
