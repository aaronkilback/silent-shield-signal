import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface IndustryStandardsRequest {
  industry: string;
  standard_type?: string;
  focus_area?: string;
  include_best_practices?: boolean;
}

// Known industry standards registry
const INDUSTRY_STANDARDS: Record<string, Record<string, any>> = {
  'energy': {
    'NERC CIP': {
      full_name: 'North American Electric Reliability Corporation Critical Infrastructure Protection',
      description: 'Cybersecurity standards for bulk power system',
      standards: ['CIP-002 through CIP-014'],
      governing_body: 'NERC',
      url: 'https://www.nerc.com/pa/Stand/Pages/CIPStandards.aspx',
    },
    'API Security Guidelines': {
      full_name: 'American Petroleum Institute Security Guidelines',
      description: 'Security guidelines for petroleum and natural gas industries',
      key_documents: ['API 1164', 'API RP 780', 'API RP 781'],
      governing_body: 'American Petroleum Institute',
    },
    'CSA Z246.1': {
      full_name: 'Security management for petroleum and natural gas industry systems',
      description: 'Canadian standard for oil and gas security management',
      governing_body: 'CSA Group',
    },
    'CEPA Security Guidelines': {
      full_name: 'Canadian Energy Pipeline Association Security Guidelines',
      description: 'Security best practices for pipeline operators',
      governing_body: 'CEPA',
    },
  },
  'security_services': {
    'ASIS Physical Security Guidelines': {
      full_name: 'ASIS International Physical Security Guidelines',
      key_documents: ['ASIS PSC.1', 'ASIS PAP Guidelines'],
      governing_body: 'ASIS International',
      url: 'https://www.asisonline.org',
    },
    'CANASA Standards': {
      full_name: 'Canadian Security Association Standards',
      description: 'Canadian standards for security service providers',
      governing_body: 'CANASA',
    },
    'ISO 18788': {
      full_name: 'Management system for private security operations',
      description: 'International standard for private security companies',
      governing_body: 'ISO',
    },
    'ANSI/ASIS PSC.1': {
      full_name: 'Management System for Quality of Private Security Company Operations',
      description: 'US standard aligned with ISO 18788',
      governing_body: 'ASIS International',
    },
  },
  'information_security': {
    'ISO 27001': {
      full_name: 'Information security management systems',
      description: 'International standard for information security management',
      governing_body: 'ISO',
    },
    'NIST Cybersecurity Framework': {
      full_name: 'NIST Cybersecurity Framework',
      description: 'Framework for improving critical infrastructure cybersecurity',
      governing_body: 'NIST',
      url: 'https://www.nist.gov/cyberframework',
    },
    'SOC 2': {
      full_name: 'Service Organization Control 2',
      description: 'Trust services criteria for service organizations',
      governing_body: 'AICPA',
    },
  },
  'workplace_safety': {
    'OSHA Standards': {
      full_name: 'Occupational Safety and Health Administration Standards',
      description: 'US workplace safety standards',
      governing_body: 'OSHA',
    },
    'CSA Z1000': {
      full_name: 'Occupational health and safety management',
      description: 'Canadian OHS management system standard',
      governing_body: 'CSA Group',
    },
    'ISO 45001': {
      full_name: 'Occupational health and safety management systems',
      description: 'International OHS standard',
      governing_body: 'ISO',
    },
  },
  'a_and_d_policy': {
    'CCSA Model Policy': {
      full_name: 'Canadian Centre on Substance Abuse Model Policy',
      description: 'Model alcohol and drug policy framework',
      governing_body: 'CCSA',
    },
    'Safety Sensitive Position Guidelines': {
      full_name: 'Guidelines for A&D Testing in Safety Sensitive Positions',
      description: 'Best practices for workplace drug testing',
      key_considerations: ['Random testing', 'Post-incident testing', 'Reasonable cause testing'],
    },
    'Construction Owners Association of Alberta (COAA)': {
      full_name: 'COAA Canadian Model for Providing a Safe Workplace',
      description: 'Alcohol and drug guidelines for construction industry',
      governing_body: 'COAA',
    },
  },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('GEMINI_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { 
      industry, 
      standard_type,
      focus_area,
      include_best_practices = true 
    }: IndustryStandardsRequest = await req.json();

    if (!industry) {
      return new Response(
        JSON.stringify({ error: 'industry is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize industry
    const normalizedIndustry = industry.toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/__+/g, '_');

    // Get standards from registry
    const industryStandards = INDUSTRY_STANDARDS[normalizedIndustry] || {};
    
    // Also check related industries
    const relatedStandards: Record<string, any> = {};
    if (normalizedIndustry.includes('energy') || normalizedIndustry.includes('oil') || normalizedIndustry.includes('gas')) {
      Object.assign(relatedStandards, INDUSTRY_STANDARDS['energy']);
    }
    if (normalizedIndustry.includes('security')) {
      Object.assign(relatedStandards, INDUSTRY_STANDARDS['security_services']);
    }

    // Check knowledge base for stored standards documents
    const { data: kbDocs } = await supabase
      .from('archival_documents')
      .select('id, filename, summary, content_text, tags')
      .or(`tags.cs.{${industry}},summary.ilike.%${industry}%,summary.ilike.%standard%`)
      .limit(5);

    // Build AI prompt
    const standardsPrompt = `You are an industry standards expert specializing in security, safety, and compliance frameworks.

Standards Request:
- Industry: ${industry}
- Standard Type: ${standard_type || 'All applicable standards'}
- Focus Area: ${focus_area || 'General overview'}
- Include Best Practices: ${include_best_practices}

Known Standards in Registry:
${Object.keys(industryStandards).length > 0 
  ? Object.entries(industryStandards).map(([name, info]: [string, any]) => 
      `- ${name}: ${info.description || info.full_name}`
    ).join('\n')
  : 'No specific standards found in registry for this industry.'}

${Object.keys(relatedStandards).length > 0 
  ? `\nRelated Industry Standards:\n${Object.entries(relatedStandards).map(([name, info]: [string, any]) => 
      `- ${name}: ${info.description || info.full_name}`
    ).join('\n')}`
  : ''}

${kbDocs && kbDocs.length > 0 ? `
Internal Knowledge Base Documents:
${kbDocs.map(doc => `- ${doc.filename}: ${doc.summary || 'No summary'}`).join('\n')}
` : ''}

Please provide comprehensive information about applicable industry standards including:

1. **Primary Standards**:
   - Mandatory regulatory standards
   - Voluntary industry standards
   - Certification requirements

2. **Best Practices** (if requested):
   - Industry-accepted practices
   - Emerging standards and trends
   - Implementation guidelines

3. **Compliance Framework**:
   - How to achieve compliance
   - Common gaps and challenges
   - Audit and certification processes

4. **Security-Specific Considerations**:
   - Physical security requirements
   - Personnel security standards
   - Incident response protocols

5. **Canadian-Specific Requirements**:
   - Provincial variations (BC, Alberta)
   - Federal requirements
   - Industry association standards

Format as structured JSON:
{
  "industry": "string",
  "applicable_standards": [
    {
      "name": "string",
      "full_name": "string",
      "type": "mandatory|voluntary|best_practice",
      "governing_body": "string",
      "description": "string",
      "key_requirements": ["string"],
      "certification_available": boolean,
      "url": "string"
    }
  ],
  "best_practices": [
    {
      "area": "string",
      "practice": "string",
      "implementation_guidance": "string"
    }
  ],
  "compliance_roadmap": {
    "steps": ["string"],
    "common_challenges": ["string"],
    "resources": ["string"]
  },
  "canadian_considerations": {
    "federal": ["string"],
    "bc_specific": ["string"],
    "alberta_specific": ["string"]
  },
  "recommendations": ["string"]
}`;

    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiResult = await callAiGateway({
      model: 'gemini-2.5-pro',
      messages: [
        { role: 'system', content: 'You are an industry standards expert with deep knowledge of security, safety, and compliance frameworks across Canadian industries. Provide accurate, actionable guidance.' },
        { role: 'user', content: standardsPrompt }
      ],
      functionName: 'access-industry-standards',
      extraBody: { temperature: 0.3, max_tokens: 4000 },
    });

    if (aiResult.error) {
      console.error('AI API error:', aiResult.error);
      return new Response(
        JSON.stringify({ error: 'Failed to access industry standards', details: aiResult.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const responseContent = aiResult.content || '';

    // Parse response
    let standardsResults;
    try {
      const jsonMatch = responseContent.match(/```json\n?([\s\S]*?)\n?```/) || 
                        responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        standardsResults = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } else {
        standardsResults = { raw_response: responseContent };
      }
    } catch {
      standardsResults = { raw_response: responseContent };
    }

    return new Response(
      JSON.stringify({
        success: true,
        request: { industry, standard_type, focus_area },
        registry_standards: industryStandards,
        related_standards: relatedStandards,
        standards_analysis: standardsResults,
        knowledge_base_matches: kbDocs || [],
        retrieved_at: new Date().toISOString(),
        disclaimer: 'Industry standards evolve. Always verify current requirements with governing bodies and consider consulting with compliance specialists.'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in access-industry-standards:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
