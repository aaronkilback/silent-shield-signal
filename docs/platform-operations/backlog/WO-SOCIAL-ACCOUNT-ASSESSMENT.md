# WO-SOCIAL-ACCOUNT-ASSESSMENT — assess supplied social accounts, don't just name-search

**Status:** LOGGED, NOT BUILT (operator ruling 2026-08-19: "agreed it needs its own design pass. Log it, do not build.").

## The gap
VIP intake captures the subject's social handles (`socialMediaHandles`, parsed to `{platform: handle}`
in `vip-deep-scan`). The subject-retrieval battery searches the subject's **name** generically against
social platforms; the supplied handles are used in exactly ONE place — `isSelfPublished()` path-matching
to classify a *discovered* URL as the subject's own account (`_shared/subject-retrieval.ts`
`deriveHandles`/`isSelfPublished`). **Nothing takes a supplied handle and assesses that account:** no
public/private determination, no post sampling, no geotag/location/routine inference. Confirmed by
absence across subject-retrieval + vip-deep-scan (Explore sweep 2026-08-19).

## Why it needs its own design pass (not a bolt-on)
The assessment we scoped — "is this account public or private, what is published, are posts geotagged,
is location/routine inferable" — requires per-platform account access:
- **Instagram / Facebook:** largely closed without Graph API + granted permissions; public-profile
  scraping has real ToS + legal exposure.
- **X:** has an API but it is budget-gated and the X monitor was retired 2026-05-22 (Phase X-1 budget).
- **Geotag/routine inference** is a distinct capability (EXIF/location extraction + pattern analysis) with
  its own privacy/legal weight.

This is a genuine MISSING capability, not a bug — it belongs in a Module (call it #1c, handle-assessment)
with its own ToS/access/legal design, not folded into reputational retrieval.

## Cross-refs
`_shared/subject-retrieval.ts` (deriveHandles/isSelfPublished); `vip-deep-scan` (socialMediaHandles parse);
retired X monitor (CLAUDE.md "Twitter API v2 RETIRED 2026-05-22").
