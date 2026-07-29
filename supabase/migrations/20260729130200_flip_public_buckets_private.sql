-- WO-SENTINEL item 3 ruling: flip 3 empty public buckets to private (applied prod 2026-07-29).
-- agent-avatars = doctrine drift (CLAUDE.md says private+signed); message-attachments obvious.
-- email-assets re-earns public ONLY if outbound email later embeds hosted images.
update storage.buckets set public=false where id in ('email-assets','message-attachments','agent-avatars');
