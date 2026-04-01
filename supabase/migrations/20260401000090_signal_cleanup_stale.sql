-- Delete signals older than 21 days that are not directly PECL-relevant
delete from signals
where created_at < now() - interval '21 days'
and severity in ('low', 'medium')
and normalized_text not ilike '%petronas%'
and normalized_text not ilike '%pecl%'
and normalized_text not ilike '%lng canada%'
and normalized_text not ilike '%coastal gaslink%';

-- Delete human interest follow-up stories with no operational security value
delete from signals
where (
  normalized_text ilike '%maya gebala%'
  or normalized_text ilike '%recovering from%'
  or normalized_text ilike '%moved from intensive care%'
  or normalized_text ilike '%rehabilitation unit%'
  or normalized_text ilike '%health centre reopening%'
  or normalized_text ilike '%FIFA world cup%'
  or normalized_text ilike '%firefighting equipment%grant%'
  or normalized_text ilike '%water supply system project%'
  or normalized_text ilike '%poor boy trucking%'
)
and severity in ('low', 'medium');

-- Delete social sentiment signals that are purely community/health news
delete from signals
where category = 'social_sentiment'
and severity = 'low'
and normalized_text not ilike '%petronas%'
and normalized_text not ilike '%pecl%'
and normalized_text not ilike '%lng%'
and normalized_text not ilike '%pipeline%'
and normalized_text not ilike '%energy%';
