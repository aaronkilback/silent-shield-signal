# Client Membership Substrate v1

This is a local substrate only. It creates the authoritative membership primitive for a later authorization recovery, but it does not switch existing client-data RLS, realtime, Edge Function, Aegis, voice, briefing, report, or agent retrieval behavior.

## Authority Contract

- `profiles.client_id` is not an authorization source.
- `tenant_users` establishes tenant participation only. It must not expand a user to every client in that tenant.
- `client_memberships` is the client grant.
- Browser-selected `client_id` is only a filter after membership is verified.
- Service-role Edge Functions must validate the caller JWT, then query the same `client_memberships` source using the validated caller user id and selected client id. This substrate intentionally does not add a public arbitrary-user lookup RPC.

## Backfill Plan, Not Executed

No membership is backfilled automatically in this slice.

Possible candidates for owner review:

- Users in a tenant that has exactly one active client may be candidates for that single client, but still require owner confirmation before insertion.
- Users in tenants with more than one client are ambiguous and must be denied by default until an owner assigns explicit client memberships.
- Users whose only client evidence is `profiles.client_id` are ambiguous because profile data is not authoritative.
- Users with only tenant-level admin, analyst, or viewer role are ambiguous for client intelligence access until explicit client membership exists.
- Any client with null or inconsistent `tenant_id` must be corrected or excluded before membership creation.

## Future Rollout Dependency

Later slices must separately:

- Replace `get_user_accessible_client_ids` usage in client-data RLS.
- Add RLS policies that use `has_active_client_membership(client_id)` plus a separate protected `is_super_admin(auth.uid())` bypass where approved.
- Update service-role Edge Functions to validate caller JWT and enforce the same client membership source before any privileged read.
- Validate same-tenant Client A / Client B denial through direct PostgREST, realtime, RPC, Edge Functions, Aegis, reports, briefings, and voice retrieval.

