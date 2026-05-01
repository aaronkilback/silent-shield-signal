// accept-operator-invite — public redemption endpoint for AEGIS Mobile
// invite tokens / PINs.
//
// No JWT required (deploy with --no-verify-jwt). Caller passes either
// the long-form `token` (UUID) or the 6-character `pin`. We:
//   1. Look up the invite, verify not used / not expired.
//   2. Create the auth.users row (signUp) with the supplied email +
//      password (or existing user if email already exists).
//   3. Create / update the profiles row with display name + optional
//      last-known location.
//   4. Add to conversation_participants if conversation-scoped.
//   5. Add to client_users + user_roles per scope.
//   6. Mark invite used.
//   7. Return a session so the mobile app can drop the user straight
//      into the chat.
//
// Body:
//   {
//     token?: string,     // either token or pin
//     pin?: string,
//     email: string,
//     password: string,
//     name: string,
//     phone?: string,
//     latitude?: number,  // optional, captured if user grants permission
//     longitude?: number
//   }

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey =
      Deno.env.get("SERVICE_ROLE_JWT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(url, serviceKey);

    const body = await req.json();
    const tokenOrPin: string =
      typeof body.token === "string" && body.token.length > 12
        ? body.token
        : (body.pin ?? body.token ?? "").toString().toUpperCase();

    if (!tokenOrPin) {
      return new Response(JSON.stringify({ error: "missing token or pin" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const email: string = (body.email ?? "").toString().trim().toLowerCase();
    const password: string = (body.password ?? "").toString();
    const name: string = (body.name ?? "").toString().trim();
    const phone: string | null = body.phone ? String(body.phone).trim() : null;
    const lat: number | null = typeof body.latitude === "number" ? body.latitude : null;
    const lng: number | null = typeof body.longitude === "number" ? body.longitude : null;

    if (!email || !password || !name) {
      return new Response(JSON.stringify({ error: "email, password, and name are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: "password must be at least 8 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up invite by token (UUID-shape) or PIN (6 chars)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tokenOrPin);
    const lookup = admin
      .from("operator_invites")
      .select("id, token, pin, conversation_id, client_id, role, expires_at, used_at")
      .limit(1);
    const { data: invites, error: lookErr } = isUuid
      ? await lookup.eq("token", tokenOrPin)
      : await lookup.eq("pin", tokenOrPin.toUpperCase());
    if (lookErr || !invites?.[0]) {
      return new Response(JSON.stringify({ error: "invite not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const invite = invites[0];

    if (invite.used_at) {
      return new Response(JSON.stringify({ error: "invite has already been used" }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (new Date(invite.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "invite has expired" }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create or fetch user
    let userId: string;
    const { data: createUser, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, phone, invited_via_operator_invite: invite.id },
    });
    if (createErr || !createUser?.user) {
      // If user exists, sign in to validate password (do NOT silently
      // grant access without password match)
      const exists = (createErr?.message ?? "").toLowerCase().includes("already") ||
                     (createErr?.message ?? "").toLowerCase().includes("registered");
      if (!exists) {
        console.error("[accept-operator-invite] createUser failed:", createErr);
        return new Response(JSON.stringify({ error: createErr?.message ?? "could not create user" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(url, anonKey);
      const { data: signIn, error: signErr } = await userClient.auth.signInWithPassword({
        email,
        password,
      });
      if (signErr || !signIn?.user) {
        return new Response(JSON.stringify({ error: "email already in use; password did not match" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = signIn.user.id;
    } else {
      userId = createUser.user.id;
    }

    // Upsert profile (Fortress profiles use `name`)
    await admin
      .from("profiles")
      .upsert(
        {
          id: userId,
          name,
          last_known_lat: lat,
          last_known_lng: lng,
          last_known_loc_at: lat != null && lng != null ? new Date().toISOString() : null,
        },
        { onConflict: "id" }
      );

    // Conversation-scoped: add to participants
    if (invite.conversation_id) {
      await admin
        .from("conversation_participants")
        .upsert(
          { conversation_id: invite.conversation_id, user_id: userId },
          { onConflict: "conversation_id,user_id" }
        );
    }

    // Client-scoped: add to client_users
    if (invite.client_id) {
      await admin
        .from("client_users")
        .upsert(
          { client_id: invite.client_id, user_id: userId },
          { onConflict: "client_id,user_id" }
        )
        .then(
          () => {},
          (e) => console.warn("[accept-operator-invite] client_users insert:", e)
        );
    }

    // Role
    if (invite.role) {
      await admin
        .from("user_roles")
        .upsert(
          { user_id: userId, role: invite.role },
          { onConflict: "user_id,role" }
        );
    }

    // Mark invite consumed
    await admin
      .from("operator_invites")
      .update({ used_at: new Date().toISOString(), used_by_user_id: userId })
      .eq("id", invite.id);

    // Sign in to return a session so the client lands authenticated
    const userClient = createClient(url, anonKey);
    const { data: session } = await userClient.auth.signInWithPassword({ email, password });

    return new Response(
      JSON.stringify({
        user_id: userId,
        conversation_id: invite.conversation_id,
        client_id: invite.client_id,
        role: invite.role,
        access_token: session?.session?.access_token ?? null,
        refresh_token: session?.session?.refresh_token ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[accept-operator-invite] unhandled:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
