-- former_employee_fixation sequence pattern.
--
-- Driven by the Vashouk / @NeoIntel7 case (2026-05-11): former PECL
-- Supply Chain Analyst terminated in 2022 over vaccine mandate,
-- maintained 4-year fixation on Mark Fitzgerald + PECL executives,
-- shared internal PECL documents online, pro-Iranian rhetoric
-- alignment. The 3Si 2024 report flagged this individually; Fortress
-- should flag it as a recognized PATTERN going forward.
--
-- Stages (min 2 of 3 to trigger):
--   1. grievance_communication — termination / wrongful-dismissal /
--      reinstatement-denial / former-employee language tied to the
--      client. Anchor mechanism (already in detector) groups by
--      client-specific terms.
--   2. executive_or_company_targeting — content naming the company or
--      its executives with hostile / accusatory tone. We can't put
--      per-client exec names in a global pattern, so we rely on the
--      anchor grouping + generic hostile-tone phrases.
--   3. foreign_alignment_amplifier — signal triggered foreign-
--      alignment scoring (score >= 0.3 OR carries any state-media /
--      rhetoric indicator). Uses the new stageMatches extension
--      (foreign_alignment_min / foreign_alignment_indicators).
--
-- 180-day window is intentional — fixation patterns are months-to-
-- years, not minutes-to-hours. Min 2 stages so even without foreign
-- alignment the grievance + targeting combination flags.

BEGIN;

INSERT INTO public.sequence_patterns (name, description, stages, window_seconds, min_stages_to_trigger)
VALUES
  (
    'former_employee_fixation',
    'A former employee or contractor maintains a persistent grievance against the client, surfacing across multiple signals as: termination / wrongful-dismissal language, hostile or accusatory mentions of the company or its executives, and (often) ideological amplification via foreign-state-media-aligned content. Window: 180 days. Driven by the Vashouk / @NeoIntel7 case (2026-05-11) where the 3Si 2024 report flagged identity obfuscation + Iranian alignment but no automated pattern existed.',
    '[
      {
        "name":"grievance_communication",
        "match":{
          "keywords":[
            "terminated","let go","wrongful dismissal","wrongful termination",
            "fired without cause","unfair dismissal","denied reinstatement",
            "reinstatement denied","reinstatement application",
            "vaccine mandate","vax mandate","mandate-related termination",
            "former employee","ex-employee","ex-staff","retaliated against",
            "blacklisted","kept off the rehire list","placed on a list",
            "anti-corporate","whistleblower","retaliation","wrongfully",
            "denied my appeal","unjust firing","union grievance"
          ]
        }
      },
      {
        "name":"executive_or_company_targeting",
        "match":{
          "keywords":[
            "should be punished","deserves to","accountable","held to account",
            "exposed","brought down","held responsible","made an example",
            "criminal","corrupt","evil","unethical","fraud","scam",
            "incompetent","liar","predator","power-hungry",
            "vendetta","grudge","unfinished business","scores to settle",
            "comeuppance","reckoning","day of judgment","will pay",
            "rain punishment","will burn","face justice","face the music",
            "wraps around","watch out","you''ll see","when this comes out"
          ]
        }
      },
      {
        "name":"foreign_alignment_amplifier",
        "match":{
          "foreign_alignment_min": 0.3
        }
      }
    ]'::jsonb,
    15552000,  -- 180 days
    2
  )
ON CONFLICT (name) DO NOTHING;

-- Verify
SELECT name, window_seconds/86400 AS window_days, min_stages_to_trigger, jsonb_array_length(stages) AS n_stages
FROM sequence_patterns
WHERE name = 'former_employee_fixation';

COMMIT;
