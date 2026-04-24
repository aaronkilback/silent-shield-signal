-- Dr. Daniel Metzger — entity content cleanup and WPATH elevation
--
-- Problem: osint-entity-scan pulled 130 web_search results for multiple
-- "Daniel Metzger" homonyms (SF acupuncturist, German professor, French
-- molecular biologist, climate change lawyer). These are clearly unrelated
-- and pollute the entity's intelligence picture.
--
-- Action:
--   1. Delete web_search content rows that are clearly about OTHER people
--      (identified by institution/domain markers in title/excerpt)
--   2. Elevate WPATH-related content (genuine high-priority findings) to
--      relevance_score 95 and mark as high_priority in metadata
--   3. Write an ai_assessment to the entity record summarising the real threat picture

DO $$
DECLARE
  metzger_id uuid := '98ac9589-9c92-4835-b34a-3bda23e19258';
  deleted_count int;
BEGIN

  -- ── 1. Delete confirmed homonym noise ─────────────────────────────────
  -- SF acupuncturist (drdanielmetzger.com, DACM, LAc, San Francisco, functional medicine)
  DELETE FROM public.entity_content
  WHERE entity_id = metzger_id
    AND (
      title ILIKE '%DACM%'
      OR title ILIKE '%LAc%'
      OR title ILIKE '%acupuncture%'
      OR title ILIKE '%functional medicine%'
      OR title ILIKE '%San Francisco%'
      OR excerpt ILIKE '%DACM%'
      OR excerpt ILIKE '%acupuncture%'
      OR excerpt ILIKE '%San Francisco%'
      OR source ILIKE '%drdanielmetzger.com%'
    );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % SF acupuncturist rows', deleted_count;

  -- German professor / Cologne University
  DELETE FROM public.entity_content
  WHERE entity_id = metzger_id
    AND (
      title ILIKE '%Köln%'
      OR title ILIKE '%Koln%'
      OR title ILIKE '%WiSo%'
      OR title ILIKE '%Wirtschaft%'
      OR title ILIKE '%Universität%'
      OR excerpt ILIKE '%Köln%'
      OR excerpt ILIKE '%WiSo Faculty%'
      OR excerpt ILIKE '%Wirtschafts%'
    );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % German professor rows', deleted_count;

  -- French/European molecular biologist (Strasbourg, nuclear receptor, mouse research)
  DELETE FROM public.entity_content
  WHERE entity_id = metzger_id
    AND (
      title ILIKE '%Strasbourg%'
      OR title ILIKE '%mTORC%'
      OR title ILIKE '%nuclear receptor%'
      OR title ILIKE '%myelin%'
      OR title ILIKE '%glucocorticoid%'
      OR title ILIKE '%Cre%' -- HSA-Cre(ERT2) mice reference
      OR excerpt ILIKE '%Strasbourg%'
      OR excerpt ILIKE '%HSA-Cre%'
      OR excerpt ILIKE '%mTORC%'
      OR excerpt ILIKE '%glucocorticoid nuclear receptor%'
      OR excerpt ILIKE '%myelin regeneration%'
      OR source ILIKE '%journals.physiology.org%'
      OR source ILIKE '%pmc.ncbi.nlm.nih.gov%'
    );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % molecular biologist rows', deleted_count;

  -- Climate change lawyer (Sabin Center, Vanderbilt)
  DELETE FROM public.entity_content
  WHERE entity_id = metzger_id
    AND (
      title ILIKE '%Sabin Center%'
      OR title ILIKE '%climate change law%'
      OR title ILIKE '%Vanderbilt%'
      OR excerpt ILIKE '%Sabin Center%'
      OR excerpt ILIKE '%climate change law%'
    );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % climate lawyer rows', deleted_count;

  -- AccountAbility / ESG consultant (different Daniel Metzger)
  DELETE FROM public.entity_content
  WHERE entity_id = metzger_id
    AND (
      title ILIKE '%AccountAbility%'
      OR title ILIKE '%Accountability Accelerator%'
      OR excerpt ILIKE '%AccountAbility%'
      OR excerpt ILIKE '%Advisory Services Daniel Metzger%'
    );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % ESG consultant rows', deleted_count;

  -- Generic Facebook/LinkedIn pages for other Daniel Metzgers
  -- (profiles listing multiple people or clearly different individuals)
  DELETE FROM public.entity_content
  WHERE entity_id = metzger_id
    AND content_type = 'web_search'
    AND (
      title ILIKE '%people named Daniel Metzger%'
      OR excerpt ILIKE '%people named Daniel Metzger%'
      OR (source = 'facebook.com' AND title NOT ILIKE '%BC Children%' AND title NOT ILIKE '%WPATH%' AND title NOT ILIKE '%gender%' AND title NOT ILIKE '%transgender%' AND excerpt NOT ILIKE '%puberty blocker%')
    );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % generic social profile rows', deleted_count;

  -- ── 2. Elevate WPATH and activist-campaign findings ───────────────────
  -- These are the real intelligence: his name in leaked WPATH files,
  -- activist media coverage, and lawsuit-adjacent social posts.
  UPDATE public.entity_content
  SET
    relevance_score = 95,
    metadata = metadata || jsonb_build_object(
      'high_priority', true,
      'finding_type', 'wpath_exposure',
      'threat_relevance', 'Named in WPATH Files leak — statements extracted and circulated by anti-gender-medicine activist networks internationally'
    )
  WHERE entity_id = metzger_id
    AND (
      title ILIKE '%WPATH%'
      OR excerpt ILIKE '%WPATH%'
      OR excerpt ILIKE '%WPATH Files%'
      OR source ILIKE '%environmentalprogress.org%'
      OR source ILIKE '%spiked-online.com%'
    );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Elevated % WPATH content rows to high-priority', deleted_count;

  -- Elevate other genuine activist/campaign content (lawsuits, Facebook activist posts)
  UPDATE public.entity_content
  SET
    relevance_score = 88,
    metadata = metadata || jsonb_build_object(
      'high_priority', true,
      'finding_type', 'activist_targeting',
      'threat_relevance', 'Named in activist social media campaigns related to gender-affirming care litigation and opposition'
    )
  WHERE entity_id = metzger_id
    AND (
      (excerpt ILIKE '%lawsuit%' AND (excerpt ILIKE '%gender%' OR excerpt ILIKE '%transgender%'))
      OR (excerpt ILIKE '%puberty blocker%')
      OR (excerpt ILIKE '%Concerned Women for America%')
      OR (source ILIKE '%troymedia.com%')
      OR (source ILIKE '%theclarion.ca%')
      OR (source ILIKE '%benryan.substack.com%')
    )
    AND (metadata->>'high_priority') IS DISTINCT FROM 'true';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Elevated % activist-targeting content rows', deleted_count;

  -- ── 3. Write threat summary to ai_assessment ──────────────────────────
  UPDATE public.entities
  SET ai_assessment = jsonb_build_object(
    'generated_at', now(),
    'risk_summary', 'HIGH — Dr. Metzger is the most publicly exposed member of the BCCH gender clinic team. His statements were extracted from the March 2024 WPATH Files leak and are actively circulated in international anti-gender-medicine activist networks (Environmental Progress, Spiked Online, Troy Media, Ben Ryan Substack). He is named in multiple Facebook-distributed activist posts linked to gender transition lawsuits (Feb–Apr 2026), and appears on RateMDs as a top Vancouver endocrinologist — confirming his personal professional identity is publicly searchable. His Dec 2020 BCCH recognition post (alongside nurse Sharleen Herrmann) publicly links him to specific clinic staff.',
    'key_findings', jsonb_build_array(
      'Named in WPATH Files leak (Mar 2024) — statements extracted and internationally syndicated by activist media',
      'Cited in anti-gender-care Facebook campaigns linked to lawsuits (Feb, Mar, Apr 2026)',
      'Cited by Concerned Women for America Legislative Action Committee',
      'Publicly listed on RateMDs as top Vancouver endocrinologist — personal identity easily verifiable',
      'No evidence of personal data breach (HIBP clean as of scan date)',
      'Public Facebook post names him and Sharleen Herrmann together at BCCH (Dec 2020)'
    ),
    'recommended_actions', jsonb_build_array(
      'Monitor WPATH-adjacent activist platforms (Environmental Progress, Spiked, Troy Media) for new Dr. Metzger citations',
      'Monitor for personal address or contact information appearing on doxbin, pastebin, or activist forums',
      'Advise clinic on social media hygiene — limit future public name associations between staff members',
      'Establish Google Alerts for "Daniel Metzger" + "BCCH", "WPATH", "gender clinic"'
    ),
    'scan_date', now()
  )
  WHERE id = metzger_id;
  RAISE NOTICE 'Updated ai_assessment for Dr. Daniel Metzger';

END $$;

-- Refresh quality score to reflect the elevated content
SELECT refresh_entity_quality_score('98ac9589-9c92-4835-b34a-3bda23e19258');
