#!/usr/bin/env python3
# WO-DR-CADENCE-REBUILD — reconcile ss-fortress-dr (the only backup) before locking.
# Read-only. Reads creds from ~/.r2dr.env (NEVER from chat/argv). boto3 S3 API against R2.
#
# ~/.r2dr.env (operator writes in their own terminal, mode 600 — secret never enters chat):
#   R2_ACCESS_KEY_ID=...
#   R2_SECRET_ACCESS_KEY=...
#
# Usage: python3 scripts/dr-reconcile-r2.py
import os, sys, datetime
try:
    import boto3
except ImportError:
    sys.exit("boto3 missing")

ACCOUNT_ID = "0fb0e48f157b0e38ac0858022550f46d"           # from wrangler whoami (not secret)
ENDPOINT   = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"
BUCKET     = "ss-fortress-dr"
CUTOFF     = datetime.datetime(2026, 7, 7, tzinfo=datetime.timezone.utc)   # LastModified >= this = post-snapshot
EXPECTED_PREFIXES = ("investigation-files/", "hostile-evidence/", "archival-documents/", "tenant-files/", "cipher-evidence/")
# proven 2026-07-06 tally (from the ledger) to reconcile against
BASELINE = {"investigation-files":61, "hostile-evidence":1, "archival-documents":365, "tenant-files":71, "cipher-evidence":0}

env = {}
p = os.path.expanduser("~/.r2dr.env")
if not os.path.exists(p):
    sys.exit(f"{p} not found — operator must stage read-only R2 creds there first (mode 600).")
for line in open(p):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
AK, SK = env.get("R2_ACCESS_KEY_ID"), env.get("R2_SECRET_ACCESS_KEY")
if not AK or not SK:
    sys.exit("~/.r2dr.env missing R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY")

s3 = boto3.client("s3", endpoint_url=ENDPOINT, aws_access_key_id=AK, aws_secret_access_key=SK, region_name="auto")

objs = []
tok = None
while True:
    kw = {"Bucket": BUCKET, "MaxKeys": 1000}
    if tok: kw["ContinuationToken"] = tok
    r = s3.list_objects_v2(**kw)
    objs.extend(r.get("Contents", []))
    if r.get("IsTruncated"): tok = r["NextContinuationToken"]
    else: break

total_n = len(objs)
total_b = sum(o["Size"] for o in objs)
print(f"=== ss-fortress-dr: {total_n} objects, {total_b/1e9:.3f} GB ===\n")

# per top-level prefix
by_pref = {}
for o in objs:
    top = o["Key"].split("/", 1)[0]
    d = by_pref.setdefault(top, {"n": 0, "b": 0})
    d["n"] += 1; d["b"] += o["Size"]
print("--- by top-level prefix (vs 2026-07-06 baseline) ---")
for k in sorted(by_pref):
    base = BASELINE.get(k)
    delta = f"  (baseline {base}, Δ{by_pref[k]['n']-base:+d})" if base is not None else "  ⚠ NOT AN EXPECTED PREFIX"
    print(f"  {k:<24} {by_pref[k]['n']:>5} objs  {by_pref[k]['b']/1e6:>9.1f} MB{delta}")
for k in BASELINE:
    if k not in by_pref: print(f"  {k:<24} {0:>5} objs  (baseline {BASELINE[k]}, Δ{-BASELINE[k]:+d})")

# strays: keys not under an expected prefix
strays = [o for o in objs if not any(o["Key"].startswith(pre) for pre in EXPECTED_PREFIXES)]
print(f"\n--- STRAYS (key not under an expected prefix): {len(strays)} ---")
for o in strays[:60]:
    print(f"  {o['LastModified'].isoformat()}  {o['Size']:>10}  {o['Key']}")

# the 24: anything LastModified >= 2026-07-07
post = sorted([o for o in objs if o["LastModified"] >= CUTOFF], key=lambda x: x["LastModified"])
print(f"\n--- POST-2026-07-06 (LastModified >= 2026-07-07): {len(post)} ---")
for o in post:
    print(f"  {o['LastModified'].isoformat()}  {o['Size']:>10}  {o['Key']}")
print(f"\nSUMMARY: total={total_n}  baseline=498  extra={total_n-498}  strays={len(strays)}  post_2026_07_06={len(post)}")
