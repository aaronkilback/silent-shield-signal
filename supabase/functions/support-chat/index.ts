import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BugReport {
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  steps_to_reproduce?: string;
  expected_behavior?: string;
  actual_behavior?: string;
}

// Detect if user is reporting a bug in conversation
function detectBugReport(messages: any[]): boolean {
  if (!messages || messages.length === 0) return false;
  const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop();
  if (!lastUserMessage) return false;
  
  const content = typeof lastUserMessage.content === 'string' 
    ? lastUserMessage.content.toLowerCase() 
    : '';
  
  const bugPatterns = [
    /\bbug\b/i,
    /\bissue\b/i,
    /\berror\b/i,
    /\bbroken\b/i,
    /\bdoesn'?t work/i,
    /\bnot working/i,
    /\bcrash/i,
    /\bfail/i,
    /\bproblem\b/i,
    /\bglitch/i,
    /\bwrong\b/i,
    /\bincorrect/i,
    /\bsomething'?s off/i,
    /\bweird behavior/i,
    /\bunexpected/i,
  ];
  
  return bugPatterns.some(pattern => pattern.test(content));
}

// Extract bug details from conversation using AI
async function extractBugDetails(messages: any[], apiKey: string): Promise<BugReport | null> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `Extract bug report details from the conversation. Return a JSON object with:
{
  "title": "Brief title (max 100 chars)",
  "description": "Full description of the issue",
  "severity": "low|medium|high|critical",
  "steps_to_reproduce": "Steps if mentioned",
  "expected_behavior": "What should happen",
  "actual_behavior": "What actually happens",
  "is_complete": true/false (whether enough info to create bug report)
}

Severity guide:
- critical: System unusable, data loss, security issue
- high: Major feature broken, blocking work
- medium: Feature partially broken, workaround exists
- low: Minor issue, cosmetic, annoyance

If user hasn't provided enough details, set is_complete to false.
Return ONLY valid JSON, no markdown.`
          },
          ...messages.slice(-10),
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) return null;
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    
    const parsed = JSON.parse(content);
    if (!parsed.is_complete) return null;
    
    return {
      title: parsed.title || "Bug report from chat",
      description: parsed.description || "",
      severity: parsed.severity || "medium",
      steps_to_reproduce: parsed.steps_to_reproduce,
      expected_behavior: parsed.expected_behavior,
      actual_behavior: parsed.actual_behavior,
    };
  } catch (error) {
    console.error("Error extracting bug details:", error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, action, bugData } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header if available
    let userId: string | null = null;
    let userEmail: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      // Skip if it's just the anon key
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (token !== anonKey) {
        try {
          const { data: { user } } = await supabase.auth.getUser(token);
          if (user) {
            userId = user.id;
            userEmail = user.email || null;
          }
        } catch {}
      }
    }

    // Handle explicit bug submission from chat
    if (action === 'submit_bug') {
      if (!bugData) {
        return new Response(
          JSON.stringify({ error: "Bug data required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Build full description with details
      let fullDescription = bugData.description || '';
      if (bugData.steps_to_reproduce) {
        fullDescription += `\n\n**Steps to Reproduce:**\n${bugData.steps_to_reproduce}`;
      }
      if (bugData.expected_behavior) {
        fullDescription += `\n\n**Expected Behavior:**\n${bugData.expected_behavior}`;
      }
      if (bugData.actual_behavior) {
        fullDescription += `\n\n**Actual Behavior:**\n${bugData.actual_behavior}`;
      }

      const { data: bug, error: bugError } = await supabase
        .from('bug_reports')
        .insert({
          user_id: userId,
          reporter_email: userEmail || bugData.email,
          title: bugData.title,
          description: fullDescription,
          severity: bugData.severity || 'medium',
          page_url: bugData.page_url,
          browser_info: bugData.browser_info,
          conversation_log: messages,
          workflow_stage: 'reported',
          status: 'open',
        })
        .select('id')
        .single();

      if (bugError) {
        console.error("Bug submission error:", bugError);
        return new Response(
          JSON.stringify({ error: "Failed to submit bug report" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          bug_id: bug.id,
          message: "Bug report submitted successfully. You'll be notified when it's fixed." 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle bug status check
    if (action === 'check_bug_status') {
      const { bug_id } = await req.json();
      
      const { data: bug, error } = await supabase
        .from('bug_reports')
        .select('id, title, status, workflow_stage, fix_status, created_at, resolved_at')
        .eq('id', bug_id)
        .single();

      if (error || !bug) {
        return new Response(
          JSON.stringify({ error: "Bug not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ bug }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Detect simple acknowledgment messages for fast path
    const isSimpleAcknowledgment = (msgs: any[]): boolean => {
      if (!msgs || msgs.length === 0) return false;
      const lastUserMessage = msgs.filter((m: any) => m.role === 'user').pop();
      if (!lastUserMessage) return false;
      
      const content = typeof lastUserMessage.content === 'string' 
        ? lastUserMessage.content.trim().toLowerCase() 
        : '';
      
      if (content.length > 50) return false;
      
      const acknowledgmentPatterns = [
        /^(ok|okay|k|kk)$/i,
        /^(ok|okay)\s+(great|good|thanks|thank you|cool|perfect|sounds good|got it|understood)$/i,
        /^(great|good|thanks|thank you|cool|perfect|awesome|nice|excellent|wonderful)$/i,
        /^(sounds good|got it|understood|roger|copy|noted|alright|all right|right)$/i,
        /^(yes|yeah|yep|yup|sure|certainly|of course|absolutely)$/i,
        /^(no problem|no worries|np|nw)$/i,
        /^(will do|sure thing|makes sense|fair enough)$/i,
        /^(i see|i understand|that makes sense)$/i,
        /^(👍|👌|🙌|✅|💯|🎉|😊|🤝|⭐|✨)+$/,
        /^(ok|okay|great|good|thanks)[\s!.]*$/i,
      ];
      
      return acknowledgmentPatterns.some(pattern => pattern.test(content));
    };

    // Fast path for simple acknowledgments
    if (isSimpleAcknowledgment(messages)) {
      console.log("Detected simple acknowledgment in support chat, using fast response path");
      
      const ackResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            {
              role: "system",
              content: `You are a helpful support assistant. The user just sent a simple acknowledgment message.

CRITICAL RULES:
1. Respond BRIEFLY - just 1-2 short sentences
2. DO NOT provide platform summaries or feature lists
3. Simply acknowledge their acknowledgment warmly
4. Offer to help with anything else

Examples: "Happy to help! Let me know if you have more questions." / "You're welcome! I'm here if you need anything." / "Great! 😊"

Respond naturally and briefly.`
            },
            ...messages.slice(-3),
          ],
          stream: true,
        }),
      });

      if (ackResponse.ok) {
        return new Response(ackResponse.body, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }
      console.log("Fast acknowledgment response failed, falling back to normal processing");
    }

    // Check if this looks like a bug report
    const isBugReport = detectBugReport(messages);
    let bugReportContext = '';
    
    if (isBugReport) {
      // Try to extract bug details
      const bugDetails = await extractBugDetails(messages, LOVABLE_API_KEY);
      
      if (bugDetails) {
        bugReportContext = `

**BUG DETECTION ACTIVE**
You've detected enough information to create a bug report. Here's what you extracted:
- Title: ${bugDetails.title}
- Severity: ${bugDetails.severity}
- Description: ${bugDetails.description}

Tell the user you have enough info and will create a ticket. Ask if they want to add anything else, or if they're ready to submit.
If they confirm, respond with: "I'll create this bug report now. [BUG_READY]"
`;
      } else {
        bugReportContext = `

**BUG DETECTION ACTIVE**
The user seems to be reporting an issue but hasn't provided complete details. 
Ask clarifying questions to gather:
1. What exactly isn't working?
2. What were they trying to do?
3. What happened instead of what they expected?
4. Can they reproduce it consistently?

Be conversational and helpful while gathering these details.
`;
      }
    }

    // Fetch knowledge base articles for context
    const { data: kbArticles } = await supabase
      .from('knowledge_base_articles')
      .select('title, summary, content, tags')
      .eq('is_published', true)
      .limit(50);

    const kbContext = kbArticles?.map(article => 
      `## ${article.title}\n${article.summary}\nTags: ${article.tags?.join(', ')}`
    ).join('\n\n') || '';

    // Fetch archival documents for reference
    const { data: archivalDocs } = await supabase
      .from('archival_documents')
      .select('filename, summary, content_text, keywords, entity_mentions, date_of_document')
      .not('content_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);
    
    let docContext = '';
    if (archivalDocs?.length) {
      docContext = '\n\n**Uploaded Intelligence Documents:**\n';
      archivalDocs.forEach(doc => {
        docContext += `\n### ${doc.filename}\n`;
        if (doc.date_of_document) docContext += `Date: ${doc.date_of_document}\n`;
        if (doc.summary) docContext += `Summary: ${doc.summary}\n`;
        if (doc.keywords?.length) docContext += `Keywords: ${doc.keywords.join(', ')}\n`;
        if (doc.entity_mentions?.length) docContext += `Entities: ${doc.entity_mentions.join(', ')}\n`;
        if (doc.content_text) {
          const preview = doc.content_text.substring(0, 1000);
          docContext += `Content: ${preview}${doc.content_text.length > 1000 ? '...' : ''}\n`;
        }
      });
    }

    const systemPrompt = `You are a helpful support assistant for FORTRESS, an autonomous Security Operations Center (SOC) platform. You have access to a comprehensive knowledge base and can help users with any platform feature.

## PLATFORM OVERVIEW
FORTRESS is an AI-powered security operations platform that helps organizations monitor, detect, and respond to security threats through autonomous intelligence gathering and analysis.

## COMPLETE FEATURE GUIDE

### 1. SIGNALS
Security events ingested from OSINT sources (news, social media, dark web, threat intel feeds).
- **Severity**: P1 (Critical) to P4 (Low)
- **Status**: new → triaged → investigating → resolved/false_positive
- **Matching**: AI automatically matches signals to relevant clients and entities
- **Duplicate Detection**: System identifies and merges similar signals
- **Feedback**: Mark signals as accurate or false positive to improve AI

### 2. INCIDENTS
Escalated signals requiring investigation and response.
- **Priority**: P1-P4 with SLA targets (MTTD, MTTR)
- **Status**: open → acknowledged → contained → resolved → closed
- **Timeline**: Full audit trail of actions and status changes
- **Actions**: Escalate, assign, add notes, link entities

### 3. ENTITIES
Tracked items: persons, organizations, locations, vehicles, domains, IPs, assets.
- **Profiles**: Photos, addresses, risk levels, relationships
- **Monitoring**: Automatic alerts when entities appear in signals
- **Suggestions**: AI proposes new entities from signal content
- **Cross-Reference**: Link entities to incidents and clients
- **Merge**: Combine duplicate entity records

### 4. CLIENTS
Multi-tenant client management with customized monitoring.
- **Monitoring Config**: Keywords, locations, assets, competitors
- **Risk Snapshots**: Executive summaries of threat landscape
- **Qualification**: Onboarding workflow for new clients
- **Industry-specific**: Tailored threat profiles by sector

### 5. TASK FORCE (Missions)
Multi-agent collaborative operations for complex investigations.
- **Missions**: Define objectives, assign AI agents, set timelines
- **Rules of Engagement (RoE)**: Configure agent behavior boundaries
- **Briefing Queries**: Ask questions during missions; agents respond with sourced intelligence
- **Validation**: Automated quality checks on deliverables

### 6. BRIEFING HUB
Real-time collaborative workspace for incident response.
- **Sessions**: Scheduled or ad-hoc meetings with humans and AI
- **Agenda**: Structured topics with presenters and time allocation
- **Live Chat**: @mention specific agents for expertise
- **Decisions**: Track and approve decisions made during briefings
- **COP Canvas**: Common Operating Picture visualization
- **Evidence Locker**: Centralized document storage
- **MCM Roles**: Team Commander, Primary Investigator, File Coordinator, Investigator, Analyst, Observer

### 7. THREAT RADAR
Advanced threat visualization and predictive intelligence.
- **Visualization**: Interactive radar of active threats by category
- **Sentiment Heatmap**: Geographic sentiment analysis
- **Score Cards**: Quick threat level summaries
- **Timeline**: Historical trend analysis
- **Predictive Insights**: AI-generated threat predictions
- **Precursor Activity**: Early warning indicators
- **Radical Activity Monitor**: Extremist narrative tracking

### 8. TRAVEL SECURITY
Protect personnel during travel.
- **Travelers**: Maintain profiles of personnel
- **Itineraries**: Track travel plans with risk assessments
- **Alerts**: Real-time notifications for destination risks
- **Map**: Geographic visualization of traveler locations
- **Document Parsing**: Upload PDFs/emails for automatic extraction

### 9. VIP DEEP SCAN
Comprehensive OSINT investigation for persons of interest.
- **Scan Types**: Basic, standard, comprehensive
- **Focus Areas**: Financial, criminal, social, professional
- **Output**: Confidence ratings, source citations, recommendations
- **Integration**: Links to entity management for ongoing monitoring

### 10. AI AGENTS
Specialized AI agents with unique capabilities.
- **AEGIS**: Strategic advisor, primary analyst interface
- **SENTINEL**: Threat monitoring and alerting
- **ORACLE**: Predictive analysis and patterns
- **CIPHER**: Communications analysis
- **NOMAD**: Travel and geospatial intelligence
- **GUARDIAN**: Protective intelligence
- **Proactive Messages**: Agents alert users to important developments

### 11. WILDFIRE & ENVIRONMENTAL
Track environmental threats to assets.
- **Sources**: NASA FIRMS, Canadian Wildfire Service
- **Map**: Active fires with asset proximity
- **Alerts**: Automatic warnings when threats approach assets
- **Weather**: Fire weather index integration

### 12. VOICE INTERFACE
Hands-free AI interaction.
- **Speech-to-Text**: Real-time transcription
- **Voice Commands**: Natural language queries
- **Accessibility**: Supports hands-free operation

### 13. INTEGRATIONS
Connect external systems.
- **API**: RESTful endpoints for signals, clients, entities
- **API Keys**: Permission-based access with rate limits
- **Webhooks**: Outbound notifications for events
- **Documentation**: OpenAPI/Swagger specs

### 14. DOCUMENT PROCESSING
Upload and analyze intelligence documents.
- **Formats**: PDF, Word, Excel, PowerPoint, images
- **OCR**: Scanned document text extraction
- **Entity Extraction**: Automatic identification of names, locations
- **Summarization**: AI-generated summaries
- **Archival**: Long-term storage with metadata

### 15. MATCHING DASHBOARD
Signal-entity correlation analytics.
- **Confidence Charts**: Match score distribution
- **Trends**: Accuracy over time
- **Close Matches**: Near-misses for review
- **Suggestions**: AI-proposed new entities

### 16. GEOSPATIAL
Location-based intelligence.
- **Maps**: Incidents, entities, travelers, assets
- **Large Map Upload**: Custom GIS data (shapefiles, KML)
- **Threat Globe**: 3D global visualization

### 17. WORKSPACES
Team collaboration.
- **Create**: Investigation or client-specific spaces
- **Invite**: Team members with role-based access
- **Roles**: Owner, Contributor, Viewer
- **Activity Feeds**: Track team actions

### 18. BUG REPORTING
Report issues through this chat.
- **Natural Conversation**: Describe bugs in plain language
- **Auto-Tracking**: Bugs logged with tracking ID
- **Workflow**: reported → investigating → fix_proposed → testing → verified
- **Notifications**: Updates in chat + email when fixed

### 19. REPORTS
Generate executive intelligence reports.
- **Time Periods**: Daily, weekly, monthly, custom
- **Formats**: PDF export with visualizations
- **Security Bulletins**: Client-specific threat summaries

### 20. LEARNING DASHBOARD
AI system performance metrics.
- **Accuracy**: Signal classification precision
- **False Positives**: Rate tracking and trends
- **Insights**: AI improvement recommendations

## KNOWLEDGE BASE ARTICLES
${kbContext}

## UPLOADED DOCUMENTS
${docContext}

${bugReportContext}

## YOUR CAPABILITIES
1. **Answer Questions**: Use feature knowledge and KB articles
2. **Step-by-Step Guides**: Walk users through any workflow
3. **Bug Reporting**: Gather details conversationally, then use [BUG_READY] to submit
4. **Feature Discovery**: Help users find capabilities they need

## RESPONSE GUIDELINES
- Be concise and actionable
- Cite KB articles when available
- Provide step-by-step instructions for how-to questions
- For bugs: gather details, confirm, include [BUG_READY] when complete
- Be friendly and professional`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add credits to your Lovable AI workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Support chat error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});