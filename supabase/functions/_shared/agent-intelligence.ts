/**
 * Agent Intelligence Module — Advanced reasoning upgrades for Fortress AI agents
 * 
 * Capabilities:
 * 1. Chain-of-Thought (CoT) structured reasoning
 * 2. Evidence-grounded citation enforcement
 * 3. Adversarial self-review (critic pass)
 * 4. Cross-agent learning (multi-agent memory retrieval)
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway } from "./ai-gateway.ts";

// ─── 1. CHAIN-OF-THOUGHT REASONING ───────────────────────────────────────────

/**
 * Generates the Chain-of-Thought reasoning framework block.
 * Forces agents to decompose problems into explicit reasoning steps.
 */
export function getChainOfThoughtPrompt(): string {
  return `
┌─────────────────────────────────────────────────────────────────────────────┐
│              CHAIN-OF-THOUGHT REASONING PROTOCOL (MANDATORY)                │
└─────────────────────────────────────────────────────────────────────────────┘

You MUST structure your analysis using explicit reasoning steps. Do NOT jump to conclusions.

**STEP 1 — OBSERVATION (What do I see?)**
List every concrete data point from the provided evidence. No interpretation yet.
Format: "I observe: [exact field] = [exact value] from [source]"

**STEP 2 — DECOMPOSITION (What sub-questions does this raise?)**
Break the investigation into 3-5 specific sub-questions that need answering.
Format: "Q1: [specific question]? Relevant because: [reason]"

**STEP 3 — HYPOTHESIS GENERATION (What could explain this?)**
For each sub-question, propose 2-3 competing hypotheses ranked by likelihood.
Format: "H1a (most likely): [hypothesis] — supported by [evidence]"
Format: "H1b (alternative): [hypothesis] — would require [missing evidence]"

**STEP 4 — EVIDENCE MAPPING (What supports or contradicts each hypothesis?)**
For each hypothesis, explicitly list:
- Supporting evidence: [cite specific data]
- Contradicting evidence: [cite specific data]
- Missing evidence: [what would confirm/deny this]

**STEP 5 — SYNTHESIS (What is my assessment?)**
Select the best-supported hypothesis for each sub-question.
State your confidence level and the specific evidence that drives it.
Acknowledge what you cannot determine.

**STEP 6 — RECOMMENDATIONS (What should be done?)**
Each recommendation must trace back to a specific finding in Steps 1-5.
Format: "Because [finding from Step X], I recommend [specific action]"

CRITICAL: Show your reasoning. Do not skip steps. Shallow analysis = mission failure.
`;
}


// ─── 2. EVIDENCE-GROUNDED CITATION SYSTEM ────────────────────────────────────

/**
 * Generates the evidence citation enforcement block.
 * Requires agents to anchor every claim to specific data points.
 */
export function getEvidenceCitationPrompt(): string {
  return `
┌─────────────────────────────────────────────────────────────────────────────┐
│              EVIDENCE-GROUNDED CITATION PROTOCOL (MANDATORY)                │
└─────────────────────────────────────────────────────────────────────────────┘

Every factual claim in your analysis MUST include an inline evidence citation.

**CITATION FORMAT:**
- Database field: [EVD: field_name = "exact_value"]
- Signal data: [EVD: signal.field = "value" | signal_id: xxx]
- Incident data: [EVD: incident.field = "value" | incident_id: xxx]
- Memory reference: [EVD: memory #N | similarity: XX%]
- Graph connection: [EVD: graph_edge | type: entity_overlap | strength: 0.X]
- Absence of evidence: [EVD: NO DATA for field_name]

**CITATION RULES:**
1. Claims without citations are FORBIDDEN — they will be flagged and rejected
2. Use EXACT values from the data — no paraphrasing numbers, dates, or names
3. When combining multiple data points, cite each one separately
4. If you infer something, explicitly state: "INFERENCE based on [EVD: ...]"
5. Confidence must correlate to citation density:
   - HIGH confidence: 3+ independent citations supporting the claim
   - MEDIUM confidence: 1-2 citations with logical inference
   - LOW confidence: inference without direct citation — MUST be labeled

**EXAMPLE:**
✗ BAD: "The threat level is increasing in the region"
✓ GOOD: "Signal volume for this client increased from 3 to 7 signals in 48h 
   [EVD: temporal_cluster | window: 48h] with entity overlap on 'pipeline' 
   [EVD: graph_edge | type: entity_overlap | strength: 0.6], suggesting 
   INFERENCE: coordinated interest in infrastructure [confidence: MEDIUM]"
`;
}


// ─── 3. ADVERSARIAL SELF-REVIEW ──────────────────────────────────────────────

/**
 * Runs an adversarial self-review pass on the agent's initial analysis.
 * The agent re-reads its own output as a "red team" critic and strengthens weak reasoning.
 */
export async function runAdversarialReview(
  initialAnalysis: string,
  agentCallSign: string,
  agentSpecialty: string,
  incidentContext: string,
  model: string
): Promise<{ reviewedAnalysis: string; weaknessesFound: number; reviewNotes: string }> {
  const criticPrompt = `You are the ADVERSARIAL REVIEWER for agent ${agentCallSign}.
Your role: ruthlessly critique the analysis below, then produce an IMPROVED version.

ORIGINAL ANALYSIS BY ${agentCallSign}:
---
${initialAnalysis}
---

AVAILABLE EVIDENCE:
---
${incidentContext.substring(0, 3000)}
---

REVIEW CHECKLIST — Evaluate each item:
1. UNSUPPORTED CLAIMS: Are there assertions without [EVD:] citations? Flag each one.
2. LOGICAL GAPS: Does the reasoning chain have missing steps? Where does it jump?
3. ALTERNATIVE HYPOTHESES: Were competing explanations adequately considered?
4. CONFIDENCE CALIBRATION: Are confidence levels justified by citation density?
5. SPECIFICITY: Are recommendations actionable (who/what/when/where)?
6. BIAS CHECK: Is the analysis anchored in evidence or projecting assumptions?
7. MISSING ANGLES: What ${agentSpecialty}-relevant factors were overlooked?

OUTPUT FORMAT:
**WEAKNESSES IDENTIFIED:** [count]
**REVIEW NOTES:**
[List each weakness with specific line reference and fix]

**STRENGTHENED ANALYSIS:**
[Rewrite the analysis addressing ALL identified weaknesses. Add missing citations.
Strengthen reasoning chains. Include alternative hypotheses where omitted.
Keep the same structure but make every claim evidence-grounded.]`;

  try {
    const reviewResult = await callAiGateway({
      model,
      messages: [
        { role: 'system', content: `You are a senior intelligence reviewer specializing in ${agentSpecialty}. Your job is to find flaws and strengthen analysis. Be thorough but constructive.` },
        { role: 'user', content: criticPrompt }
      ],
      functionName: 'agent-intelligence-review',
      extraBody: {
        ...(model.startsWith('openai/') ? { max_completion_tokens: 4000 } : { max_tokens: 4000 }),
        temperature: 0.3, // Lower temperature for precise critique
      },
    });

    if (reviewResult.error || !reviewResult.content) {
      console.warn(`[AdversarialReview] Review failed for ${agentCallSign}, using original analysis`);
      return { reviewedAnalysis: initialAnalysis, weaknessesFound: 0, reviewNotes: 'Review unavailable' };
    }

    const content = reviewResult.content;
    
    // Extract weakness count
    const weaknessMatch = content.match(/WEAKNESSES IDENTIFIED:\s*(\d+)/i);
    const weaknessesFound = weaknessMatch ? parseInt(weaknessMatch[1]) : 0;

    // Extract review notes
    const notesMatch = content.match(/REVIEW NOTES:([\s\S]*?)(?=STRENGTHENED ANALYSIS:|$)/i);
    const reviewNotes = notesMatch ? notesMatch[1].trim().substring(0, 500) : '';

    // Extract strengthened analysis
    const strengthenedMatch = content.match(/STRENGTHENED ANALYSIS:([\s\S]*)/i);
    const reviewedAnalysis = strengthenedMatch ? strengthenedMatch[1].trim() : content;

    console.log(`[AdversarialReview] ${agentCallSign}: Found ${weaknessesFound} weaknesses, analysis strengthened`);
    return { reviewedAnalysis, weaknessesFound, reviewNotes };
  } catch (err) {
    console.error(`[AdversarialReview] Error:`, err);
    return { reviewedAnalysis: initialAnalysis, weaknessesFound: 0, reviewNotes: 'Review error' };
  }
}


// ─── 4. CROSS-AGENT LEARNING ─────────────────────────────────────────────────

/**
 * Retrieves memories from ALL agents (not just the current one) that are relevant
 * to the current investigation. This enables cross-pollination of insights.
 */
export async function retrieveCrossAgentInsights(
  supabase: SupabaseClient,
  currentAgent: string,
  queryText: string,
  maxPerAgent: number = 3
): Promise<{ agentCallSign: string; content: string; confidence: number; memory_type: string }[]> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) return [];

  try {
    // Generate query embedding
    const embResponse = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: queryText.substring(0, 8000),
      }),
    });

    if (!embResponse.ok) return [];

    const embData = await embResponse.json();
    const queryEmbedding = embData.data?.[0]?.embedding;
    if (!queryEmbedding) return [];

    // Query memories from OTHER agents (cross-agent learning)
    const { data: memories, error } = await supabase.rpc('match_cross_agent_memories', {
      p_exclude_agent: currentAgent,
      p_query_embedding: JSON.stringify(queryEmbedding),
      p_match_threshold: 0.70, // Higher threshold for cross-agent to ensure relevance
      p_match_count: maxPerAgent * 5, // Fetch more, then deduplicate per agent
    });

    if (error) {
      // Fallback: if RPC doesn't exist yet, do a basic keyword search
      console.warn('[CrossAgentLearning] RPC not available, using keyword fallback:', error.message);
      return await keywordFallbackSearch(supabase, currentAgent, queryText);
    }

    // Deduplicate: max N per agent
    const perAgentCount: Record<string, number> = {};
    const results: { agentCallSign: string; content: string; confidence: number; memory_type: string }[] = [];

    for (const mem of memories || []) {
      const agent = mem.agent_call_sign;
      perAgentCount[agent] = (perAgentCount[agent] || 0) + 1;
      if (perAgentCount[agent] <= maxPerAgent) {
        results.push({
          agentCallSign: agent,
          content: mem.content,
          confidence: mem.confidence || 0.5,
          memory_type: mem.memory_type || 'investigation',
        });
      }
    }

    return results;
  } catch (err) {
    console.error('[CrossAgentLearning] Error:', err);
    return [];
  }
}

/**
 * Keyword-based fallback when vector search RPC isn't available
 */
async function keywordFallbackSearch(
  supabase: SupabaseClient,
  excludeAgent: string,
  queryText: string
): Promise<{ agentCallSign: string; content: string; confidence: number; memory_type: string }[]> {
  // Extract key terms from query
  const words = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const keyTerms = words.slice(0, 5);

  if (keyTerms.length === 0) return [];

  const { data: memories } = await supabase
    .from('agent_investigation_memory')
    .select('agent_call_sign, content, confidence, memory_type')
    .neq('agent_call_sign', excludeAgent)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!memories) return [];

  // Simple relevance scoring
  return memories
    .map(m => {
      const contentLower = m.content.toLowerCase();
      const matchCount = keyTerms.filter(t => contentLower.includes(t)).length;
      return { ...m, agentCallSign: m.agent_call_sign, matchScore: matchCount / keyTerms.length };
    })
    .filter(m => m.matchScore > 0.3)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 10)
    .map(({ agentCallSign, content, confidence, memory_type }) => ({
      agentCallSign,
      content: content.substring(0, 300),
      confidence: confidence || 0.5,
      memory_type: memory_type || 'investigation',
    }));
}

/**
 * Build a cross-agent insights context block for injection into prompts
 */
export async function buildCrossAgentContext(
  supabase: SupabaseClient,
  currentAgent: string,
  incidentContext: string
): Promise<string> {
  const insights = await retrieveCrossAgentInsights(supabase, currentAgent, incidentContext);

  if (insights.length === 0) {
    return '\n=== CROSS-AGENT INTELLIGENCE ===\nNo relevant findings from other agents.\n';
  }

  // Group by agent
  const byAgent: Record<string, typeof insights> = {};
  for (const ins of insights) {
    if (!byAgent[ins.agentCallSign]) byAgent[ins.agentCallSign] = [];
    byAgent[ins.agentCallSign].push(ins);
  }

  const lines: string[] = [];
  for (const [agent, findings] of Object.entries(byAgent)) {
    lines.push(`\n[${agent}] shared findings:`);
    for (const f of findings) {
      lines.push(`  • (${f.memory_type}, confidence: ${(f.confidence * 100).toFixed(0)}%) ${f.content.substring(0, 250)}`);
    }
  }

  return `\n=== CROSS-AGENT INTELLIGENCE (${insights.length} findings from ${Object.keys(byAgent).length} agents) ===
${lines.join('\n')}
INSTRUCTION: Consider these findings from peer agents. Corroborate, challenge, or extend them.
Do NOT blindly trust — apply your own specialty lens and cite supporting/contradicting evidence.
`;
}


// ─── COMBINED INTELLIGENCE PROMPT ────────────────────────────────────────────

/**
 * Returns the full intelligence upgrade prompt combining all four capabilities.
 * Inject this into the agent's system prompt.
 */
export function getIntelligenceUpgradePrompt(): string {
  return `${getChainOfThoughtPrompt()}\n${getEvidenceCitationPrompt()}`;
}
