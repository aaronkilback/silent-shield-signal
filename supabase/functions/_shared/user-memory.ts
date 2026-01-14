// User Memory Helper - Fetches persistent context for Aegis AI
// This provides hybrid memory: global preferences + client-specific project context

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export interface UserPreferences {
  communication_style: string | null;
  preferred_format: string | null;
  role_context: string | null;
  timezone: string | null;
  language_preference: string | null;
  custom_preferences: Record<string, any>;
}

export interface ProjectContext {
  id: string;
  project_name: string;
  project_description: string | null;
  current_status: string | null;
  key_details: Record<string, any>;
  priority: string;
  client_id: string | null;
  client_name?: string;
  last_mentioned_at: string;
}

export interface ConversationMemory {
  id: string;
  memory_type: string;
  content: string;
  context_tags: string[];
  importance_score: number;
  client_id: string | null;
  created_at: string;
}

export interface UserMemoryContext {
  preferences: UserPreferences | null;
  activeProjects: ProjectContext[];
  recentMemories: ConversationMemory[];
  clientSpecificContext: {
    clientId: string;
    clientName: string;
    projects: ProjectContext[];
    memories: ConversationMemory[];
  }[];
}

/**
 * Fetches comprehensive memory context for a user
 * @param supabase - Supabase client with service role
 * @param userId - The authenticated user's ID
 * @param currentClientId - Optional current client context
 */
export async function fetchUserMemory(
  supabase: SupabaseClient,
  userId: string,
  currentClientId?: string
): Promise<UserMemoryContext> {
  const [preferencesResult, projectsResult, memoriesResult] = await Promise.all([
    // Fetch global user preferences
    supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", userId)
      .single(),
    
    // Fetch active projects (recent first, limit 10)
    supabase
      .from("user_project_context")
      .select(`
        id,
        project_name,
        project_description,
        current_status,
        key_details,
        priority,
        client_id,
        last_mentioned_at,
        clients(name)
      `)
      .eq("user_id", userId)
      .in("current_status", ["active", "on_hold"])
      .order("last_mentioned_at", { ascending: false })
      .limit(10),
    
    // Fetch recent conversation memories (high importance or recent)
    supabase
      .from("conversation_memory")
      .select("*")
      .eq("user_id", userId)
      .or("importance_score.gte.7,created_at.gte." + new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order("importance_score", { ascending: false })
      .limit(20)
  ]);

  // Process preferences
  const preferences: UserPreferences | null = preferencesResult.data ? {
    communication_style: preferencesResult.data.communication_style,
    preferred_format: preferencesResult.data.preferred_format,
    role_context: preferencesResult.data.role_context,
    timezone: preferencesResult.data.timezone,
    language_preference: preferencesResult.data.language_preference,
    custom_preferences: preferencesResult.data.custom_preferences || {}
  } : null;

  // Process projects with client names
  const activeProjects: ProjectContext[] = (projectsResult.data || []).map((p: any) => ({
    id: p.id,
    project_name: p.project_name,
    project_description: p.project_description,
    current_status: p.current_status,
    key_details: p.key_details || {},
    priority: p.priority,
    client_id: p.client_id,
    client_name: p.clients?.name,
    last_mentioned_at: p.last_mentioned_at
  }));

  // Process memories
  const recentMemories: ConversationMemory[] = (memoriesResult.data || []).map((m: any) => ({
    id: m.id,
    memory_type: m.memory_type,
    content: m.content,
    context_tags: m.context_tags || [],
    importance_score: m.importance_score,
    client_id: m.client_id,
    created_at: m.created_at
  }));

  // Group by client for client-specific context
  const clientMap = new Map<string, { clientName: string; projects: ProjectContext[]; memories: ConversationMemory[] }>();
  
  for (const project of activeProjects) {
    if (project.client_id) {
      if (!clientMap.has(project.client_id)) {
        clientMap.set(project.client_id, {
          clientName: project.client_name || "Unknown Client",
          projects: [],
          memories: []
        });
      }
      clientMap.get(project.client_id)!.projects.push(project);
    }
  }

  for (const memory of recentMemories) {
    if (memory.client_id && clientMap.has(memory.client_id)) {
      clientMap.get(memory.client_id)!.memories.push(memory);
    }
  }

  const clientSpecificContext = Array.from(clientMap.entries()).map(([clientId, data]) => ({
    clientId,
    clientName: data.clientName,
    projects: data.projects,
    memories: data.memories
  }));

  return {
    preferences,
    activeProjects,
    recentMemories: recentMemories.filter(m => !m.client_id), // Global memories only
    clientSpecificContext
  };
}

/**
 * Formats user memory into a prompt-ready string
 */
export function formatMemoryForPrompt(memory: UserMemoryContext, currentClientId?: string): string {
  const sections: string[] = [];

  // User Preferences Section
  if (memory.preferences) {
    const prefs = memory.preferences;
    const prefLines: string[] = [];
    
    if (prefs.role_context) prefLines.push(`Role: ${prefs.role_context}`);
    if (prefs.communication_style) prefLines.push(`Communication Style: ${prefs.communication_style}`);
    if (prefs.preferred_format) prefLines.push(`Preferred Format: ${prefs.preferred_format}`);
    if (prefs.timezone) prefLines.push(`Timezone: ${prefs.timezone}`);
    if (Object.keys(prefs.custom_preferences).length > 0) {
      prefLines.push(`Custom: ${JSON.stringify(prefs.custom_preferences)}`);
    }
    
    if (prefLines.length > 0) {
      sections.push(`═══ USER PREFERENCES ═══\n${prefLines.join("\n")}`);
    }
  }

  // Active Projects Section
  if (memory.activeProjects.length > 0) {
    const projectLines = memory.activeProjects.map(p => {
      let line = `• ${p.project_name} [${p.current_status}]`;
      if (p.client_name) line += ` (${p.client_name})`;
      if (p.project_description) line += `\n  ${p.project_description}`;
      if (Object.keys(p.key_details).length > 0) {
        line += `\n  Details: ${JSON.stringify(p.key_details)}`;
      }
      return line;
    });
    sections.push(`═══ ACTIVE PROJECTS (${memory.activeProjects.length}) ═══\n${projectLines.join("\n\n")}`);
  }

  // Global Memories Section
  if (memory.recentMemories.length > 0) {
    const memoryLines = memory.recentMemories
      .slice(0, 10)
      .map(m => `• [${m.memory_type}] ${m.content}${m.context_tags.length ? ` #${m.context_tags.join(" #")}` : ""}`);
    sections.push(`═══ REMEMBERED CONTEXT ═══\n${memoryLines.join("\n")}`);
  }

  // Current Client Context (prioritized)
  if (currentClientId) {
    const clientContext = memory.clientSpecificContext.find(c => c.clientId === currentClientId);
    if (clientContext && (clientContext.projects.length > 0 || clientContext.memories.length > 0)) {
      const clientLines: string[] = [`Client: ${clientContext.clientName}`];
      
      if (clientContext.projects.length > 0) {
        clientLines.push("Projects:");
        clientContext.projects.forEach(p => {
          clientLines.push(`  • ${p.project_name} [${p.current_status}]`);
        });
      }
      
      if (clientContext.memories.length > 0) {
        clientLines.push("Context:");
        clientContext.memories.slice(0, 5).forEach(m => {
          clientLines.push(`  • ${m.content}`);
        });
      }
      
      sections.push(`═══ CURRENT CLIENT CONTEXT ═══\n${clientLines.join("\n")}`);
    }
  }

  if (sections.length === 0) {
    return "";
  }

  return `
╔═══════════════════════════════════════════════════════════════════════════════╗
║                          🧠 PERSISTENT USER CONTEXT                           ║
╠═══════════════════════════════════════════════════════════════════════════════╣
You have access to the following persistent memory about this user.
Use this context naturally in your responses - reference past projects,
respect communication preferences, and provide continuity across sessions.

${sections.join("\n\n")}

╚═══════════════════════════════════════════════════════════════════════════════╝`;
}

/**
 * Saves a new memory to the user's context
 */
export async function saveMemory(
  supabase: SupabaseClient,
  userId: string,
  memory: {
    memory_type: "summary" | "key_fact" | "preference" | "decision";
    content: string;
    context_tags?: string[];
    importance_score?: number;
    client_id?: string;
    source_conversation_id?: string;
    expires_at?: string;
  }
): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data, error } = await supabase
    .from("conversation_memory")
    .insert({
      user_id: userId,
      memory_type: memory.memory_type,
      content: memory.content,
      context_tags: memory.context_tags || [],
      importance_score: memory.importance_score || 5,
      client_id: memory.client_id || null,
      source_conversation_id: memory.source_conversation_id || null,
      expires_at: memory.expires_at || null
    })
    .select("id")
    .single();

  if (error) {
    console.error("Error saving memory:", error);
    return { success: false, error: error.message };
  }

  return { success: true, id: data.id };
}

/**
 * Updates or creates user preferences
 */
export async function upsertPreferences(
  supabase: SupabaseClient,
  userId: string,
  preferences: Partial<UserPreferences>
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from("user_preferences")
    .upsert({
      user_id: userId,
      ...preferences,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });

  if (error) {
    console.error("Error upserting preferences:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Creates or updates a project context
 */
export async function upsertProject(
  supabase: SupabaseClient,
  userId: string,
  project: {
    id?: string;
    project_name: string;
    project_description?: string;
    current_status?: string;
    key_details?: Record<string, any>;
    priority?: string;
    client_id?: string;
  }
): Promise<{ success: boolean; id?: string; error?: string }> {
  const projectData = {
    user_id: userId,
    project_name: project.project_name,
    project_description: project.project_description || null,
    current_status: project.current_status || "active",
    key_details: project.key_details || {},
    priority: project.priority || "medium",
    client_id: project.client_id || null,
    last_mentioned_at: new Date().toISOString()
  };

  if (project.id) {
    // Update existing
    const { error } = await supabase
      .from("user_project_context")
      .update(projectData)
      .eq("id", project.id)
      .eq("user_id", userId);

    if (error) {
      console.error("Error updating project:", error);
      return { success: false, error: error.message };
    }
    return { success: true, id: project.id };
  } else {
    // Create new
    const { data, error } = await supabase
      .from("user_project_context")
      .insert(projectData)
      .select("id")
      .single();

    if (error) {
      console.error("Error creating project:", error);
      return { success: false, error: error.message };
    }
    return { success: true, id: data.id };
  }
}

/**
 * Updates project's last_mentioned_at to keep it relevant
 */
export async function touchProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<void> {
  await supabase
    .from("user_project_context")
    .update({ last_mentioned_at: new Date().toISOString() })
    .eq("id", projectId);
}
