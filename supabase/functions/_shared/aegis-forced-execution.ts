// ═══════════════════════════════════════════════════════════════════════════════
//              AEGIS FORCED EXECUTION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
// When the AI model describes a tool call in prose instead of emitting a proper
// tool_calls response, these extractors parse structured parameters from the
// assistant's text so we can force-execute the intended tool.

/**
 * Extract key-value pairs from AI text output.
 * Handles patterns like: key="value", key: 'value', key=value
 */
export function extractValueFromText(normalized: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = `\`?${escapedKey}\`?\\s*[:=]\\s*(?:"([^"\\n]+)"|"([^"\\n]+)"|'([^'\\n]+)'|([^\\n,}]+))`;
  try {
    const re = new RegExp(pattern, "i");
    const m = normalized.match(re);
    const value = (m?.[1] || m?.[2] || m?.[3] || m?.[4] || "").trim();
    return value.replace(/[",;]+$/, '').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Strip markdown formatting (bold, italic, code) from extracted values.
 */
export function cleanMarkdownFormatting(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/^\*+\s*/g, "")
    .replace(/\s*\*+$/g, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/`/g, "")
    .replace(/^#+\s*/g, "")
    .trim();
}

/**
 * Extract inject_test_signal parameters when AI describes injecting but doesn't call the tool.
 */
export function extractPlannedTestSignalFromText(
  text: string,
): { text: string; client_name?: string; severity?: string; category?: string } | null {
  const looksLikeInjection = /\b(inject|injecting)\b/i.test(text) && /\bsignal\b/i.test(text);
  if (!looksLikeInjection) return null;

  const normalized = text.replace(/\r/g, "");

  const client_name = extractValueFromText(normalized, "client_name") || extractValueFromText(normalized, "client") || extractValueFromText(normalized, "clientName");
  if (!client_name) return null;

  const headline = extractValueFromText(normalized, "headline") || extractValueFromText(normalized, "title");
  const body = extractValueFromText(normalized, "body") || extractValueFromText(normalized, "text") || extractValueFromText(normalized, "description");

  const severityRaw = (extractValueFromText(normalized, "severity") || "medium").toLowerCase();
  const categoryRaw = extractValueFromText(normalized, "category") || "physical_security";

  if (!headline && !body) return null;

  const severity = ["critical", "high", "medium", "low"].includes(severityRaw)
    ? severityRaw
    : "medium";
  const category = categoryRaw.trim() || "physical_security";

  const unique = `UID:${Date.now()}`;
  const combinedText = `${headline || "(Test Signal)"}\n\n${body || ""}\n\n${unique}\nFORCED_FROM_ASSISTANT_TEXT:true`;

  return {
    client_name,
    severity,
    category,
    text: combinedText.trim(),
  };
}

/**
 * Extract query_fortress_data parameters when AI describes querying but doesn't call the tool.
 */
export function extractPlannedFortressQueryFromText(
  text: string,
): { query_type: string; filters?: any; output_format?: string; reason_for_access: string; agent_id?: string } | null {
  const looksLikeFortressQuery = /\b(query_fortress_data|query.*fortress|fortress.*query|executing.*query|fetch.*data|retrieve.*data)\b/i.test(text);
  if (!looksLikeFortressQuery) return null;

  const normalized = text.replace(/\r/g, "");

  // PRIORITY 1: Extract EXPLICIT query_type from structured call syntax
  let query_type = "comprehensive";
  
  const explicitQueryTypeMatch = normalized.match(/query_type\s*[=:]\s*["']?(\w+)["']?/i);
  if (explicitQueryTypeMatch) {
    const explicitType = explicitQueryTypeMatch[1].toLowerCase();
    const validTypes = ["signals", "incidents", "entities", "clients", "documents", "investigations", "knowledge_base", "travel", "comprehensive"];
    if (validTypes.includes(explicitType)) {
      query_type = explicitType;
      console.log(`extractPlannedFortressQueryFromText: EXPLICIT query_type found: ${query_type}`);
    }
  } else {
    const queryCallMatch = normalized.match(/(query_fortress_data|query.*fortress|fortress.*query)[^.]{0,100}/i);
    const queryContext = queryCallMatch ? queryCallMatch[0] : "";
    
    if (/\bdocument/i.test(queryContext)) query_type = "documents";
    else if (/\bsignal/i.test(queryContext)) query_type = "signals";
    else if (/\bincident/i.test(queryContext)) query_type = "incidents";
    else if (/\bentit/i.test(queryContext)) query_type = "entities";
    else if (/\bclient/i.test(queryContext)) query_type = "clients";
    else if (/\binvestigation/i.test(queryContext)) query_type = "investigations";
    else if (/\bknowledge/i.test(queryContext)) query_type = "knowledge_base";
    else if (/\btravel/i.test(queryContext)) query_type = "travel";
  }

  // Extract filters from STRUCTURED syntax only
  const filters: any = {};
  
  const filtersBlockMatch = normalized.match(/filters\s*[=:]\s*\{([^}]+)\}/i);
  if (filtersBlockMatch) {
    const filtersContent = filtersBlockMatch[1];
    console.log(`extractPlannedFortressQueryFromText: Found explicit filters block: ${filtersContent}`);
    
    const keywordsMatch = filtersContent.match(/keywords\s*[=:]\s*\[([^\]]+)\]/i);
    if (keywordsMatch) {
      const keywordsList = keywordsMatch[1].match(/["']([^"']+)["']/g);
      if (keywordsList) {
        filters.keywords = keywordsList.map((k: string) => k.replace(/["']/g, ''));
      }
    }
    
    const singleKeywordMatch = filtersContent.match(/keyword[s]?\s*[=:]\s*["']([^"']+)["']/i);
    if (singleKeywordMatch && !filters.keywords) {
      filters.keywords = [singleKeywordMatch[1]];
    }
    
    const entityNameMatch = filtersContent.match(/entity_name\s*[=:]\s*["']([^"']+)["']/i);
    if (entityNameMatch) {
      filters.entity_name = entityNameMatch[1];
      if (!filters.keywords) filters.keywords = [];
      filters.keywords.push(entityNameMatch[1]);
    }
    
    const clientIdMatch = filtersContent.match(/client_id\s*[=:]\s*["']([^"']+)["']/i);
    if (clientIdMatch) {
      filters.client_id = clientIdMatch[1];
    }
    
    const severityMatch = filtersContent.match(/severity\s*[=:]\s*["']?(critical|high|medium|low)["']?/i);
    if (severityMatch) {
      filters.severity = severityMatch[1].toLowerCase();
    }
    
    const timeRangeMatch = filtersContent.match(/time_range\s*[=:]\s*\{([^}]+)\}/i);
    if (timeRangeMatch) {
      const timeContent = timeRangeMatch[1];
      const startMatch = timeContent.match(/start\s*[=:]\s*["']([^"']+)["']/i);
      const endMatch = timeContent.match(/end\s*[=:]\s*["']([^"']+)["']/i);
      if (startMatch || endMatch) {
        filters.time_range = {};
        if (startMatch) filters.time_range.start = startMatch[1];
        if (endMatch) filters.time_range.end = endMatch[1];
      }
    }
  }
  
  // Standalone time_range fallbacks
  if (!filters.time_range) {
    const standaloneTimeMatch = normalized.match(/time_range\s*[=:]\s*\{[^}]*start\s*[=:]\s*["']([^"']+)["'][^}]*end\s*[=:]\s*["']([^"']+)["'][^}]*\}/i);
    if (standaloneTimeMatch) {
      filters.time_range = { start: standaloneTimeMatch[1], end: standaloneTimeMatch[2] };
    } else {
      const reverseTimeMatch = normalized.match(/time_range\s*[=:]\s*\{[^}]*end\s*[=:]\s*["']([^"']+)["'][^}]*start\s*[=:]\s*["']([^"']+)["'][^}]*\}/i);
      if (reverseTimeMatch) {
        filters.time_range = { start: reverseTimeMatch[2], end: reverseTimeMatch[1] };
      }
    }
  }
  
  if (!filters.time_range) {
    const dateRangeMatch = normalized.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|through|until|-)\s*(\d{4}-\d{2}-\d{2})/i);
    if (dateRangeMatch) {
      filters.time_range = { start: dateRangeMatch[1], end: dateRangeMatch[2] };
    }
  }
  
  if (!filters.time_range) {
    const lastNMatch = normalized.match(/\blast\s+(\d+)\s+(day|week|month|year)s?/i);
    if (lastNMatch) {
      filters.time_range = { last: `${lastNMatch[1]} ${lastNMatch[2]}s` };
    } else if (/\b(7|seven)\s*day/i.test(normalized)) {
      filters.time_range = { last: "7 days" };
    } else if (/\b(30|thirty)\s*day/i.test(normalized)) {
      filters.time_range = { last: "30 days" };
    }
  }
  
  if (!filters.severity) {
    const severityMatch = normalized.match(/severity\s*[=:]\s*["']?(critical|high|medium|low)["']?/i);
    if (severityMatch) {
      filters.severity = severityMatch[1].toLowerCase();
    }
  }
  
  if (!filters.keywords) {
    const keywordsArrayMatch = normalized.match(/keywords\s*[=:]\s*\[([^\]]+)\]/i);
    if (keywordsArrayMatch) {
      const keywordsList = keywordsArrayMatch[1].match(/["']([^"']+)["']/g);
      if (keywordsList) {
        filters.keywords = keywordsList.map((k: string) => k.replace(/["']/g, ''));
      }
    } else {
      const queryCallMatch = normalized.match(/(query_fortress_data|query.*fortress)[^.]{0,50}/i);
      if (queryCallMatch) {
        const nearContext = queryCallMatch[0];
        const quotedMatch = nearContext.match(/["']([^"']{2,50})["']/);
        if (quotedMatch) {
          filters.keywords = [quotedMatch[1]];
        }
      }
    }
  }

  let output_format = "detailed";
  const outputFormatMatch = normalized.match(/output_format\s*[=:]\s*["']?(summary|detailed|json)["']?/i);
  if (outputFormatMatch) {
    output_format = outputFormatMatch[1].toLowerCase();
  } else if (/\bsummary\b/i.test(normalized)) {
    output_format = "summary";
  } else if (/\bjson\b/i.test(normalized)) {
    output_format = "json";
  }

  let reason_for_access = "AI Assistant autonomous query (forced execution from text description)";
  const reasonMatch = normalized.match(/reason_for_access\s*[=:]\s*["']([^"']+)["']/i);
  if (reasonMatch) {
    reason_for_access = reasonMatch[1];
  } else {
    const reasonMatch2 = extractValueFromText(normalized, "reason_for_access") || extractValueFromText(normalized, "reason");
    if (reasonMatch2) {
      reason_for_access = reasonMatch2;
    }
  }

  console.log("extractPlannedFortressQueryFromText: Final extracted parameters", {
    query_type,
    filters,
    output_format,
    reason_for_access: reason_for_access.substring(0, 50),
    parsing_success: {
      explicit_query_type: !!explicitQueryTypeMatch,
      has_filters: Object.keys(filters).length > 0,
      has_time_range: !!filters.time_range,
      has_keywords: !!filters.keywords,
    }
  });

  return {
    query_type,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
    output_format,
    reason_for_access,
    agent_id: "aegis_forced_query",
  };
}

/**
 * Extract agent creation details when AI describes creating an agent without calling the tool.
 */
export function extractPlannedAgentFromText(
  text: string,
): { header_name: string; codename: string; call_sign: string; persona: string; specialty: string; mission_scope: string; is_client_facing?: boolean; is_active?: boolean; requested_by?: string } | null {
  const looksLikeAgentCreation = /\b(creat|provision|deploy|activat|initializ)(ing|e|ed)?\b/i.test(text) && /\bagent\b/i.test(text);
  if (!looksLikeAgentCreation) return null;

  const normalized = text.replace(/\r/g, "");

  const header_name = cleanMarkdownFormatting(extractValueFromText(normalized, "header_name") || extractValueFromText(normalized, "name") || extractValueFromText(normalized, "agent_name"));
  const codename = cleanMarkdownFormatting(extractValueFromText(normalized, "codename"));
  const call_sign = cleanMarkdownFormatting(extractValueFromText(normalized, "call_sign") || extractValueFromText(normalized, "callsign"));
  const persona = cleanMarkdownFormatting(extractValueFromText(normalized, "persona"));
  const specialty = cleanMarkdownFormatting(extractValueFromText(normalized, "specialty") || extractValueFromText(normalized, "specialization"));
  const mission_scope = cleanMarkdownFormatting(extractValueFromText(normalized, "mission_scope") || extractValueFromText(normalized, "mission") || extractValueFromText(normalized, "scope"));

  if (!codename || !call_sign) {
    console.log("extractPlannedAgentFromText: Missing codename or call_sign", { codename, call_sign });
    return null;
  }

  const finalHeaderName = header_name || codename;

  const isClientFacingStr = cleanMarkdownFormatting(extractValueFromText(normalized, "is_client_facing") || extractValueFromText(normalized, "client_facing"));
  const is_client_facing = isClientFacingStr ? isClientFacingStr.toLowerCase() === "true" : undefined;
  
  const isActiveStr = cleanMarkdownFormatting(extractValueFromText(normalized, "is_active") || extractValueFromText(normalized, "active"));
  const is_active = isActiveStr ? isActiveStr.toLowerCase() !== "false" : true;

  const requested_by = cleanMarkdownFormatting(extractValueFromText(normalized, "requested_by")) || "Aegis (auto-detected)";

  console.log("extractPlannedAgentFromText: Extracted agent details", {
    header_name: finalHeaderName,
    codename,
    call_sign,
    persona: persona?.substring(0, 50),
    specialty: specialty?.substring(0, 50),
    mission_scope: mission_scope?.substring(0, 50),
  });

  return {
    header_name: finalHeaderName,
    codename,
    call_sign,
    persona: persona || `${codename} is a specialized AI agent for security intelligence operations.`,
    specialty: specialty || `Security intelligence and threat analysis`,
    mission_scope: mission_scope || `Provide security intelligence support and analysis`,
    is_client_facing,
    is_active,
    requested_by,
  };
}
