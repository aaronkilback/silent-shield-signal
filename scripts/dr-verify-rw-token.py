#!/usr/bin/env python3
# WO-DR-CADENCE-REBUILD — verify the Object R/W token's SAFETY properties before it's trusted.
# Reads ~/.r2dr-rw.env (never chat). Ground truth = read-back, never a call's reported success.
import os, sys, datetime
import boto3
from botocore.exceptions import ClientError

ACCOUNT_ID = "0fb0e48f157b0e38ac0858022550f46d"
ENDPOINT   = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"
BUCKET     = "ss-fortress-dr"
PROBE_KEY  = "incremental/_verify/2026-08-11-lock-test"
# lowest-value REAL object for the direct delete-block proof (regenerable audio, not evidence):
REAL_KEY   = "tenant-files/_system/briefings/system/1785416738581-Daily_Briefing_Thursday__July_30__2026.mp3"

# operator may stage at either name
p = next((os.path.expanduser(x) for x in ("~/.r2dr-rw.env", "~/.r2dr.env") if os.path.exists(os.path.expanduser(x))), None)
if not p: sys.exit("no ~/.r2dr-rw.env or ~/.r2dr.env — stage the Object R/W creds first (mode 600).")
env = {}
for line in open(p):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
s3 = boto3.client("s3", endpoint_url=ENDPOINT, aws_access_key_id=env["R2_ACCESS_KEY_ID"],
                  aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"], region_name="auto")

def err(e): return e.response.get("Error", {}).get("Code", str(e)) if isinstance(e, ClientError) else str(e)

print("=== TEST 1 — SCOPE: token must be denied on any bucket other than ss-fortress-dr ===")
try:
    s3.list_objects_v2(Bucket="ss-fortress-dr-scope-check", MaxKeys=1)
    print("  ❌ FAIL — got a response for a different bucket (token is NOT scoped)")
except ClientError as e:
    code = err(e)
    print(f"  ✅ PASS — other bucket denied ({code})" if code in ("AccessDenied","Forbidden","403") else f"  ⚠ other bucket returned {code} (not a 200; acceptable if 404-on-nonexistent, but AccessDenied is the scope proof)")

print("\n=== TEST 3 — WRITE: PUT the deliberate probe, confirm via read-back ===")
s3.put_object(Bucket=BUCKET, Key=PROBE_KEY,
              Body=b"DR R/W-token + WORM lock verification, 2026-08-11. Immutable until 2026-11-09 (snapshot-worm-90d). Deliberate; cannot be deleted until then.")
got = s3.get_object(Bucket=BUCKET, Key=PROBE_KEY)["Body"].read()
print(f"  ✅ PASS — probe written + read back ({len(got)} bytes) at {PROBE_KEY}" if got.startswith(b"DR R/W-token") else "  ❌ FAIL — probe read-back mismatch")

print("\n=== TEST 2 — LOCK DEFEATS THIS TOKEN (the structural guarantee) ===")
def survives(key, label):
    orig = s3.head_object(Bucket=BUCKET, Key=key); etag = orig["ETag"]
    # attempt DELETE
    try:
        s3.delete_object(Bucket=BUCKET, Key=key); dele = "call returned success"
    except ClientError as e: dele = f"call raised {err(e)}"
    # ground truth: is it still there, unchanged?
    try:
        after = s3.head_object(Bucket=BUCKET, Key=key)
        gone = False; same = after["ETag"] == etag
    except ClientError as e:
        gone = True; same = False
    print(f"  [{label}] DELETE: {dele}  →  read-back: {'GONE ❌❌' if gone else ('SURVIVES, ETag unchanged ✅' if same else 'present but ETag CHANGED ⚠')}")
    return (not gone) and same

print("  -- on the deliberate probe (also overwrite test; safe, we own it) --")
probe_del_ok = survives(PROBE_KEY, "probe")
# OVERWRITE attempt on the probe
try:
    s3.put_object(Bucket=BUCKET, Key=PROBE_KEY, Body=b"OVERWRITTEN-v2-should-not-persist")
    ov = "call returned success"
except ClientError as e: ov = f"call raised {err(e)}"
now = s3.get_object(Bucket=BUCKET, Key=PROBE_KEY)["Body"].read()
probe_ov_ok = now.startswith(b"DR R/W-token")
print(f"  [probe] OVERWRITE: {ov}  →  read-back: {'ORIGINAL survives ✅' if probe_ov_ok else 'content CHANGED to v2 ❌'}")

print("  -- direct proof on a REAL backup object (regenerable briefing MP3, lowest blast radius) --")
try:
    real_del_ok = survives(REAL_KEY, "real MP3")
except ClientError as e:
    real_del_ok = None; print(f"  [real MP3] head failed ({err(e)}) — key may differ; probe proof stands")

print("\n=== VERDICT ===")
ok = probe_del_ok and probe_ov_ok and (real_del_ok in (True, None))
print("  ✅ STRUCTURAL GUARANTEE HOLDS — this Object R/W token CANNOT delete or overwrite locked objects."
      if ok else "  ❌ GUARANTEE FAILED — a locked object was destroyed/changed. STOP.")
