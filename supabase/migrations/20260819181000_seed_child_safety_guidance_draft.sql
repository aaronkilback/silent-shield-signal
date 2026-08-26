-- DRAFT seed for child_safety_guidance (Phase 1 step 2). AI-drafted from operator spec + public guidance.
-- Every row reviewed_by='DRAFT — pending professional review' — it is NOT signed content. It renders with a
-- visible DRAFT banner and the staleness probe fires on it regardless of age until a child-safety
-- professional (see WO named dependency) reviews it. Escalation rows: review_interval_months=3.
insert into public.child_safety_guidance (section, key, title, content, display_order, is_emergency, review_interval_months, reviewed_by) values

('framing','stranger_danger_wrong','The stranger-danger model is wrong',
 jsonb_build_object('body','In the cases where children physically met someone they first met online, 100% went willingly. Predators do not present as strangers — they build familiarity and trust first, so by the time a meeting is proposed the child does not experience them as a stranger. Teaching "don''t talk to strangers" does not address how this actually happens.'),
 10,false,6,'DRAFT — pending professional review'),

('framing','grooming_can_be_fast','Grooming can happen in under a week',
 jsonb_build_object('body','"Watch for a slow pattern" is wrong advice. CEOP has documented cases where the entire grooming cycle — first contact to attempted abuse — occurred in under a week. Do not assume you have weeks to notice a gradual change.'),
 20,false,6,'DRAFT — pending professional review'),

('platform','roblox','Roblox',
 jsonb_build_object(
   'risk_profile','Very large young user base; in-experience chat and private servers; the Robux economy is a common grooming and gift vector.',
   'contact_patterns', jsonb_build_array('Adults posing as peers inside popular experiences','Moving chat into private servers away from moderation','Offering Robux or premium items as gifts'),
   'verifiable_settings', jsonb_build_array('Turn Account Restrictions ON (limits to curated content and contacts)','Set an Account PIN so the child cannot change safety settings','Set chat and contact permissions by age — and verify the declared age is correct','Review the child''s friends list and any private-server access')),
 100,false,6,'DRAFT — pending professional review'),

('platform','minecraft','Minecraft',
 jsonb_build_object(
   'risk_profile','Public multiplayer servers carry unmoderated chat and voice; private realms are controllable.',
   'contact_patterns', jsonb_build_array('Contact on a public server then a push to Discord or DMs','Befriending on a server then requesting private contact'),
   'verifiable_settings', jsonb_build_array('Use a private invite-only Realm rather than public servers','Restrict or disable multiplayer and chat in account/family settings','Review who is on the Realm allow-list','On console, set communication to Friends-only via the platform family settings')),
 110,false,6,'DRAFT — pending professional review'),

('platform','discord','Discord',
 jsonb_build_object(
   'risk_profile','Direct messages and server joins are the primary risk; default DM filtering is weak and the adult population is large.',
   'contact_patterns', jsonb_build_array('A DM after meeting on a game or server','An invite to a private server','Requests for images or a move to Snapchat/Telegram'),
   'verifiable_settings', jsonb_build_array('Enable the "Keep me safe" DM content filter (scans all direct messages)','Turn OFF "Allow direct messages from server members" by default','Restrict who can add the child as a friend to Friends-of-Friends or none','Review joined servers and remove unknown ones')),
 120,false,6,'DRAFT — pending professional review'),

('platform','snapchat','Snapchat',
 jsonb_build_object(
   'risk_profile','Ephemeral content reduces evidence; Snap Map can share location; Quick Add surfaces strangers.',
   'contact_patterns', jsonb_build_array('Location-based contact via Snap Map','Quick Add suggestions connecting the child to strangers','Requests for disappearing images (a common sextortion vector)'),
   'verifiable_settings', jsonb_build_array('Enable Ghost Mode so location is NOT shared on Snap Map','Set "Contact Me" and "See My Location" to Friends-only or Only Me','Turn off Quick Add visibility','Review the friends list for unknown accounts')),
 130,false,6,'DRAFT — pending professional review'),

('cross_platform','migration_signal','Cross-platform migration — the highest-value warning signal',
 jsonb_build_object('body','Contact that starts in a moderated game (Roblox, Minecraft) and then moves to weaker-moderation private messaging (Discord DMs, Snapchat, Telegram, WhatsApp) is the single strongest warning sign. Moderation and evidence both drop at the moment of the move — which is exactly why a predator pushes for it. If a child mentions a new online friend who wants to talk somewhere else, treat it as significant.'),
 200,false,6,'DRAFT — pending professional review'),

('cross_platform','ingame_currency','In-game currency is the gift signal',
 jsonb_build_object('body','Parents watch for physical gifts and miss that the transaction is digital. Robux, V-Bucks, gift cards, or a suddenly upgraded or premium account can be the grooming gift. A child receiving in-game currency or premium items from an online contact is the same warning as an adult buying a child physical presents.'),
 210,false,6,'DRAFT — pending professional review'),

('cross_platform','age_settings','Age-accurate account settings',
 jsonb_build_object('body','Platforms apply protections based on the age an account declared at signup. A child who signed up as 18 has silently disabled every age-based safeguard — content filters, contact restrictions, and default privacy. Verify the declared age on each account matches the child''s real age; if it does not, the protections you assume are on are off.'),
 220,false,6,'DRAFT — pending professional review'),

('protocol','warning_signs','Warning signs — sustained change with secrecy, not single bad days',
 jsonb_build_object('body','The reliable signal is a sustained change over weeks paired with secrecy or distress around devices — hiding the screen, anxiety when a device is taken away, a new online friend they will not discuss, staying up to be online. A single bad day, ordinary teenage moodiness, or simply wanting more privacy are NOT warning signs; confusing normal development with danger leads a parent to either miss the real signal or panic at nothing. Because grooming can also be fast, a sudden and intense new secrecy is worth attention too — the pattern is secrecy plus change, not duration alone.'),
 300,false,6,'DRAFT — pending professional review'),

('protocol','no_confront','Do not confront the predator',
 jsonb_build_object('body','A parent''s instinct is to message or confront the account. Do not. It tips the predator off — they delete the account and the evidence, block, and the case dies — and it can escalate risk to the child. Preserve evidence first, involve the platform and authorities, and never contact the account yourself.'),
 310,false,6,'DRAFT — pending professional review'),

('protocol','evidence_first','Preserve evidence before any action',
 jsonb_build_object('body','Before confronting your child, changing settings, or reporting: document and preserve. Screenshot the conversations, profiles, usernames, and any images or requests; record dates, times, and the platform. Do not delete anything. Evidence preserved now is what lets authorities and platforms act — evidence lost cannot be recovered.'),
 320,false,6,'DRAFT — pending professional review'),

('protocol','sextortion','Sextortion — emergency protocol',
 jsonb_build_object('body','Sextortion is distinct from grooming, time-critical, and the correct response is counterintuitive. A perpetrator — often posing as a peer — obtains an intimate image and then threatens to share it unless paid or sent more. Financial sextortion of teenage boys is the fastest-growing variant and most parents have never heard of it. If it is happening: DO NOT PAY (payment increases demands, it does not end them). DO NOT DELETE anything (the evidence is needed). PRESERVE everything — screenshots, usernames, payment demands. REPORT IMMEDIATELY (Cybertip.ca / NCMEC). Reassure the child they are not in trouble and that paying or sending more will not fix it. Speed matters.'),
 330,true,6,'DRAFT — pending professional review'),

('protocol','rehearsed_protocol','The rehearsed family protocol',
 jsonb_build_object('body','Agree as a household, BEFORE it is needed, what to do — and rehearse it. The agreement: if anyone online asks to move to another app, asks for a photo, or asks them to keep a secret from you, they tell you — and they will NEVER be in trouble for telling you. That last part is the point; children stay silent because they fear blame or losing their device, so remove that fear in advance. We do not react in the moment; we rehearse so the child already knows what to do.'),
 340,false,6,'DRAFT — pending professional review'),

('escalation','cybertip','Cybertip.ca / Project Arachnid',
 jsonb_build_object('org','Cybertip.ca — Canadian Centre for Child Protection','contact','1-866-658-9022 · cybertip.ca','note','Canada''s tipline for online child sexual exploitation. Project Arachnid issues takedown notices to hosts — this works against the content regardless of where the perpetrator is located, which matters when police say a foreign jurisdiction puts it beyond reach.'),
 400,false,3,'DRAFT — pending professional review'),

('escalation','ncmec_takeitdown','NCMEC — Take It Down',
 jsonb_build_object('org','NCMEC — Take It Down','contact','takeitdown.ncmec.org','note','Free service to help stop the online sharing of nude or partially-nude images of a minor. Works from a hash of the image, so the image itself is not uploaded or shared further.'),
 410,false,3,'DRAFT — pending professional review'),

('escalation','needhelpnow','NeedHelpNow.ca',
 jsonb_build_object('org','NeedHelpNow.ca','contact','needhelpnow.ca','note','Canadian guidance and support for youth and parents on removing shared intimate images and on coping steps.'),
 420,false,3,'DRAFT — pending professional review'),

('escalation','rcmp_ncecc','RCMP National Child Exploitation Crime Centre',
 jsonb_build_object('org','RCMP National Child Exploitation Crime Centre (NCECC)','contact','Report via Cybertip.ca or local police; NCECC is the national law-enforcement coordination point','note','For law-enforcement action. Preserve evidence before reporting.'),
 430,false,3,'DRAFT — pending professional review'),

('escalation','platform_reporting','The platform''s own reporting',
 jsonb_build_object('org','The platform''s own reporting tools','contact','In-app report and block tools on each platform','note','Report the account and content in-app as well — platforms can action accounts and preserve their own logs. Do this in addition to, not instead of, Cybertip and NCMEC.'),
 440,false,3,'DRAFT — pending professional review')

on conflict (section, key) do nothing;
