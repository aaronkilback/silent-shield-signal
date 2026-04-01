-- Signal database cleanup
-- Remove junk signal categories
delete from signals where category = 'weather';
delete from signals where category = 'test';
delete from signals where category = 'work_interruption';

-- Fix insider_threat classifier bug: 14 signals all critical is impossible
-- Downgrade to medium unless they mention PECL assets
update signals
set severity = 'medium'
where category = 'insider_threat'
  and severity = 'critical'
  and (normalized_text not ilike '%petronas%'
   and normalized_text not ilike '%pecl%'
   and normalized_text not ilike '%lng canada%'
   and normalized_text not ilike '%coastal gaslink%');

-- Downgrade civil_emergency signals not mentioning PECL assets
update signals
set severity = 'low'
where category = 'civil_emergency'
  and severity in ('critical', 'high')
  and (normalized_text not ilike '%petronas%'
   and normalized_text not ilike '%pecl%'
   and normalized_text not ilike '%fort st john%'
   and normalized_text not ilike '%kitimat%'
   and normalized_text not ilike '%coastal gaslink%');

-- Normalize duplicate category names
update signals set category = 'cybersecurity' where category = 'cyber';
update signals set category = 'protest' where category = 'activism';
