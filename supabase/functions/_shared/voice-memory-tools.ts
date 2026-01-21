import {
  fetchUserMemory,
  formatMemoryForPrompt,
  saveMemory,
  upsertPreferences,
  upsertProject,
} from "./user-memory.ts";

async function getUserIdFromRequest(req: Request, supabase: any): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

export async function executeVoiceMemoryTool(opts: {
  req: Request;
  // `any` avoids cross-version supabase-js type incompatibilities.
  supabase: any;
  toolName: string;
  toolArgs: Record<string, any>;
}): Promise<{ handled: boolean; result?: unknown }> {
  const { req, supabase, toolName, toolArgs } = opts;

  const memoryTools = new Set([
    "get_user_memory",
    "remember_this",
    "update_user_preferences",
    "manage_project_context",
  ]);

  if (!memoryTools.has(toolName)) return { handled: false };

  const userId = await getUserIdFromRequest(req, supabase);
  if (!userId) {
    return {
      handled: true,
      result: {
        success: false,
        message: "No authenticated user found. Memory tools require an active signed-in session.",
      },
    };
  }

  switch (toolName) {
    case "get_user_memory": {
      const memoryContext = await fetchUserMemory(supabase, userId, toolArgs.current_client_id);
      const formatted = formatMemoryForPrompt(memoryContext, toolArgs.current_client_id);

      return {
        handled: true,
        result: {
          success: true,
          has_preferences: !!memoryContext.preferences,
          active_projects_count: memoryContext.activeProjects.length,
          global_memories_count: memoryContext.recentMemories.length,
          client_contexts_count: memoryContext.clientSpecificContext.length,
          formatted_context: formatted || "No persistent memory found for this user yet.",
          raw_data: {
            preferences: memoryContext.preferences,
            projects: memoryContext.activeProjects.slice(0, 5),
            memories: memoryContext.recentMemories.slice(0, 10),
          },
        },
      };
    }

    case "remember_this": {
      let expires_at: string | undefined;
      if (typeof toolArgs.expires_in_days === "number" && toolArgs.expires_in_days > 0) {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + toolArgs.expires_in_days);
        expires_at = expiryDate.toISOString();
      }

      const res = await saveMemory(supabase, userId, {
        memory_type: toolArgs.memory_type,
        content: toolArgs.content,
        context_tags: toolArgs.context_tags || [],
        importance_score: toolArgs.importance_score || 5,
        client_id: toolArgs.client_id,
        expires_at,
      });

      return {
        handled: true,
        result: res.success
          ? {
              success: true,
              message: `✓ Remembered: "${String(toolArgs.content || "").substring(0, 50)}${String(toolArgs.content || "").length > 50 ? "..." : ""}"`,
              memory_id: res.id,
              memory_type: toolArgs.memory_type,
              importance: toolArgs.importance_score || 5,
              expires: expires_at ? `in ${toolArgs.expires_in_days} days` : "never",
            }
          : { success: false, message: res.error },
      };
    }

    case "update_user_preferences": {
      const prefsToUpdate: Record<string, any> = {};
      if (toolArgs.communication_style) prefsToUpdate.communication_style = toolArgs.communication_style;
      if (toolArgs.preferred_format) prefsToUpdate.preferred_format = toolArgs.preferred_format;
      if (toolArgs.role_context) prefsToUpdate.role_context = toolArgs.role_context;
      if (toolArgs.timezone) prefsToUpdate.timezone = toolArgs.timezone;
      if (toolArgs.language_preference) prefsToUpdate.language_preference = toolArgs.language_preference;
      if (toolArgs.custom_preferences) prefsToUpdate.custom_preferences = toolArgs.custom_preferences;

      const res = await upsertPreferences(supabase, userId, prefsToUpdate);
      return {
        handled: true,
        result: res.success
          ? {
              success: true,
              message: `✓ Updated preferences: ${Object.keys(prefsToUpdate).join(", ")}`,
              updated_fields: prefsToUpdate,
            }
          : { success: false, message: res.error },
      };
    }

    case "manage_project_context": {
      const action = toolArgs.action;

      if (action === "complete" || action === "pause") {
        if (!toolArgs.project_id) {
          return {
            handled: true,
            result: { success: false, message: "project_id required for complete/pause actions" },
          };
        }

        const newStatus = action === "complete" ? "completed" : "on_hold";
        const { error } = await supabase
          .from("user_project_context")
          .update({ current_status: newStatus, updated_at: new Date().toISOString() })
          .eq("id", toolArgs.project_id)
          .eq("user_id", userId);

        if (error) {
          return { handled: true, result: { success: false, message: error.message } };
        }

        return {
          handled: true,
          result: {
            success: true,
            message: `✓ Project marked as ${newStatus}`,
            project_id: toolArgs.project_id,
            new_status: newStatus,
          },
        };
      }

      if (action === "create" || action === "update") {
        if (!toolArgs.project_name && !toolArgs.project_id) {
          return {
            handled: true,
            result: { success: false, message: "project_name required for create, or project_id for update" },
          };
        }

        const res = await upsertProject(supabase, userId, {
          id: toolArgs.project_id,
          project_name: toolArgs.project_name,
          project_description: toolArgs.project_description,
          current_status: "active",
          key_details: toolArgs.key_details || {},
          priority: toolArgs.priority || "medium",
          client_id: toolArgs.client_id,
        });

        return {
          handled: true,
          result: res.success
            ? {
                success: true,
                message: `✓ Project ${action === "create" ? "created" : "updated"}: ${toolArgs.project_name}`,
                project_id: res.id,
                action,
              }
            : { success: false, message: res.error },
        };
      }

      return { handled: true, result: { success: false, message: `Unknown action: ${action}` } };
    }

    default:
      return { handled: true, result: { success: false, message: `Unknown tool: ${toolName}` } };
  }
}
