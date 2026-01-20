
-- Backfill historical AI assistant messages into tenant_activity
INSERT INTO tenant_activity (tenant_id, user_id, activity_type, resource_type, resource_id, resource_name, description, metadata, created_at)
SELECT 
  m.tenant_id,
  m.user_id,
  'create' as activity_type,
  'chat' as resource_type,
  m.id as resource_id,
  m.title as resource_name,
  'Sent message to AI assistant' as description,
  jsonb_build_object('role', m.role, 'conversation_id', m.conversation_id) as metadata,
  m.created_at
FROM ai_assistant_messages m
WHERE m.user_id NOT IN (SELECT user_id FROM user_roles WHERE role = 'super_admin')
  AND m.role = 'user'
  AND m.tenant_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill historical audit events into tenant_activity (cast resource_id from text to uuid)
INSERT INTO tenant_activity (tenant_id, user_id, activity_type, resource_type, resource_id, resource_name, description, metadata, created_at)
SELECT 
  a.tenant_id,
  a.user_id,
  a.action as activity_type,
  a.resource as resource_type,
  CASE 
    WHEN a.resource_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
    THEN a.resource_id::uuid 
    ELSE NULL 
  END as resource_id,
  NULL as resource_name,
  a.action || ' on ' || a.resource as description,
  a.metadata,
  a.created_at
FROM audit_events a
WHERE a.user_id NOT IN (SELECT user_id FROM user_roles WHERE role = 'super_admin')
  AND a.tenant_id IS NOT NULL
ON CONFLICT DO NOTHING;
