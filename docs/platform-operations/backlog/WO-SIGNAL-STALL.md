# WO-SIGNAL-STALL — zero signals in 24h; is collection dark or is ingest broken?

**Status:** report only. **Do NOT fix.** **Opened:** 2026-08-31.

## The trigger
Today's briefing: **zero signals in 24 hours**. `monitor-twitter` dark for the comparison period; **4
monitors failed** during the window. The platform is not currently monitoring.

## Questions (Step 1)
1. Which 4 monitors failed, and with what error.
2. When did `monitor-twitter` go dark, and why.
3. Is the zero-signal condition explained ENTIRELY by those five, or is **ingest broken downstream of
   collection** (collection running, writes failing)?
4. Last successful signal write: timestamp and source.

## Do NOT
Report only. Do not restart monitors, do not re-enable anything, do not touch the pipeline.
