import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

/**
 * PREDICTIVE ALERT TUNING ENGINE
 * 
 * Uses AI to analyze feedback patterns and:
 * 1. Discover new noise patterns from rejected signals
 * 2. Auto-calibrate relevance thresholds based on feedback trends
 * 3. Identify emerging false-positive categories
 * 4. Propose new blocklist regex patterns
 * 
 * Runs on-demand or via scheduled cron.
 */

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    console.log("[PredictiveAlertTuning] Starting analysis...");

    // ═══ PHASE 1: Gather rejected/irrelevant signals from feedback ═══
    const { data: recentFeedback } = await supabase
      .from("feedback_events")
      .select("object_id, feedback, notes, created_at")
      .eq("object_type", "signal")
      .eq("feedback", "irrelevant")
      .order("created_at", { ascending: false })
      .limit(100);

    const rejectedIds = (recentFeedback || []).map(f => f.object_id).filter(Boolean);
    
    // Also get signals that were manually suppressed (relevance_score = 0)
    const { data: suppressedSignals } = await supabase
      .from("signals")
      .select("id, title, normalized_text, category, relevance_score")
      .eq("relevance_score", 0)
      .order("created_at", { ascending: false })
      .limit(100);

    // Get signals marked irrelevant via feedback
    let rejectedSignals: any[] = [];
    if (rejectedIds.length > 0) {
      const { data } = await supabase
        .from("signals")
        .select("id, title, normalized_text, category, relevance_score")
        .in("id", rejectedIds);
      rejectedSignals = data || [];
    }

    // Combine both sources of noise
    const allNoiseSignals = [...rejectedSignals, ...(suppressedSignals || [])];
    const uniqueNoise = Array.from(new Map(allNoiseSignals.map(s => [s.id, s])).values());

    console.log(`[PredictiveAlertTuning] Analyzing ${uniqueNoise.length} noise signals`);

    if (uniqueNoise.length < 5) {
      return successResponse({
        success: true,
        message: "Insufficient noise data for pattern discovery (need 5+)",
        patterns_discovered: 0,
      });
    }

    // ═══ PHASE 2: Get current clean signals for contrast ═══
    const { data: cleanSignals } = await supabase
      .from("signals")
      .select("id, title, normalized_text, category")
      .gte("relevance_score", 0.6)
      .order("created_at", { ascending: false })
      .limit(50);

    // ═══ PHASE 3: AI analysis for pattern discovery ═══
    const noiseTitles = uniqueNoise.map(s => `- [${s.category || 'unknown'}] ${s.title}`).join("\n");
    const cleanTitles = (cleanSignals || []).slice(0, 20).map(s => `- [${s.category || 'unknown'}] ${s.title}`).join("\n");

    const aiPrompt = `You are a signal intelligence noise filter engineer. Analyze the rejected/noise signals below and compare them to the clean (relevant) signals to discover patterns.

NOISE SIGNALS (rejected/suppressed):
${noiseTitles}

CLEAN SIGNALS (relevant, high-value):
${cleanTitles}

Your task:
1. Identify COMMON PATTERNS in the noise that do NOT appear in clean signals
2. For each pattern, propose a JavaScript regex that would match it
3. Categorize patterns: "career_noise", "lifestyle_spam", "generic_news", "geographic_irrelevant", "vague_titles", "other"
4. Rate confidence (0.0-1.0) that each pattern won't catch legitimate signals

Return ONLY a JSON array of pattern objects. No markdown, no explanation.
Each object: { "pattern": "regex_string", "category": "category", "confidence": 0.8, "description": "what it catches", "example_matches": ["title1", "title2"] }

Rules:
- Patterns must be case-insensitive regex
- Minimum confidence 0.7 to propose
- Must not match any of the clean signal titles
- Focus on the MOST IMPACTFUL patterns (top 5-10)`;

    const aiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GEMINI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a precision regex pattern engineer. Output only valid JSON arrays." },
          { role: "user", content: aiPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("[PredictiveAlertTuning] AI error:", aiResponse.status, errText);
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    let rawContent = aiData.choices?.[0]?.message?.content || "[]";
    
    // Strip markdown code fences if present
    rawContent = rawContent.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();

    let discoveredPatterns: any[] = [];
    try {
      discoveredPatterns = JSON.parse(rawContent);
    } catch (e) {
      console.error("[PredictiveAlertTuning] Failed to parse AI response:", rawContent.substring(0, 200));
      discoveredPatterns = [];
    }

    // ═══ PHASE 4: Validate patterns don't catch clean signals ═══
    const validatedPatterns = [];
    for (const pattern of discoveredPatterns) {
      if (!pattern.pattern || pattern.confidence < 0.7) continue;
      
      try {
        const regex = new RegExp(pattern.pattern, "i");
        
        // Check against clean signals — reject if it matches any
        const falsePositive = (cleanSignals || []).some(s => 
          regex.test(s.title || "") || regex.test(s.normalized_text || "")
        );

        if (falsePositive) {
          console.log(`[PredictiveAlertTuning] Rejected pattern (false positive): ${pattern.pattern}`);
          continue;
        }

        // Count how many noise signals it catches
        const matchCount = uniqueNoise.filter(s => 
          regex.test(s.title || "") || regex.test(s.normalized_text || "")
        ).length;

        if (matchCount < 2) continue; // Need to catch at least 2 noise signals

        validatedPatterns.push({
          ...pattern,
          match_count: matchCount,
          false_positive_check: "passed",
        });
      } catch {
        console.log(`[PredictiveAlertTuning] Invalid regex: ${pattern.pattern}`);
      }
    }

    console.log(`[PredictiveAlertTuning] ${validatedPatterns.length} validated patterns from ${discoveredPatterns.length} proposals`);

    // ═══ PHASE 5: Store proposals for analyst review ═══
    if (validatedPatterns.length > 0) {
      await supabase.from("intelligence_config").upsert({
        key: "predictive_blocklist_proposals",
        value: {
          status: "pending_review",
          generated_at: new Date().toISOString(),
          patterns: validatedPatterns,
          noise_sample_size: uniqueNoise.length,
          clean_sample_size: (cleanSignals || []).length,
        },
      }, { onConflict: "key" });
    }

    // ═══ PHASE 6: Feedback trend analysis ═══
    const { data: allFeedback } = await supabase
      .from("feedback_events")
      .select("feedback, created_at")
      .eq("object_type", "signal")
      .order("created_at", { ascending: false })
      .limit(200);

    let trendAnalysis = { direction: "stable", recommendation: "none" };
    if (allFeedback && allFeedback.length > 20) {
      const recent = allFeedback.slice(0, Math.floor(allFeedback.length / 2));
      const older = allFeedback.slice(Math.floor(allFeedback.length / 2));
      
      const recentIrrelevant = recent.filter(f => f.feedback === "irrelevant").length / recent.length;
      const olderIrrelevant = older.filter(f => f.feedback === "irrelevant").length / older.length;
      
      if (recentIrrelevant > olderIrrelevant + 0.1) {
        trendAnalysis = { 
          direction: "worsening", 
          recommendation: "Noise is increasing — consider raising suppress threshold to 0.45" 
        };
      } else if (recentIrrelevant < olderIrrelevant - 0.1) {
        trendAnalysis = { 
          direction: "improving", 
          recommendation: "Noise is decreasing — current thresholds are effective" 
        };
      }
    }

    // ═══ PHASE 7: Log autonomous action ═══
    await supabase.from("autonomous_actions_log").insert({
      action_type: "predictive_alert_tuning",
      trigger_source: "scheduled",
      action_details: {
        noise_analyzed: uniqueNoise.length,
        patterns_discovered: validatedPatterns.length,
        trend: trendAnalysis,
      },
      status: "completed",
    });

    return successResponse({
      success: true,
      patterns_discovered: validatedPatterns.length,
      validated_patterns: validatedPatterns,
      trend_analysis: trendAnalysis,
      noise_analyzed: uniqueNoise.length,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("[PredictiveAlertTuning] Error:", error);
    return errorResponse(error instanceof Error ? error.message : String(error), 500);
  }
});
