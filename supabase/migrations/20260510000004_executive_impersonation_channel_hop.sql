-- executive_impersonation_channel_hop sequence pattern.
-- Adapted from ZeroFox "A Detective's Field Guide to Social Engineering"
-- (May 2026 industry intel). The doc explicitly names the BEC tell:
-- email + SMS/chat + voicemail naming the same exec, all pressuring an
-- urgent action, all within minutes. Multi-channel pressure is what
-- bypasses single-channel filters. Sequence detector windows align
-- well with this — 60 minutes is generous enough to catch the staggered
-- arrivals, tight enough to exclude unrelated coincidence.
--
-- Stages (min 2 of 3 to trigger):
--   1. exec_identity_referenced_email — inbound signal mentioning a
--      client exec, source includes email-class indicators (look-alike
--      domain, gmail/proton, "from:" header in raw_json).
--   2. exec_identity_referenced_secondary — same exec named in an
--      SMS / chat / collaboration-app / voicemail-transcript signal.
--      Different channel from stage 1 is the discriminator.
--   3. urgent_action_request — wire transfer, payroll change, contract
--      approval, vendor banking change, gift card ask. Indicates the
--      "ask" stage of the BEC pattern.
--
-- 60-min window is intentional. The ZeroFox guide notes attackers
-- compress channel-hopping to <1 hour to deny verification time.

INSERT INTO public.sequence_patterns (name, description, stages, window_seconds, min_stages_to_trigger)
VALUES
  (
    'executive_impersonation_channel_hop',
    'Multi-channel BEC pressure: a named client executive is referenced across two or more channels (email + SMS/chat/voicemail) within 60 minutes, accompanied by an urgent financial or access request. Detects the channel-hopping signature ZeroFox flags as the dominant 2025 BEC pattern — specifically targets the executive-protection threat surface for clients with named principals.',
    '[
      {"name":"exec_identity_referenced_email","match":{"keywords":["from CEO","from CFO","from president","CEO requested","CFO approved","executive directive","executive request","wire request","invoice attached","payment update","banking details","vendor change","compromised email","spoofed email","look-alike domain","display name","reply-to mismatch"]}},
      {"name":"exec_identity_referenced_secondary","match":{"keywords":["text from CEO","text message from","SMS impersonation","WhatsApp from","Teams message","Slack DM","voicemail from","voice cloning","deepfake voice","AI-generated voice","cloned voice","video call request","calendar invite from CEO"]}},
      {"name":"urgent_action_request","match":{"keywords":["urgent wire","wire transfer","emergency payment","ASAP transfer","gift card","iTunes card","Apple gift","payroll change","direct deposit change","banking details update","new account","invoice payment","vendor banking","M&A confidential","contract approval needed","do not contact","keep this confidential","do not loop in"]}}
    ]'::jsonb,
    3600,  -- 60 minutes
    2
  )
ON CONFLICT (name) DO NOTHING;

-- Verify
SELECT name, window_seconds/60 AS window_minutes, min_stages_to_trigger, jsonb_array_length(stages) AS n_stages
FROM sequence_patterns
WHERE name = 'executive_impersonation_channel_hop';
