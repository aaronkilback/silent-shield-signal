/**
 * Structured Debate Protocol
 * 
 * Replaces free-text agent debates with formal tool-calling schemas.
 * Agents submit typed Hypothesis, CounterArgument, and EvidenceCitation
 * objects, creating an auditable analytical record.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway } from "./ai-gateway.ts";

// ═══════════════════════════════════════════════════════════════
//  STRUCTURED ARGUMENT TYPES
// ═══════════════════════════════════════════════════════════════

export interface Hypothesis {
  claim: string;
  confidence: number;
  evidenceIds: string[];
  evidenceSummary: string;
  strength: 'weak' | 'moderate' | 'strong' | 'definitive';
}

export interface CounterArgument {
  targetsHypothesisIndex: number;
  claim: string;
  confidence: number;
  evidenceIds: string[];
  evidenceSummary: string;
  strength: 'weak' | 'moderate' | 'strong' | 'definitive';
}

export interface EvidenceCitation {
  sourceType: 'signal' | 'incident' | 'entity' | 'osint' | 'expert_knowledge';
  sourceId: string;
  excerpt: string;
  relevanceScore: number;
}

export interface StructuredAnalysis {
  hypotheses: Hypothesis[];
  counterArguments: CounterArgument[];
  evidenceCitations: EvidenceCitation[];
  overallAssessment: string;
  confidenceLevel: number;
}

// Tool definition for structured debate output
export const STRUCTURED_DEBATE_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'submit_structured_analysis',
      description: 'Submit your structured analysis with formal hypotheses, counter-arguments, and evidence citations.',
      parameters: {
        type: 'object',
        properties: {
          hypotheses: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                claim: { type: 'string', description: 'The hypothesis statement' },
                confidence: { type: 'number', description: '0-1 confidence level' },
                evidence_ids: { type: 'array', items: { type: 'string' }, description: 'IDs of supporting signals/incidents' },
                evidence_summary: { type: 'string', description: 'Brief summary of supporting evidence' },
                strength: { type: 'string', enum: ['weak', 'moderate', 'strong', 'definitive'] },
              },
              required: ['claim', 'confidence', 'evidence_summary', 'strength'],
            },
            description: 'Formal hypotheses with evidence and confidence levels',
          },
          counter_arguments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                targets_hypothesis_index: { type: 'number', description: 'Index of the hypothesis this counters' },
                claim: { type: 'string', description: 'The counter-argument' },
                confidence: { type: 'number', description: '0-1 confidence level' },
                evidence_ids: { type: 'array', items: { type: 'string' }, description: 'IDs of supporting evidence' },
                evidence_summary: { type: 'string' },
                strength: { type: 'string', enum: ['weak', 'moderate', 'strong', 'definitive'] },
              },
              required: ['targets_hypothesis_index', 'claim', 'confidence', 'strength'],
            },
            description: 'Counter-arguments targeting specific hypotheses',
          },
          evidence_citations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source_type: { type: 'string', enum: ['signal', 'incident', 'entity', 'osint', 'expert_knowledge'] },
                source_id: { type: 'string' },
                excerpt: { type: 'string', description: 'Relevant excerpt from source' },
                relevance_score: { type: 'number', description: '0-1 relevance' },
              },
              required: ['source_type', 'excerpt', 'relevance_score'],
            },
          },
          overall_assessment: { type: 'string', description: 'Unified assessment of the situation' },
          confidence_level: { type: 'number', description: '0-1 overall confidence' },
        },
        required: ['hypotheses', 'overall_assessment', 'confidence_level'],
      },
    },
  },
];

// Synthesis tool for the judge
export const STRUCTURED_SYNTHESIS_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'submit_synthesis',
      description: 'Synthesize multiple structured analyses into a final assessment.',
      parameters: {
        type: 'object',
        properties: {
          consensus_hypotheses: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                claim: { type: 'string' },
                supporting_agents: { type: 'array', items: { type: 'string' } },
                combined_confidence: { type: 'number' },
                strength: { type: 'string', enum: ['weak', 'moderate', 'strong', 'definitive'] },
                evidence_count: { type: 'number' },
              },
              required: ['claim', 'supporting_agents', 'combined_confidence', 'strength'],
            },
            description: 'Hypotheses where agents agree',
          },
          contested_findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                topic: { type: 'string' },
                positions: { type: 'array', items: { type: 'object', properties: { agent: { type: 'string' }, position: { type: 'string' }, confidence: { type: 'number' } }, required: ['agent', 'position', 'confidence'] } },
                ruling: { type: 'string', description: 'Judge ruling on contested finding' },
                ruling_confidence: { type: 'number' },
              },
              required: ['topic', 'positions', 'ruling'],
            },
            description: 'Findings where agents disagree',
          },
          unique_insights: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                insight: { type: 'string' },
                discovered_by: { type: 'string' },
                importance: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
              },
              required: ['insight', 'discovered_by', 'importance'],
            },
            description: 'Insights caught by only one analyst',
          },
          final_assessment: { type: 'string' },
          consensus_score: { type: 'number', description: '0-100 agreement level' },
          recommended_actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string' },
                priority: { type: 'string', enum: ['immediate', 'urgent', 'routine', 'deferred'] },
                owner_suggestion: { type: 'string' },
              },
              required: ['action', 'priority'],
            },
          },
          confidence_level: { type: 'number' },
        },
        required: ['consensus_hypotheses', 'final_assessment', 'consensus_score', 'recommended_actions', 'confidence_level'],
      },
    },
  },
];

/**
 * Store structured debate arguments in the database.
 */
export async function storeStructuredArguments(
  supabase: ReturnType<typeof createClient>,
  debateId: string,
  agentCallSign: string,
  analysis: any // raw tool call arguments
): Promise<void> {
  const records: any[] = [];

  // Store hypotheses
  if (analysis.hypotheses) {
    for (const h of analysis.hypotheses) {
      records.push({
        debate_id: debateId,
        agent_call_sign: agentCallSign,
        argument_type: 'hypothesis',
        claim: h.claim,
        confidence: h.confidence || 0.5,
        evidence_ids: h.evidence_ids || [],
        evidence_summary: h.evidence_summary || '',
        strength: h.strength || 'moderate',
        metadata: {},
      });
    }
  }

  // Store counter-arguments
  if (analysis.counter_arguments) {
    for (const ca of analysis.counter_arguments) {
      records.push({
        debate_id: debateId,
        agent_call_sign: agentCallSign,
        argument_type: 'counter_argument',
        claim: ca.claim,
        confidence: ca.confidence || 0.5,
        evidence_ids: ca.evidence_ids || [],
        evidence_summary: ca.evidence_summary || '',
        strength: ca.strength || 'moderate',
        metadata: { targets_hypothesis_index: ca.targets_hypothesis_index },
      });
    }
  }

  // Store evidence citations
  if (analysis.evidence_citations) {
    for (const ec of analysis.evidence_citations) {
      records.push({
        debate_id: debateId,
        agent_call_sign: agentCallSign,
        argument_type: 'evidence_citation',
        claim: ec.excerpt,
        confidence: ec.relevance_score || 0.5,
        evidence_ids: ec.source_id ? [ec.source_id] : [],
        evidence_summary: `${ec.source_type}: ${ec.excerpt}`,
        strength: ec.relevance_score > 0.8 ? 'strong' : ec.relevance_score > 0.5 ? 'moderate' : 'weak',
        metadata: { source_type: ec.source_type },
      });
    }
  }

  if (records.length > 0) {
    const { error } = await supabase.from('structured_debate_arguments').insert(records);
    if (error) console.error(`[StructuredDebate] Failed to store arguments for ${agentCallSign}:`, error);
    else console.log(`[StructuredDebate] Stored ${records.length} arguments for ${agentCallSign}`);
  }
}
