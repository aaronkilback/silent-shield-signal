import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation schema
const ClientDataSchema = z.object({
  clientData: z.object({
    name: z.string().min(1).max(200).optional(),
    organization: z.string().max(200).optional(),
    contact_email: z.string().email().max(255).optional(),
    contact_phone: z.string().max(50).optional(),
    industry: z.string().max(100).optional(),
    employee_count: z.union([z.number(), z.string()]).optional(),
    locations: z.union([z.array(z.string()), z.string()]).optional(),
    high_value_assets: z.union([z.array(z.string()), z.string()]).optional(),
  }).passthrough() // Allow additional fields from various forms
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Validate input
    const rawBody = await req.json();
    const validationResult = ClientDataSchema.safeParse(rawBody);
    
    if (!validationResult.success) {
      console.error('Validation error:', validationResult.error);
      return new Response(
        JSON.stringify({ 
          error: 'Invalid client data', 
          details: validationResult.error.errors 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { clientData } = validationResult.data;
    
    console.log('Processing client onboarding data:', clientData);

    // Extract and normalize data from various Google Form field names
    const normalizedData = {
      name: clientData.name || clientData['Client Name'] || clientData['Name'] || '',
      organization: clientData.organization || clientData['Organization'] || clientData['Company'] || '',
      contact_email: clientData.contact_email || clientData['Email'] || clientData['Contact Email'] || '',
      contact_phone: clientData.contact_phone || clientData['Phone'] || clientData['Contact Phone'] || '',
      industry: clientData.industry || clientData['Industry'] || clientData['Business Type'] || '',
      employee_count: parseInt(clientData.employee_count || clientData['Number of Employees'] || '0'),
      locations: Array.isArray(clientData.locations) 
        ? clientData.locations 
        : (clientData.locations || clientData['Locations'] || '').split(',').map((l: string) => l.trim()).filter(Boolean),
      high_value_assets: Array.isArray(clientData.high_value_assets)
        ? clientData.high_value_assets
        : (clientData.high_value_assets || clientData['High-Value Assets'] || '').split(',').map((a: string) => a.trim()).filter(Boolean),
      onboarding_data: clientData,
    };

    // Use AI to generate risk assessment
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are a security risk analyst. Analyze client onboarding data and provide:
- threat_profile: array of potential threats based on industry and assets
- risk_score: 0-100 overall risk score
- risk_factors: array of specific risk factors
- recommendations: array of security recommendations
Respond ONLY with valid JSON.`
          },
          {
            role: 'user',
            content: JSON.stringify(normalizedData)
          }
        ],
      }),
    });

    let riskAssessment = {
      threat_profile: ['General security threats'],
      risk_score: 50,
      risk_factors: ['Insufficient data for detailed assessment'],
      recommendations: ['Complete comprehensive security audit'],
      generated_at: new Date().toISOString(),
    };

    if (aiResponse.ok) {
      const aiData = await aiResponse.json();
      const aiContent = aiData.choices?.[0]?.message?.content;
      if (aiContent) {
        try {
          const parsed = JSON.parse(aiContent);
          riskAssessment = { ...riskAssessment, ...parsed, generated_at: new Date().toISOString() };
        } catch (e) {
          console.error('Failed to parse AI response:', e);
        }
      }
    }

    // Insert client with risk assessment
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        ...normalizedData,
        threat_profile: riskAssessment.threat_profile,
        risk_assessment: riskAssessment,
        status: 'onboarding',
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client insert error:', clientError);
      throw clientError;
    }

    console.log('Client onboarded:', client.id);

    return new Response(
      JSON.stringify({ 
        client_id: client.id, 
        risk_assessment: riskAssessment 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in process-client-onboarding:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
