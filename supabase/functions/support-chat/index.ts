import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, action } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Handle bug submission
    if (action === 'submit_bug') {
      const authHeader = req.headers.get('Authorization')!;
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);

      if (!user) {
        return new Response(
          JSON.stringify({ error: "Authentication required" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const bugData = await req.json();
      const { error: bugError } = await supabase
        .from('bug_reports')
        .insert({
          user_id: user.id,
          title: bugData.title,
          description: bugData.description,
          severity: bugData.severity,
          page_url: bugData.pageUrl,
          browser_info: bugData.browserInfo,
        });

      if (bugError) {
        console.error("Bug submission error:", bugError);
        return new Response(
          JSON.stringify({ error: "Failed to submit bug report" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: "Bug report submitted successfully" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch knowledge base articles for context
    const { data: kbArticles } = await supabase
      .from('knowledge_base_articles')
      .select('title, summary, content, tags')
      .eq('is_published', true)
      .limit(50);

    // Build knowledge base context
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

    const systemPrompt = `You are a helpful support assistant for a Security Operations Center (SOC) platform with access to a comprehensive knowledge base.

**Platform Overview:**
This is an autonomous security operations platform that helps organizations monitor, detect, and respond to security threats.

**Key Features:**

1. **Signals**: Security events ingested from various sources (OSINT, threat intel, news, social media). Each signal has:
   - Severity levels (P1-P4)
   - Status (new, triaged, investigating, resolved, false_positive)
   - Normalized text, category, confidence score
   - Can be matched to clients and entities

2. **Incidents**: Escalated signals that require investigation. Includes:
   - Priority levels (P1-P4)
   - Status tracking (open, acknowledged, contained, resolved, closed)
   - SLA targets (MTTD - Mean Time To Detect, MTTR - Mean Time To Resolve)
   - Timeline tracking

3. **Entities**: Tracked items like persons, organizations, locations, infrastructure, domains, IPs, emails, phones, vehicles
   - Can have relationships with other entities
   - Risk levels and threat scores
   - Photo attachments
   - Address fields (street, city, province, postal code, country)
   - Mentioned in signals/incidents

4. **Autonomous SOC System**:
   - AI Decision Engine analyzes signals automatically
   - Auto-escalation based on severity
   - OSINT monitoring (dark web, social media, news, threat intel)
   - Pattern detection and campaign assessment

5. **Client Management**: Multi-tenant system where signals/incidents are matched to specific clients based on industry, location, assets, etc.

6. **Learning Dashboard**: Shows AI accuracy, false positive rates, trends over time

7. **Reports**: Executive reports can be generated for time periods

8. **Travel Security**: Monitor travelers and itineraries with risk assessments

9. **Knowledge Base**: Comprehensive documentation and guides (you have access to this)

10. **Bug Reporting**: Users can report issues they encounter

11. **Intelligence Documents**: Users can upload security reports, threat assessments, and other documents. These are processed and available for reference.

**Knowledge Base Articles:**

${kbContext}

**Uploaded Intelligence Documents:**
${docContext}

**Your Capabilities:**

1. **Answer Questions**: Use the knowledge base articles above to provide accurate, detailed answers
2. **Guide Users**: Provide step-by-step instructions for common tasks
3. **Bug Reporting**: If a user reports a bug or issue:
   - Acknowledge the problem
   - Ask for details: title, description, severity (low/medium/high/critical), and what page/feature
   - Tell them you'll help them submit a bug report
   - Let them know to click "Submit Bug Report" button that will appear

**Your Role:**
- Answer questions clearly and concisely using knowledge base information
- Guide users through features with step-by-step instructions
- Explain security concepts when needed
- Reference specific knowledge base articles when helpful
- Help users report bugs they encounter
- Be friendly, professional, and helpful

**When answering:**
- Search the knowledge base articles for relevant information
- Cite article titles when referencing them
- Provide practical, actionable guidance
- Keep responses focused and concise
- If something isn't in the knowledge base, use your general platform knowledge

**For bug reports:**
- If user mentions a bug, error, or problem, acknowledge it and offer to help them file a report
- Gather: title, description, severity, and location of the issue
- Let them know they can submit it via the chat interface`;

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
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add credits to your Lovable AI workspace." }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Support chat error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
