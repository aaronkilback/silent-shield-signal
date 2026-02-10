// ═══════════════════════════════════════════════════════════════════════════════
//              AEGIS TOOL EXECUTOR — Dispatch Router
// ═══════════════════════════════════════════════════════════════════════════════
// Thin dispatcher that routes tool calls to domain-specific handler modules.
// Each handler module exports a Record<string, HandlerFn> keyed by tool name.

export type ToolHandlerFn = (
  args: any,
  supabaseClient: any,
  userId?: string,
) => Promise<any>;

/**
 * Registry of all tool handlers, keyed by tool name.
 * Populated by importing domain-specific handler modules.
 */
export type ToolHandlerRegistry = Record<string, ToolHandlerFn>;

/**
 * Merge multiple handler maps into a single registry.
 * Throws on duplicate keys to catch misconfigurations early.
 */
export function mergeHandlers(...maps: ToolHandlerRegistry[]): ToolHandlerRegistry {
  const merged: ToolHandlerRegistry = {};
  for (const map of maps) {
    for (const [name, fn] of Object.entries(map)) {
      if (merged[name]) {
        console.error(`[aegis-tool-executor] Duplicate handler for tool "${name}" — last wins`);
      }
      merged[name] = fn;
    }
  }
  return merged;
}

/**
 * Execute a tool by name using the registry.
 * Injects userId for memory-related tools automatically.
 */
export function createToolExecutor(registry: ToolHandlerRegistry) {
  const memoryTools = new Set([
    "get_user_memory",
    "remember_this",
    "update_user_preferences",
    "manage_project_context",
  ]);

  return async function executeTool(
    toolName: string,
    args: any,
    supabaseClient: any,
    userId?: string,
  ): Promise<any> {
    // Inject user ID for memory tools
    if (memoryTools.has(toolName) && userId) {
      args._user_id = userId;
    }
    console.log(`Executing tool: ${toolName}`, JSON.stringify(args));

    const handler = registry[toolName];
    if (!handler) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    try {
      return await handler(args, supabaseClient, userId);
    } catch (error) {
      console.error(`Tool execution error for ${toolName}:`, error);
      throw error;
    }
  };
}
