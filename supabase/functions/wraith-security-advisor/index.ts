import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse, getUserFromRequest } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

/**
 * WRAITH Security Advisor
 * 
 * Provides personal security analysis: breach checks, URL/email analysis,
 * digital footprint scanning, and security scoring.
 */

interface RequestBody {
  action: 'analyze_url' | 'analyze_email' | 'check_breaches' | 'full_security_audit' | 'get_threat_feed' | 'get_security_score';
  input?: string;
  email?: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { userId } = await getUserFromRequest(req);
    if (!userId) return errorResponse('Authentication required', 401);

    const { action, input, email } = await req.json() as RequestBody;
    const supabase = createServiceClient();

    switch (action) {
      case 'analyze_url':
        return successResponse(await analyzeUrl(input || ''));
      case 'analyze_email':
        return successResponse(await analyzeEmailPhishing(input || ''));
      case 'check_breaches':
        return successResponse(await checkBreaches(email || input || ''));
      case 'full_security_audit':
        return successResponse(await runFullSecurityAudit(supabase, userId, email || ''));
      case 'get_threat_feed':
        return successResponse(await getThreatFeed());
      case 'get_security_score':
        return successResponse(await getSecurityScore(supabase, userId));
      default:
        return errorResponse('Unknown action', 400);
    }
  } catch (error) {
    console.error('[wraith-security-advisor] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

async function analyzeUrl(url: string) {
  if (!url) return { error: 'URL is required' };
  
  // Use AI to analyze URL for phishing indicators
  const aiResult = await callAiGateway({
    model: 'google/gemini-2.5-flash',
    messages: [
      { role: 'system', content: `You are WRAITH (0DAY), an elite offensive security specialist. Analyze URLs for security threats. Return a JSON object with: risk_level (critical/high/medium/low), threat_type (phishing/malware/safe/suspicious), indicators (array of specific concerns), recommendation (string). Be thorough but concise.` },
      { role: 'user', content: `Analyze this URL for phishing, malware, and security threats: ${url}\n\nCheck for: typosquatting, suspicious TLDs, encoded characters, known malicious patterns, homograph attacks, redirect chains, and data exfiltration indicators.` }
    ],
    functionName: 'wraith-security-advisor',
  });

  try {
    const jsonMatch = aiResult.content?.match(/\{[\s\S]*\}/);
    if (jsonMatch) return { analysis: JSON.parse(jsonMatch[0]), url, analyzed_at: new Date().toISOString() };
  } catch {}
  
  return { analysis: { risk_level: 'unknown', recommendation: aiResult.content || 'Analysis unavailable' }, url, analyzed_at: new Date().toISOString() };
}

async function analyzeEmailPhishing(emailContent: string) {
  if (!emailContent) return { error: 'Email content is required' };
  
  const aiResult = await callAiGateway({
    model: 'google/gemini-2.5-flash',
    messages: [
      { role: 'system', content: `You are WRAITH (0DAY), an elite offensive security specialist trained in social engineering detection. Analyze email content for phishing indicators. Return a JSON object with: risk_level (critical/high/medium/low), phishing_score (0-100), indicators (array of specific red flags), social_engineering_tactics (array), recommendation (string).` },
      { role: 'user', content: `Analyze this email/message for phishing and social engineering: ${emailContent.substring(0, 3000)}` }
    ],
    functionName: 'wraith-security-advisor',
  });

  try {
    const jsonMatch = aiResult.content?.match(/\{[\s\S]*\}/);
    if (jsonMatch) return { analysis: JSON.parse(jsonMatch[0]), analyzed_at: new Date().toISOString() };
  } catch {}
  
  return { analysis: { risk_level: 'unknown', recommendation: aiResult.content || 'Analysis unavailable' }, analyzed_at: new Date().toISOString() };
}

async function checkBreaches(email: string) {
  if (!email) return { error: 'Email is required' };
  
  const HIBP_API_KEY = Deno.env.get("HIBP_API_KEY");
  if (!HIBP_API_KEY) {
    return { 
      email, breach_count: 0, risk_level: 'unknown',
      message: 'Breach checking service not configured. Contact administrator.',
      recommendations: [
        'Use unique passwords for every account',
        'Enable MFA everywhere possible (prefer FIDO2/hardware keys)',
        'Monitor your email on haveibeenpwned.com manually',
        'Use a password manager like 1Password or Bitwarden',
      ]
    };
  }

  try {
    const response = await fetch(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
      { headers: { "hibp-api-key": HIBP_API_KEY, "user-agent": "Fortress-WRAITH-Advisor" } }
    );

    if (response.ok) {
      const breaches = await response.json();
      const criticalBreaches = breaches.filter((b: any) =>
        (b.DataClasses || []).some((dc: string) => /password|credit|financial|social.*security/i.test(dc))
      );
      return {
        email, found: true, breach_count: breaches.length, critical_count: criticalBreaches.length,
        risk_level: criticalBreaches.length > 0 ? 'critical' : breaches.length > 5 ? 'high' : breaches.length > 2 ? 'medium' : 'low',
        breaches: breaches.slice(0, 10).map((b: any) => ({
          name: b.Name, domain: b.Domain, date: b.BreachDate,
          data_exposed: b.DataClasses?.slice(0, 5) || [],
          is_critical: (b.DataClasses || []).some((dc: string) => /password|credit|financial/i.test(dc))
        })),
        recommendations: generateBreachRecommendations(breaches, criticalBreaches)
      };
    } else if (response.status === 404) {
      return { email, found: false, breach_count: 0, risk_level: 'low', message: 'No breaches found.', recommendations: ['Continue monitoring', 'Keep MFA enabled'] };
    }
    return { error: `Breach check failed: ${response.status}` };
  } catch (e) {
    return { error: `Breach check error: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

function generateBreachRecommendations(breaches: any[], criticalBreaches: any[]): string[] {
  const recs = [
    'Change passwords for all breached services immediately',
    'Enable Multi-Factor Authentication (MFA) on all accounts',
  ];
  if (criticalBreaches.length > 0) {
    recs.unshift('CRITICAL: Financial/password data exposed — freeze credit and change all passwords NOW');
    recs.push('Monitor bank statements and credit reports for unauthorized activity');
  }
  if (breaches.length > 5) {
    recs.push('Your email has significant exposure — consider using email aliases (e.g., SimpleLogin, Apple Hide My Email)');
  }
  recs.push('Use a hardware security key (YubiKey) for critical accounts');
  recs.push('Audit all accounts at haveibeenpwned.com and remove unused accounts');
  return recs;
}

async function runFullSecurityAudit(supabase: any, userId: string, email: string) {
  const breachResult = email ? await checkBreaches(email) : { breach_count: 0, risk_level: 'low' };

  // Score calculation
  let score = 100;
  const findings: Record<string, any> = {};
  const recommendations: string[] = [];

  // Breach deductions
  const breachCount = (breachResult as any).breach_count || 0;
  const criticalCount = (breachResult as any).critical_count || 0;
  score -= Math.min(breachCount * 5, 30);
  score -= criticalCount * 10;
  findings.breaches = breachResult;

  // Get CISA threat feed
  const threatFeed = await getThreatFeed();
  findings.active_threats = threatFeed;

  // Hardening checklist scoring
  const hardening = {
    password_manager: { label: 'Using a password manager', points: 10, status: 'unverified' },
    mfa_enabled: { label: 'MFA enabled on critical accounts', points: 15, status: 'unverified' },
    hardware_key: { label: 'Hardware security key (FIDO2)', points: 10, status: 'unverified' },
    email_aliases: { label: 'Email alias service', points: 5, status: 'unverified' },
    vpn_usage: { label: 'VPN for public networks', points: 5, status: 'unverified' },
    device_encryption: { label: 'Full device encryption', points: 10, status: 'unverified' },
    auto_updates: { label: 'Automatic OS updates', points: 5, status: 'unverified' },
    wifi_security: { label: 'Secure home WiFi (WPA3)', points: 5, status: 'unverified' },
    bluetooth_discipline: { label: 'Bluetooth off when unused', points: 5, status: 'unverified' },
    biometric_lock: { label: 'Biometric device lock', points: 5, status: 'unverified' },
  };
  findings.hardening_checklist = hardening;
  
  recommendations.push(
    'Complete the security hardening checklist to improve your score',
    'Run breach checks monthly on all email addresses',
    'Review app permissions on your phone quarterly',
    'Disable WiFi auto-connect to prevent Evil Twin attacks',
    'Turn off Bluetooth when not in use to prevent BlueBorne attacks',
    'Use a VPN on public/hotel WiFi networks',
    'Enable Find My Device and remote wipe capability',
  );

  if (breachCount > 0) recommendations.unshift('Address all breached accounts immediately');

  score = Math.max(0, Math.min(100, score));

  // Store audit
  await supabase.from('user_security_audits').insert({
    user_id: userId,
    audit_type: 'full_scan',
    overall_score: score,
    breach_count: breachCount,
    exposed_passwords: criticalCount,
    digital_footprint_findings: breachCount,
    recommendations,
    findings,
    status: 'completed',
    completed_at: new Date().toISOString(),
  });

  return {
    score, risk_level: score >= 80 ? 'low' : score >= 60 ? 'medium' : score >= 40 ? 'high' : 'critical',
    breach_count: breachCount, critical_breaches: criticalCount,
    findings, recommendations,
    generated_at: new Date().toISOString()
  };
}

async function getThreatFeed() {
  try {
    const response = await fetch(
      "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
      { signal: AbortSignal.timeout(10000) }
    );
    if (response.ok) {
      const data = await response.json();
      const vulns = (data.vulnerabilities || []).slice(0, 8);
      return {
        source: 'CISA Known Exploited Vulnerabilities',
        count: vulns.length,
        vulnerabilities: vulns.map((v: any) => ({
          cve: v.cveID, vendor: v.vendorProject, product: v.product,
          description: v.shortDescription, due_date: v.dueDate,
          action: v.requiredAction
        })),
        last_updated: data.catalogVersion || new Date().toISOString()
      };
    }
    return { source: 'CISA', count: 0, error: 'Feed unavailable' };
  } catch {
    return { source: 'CISA', count: 0, error: 'Failed to fetch threat feed' };
  }
}

async function getSecurityScore(supabase: any, userId: string) {
  const { data: latestAudit } = await supabase
    .from('user_security_audits')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (latestAudit) {
    return {
      score: latestAudit.overall_score,
      risk_level: latestAudit.overall_score >= 80 ? 'low' : latestAudit.overall_score >= 60 ? 'medium' : latestAudit.overall_score >= 40 ? 'high' : 'critical',
      breach_count: latestAudit.breach_count,
      last_scan: latestAudit.created_at,
      recommendations: latestAudit.recommendations,
    };
  }

  return { score: null, risk_level: 'unknown', message: 'No security audit has been run yet. Run a full audit to get your score.' };
}
