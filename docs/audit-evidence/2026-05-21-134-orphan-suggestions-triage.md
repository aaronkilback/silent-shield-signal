# #134 Orphan Pending Suggestions — Triage Export

Generated: 2026-05-21 post prod rollout.

After backfill migration + ISIS-K manual assignment, **46 pending entity_suggestions remain with tenant_id=NULL** on prod. They were created via the AEGIS / agent-chat / aegis_ai paths with synthetic `source_id` (random UUID, no FK chain to a tenant-bearing source), and `created_by` is NULL. Aaron's instruction: do not bulk-assign; export for analyst triage.

Two cohorts visible in the data:

## Cohort A — Bulk threat-org library load (2026-05-21 17:49)
~30 rows, all `source_type='ai_assistant'`, created seconds apart, all confidence=0.85, all `context='Created via AI Assistant: No description provided'`. Looks like a batch-load of canonical threat group reference entities. Likely intended as a global reference library OR for the Silent Shield Operations tenant.

| name | type | id |
|---|---|---|
| Lashkar-e-Jhangvi | organization | dd9ebffa-00d1-4685-9829-0d3fce90d5b9 |
| Harakat ul-Mudjahidin | organization | 91024363-3734-4eeb-9faf-e6775f00880f |
| Jemaah Islamiyah | organization | 423bd666-d43f-4a74-b414-d2a01b5ee7d2 |
| Islamic State - Sinai Province | organization | 6ce36438-1491-4d07-aff5-8fad996bc1e4 |
| Militant Far-Left / Anarchist Direct Action Networks | organization | 51197ae3-5364-48c2-8df4-7cd58cc7abf9 |
| Active Club Networks | organization | 10bf600f-e915-40b6-bf75-ece8a6f93dba |
| Haqqani Network | organization | 81a9493f-71c3-4274-ad93-32919e3e465e |
| Palestine Liberation Front | organization | 8678d6a5-10c0-4aea-9c65-b84fa8b43adf |
| Islamic State - Bangladesh | organization | e316e05e-8d09-4f03-979d-accee00b46d1 |
| The Base | organization | 1845dbeb-f238-423d-b89b-ab578093be9d |
| Al-Gama'a al-Islamiyya | organization | 75bdccde-3829-4362-9e2e-41e2763b9085 |
| Ansar Dine | organization | 1a327ca0-ef71-422d-9767-f4d2f7dc443b |
| Movement for Oneness and Jihad in West Africa | organization | 22870484-4a7b-4a64-8dc5-f49742f7bccd |
| Boko Haram | organization | f71baee8-4625-4647-9603-c4dcba4c5089 |
| Caucasus Emirate | organization | a4aa9595-7f63-4ccd-88a0-9fa949437b21 |
| Sinaloa Cartel | organization | 2a755e89-c21b-4e44-a8ee-90ae8e0b005c |
| Lashkar-e-Tayyiba | organization | d4dd91d3-1e1c-41b5-b906-15d3737ef9e4 |
| Al-Shabaab | organization | 6d23d455-8af0-45b3-82db-42ffd2a42612 |
| Islamic Movement of Uzbekistan | organization | 56991b0e-a536-4ac9-8e5e-2ffbd4210fc1 |
| Jaish-e-Mohammed | organization | bf136c81-8269-475a-a759-d3dca45d4050 |
| Ansar al-Islam | organization | f66c8833-a6a1-43ef-bdd4-f590daee7196 |
| Ansarallah | organization | b7be7a19-abee-4b00-b0fe-3c8efe1605b9 |
| Jalisco New Generation Cartel | organization | 6e7d55b2-47c0-45ce-80e0-d88c7e038268 |
| Al-Qaeda | organization | 708b789c-dc52-4d35-9ffc-849bf8e5c7f5 |
| Islamic Revolutionary Guard Corps | organization | 43f6467d-d2fe-41e6-867c-daeea77c2bc9 |
| Atomwaffen Division | organization | cc7057c2-ce7f-4652-9e03-8b2629d8da80 |
| Islamic Revolutionary Guard Corps - Quds Force | organization | 57133a45-961e-431b-862e-0f61fd893cd4 |
| Hezbollah | organization | 37c68494-67b4-4e51-a4ea-2fb8ab8a89ef |
| ISIS Core | organization | 852282c1-6a26-4e35-99b8-57ef46d0eb12 |
| Palestinian Islamic Jihad | organization | 74b2392b-7052-4f20-866c-2f4a043b0db4 |
| Russian Imperial Movement | organization | e4f8df03-f0b9-4fb1-99a4-c533c1b0d857 |
| Tehrik-e-Taliban Pakistan | organization | 435adc7b-3c5e-4f11-ab02-aefd037818bf |
| Popular Front for the Liberation of Palestine | organization | 6d8eddd6-4b65-4fb7-8698-762c28a5974d |
| Popular Front for the Liberation of Palestine - General Command | organization | e285ccad-6477-4b4a-ac67-a45bfdd03016 |
| Nationalist-13 | organization | 83c1d80a-3f54-4516-8fdb-123ab839dcf4 |

## Cohort B — BC/Vancouver advocacy & civil-society orgs (2026-05-21 17:49)
~12 rows, same batch. Likely intended for **CRT** or **Silent Shield Operations**:

| name | type | id |
|---|---|---|
| Carnegie Community Action Project | organization | 8ae6b348-568b-4c83-b0d2-264f2e7fb77a |
| BC Federation of Labour | organization | 9ffee5ac-af6a-4a65-bf1a-fc035eaf40c4 |
| BC Civil Liberties Association | organization | 6b4d85cd-0cc8-41de-bfbc-cb9459060e7a |
| West Coast Environmental Law | organization | 9c929129-dd9c-4be6-baf8-9cdfbdf275e9 |
| Disability Alliance BC | organization | d8a92776-d19b-4170-ab3e-9301544bf34c |
| Vancouver Island Human Rights Coalition | organization | 8554f334-40b4-4390-bde0-8a8b2fb8cd01 |
| Vancouver Area Network of Drug Users | organization | 53fda3ff-8c96-4e79-a298-aac091befdcc |
| BC Poverty Reduction Coalition | organization | 6ad909dc-a224-4740-ad17-ce235a11bdc4 |
| Pivot Legal Society | organization | 01a156c7-3f71-4918-9b4c-d9445c764346 |
| Vancouver Tenants Union | organization | 2ee2af38-d14d-45c4-a257-1633c1eb427c |
| BC ACORN | organization | 123beb9c-7628-4c0b-8d5e-4a4ff8211417 |

## Cohort C — Other (1 row)
| name | type | source_type | id |
|---|---|---|---|
| Social Intelligence | person | signal | d4da5b47-f04f-4bdb-9c41-ad41defb892c |
(Signal-extracted row from `ad7b0a47-a58a-4795-ab81-a1cc16ff5403` — the source signal exists but has NULL tenant_id, so backfill couldn't resolve.)

## Recommended assignment per cohort

- **Cohort A (global threat reference library)**: assign to **Silent Shield Operations** tenant (`feff5c44-c77b-4e02-b247-aa5a44a8b751`) — these are platform-wide reference threat groups, not client-specific.
- **Cohort B (BC advocacy orgs)**: same — assign to **Silent Shield Operations**. These look like a Vancouver activism reference library; not BC Place / Trent-protection specific.
- **Cohort C (Social Intelligence)**: probably noise; recommend reject + delete OR assign to Silent Shield Operations as low-quality reference.

When Aaron confirms cohort assignments, the cleanup SQL is one statement per cohort:
```sql
UPDATE public.entity_suggestions SET tenant_id='feff5c44-c77b-4e02-b247-aa5a44a8b751'
WHERE id IN ('...', '...');
```

Or, if you want to bulk-resolve everything that's clearly platform reference data:
```sql
UPDATE public.entity_suggestions
SET tenant_id='feff5c44-c77b-4e02-b247-aa5a44a8b751'
WHERE tenant_id IS NULL
  AND status='pending'
  AND source_type IN ('ai_assistant')
  AND created_at >= '2026-05-21 17:00';  -- the batch window
```
