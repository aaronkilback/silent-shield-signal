import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

interface RegulatoryDocumentRequest {
  jurisdiction: string;
  document_name: string;
  section_or_part?: string;
  document_type?: 'act' | 'regulation' | 'standard' | 'guideline' | 'policy';
}

// Known regulatory documents and their key information
const REGULATORY_DOCUMENTS: Record<string, Record<string, Record<string, unknown>>> = {
  'BC': {
    'Security Services Act': {
      full_name: 'Security Services Act, SBC 2007, c 30',
      type: 'act',
      governing_body: 'Security Programs & Police Technology Division',
      key_sections: {
        'Part 1': 'Interpretation and Application',
        'Part 2': 'Licensing of Security Businesses',
        'Part 3': 'Licensing of Security Workers',
        'Part 4': 'Conduct and Discipline',
        'Part 5': 'Registrar and Administration',
        'Part 6': 'Offences and Penalties',
      },
      url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/07030_01',
      last_amended: '2023',
    },
    'Security Services Regulation': {
      full_name: 'Security Services Regulation, BC Reg 207/2008',
      type: 'regulation',
      governing_body: 'Security Programs & Police Technology Division',
      key_sections: {
        'Part 1': 'Definitions',
        'Part 2': 'Licensing Requirements',
        'Part 3': 'Training Standards',
        'Part 4': 'Use of Force Guidelines',
      },
      url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/207_2008',
    },
    'Workers Compensation Act': {
      full_name: 'Workers Compensation Act, RSBC 2019, c 1',
      type: 'act',
      governing_body: 'WorkSafeBC',
      url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/19001',
    },
    'Occupational Health and Safety Regulation': {
      full_name: 'Occupational Health and Safety Regulation, BC Reg 296/97',
      type: 'regulation',
      governing_body: 'WorkSafeBC',
      url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/296_97',
    },
    'Personal Information Protection Act': {
      full_name: 'Personal Information Protection Act, SBC 2003, c 63',
      type: 'act',
      governing_body: 'Office of the Information and Privacy Commissioner',
      url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/03063_01',
    },
  },
  'Alberta': {
    'Security Services and Investigators Act': {
      full_name: 'Security Services and Investigators Act, SA 2008, c S-4.7',
      type: 'act',
      governing_body: 'Alberta Solicitor General and Public Security',
      key_sections: {
        'Part 1': 'Interpretation and Application',
        'Part 2': 'Licensing',
        'Part 3': 'Conduct',
        'Part 4': 'Enforcement',
      },
      url: 'https://www.qp.alberta.ca/documents/Acts/S04P7.pdf',
      last_amended: '2022',
    },
    'Security Services and Investigators Regulation': {
      full_name: 'Security Services and Investigators Regulation, Alta Reg 54/2010',
      type: 'regulation',
      governing_body: 'Alberta Solicitor General and Public Security',
      url: 'https://www.qp.alberta.ca/documents/Regs/2010_054.pdf',
    },
    'Occupational Health and Safety Act': {
      full_name: 'Occupational Health and Safety Act, RSA 2020, c O-2.2',
      type: 'act',
      governing_body: 'Alberta Labour and Immigration',
      url: 'https://www.qp.alberta.ca/documents/Acts/O02P2.pdf',
    },
    'Personal Information Protection Act': {
      full_name: 'Personal Information Protection Act, SA 2003, c P-6.5',
      type: 'act',
      governing_body: 'Office of the Information and Privacy Commissioner of Alberta',
      url: 'https://www.qp.alberta.ca/documents/Acts/P06P5.pdf',
    },
    'Private Investigators and Security Guards Act': {
      full_name: 'Private Investigators and Security Guards Act (historical)',
      type: 'act',
      note: 'Replaced by Security Services and Investigators Act',
      status: 'repealed',
    },
  },
  'Canada': {
    'Criminal Code': {
      full_name: 'Criminal Code, RSC 1985, c C-46',
      type: 'act',
      governing_body: 'Department of Justice Canada',
      key_sections: {
        'Section 25': 'Protection of Persons Administering and Enforcing the Law',
        'Section 27': 'Use of Force to Prevent Commission of Offence',
        'Section 34': 'Defence of Person',
        'Section 35': 'Defence of Property',
        'Section 494': 'Arrest without Warrant by Any Person',
      },
      url: 'https://laws-lois.justice.gc.ca/eng/acts/c-46/',
    },
    'Trespass Act (Federal)': {
      full_name: 'Trespass provisions under Provincial jurisdiction',
      note: 'Trespass laws are provincial - see BC Trespass Act or Alberta Petty Trespass Act',
    },
    'Personal Information Protection and Electronic Documents Act': {
      full_name: 'Personal Information Protection and Electronic Documents Act, SC 2000, c 5',
      type: 'act',
      governing_body: 'Office of the Privacy Commissioner of Canada',
      url: 'https://laws-lois.justice.gc.ca/eng/acts/p-8.6/',
    },
    'Canada Labour Code': {
      full_name: 'Canada Labour Code, RSC 1985, c L-2',
      type: 'act',
      governing_body: 'Employment and Social Development Canada',
      url: 'https://laws-lois.justice.gc.ca/eng/acts/l-2/',
    },
  },
};

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    const { 
      jurisdiction, 
      document_name, 
      section_or_part,
      document_type 
    }: RegulatoryDocumentRequest = await req.json();

    if (!jurisdiction || !document_name) {
      return errorResponse('jurisdiction and document_name are required', 400);
    }

    // Normalize jurisdiction
    const normalizedJurisdiction = jurisdiction.toUpperCase()
      .replace('BRITISH COLUMBIA', 'BC')
      .replace('FEDERAL', 'Canada');

    // Check if we have this document in our registry
    const jurisdictionDocs = REGULATORY_DOCUMENTS[normalizedJurisdiction];
    let documentInfo = null;
    
    if (jurisdictionDocs) {
      // Try exact match first
      documentInfo = jurisdictionDocs[document_name];
      
      // If not found, try fuzzy match
      if (!documentInfo) {
        const docNames = Object.keys(jurisdictionDocs);
        const matchedName = docNames.find(name => 
          name.toLowerCase().includes(document_name.toLowerCase()) ||
          document_name.toLowerCase().includes(name.toLowerCase())
        );
        if (matchedName) {
          documentInfo = jurisdictionDocs[matchedName];
        }
      }
    }

    // Also check knowledge base for any stored documents
    const { data: kbDocs } = await supabase
      .from('archival_documents')
      .select('id, filename, summary, content_text, tags, metadata')
      .or(`filename.ilike.%${document_name}%,summary.ilike.%${document_name}%`)
      .limit(3);

    // Build AI prompt for detailed document information
    const documentPrompt = `You are a legal document specialist with expertise in Canadian regulatory frameworks.

Document Request:
- Jurisdiction: ${jurisdiction}
- Document Name: ${document_name}
- Specific Section/Part: ${section_or_part || 'Full document overview'}
- Document Type Filter: ${document_type || 'Any'}

${documentInfo ? `
Known Document Information:
- Full Name: ${documentInfo.full_name}
- Type: ${documentInfo.type}
- Governing Body: ${documentInfo.governing_body}
- Official URL: ${documentInfo.url || 'Not available'}
${documentInfo.key_sections ? `- Key Sections: ${JSON.stringify(documentInfo.key_sections)}` : ''}
${documentInfo.last_amended ? `- Last Amended: ${documentInfo.last_amended}` : ''}
` : 'Document not found in primary registry - please provide comprehensive information.'}

${kbDocs && kbDocs.length > 0 ? `
Internal Knowledge Base Documents Found:
${kbDocs.map(doc => `- ${doc.filename}: ${doc.summary || 'No summary'}`).join('\n')}
` : ''}

Please provide:

1. **Document Overview**:
   - Official title and citation
   - Enactment date and amendments
   - Purpose and scope
   - Governing/enforcing body

2. **Key Provisions** ${section_or_part ? `(Focus on ${section_or_part})` : ''}:
   - Main requirements and obligations
   - Definitions of key terms
   - Scope of application

3. **Compliance Requirements**:
   - Who must comply
   - What actions are required
   - Timelines and deadlines
   - Penalties for non-compliance

4. **Related Regulations**:
   - Associated regulations or guidelines
   - Cross-references to other legislation

5. **Practical Application**:
   - How this applies to security operations
   - Common compliance scenarios
   - Best practices

Format as structured JSON:
{
  "document": {
    "official_title": "string",
    "citation": "string",
    "type": "string",
    "jurisdiction": "string",
    "governing_body": "string",
    "enactment_date": "string",
    "last_amended": "string",
    "official_url": "string"
  },
  "overview": "string",
  "key_provisions": [{"section": "string", "title": "string", "summary": "string", "requirements": ["string"]}],
  "compliance": {
    "who_must_comply": ["string"],
    "key_obligations": ["string"],
    "penalties": ["string"]
  },
  "related_documents": [{"name": "string", "relationship": "string"}],
  "security_application": "string",
  "disclaimer": "string"
}`;

    if (!lovableApiKey) {
      return errorResponse('LOVABLE_API_KEY not configured', 500);
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          { role: 'system', content: 'You are a regulatory document expert specializing in Canadian law. Provide accurate, detailed information about regulatory documents with proper citations.' },
          { role: 'user', content: documentPrompt }
        ],
        temperature: 0.2,
        max_tokens: 4000,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', errorText);
      return errorResponse(`Failed to retrieve document information: ${errorText}`, 500);
    }

    const aiData = await aiResponse.json();
    const responseContent = aiData.choices?.[0]?.message?.content || '';

    // Parse response
    let documentDetails;
    try {
      const jsonMatch = responseContent.match(/```json\n?([\s\S]*?)\n?```/) || 
                        responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        documentDetails = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } else {
        documentDetails = { raw_response: responseContent };
      }
    } catch {
      documentDetails = { raw_response: responseContent };
    }

    return successResponse({
      success: true,
      request: { jurisdiction, document_name, section_or_part },
      registry_info: documentInfo,
      document_details: documentDetails,
      knowledge_base_matches: kbDocs || [],
      retrieved_at: new Date().toISOString(),
      disclaimer: 'This is a summary for reference purposes. Always verify against official government sources for the most current and authoritative version of any regulatory document.'
    });

  } catch (error) {
    console.error('Error in retrieve-regulatory-document:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
