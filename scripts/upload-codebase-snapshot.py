#!/usr/bin/env python3
"""
Upload edge function source files to Supabase Storage (codebase-source bucket)
so wraith-snapshot-codebase can read them for vulnerability scanning.

Run this after deploying functions:
  python3 scripts/upload-codebase-snapshot.py

Requires: SUPABASE_SERVICE_ROLE_KEY env var or pass as argument.
"""

import os, sys, urllib.request, urllib.parse, json

SUPABASE_URL = "https://kpuqukppbmwebiptqmog.supabase.co"
BUCKET = "codebase-source"

SCAN_TARGETS = [
    "supabase/functions/ingest-signal/index.ts",
    "supabase/functions/ai-decision-engine/index.ts",
    "supabase/functions/correlate-entities/index.ts",
    "supabase/functions/incident-action/index.ts",
    "supabase/functions/_shared/handlers-signals-incidents.ts",
]

def upload(service_role_key: str, file_path: str):
    abs_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), file_path)
    if not os.path.exists(abs_path):
        print(f"  ✗ NOT FOUND: {file_path}")
        return False

    with open(abs_path, "rb") as f:
        content = f.read()

    storage_path = urllib.parse.quote(file_path, safe="")
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{file_path}"

    req = urllib.request.Request(
        url,
        data=content,
        headers={
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "text/plain; charset=utf-8",
            "x-upsert": "true",
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"  ✓ {file_path} ({len(content):,} bytes)")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        print(f"  ✗ {file_path}: HTTP {e.code} — {body}")
        return False

def main():
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or (sys.argv[1] if len(sys.argv) > 1 else None)
    if not service_role_key:
        print("ERROR: Set SUPABASE_SERVICE_ROLE_KEY env var or pass as first argument")
        sys.exit(1)

    print(f"Uploading {len(SCAN_TARGETS)} files to Supabase Storage ({BUCKET})...")
    success = sum(upload(service_role_key, f) for f in SCAN_TARGETS)
    print(f"\nDone: {success}/{len(SCAN_TARGETS)} uploaded")
    if success < len(SCAN_TARGETS):
        sys.exit(1)

if __name__ == "__main__":
    main()
