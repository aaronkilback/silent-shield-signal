# WO-MEDIA-TITLE-RELEVANCE — headline-verbatim media titles can read as unrelated to the subject

**Status:** LOGGED (do not fix). **Opened:** 2026-08-31 (WO-SWEEP-CATEGORY-MAPPING build).
**Class:** known limit of headline-verbatim titling, not a defect.

## The limit
The media-path title rule uses the article **headline verbatim** — correct for honesty (we never invent a
title). First awkward case: the Vancouver Sun coverage of the Olynyk prosecution is titled
**"Prosecution policy comes back to bite Liberals"** (`202773a2`, media, correctly classified; the subject
line underneath names both parties). The headline is about *policy*, not about the subject. After
WO-SWEEP-CATEGORY-MAPPING it appears **five times** in Section 7 (legal / media / corporate / property /
social all contributed to it) where the subject line does NOT follow it — so a reader may not connect the
headline to themselves.

## Why it is not fixed here
- Not a defect in the mapping fix — the mapping faithfully reports that one story was surfaced five ways, and
  the repeated title is the honest signal that it IS one story.
- Headline-verbatim is the correct honesty rule; "fixing" it by rewriting titles reintroduces fabrication.

## Revisit trigger
If this recurs on other subjects (a headline that does not name or obviously concern the subject leading a
media finding), consider appending the extracted subject line to the Section-7 contribution reference, or a
short "(re: you)" qualifier derived from the M1∧M2 subject-line the media gate already extracts. Do NOT
rewrite the headline.

## Do NOT
Do not fix. Log only. Revisit on recurrence.
