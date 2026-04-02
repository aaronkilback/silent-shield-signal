import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface AutopilotRequest {
  investigation_id: string;
  session_id?: string; // If resuming
  action: "start" | "execute_task" | "cancel";
  task_id?: string; // For execute_task
}

const TASK_TYPES = [
  {
    type: "entity_extraction",
    label: "Entity Extraction & Correlation",
    agent: "NEO",
    description: "Extract and correlate entities from investigation data against known records",
  },
  {
    type: "signal_crossref",
    label: "Signal Cross-Reference",
    agent: "NEO",
    description: "Find related signals across all clients and sources",
  },
  {
    type: "pattern_matching",
    label: "Historical Pattern Analysis",
    agent: "CERBERUS",
    description: "Compare against closed investigations for similar methods of operation",
  },
  {
    type: "timeline_construction",
    label: "Timeline Construction",
    agent: "PRAETOR",
    description: "Build chronological event sequence from all correlated data",
  },
  {
    type: "risk_assessment",
    label: "Risk Assessment & Recommendations",
    agent: "MERIDIAN",
    description: "Score findings and generate actionable recommendations",
  },
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("OPENAI_API_KEY");

    const supabase = createClient(supabaseUrl, serviceKey);
    const { investigation_id, session_id, action, task_id } = (await req.json()) as AutopilotRequest;

    if (!investigation_id) {
      return new Response(JSON.stringify({ error: "investigation_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get investigation context
    const { data: investigation, error: invError } = await supabase
      .from("investigations")
      .select("*")
      .eq("id", investigation_id)
      .single();

    if (invError || !investigation) {
      return new Response(JSON.stringify({ error: "Investigation not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "start") {
      return await handleStart(supabase, investigation, lovableKey);
    } else if (action === "execute_task" && task_id) {
      return await handleExecuteTask(supabase, investigation, task_id, lovableKey);
    } else if (action === "cancel" && session_id) {
      return await handleCancel(supabase, session_id);
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Autopilot error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function handleStart(supabase: any, investigation: any, lovableKey: string | undefined) {
  // Get auth user from the request
  const authHeader = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  // Create session
  const { data: session, error: sessionError } = await supabase
    .from("investigation_autopilot_sessions")
    .insert({
      investigation_id: investigation.id,
      initiated_by: investigation.created_by || investigation.assigned_to,
      status: "planning",
      total_tasks: TASK_TYPES.length,
    })
    .select()
    .single();

  if (sessionError) {
    console.error("Session creation error:", sessionError);
    return new Response(JSON.stringify({ error: "Failed to create session" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Create all tasks
  const tasks = TASK_TYPES.map((t, i) => ({
    investigation_id: investigation.id,
    session_id: session.id,
    task_type: t.type,
    task_label: t.label,
    agent_call_sign: t.agent,
    status: "pending",
    priority: i + 1,
    sort_order: i,
    input_context: {
      description: t.description,
      investigation_title: investigation.title,
      investigation_synopsis: investigation.synopsis,
      investigation_type: investigation.investigation_type,
      investigation_status: investigation.status,
    },
  }));

  const { data: createdTasks, error: taskError } = await supabase
    .from("investigation_autopilot_tasks")
    .insert(tasks)
    .select();

  if (taskError) {
    console.error("Task creation error:", taskError);
    return new Response(JSON.stringify({ error: "Failed to create tasks" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Update session to running
  await supabase
    .from("investigation_autopilot_sessions")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", session.id);

  // Execute first task immediately
  const firstTask = createdTasks.sort((a: any, b: any) => a.sort_order - b.sort_order)[0];
  if (firstTask) {
    await executeTask(supabase, investigation, firstTask, lovableKey);
  }

  return new Response(JSON.stringify({ session_id: session.id, tasks: createdTasks }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleExecuteTask(supabase: any, investigation: any, taskId: string, lovableKey: string | undefined) {
  const { data: task, error } = await supabase
    .from("investigation_autopilot_tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (error || !task) {
    return new Response(JSON.stringify({ error: "Task not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await executeTask(supabase, investigation, task, lovableKey);

  // Check if all tasks in session are done
  const { data: allTasks } = await supabase
    .from("investigation_autopilot_tasks")
    .select("status")
    .eq("session_id", task.session_id);

  const completedCount = allTasks?.filter((t: any) => ["completed", "failed", "skipped"].includes(t.status)).length || 0;

  if (completedCount === allTasks?.length) {
    // Generate overall summary
    const { data: completedTasks } = await supabase
      .from("investigation_autopilot_tasks")
      .select("*")
      .eq("session_id", task.session_id)
      .eq("status", "completed")
      .order("sort_order");

    const overallSummary = await generateOverallSummary(supabase, investigation, completedTasks || [], lovableKey);

    await supabase
      .from("investigation_autopilot_sessions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_tasks: completedCount,
        overall_summary: overallSummary.summary,
        key_findings: overallSummary.keyFindings,
        recommendations: overallSummary.recommendations,
        risk_score: overallSummary.riskScore,
      })
      .eq("id", task.session_id);
  } else {
    await supabase
      .from("investigation_autopilot_sessions")
      .update({ completed_tasks: completedCount })
      .eq("id", task.session_id);
  }

  return new Response(JSON.stringify({ success: true, task_id: taskId }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleCancel(supabase: any, sessionId: string) {
  await supabase
    .from("investigation_autopilot_tasks")
    .update({ status: "skipped" })
    .eq("session_id", sessionId)
    .in("status", ["pending", "running"]);

  await supabase
    .from("investigation_autopilot_sessions")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", sessionId);

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function executeTask(supabase: any, investigation: any, task: any, lovableKey: string | undefined) {
  const startTime = Date.now();

  // Mark as running
  await supabase
    .from("investigation_autopilot_tasks")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", task.id);

  try {
    let result: any;

    switch (task.task_type) {
      case "entity_extraction":
        result = await taskEntityExtraction(supabase, investigation, lovableKey);
        break;
      case "signal_crossref":
        result = await taskSignalCrossref(supabase, investigation);
        break;
      case "pattern_matching":
        result = await taskPatternMatching(supabase, investigation, lovableKey);
        break;
      case "timeline_construction":
        result = await taskTimelineConstruction(supabase, investigation);
        break;
      case "risk_assessment":
        result = await taskRiskAssessment(supabase, investigation, task.session_id, lovableKey);
        break;
      default:
        result = { findings: [], summary: "Unknown task type", confidence: 0.5 };
    }

    const durationMs = Date.now() - startTime;

    await supabase
      .from("investigation_autopilot_tasks")
      .update({
        status: "completed",
        findings: result.findings || [],
        summary: result.summary,
        confidence_score: result.confidence || 0.75,
        entities_found: result.entities || [],
        signals_correlated: result.signals || [],
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
      })
      .eq("id", task.id);
  } catch (e) {
    console.error(`Task ${task.task_type} failed:`, e);
    await supabase
      .from("investigation_autopilot_tasks")
      .update({
        status: "failed",
        error_message: e instanceof Error ? e.message : "Unknown error",
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      })
      .eq("id", task.id);
  }
}

// ─── TASK IMPLEMENTATIONS ────────────────────────────────────────────

async function taskEntityExtraction(supabase: any, investigation: any, lovableKey: string | undefined) {
  // Get investigation entries for content
  const { data: entries } = await supabase
    .from("investigation_entries")
    .select("content, created_at")
    .eq("investigation_id", investigation.id)
    .order("created_at", { ascending: true })
    .limit(50);

  // Get persons of interest
  const { data: persons } = await supabase
    .from("investigation_persons")
    .select("*")
    .eq("investigation_id", investigation.id);

  const textContent = [
    investigation.synopsis || "",
    investigation.information || "",
    investigation.recommendations || "",
    ...(entries?.map((e: any) => e.content) || []),
  ].join("\n\n");

  // Cross-reference against known entities
  const entityNames = persons?.map((p: any) => p.name) || [];
  let matchedEntities: any[] = [];

  if (entityNames.length > 0) {
    const { data: entities } = await supabase
      .from("entities")
      .select("id, name, type, threat_score, risk_level")
      .or(entityNames.map((n: string) => `name.ilike.%${n.replace(/'/g, "''")}%`).join(","))
      .limit(20);

    matchedEntities = entities || [];
  }

  // Use AI to extract additional entities from text
  let aiEntities: any[] = [];
  if (lovableKey && textContent.length > 50) {
    try {
      const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You are an intelligence analyst. Extract entities (persons, organizations, locations, vehicles, financial instruments) from the following investigation text. Return a JSON array of objects with {name, type, relevance, context}. Types: person, organization, location, vehicle, financial. Relevance: high, medium, low.",
            },
            { role: "user", content: textContent.substring(0, 8000) },
          ],
          tools: [{
            type: "function",
            function: {
              name: "extract_entities",
              description: "Extract entities from investigation text",
              parameters: {
                type: "object",
                properties: {
                  entities: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        type: { type: "string", enum: ["person", "organization", "location", "vehicle", "financial"] },
                        relevance: { type: "string", enum: ["high", "medium", "low"] },
                        context: { type: "string" },
                      },
                      required: ["name", "type", "relevance", "context"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["entities"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "extract_entities" } },
        }),
      });

      if (aiResponse.ok) {
        const data = await aiResponse.json();
        const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall) {
          const parsed = JSON.parse(toolCall.function.arguments);
          aiEntities = parsed.entities || [];
        }
      }
    } catch (e) {
      console.error("AI entity extraction failed:", e);
    }
  }

  const findings = [
    ...(matchedEntities.map((e: any) => ({
      type: "matched_entity",
      title: `Known entity: ${e.name}`,
      detail: `Type: ${e.type} | Threat Score: ${e.threat_score || "N/A"} | Risk: ${e.risk_level || "unknown"}`,
      severity: e.threat_score > 70 ? "high" : e.threat_score > 40 ? "medium" : "low",
    }))),
    ...(aiEntities.map((e: any) => ({
      type: "extracted_entity",
      title: `Extracted: ${e.name} (${e.type})`,
      detail: e.context,
      severity: e.relevance,
    }))),
  ];

  return {
    findings,
    summary: `Extracted ${aiEntities.length} entities from case text. Found ${matchedEntities.length} matches against known entity database. ${persons?.length || 0} persons of interest on file.`,
    confidence: matchedEntities.length > 0 ? 0.85 : 0.7,
    entities: [...entityNames, ...aiEntities.map((e: any) => e.name)],
  };
}

async function taskSignalCrossref(supabase: any, investigation: any) {
  // Find signals related to this investigation's client, keywords, and time period
  const keywords = [
    ...(investigation.title?.split(/\s+/).filter((w: string) => w.length > 4) || []),
    ...(investigation.synopsis?.split(/\s+/).filter((w: string) => w.length > 5).slice(0, 10) || []),
  ];

  let relatedSignals: any[] = [];

  // Search by client
  if (investigation.client_id) {
    const { data: clientSignals } = await supabase
      .from("signals")
      .select("id, title, severity, category, created_at, signal_type")
      .eq("client_id", investigation.client_id)
      .gte("created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20);

    relatedSignals = clientSignals || [];
  }

  // Search by keywords
  if (keywords.length > 0) {
    const keywordFilter = keywords.slice(0, 5).map((k: string) => `title.ilike.%${k}%`).join(",");
    const { data: keywordSignals } = await supabase
      .from("signals")
      .select("id, title, severity, category, created_at, signal_type")
      .or(keywordFilter)
      .gte("created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .order("severity", { ascending: false })
      .limit(15);

    // Merge without duplicates
    const existingIds = new Set(relatedSignals.map((s: any) => s.id));
    for (const s of keywordSignals || []) {
      if (!existingIds.has(s.id)) {
        relatedSignals.push(s);
      }
    }
  }

  // Check for linked incidents
  const { data: incidents } = await supabase
    .from("incidents")
    .select("id, priority, status, opened_at, signal_id")
    .eq("investigation_id", investigation.id)
    .limit(10);

  const findings = [
    ...relatedSignals.slice(0, 15).map((s: any) => ({
      type: "related_signal",
      title: s.title || "Untitled signal",
      detail: `Severity: ${s.severity || "unknown"} | Category: ${s.category || "uncategorized"} | Source: ${s.signal_type || "unknown"} | ${new Date(s.created_at).toLocaleDateString()}`,
      severity: s.severity === "critical" || s.severity === "high" ? "high" : s.severity === "medium" ? "medium" : "low",
      signal_id: s.id,
    })),
    ...(incidents || []).map((i: any) => ({
      type: "linked_incident",
      title: `Incident ${i.priority?.toUpperCase()} — ${i.status}`,
      detail: `Opened: ${new Date(i.opened_at).toLocaleDateString()}`,
      severity: i.priority === "p1" ? "high" : i.priority === "p2" ? "medium" : "low",
    })),
  ];

  return {
    findings,
    summary: `Found ${relatedSignals.length} related signals (${relatedSignals.filter((s: any) => s.severity === "critical" || s.severity === "high").length} high/critical). ${incidents?.length || 0} linked incidents identified.`,
    confidence: relatedSignals.length > 5 ? 0.85 : 0.65,
    signals: relatedSignals.map((s: any) => s.id),
  };
}

async function taskPatternMatching(supabase: any, investigation: any, lovableKey: string | undefined) {
  // Find similar closed investigations
  const { data: closedCases } = await supabase
    .from("investigations")
    .select("id, title, synopsis, investigation_type, status, recommendations, created_at")
    .eq("status", "closed")
    .neq("id", investigation.id)
    .limit(50);

  if (!closedCases || closedCases.length === 0) {
    return {
      findings: [{ type: "no_data", title: "No historical cases available", detail: "No closed investigations found for pattern comparison", severity: "low" }],
      summary: "No closed cases available for pattern analysis.",
      confidence: 0.3,
    };
  }

  // Use AI to find similarities
  if (!lovableKey) {
    return { findings: [], summary: "AI key not available for pattern matching", confidence: 0.3 };
  }

  try {
    const casesSummary = closedCases.slice(0, 20).map((c: any) => ({
      title: c.title,
      type: c.investigation_type,
      synopsis: (c.synopsis || "").substring(0, 200),
    }));

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a senior investigator comparing cases. Analyze the current investigation against historical cases and identify pattern matches, similar MOs, and lessons learned. Be precise and actionable.",
          },
          {
            role: "user",
            content: `Current investigation:\nTitle: ${investigation.title}\nType: ${investigation.investigation_type}\nSynopsis: ${(investigation.synopsis || "").substring(0, 1000)}\n\nHistorical cases:\n${JSON.stringify(casesSummary)}`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "report_patterns",
            description: "Report pattern matches between current and historical cases",
            parameters: {
              type: "object",
              properties: {
                matches: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      case_title: { type: "string" },
                      similarity_reason: { type: "string" },
                      lesson_learned: { type: "string" },
                      relevance: { type: "string", enum: ["high", "medium", "low"] },
                    },
                    required: ["case_title", "similarity_reason", "lesson_learned", "relevance"],
                    additionalProperties: false,
                  },
                },
                overall_pattern: { type: "string" },
              },
              required: ["matches", "overall_pattern"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "report_patterns" } },
      }),
    });

    if (aiResponse.ok) {
      const data = await aiResponse.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall) {
        const parsed = JSON.parse(toolCall.function.arguments);
        return {
          findings: (parsed.matches || []).map((m: any) => ({
            type: "pattern_match",
            title: `Similar case: ${m.case_title}`,
            detail: `${m.similarity_reason}\n\nLesson: ${m.lesson_learned}`,
            severity: m.relevance,
          })),
          summary: parsed.overall_pattern || `Found ${parsed.matches?.length || 0} pattern matches.`,
          confidence: 0.75,
        };
      }
    }
  } catch (e) {
    console.error("Pattern matching AI failed:", e);
  }

  return { findings: [], summary: "Pattern matching could not be completed", confidence: 0.4 };
}

async function taskTimelineConstruction(supabase: any, investigation: any) {
  // Gather all time-stamped events
  const events: any[] = [];

  // Investigation entries
  const { data: entries } = await supabase
    .from("investigation_entries")
    .select("content, created_at, created_by")
    .eq("investigation_id", investigation.id)
    .order("created_at", { ascending: true });

  for (const e of entries || []) {
    events.push({
      timestamp: e.created_at,
      type: "investigation_entry",
      content: (e.content || "").substring(0, 200),
    });
  }

  // Related signals
  if (investigation.client_id) {
    const { data: signals } = await supabase
      .from("signals")
      .select("title, created_at, severity, signal_type")
      .eq("client_id", investigation.client_id)
      .gte("created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: true })
      .limit(30);

    for (const s of signals || []) {
      events.push({
        timestamp: s.created_at,
        type: "signal",
        content: `[${s.severity || "unknown"}] ${s.title || "Signal detected"} (${s.signal_type || "unknown"})`,
      });
    }
  }

  // Linked incidents
  const { data: incidents } = await supabase
    .from("incidents")
    .select("priority, status, opened_at, resolved_at")
    .eq("investigation_id", investigation.id);

  for (const i of incidents || []) {
    events.push({ timestamp: i.opened_at, type: "incident_opened", content: `${i.priority?.toUpperCase()} incident opened` });
    if (i.resolved_at) {
      events.push({ timestamp: i.resolved_at, type: "incident_resolved", content: `${i.priority?.toUpperCase()} incident resolved` });
    }
  }

  // Sort chronologically
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const findings = events.map((e) => ({
    type: "timeline_event",
    title: `${new Date(e.timestamp).toLocaleString()} — ${e.type.replace(/_/g, " ")}`,
    detail: e.content,
    severity: e.type === "incident_opened" ? "high" : e.type === "signal" ? "medium" : "low",
    timestamp: e.timestamp,
  }));

  return {
    findings,
    summary: `Constructed timeline with ${events.length} events spanning ${events.length > 1 ? `${Math.ceil((new Date(events[events.length - 1].timestamp).getTime() - new Date(events[0].timestamp).getTime()) / (24 * 60 * 60 * 1000))} days` : "a single point"}.`,
    confidence: events.length > 5 ? 0.85 : 0.6,
  };
}

async function taskRiskAssessment(supabase: any, investigation: any, sessionId: string, lovableKey: string | undefined) {
  // Gather all completed task findings for synthesis
  const { data: completedTasks } = await supabase
    .from("investigation_autopilot_tasks")
    .select("task_type, summary, findings, confidence_score")
    .eq("session_id", sessionId)
    .eq("status", "completed");

  const taskSummaries = (completedTasks || []).map((t: any) => ({
    type: t.task_type,
    summary: t.summary,
    findingCount: Array.isArray(t.findings) ? t.findings.length : 0,
    confidence: t.confidence_score,
  }));

  if (!lovableKey) {
    return {
      findings: [{ type: "risk_score", title: "Risk assessment unavailable", detail: "AI key not configured", severity: "medium" }],
      summary: "Automated risk assessment requires AI capability.",
      confidence: 0.3,
    };
  }

  try {
    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a senior intelligence analyst performing a risk assessment. Based on the investigation context and autopilot findings, provide a risk score (0.0-1.0), key risk factors, and actionable recommendations. Be direct and operationally focused.",
          },
          {
            role: "user",
            content: `Investigation: ${investigation.title}\nType: ${investigation.investigation_type}\nSynopsis: ${(investigation.synopsis || "").substring(0, 1500)}\n\nAutopilot findings:\n${JSON.stringify(taskSummaries)}`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "assess_risk",
            description: "Provide risk assessment for the investigation",
            parameters: {
              type: "object",
              properties: {
                risk_score: { type: "number", description: "Overall risk score 0.0-1.0" },
                risk_level: { type: "string", enum: ["critical", "high", "medium", "low"] },
                risk_factors: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      factor: { type: "string" },
                      severity: { type: "string", enum: ["high", "medium", "low"] },
                      detail: { type: "string" },
                    },
                    required: ["factor", "severity", "detail"],
                    additionalProperties: false,
                  },
                },
                recommendations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      action: { type: "string" },
                      priority: { type: "string", enum: ["immediate", "short_term", "long_term"] },
                      rationale: { type: "string" },
                    },
                    required: ["action", "priority", "rationale"],
                    additionalProperties: false,
                  },
                },
                assessment_summary: { type: "string" },
              },
              required: ["risk_score", "risk_level", "risk_factors", "recommendations", "assessment_summary"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "assess_risk" } },
      }),
    });

    if (aiResponse.ok) {
      const data = await aiResponse.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall) {
        const parsed = JSON.parse(toolCall.function.arguments);
        const findings = [
          {
            type: "risk_score",
            title: `Overall Risk: ${parsed.risk_level?.toUpperCase()} (${(parsed.risk_score * 100).toFixed(0)}%)`,
            detail: parsed.assessment_summary,
            severity: parsed.risk_level === "critical" || parsed.risk_level === "high" ? "high" : parsed.risk_level,
          },
          ...(parsed.risk_factors || []).map((f: any) => ({
            type: "risk_factor",
            title: f.factor,
            detail: f.detail,
            severity: f.severity,
          })),
          ...(parsed.recommendations || []).map((r: any) => ({
            type: "recommendation",
            title: `[${r.priority?.toUpperCase()}] ${r.action}`,
            detail: r.rationale,
            severity: r.priority === "immediate" ? "high" : r.priority === "short_term" ? "medium" : "low",
          })),
        ];

        return {
          findings,
          summary: parsed.assessment_summary,
          confidence: 0.8,
        };
      }
    }
  } catch (e) {
    console.error("Risk assessment AI failed:", e);
  }

  return {
    findings: [{ type: "risk_score", title: "Risk assessment could not be completed", detail: "AI analysis encountered an error", severity: "medium" }],
    summary: "Risk assessment incomplete due to processing error.",
    confidence: 0.3,
  };
}

async function generateOverallSummary(supabase: any, investigation: any, tasks: any[], lovableKey: string | undefined) {
  const taskResults = tasks.map((t: any) => `${t.task_label}: ${t.summary || "No summary"}`).join("\n");

  if (!lovableKey) {
    return {
      summary: `Autopilot completed ${tasks.length} tasks for investigation "${investigation.title}".`,
      keyFindings: [],
      recommendations: [],
      riskScore: 0.5,
    };
  }

  try {
    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a senior intelligence officer synthesizing autopilot investigation results into an executive briefing. Be concise, direct, and actionable.",
          },
          {
            role: "user",
            content: `Investigation: ${investigation.title}\n\nAutopilot results:\n${taskResults}`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "synthesize_results",
            description: "Synthesize autopilot results into executive briefing",
            parameters: {
              type: "object",
              properties: {
                executive_summary: { type: "string" },
                key_findings: {
                  type: "array",
                  items: { type: "string" },
                },
                recommendations: {
                  type: "array",
                  items: { type: "string" },
                },
                risk_score: { type: "number" },
              },
              required: ["executive_summary", "key_findings", "recommendations", "risk_score"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "synthesize_results" } },
      }),
    });

    if (aiResponse.ok) {
      const data = await aiResponse.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall) {
        const parsed = JSON.parse(toolCall.function.arguments);
        return {
          summary: parsed.executive_summary,
          keyFindings: parsed.key_findings || [],
          recommendations: parsed.recommendations || [],
          riskScore: parsed.risk_score || 0.5,
        };
      }
    }
  } catch (e) {
    console.error("Overall summary generation failed:", e);
  }

  return {
    summary: `Autopilot completed ${tasks.length} tasks.`,
    keyFindings: [],
    recommendations: [],
    riskScore: 0.5,
  };
}
