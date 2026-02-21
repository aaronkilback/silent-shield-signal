/**
 * Structured Assessment Schemas
 * 
 * Tool-calling schemas for critical AEGIS operations.
 * Forces typed, constrained output instead of free-text JSON —
 * preventing narrative drift and hallucinated fields.
 */

/**
 * Threat assessment tool schema — used for signal analysis responses
 * that require structured output with source citations.
 */
export const THREAT_ASSESSMENT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'deliver_threat_assessment',
    description: 'Deliver a structured threat assessment with source-verified citations. Use this when analyzing signals, incidents, or threat intelligence.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Concise 1-2 sentence summary of the assessment (conversational tone)',
        },
        threat_level: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low', 'informational'],
          description: 'Overall threat level based on evidence',
        },
        confidence: {
          type: 'number',
          description: 'Assessment confidence 0.0-1.0 based on evidence quality',
        },
        confidence_basis: {
          type: 'string',
          enum: ['multiple_sources', 'single_verified_source', 'analyst_judgment', 'insufficient_data'],
          description: 'What the confidence score is based on',
        },
        key_findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              finding: { type: 'string', description: 'The factual finding' },
              source_type: {
                type: 'string',
                enum: ['signal', 'incident', 'entity', 'document', 'tool_result', 'assessment'],
                description: 'Type of source backing this finding',
              },
              source_id: {
                type: 'string',
                description: 'UUID of the source record, or "analyst_judgment" for assessments',
              },
              verified: {
                type: 'boolean',
                description: 'Whether this finding is directly verified from source data (true) or analytical inference (false)',
              },
            },
            required: ['finding', 'source_type', 'verified'],
          },
          description: 'Key findings with source citations (3-7 items)',
        },
        recommended_actions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Recommended next steps (2-5 items)',
        },
        unverified_assessments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Analytical judgments that are NOT backed by direct evidence — explicitly separated from facts',
        },
        correlation_status: {
          type: 'string',
          enum: ['correlated', 'isolated', 'insufficient_data'],
          description: 'Whether this signal/incident correlates with others based on DIRECT evidence',
        },
        correlation_evidence: {
          type: 'string',
          description: 'Specific evidence for correlation (shared actors, explicit references) or "No direct evidence" if isolated',
        },
      },
      required: ['summary', 'threat_level', 'confidence', 'confidence_basis', 'key_findings', 'recommended_actions', 'correlation_status'],
    },
  },
};

/**
 * Incident summary tool schema — used for structured incident briefings
 */
export const INCIDENT_SUMMARY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'deliver_incident_summary',
    description: 'Deliver a structured incident summary with verified facts separated from analytical assessments.',
    parameters: {
      type: 'object',
      properties: {
        headline: {
          type: 'string',
          description: 'One-line incident headline (conversational, not bureaucratic)',
        },
        priority: {
          type: 'string',
          enum: ['p1', 'p2', 'p3', 'p4'],
        },
        status: {
          type: 'string',
          enum: ['active', 'monitoring', 'contained', 'resolved'],
        },
        verified_facts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fact: { type: 'string' },
              source_id: { type: 'string', description: 'UUID of source signal/incident/document' },
              timestamp: { type: 'string', description: 'ISO timestamp of when this was established' },
            },
            required: ['fact'],
          },
          description: 'Facts confirmed by tool data — no inferences',
        },
        analyst_assessments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Analytical judgments explicitly marked as inference, not fact',
        },
        timeline: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'string' },
              event: { type: 'string' },
              source: { type: 'string', description: 'Where this timeline entry came from' },
            },
            required: ['event'],
          },
          description: 'Chronological timeline of events',
        },
        recommended_actions: {
          type: 'array',
          items: { type: 'string' },
        },
        data_gaps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Information we do NOT have that would improve this assessment',
        },
      },
      required: ['headline', 'priority', 'status', 'verified_facts', 'recommended_actions'],
    },
  },
};

/**
 * Multi-model consensus assessment tool — used by consensus engine
 * to force structured output instead of free-text JSON parsing
 */
export const CONSENSUS_ASSESSMENT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_assessment',
    description: 'Submit a structured signal assessment for multi-model consensus validation.',
    parameters: {
      type: 'object',
      properties: {
        assessment: {
          type: 'string',
          enum: ['relevant', 'irrelevant', 'requires_investigation'],
          description: 'Signal relevance determination',
        },
        confidence: {
          type: 'number',
          description: 'Assessment confidence 0.0-1.0',
        },
        recommended_priority: {
          type: 'string',
          enum: ['p1', 'p2', 'p3', 'p4'],
          description: 'Recommended incident priority',
        },
        key_factors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key factors supporting this assessment (3-5 items)',
        },
        reasoning: {
          type: 'string',
          description: 'Brief explanation (max 50 words)',
        },
      },
      required: ['assessment', 'confidence', 'recommended_priority', 'key_factors', 'reasoning'],
    },
  },
};
