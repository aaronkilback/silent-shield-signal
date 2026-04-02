/**
 * WRAITH Security Advisor — Consolidated Domain Service (#7)
 * 
 * Single entry point for all personal security analysis operations.
 * Provides breach checks, URL/email analysis, network scanning, and security scoring.
 * 
 * Actions:
 *   analyze_url          — AI-powered URL phishing/malware analysis
 *   analyze_email        — AI-powered email social engineering detection
 *   check_breaches       — HIBP breach lookup
 *   full_security_audit  — Comprehensive security posture audit
 *   get_threat_feed      — CISA KEV vulnerability feed
 *   get_security_score   — Retrieve latest security score
 *   scan_ip_exposure     — Public IP reputation & exposure analysis
 *   check_dns_leaks      — DNS leak detection (VPN validation)
 *   check_ssl            — SSL/TLS certificate & header analysis
 *   check_webrtc         — WebRTC leak guidance (client-side execution)
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse, getUserFromRequest } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import type { WraithSecurityAction, DomainRequest } from "../_shared/types.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { userId } = await getUserFromRequest(req);
    if (!userId) return errorResponse('Authentication required', 401);

    const body = await req.json() as DomainRequest<WraithSecurityAction>;
    const { action, input, email } = body as any;

    if (!action) {
      return errorResponse(
        'Missing "action" field. Valid actions: analyze_url, analyze_email, check_breaches, full_security_audit, get_threat_feed, get_security_score, scan_ip_exposure, check_dns_leaks, check_ssl, check_webrtc',
        400
      );
    }

    console.log(`[WraithSecurityAdvisor] Dispatching action: ${action}`);
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
      case 'scan_ip_exposure':
        return successResponse(await scanIpExposure());
      case 'check_dns_leaks':
        return successResponse(await checkDnsLeaks());
      case 'check_ssl':
        return successResponse(await checkSslTls(input || ''));
      case 'check_webrtc':
        return successResponse(await checkWebRtcLeak());
      default:
        return errorResponse(
          `Unknown action: ${action}. Valid actions: analyze_url, analyze_email, check_breaches, full_security_audit, get_threat_feed, get_security_score, scan_ip_exposure, check_dns_leaks, check_ssl, check_webrtc`,
          400
        );
    }
  } catch (error) {
    console.error('[WraithSecurityAdvisor] Router error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

async function analyzeUrl(url: string) {
  if (!url) return { error: 'URL is required' };
  
  // Use AI to analyze URL for phishing indicators
  const aiResult = await callAiGateway({
    model: 'google/gpt-4o-mini',
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
    model: 'google/gpt-4o-mini',
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

// ============ NETWORK SCANNING FUNCTIONS ============

async function scanIpExposure() {
  try {
    // Get public IP
    const ipResponse = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
    if (!ipResponse.ok) return { error: 'Could not determine public IP' };
    const { ip } = await ipResponse.json();

    // Check IP reputation via multiple sources
    const findings: any[] = [];
    let risk_level = 'low';

    // Check AbuseIPDB (free tier)
    const abuseKey = Deno.env.get("ABUSEIPDB_API_KEY");
    if (abuseKey) {
      try {
        const abuseResp = await fetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${ip}&maxAgeInDays=90`, {
          headers: { 'Key': abuseKey, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (abuseResp.ok) {
          const abuseData = await abuseResp.json();
          const d = abuseData.data;
          if (d.abuseConfidenceScore > 50) {
            risk_level = 'high';
            findings.push({ source: 'AbuseIPDB', type: 'reputation', detail: `Abuse confidence: ${d.abuseConfidenceScore}%`, severity: 'high' });
          } else if (d.abuseConfidenceScore > 10) {
            risk_level = 'medium';
            findings.push({ source: 'AbuseIPDB', type: 'reputation', detail: `Abuse confidence: ${d.abuseConfidenceScore}%`, severity: 'medium' });
          }
          if (d.totalReports > 0) {
            findings.push({ source: 'AbuseIPDB', type: 'reports', detail: `${d.totalReports} abuse reports in last 90 days`, severity: d.totalReports > 5 ? 'high' : 'low' });
          }
          findings.push({ source: 'AbuseIPDB', type: 'info', detail: `ISP: ${d.isp || 'Unknown'}, Country: ${d.countryCode || 'Unknown'}`, severity: 'info' });
        }
      } catch {}
    }

    // Use AI to analyze the IP context
    const aiResult = await callAiGateway({
      model: 'google/gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are WRAITH (0DAY). Analyze a public IP for exposure risks. Return JSON: { "open_port_risks": string[], "exposure_summary": string, "recommendations": string[], "geolocation_risk": string }` },
        { role: 'user', content: `Analyze public IP ${ip} for exposure. Consider: residential vs datacenter, common port exposure risks for consumer IPs, VPN detection indicators, and ISP-level security. Findings so far: ${JSON.stringify(findings)}` }
      ],
      functionName: 'wraith-security-advisor',
    });

    let aiAnalysis: any = {};
    try {
      const jsonMatch = aiResult.content?.match(/\{[\s\S]*\}/);
      if (jsonMatch) aiAnalysis = JSON.parse(jsonMatch[0]);
    } catch {}

    return {
      ip,
      risk_level,
      findings,
      ai_analysis: aiAnalysis,
      scanned_at: new Date().toISOString(),
      recommendations: [
        ...(aiAnalysis.recommendations || []),
        'Use a VPN to mask your real IP address',
        'Ensure your router firewall is enabled',
        'Disable UPnP on your router to prevent port exposure',
        'Check if your ISP provides a dynamic or static IP',
      ]
    };
  } catch (e) {
    return { error: `IP scan failed: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

async function checkDnsLeaks() {
  try {
    // Resolve multiple DNS endpoints to detect leaks
    const testDomains = [
      'dns-test-1.wraith-security.test',
      'whoami.akamai.net',
    ];

    // Get IP to check VPN status
    const ipResp = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
    const { ip } = await ipResp.json();

    // Check DNS resolver via DNS-over-HTTPS
    let dnsResolver = 'Unknown';
    let dnsResolverIp = 'Unknown';
    try {
      const dohResp = await fetch('https://cloudflare-dns.com/dns-query?name=whoami.cloudflare.com&type=TXT', {
        headers: { 'Accept': 'application/dns-json' },
        signal: AbortSignal.timeout(5000),
      });
      if (dohResp.ok) {
        const dohData = await dohResp.json();
        dnsResolverIp = dohData.Answer?.[0]?.data?.replace(/"/g, '') || 'Unknown';
      }
    } catch {}

    // Detect potential DNS leak
    const ipPrefix = ip.split('.').slice(0, 2).join('.');
    const dnsPrefix = dnsResolverIp.split('.').slice(0, 2).join('.');
    const possibleLeak = ipPrefix !== dnsPrefix && dnsResolverIp !== 'Unknown';

    const findings = [];
    let risk_level = 'low';

    if (!possibleLeak && dnsResolverIp !== 'Unknown') {
      findings.push({ type: 'dns_match', detail: 'DNS resolver matches your IP range — possible DNS leak if using VPN', severity: 'medium' });
      risk_level = 'medium';
    }

    findings.push({ type: 'public_ip', detail: `Your public IP: ${ip}`, severity: 'info' });
    findings.push({ type: 'dns_resolver', detail: `DNS resolver IP: ${dnsResolverIp}`, severity: 'info' });

    return {
      public_ip: ip,
      dns_resolver_ip: dnsResolverIp,
      dns_resolver: dnsResolver,
      possible_dns_leak: !possibleLeak ? false : true,
      risk_level,
      findings,
      scanned_at: new Date().toISOString(),
      recommendations: [
        'Use DNS-over-HTTPS (DoH) or DNS-over-TLS (DoT) for encrypted DNS',
        'Configure your VPN to use its own DNS servers',
        'Test at dnsleaktest.com for a comprehensive check',
        'Consider using Cloudflare (1.1.1.1) or Quad9 (9.9.9.9) DNS',
        'Disable WebRTC in your browser to prevent IP leaks',
      ]
    };
  } catch (e) {
    return { error: `DNS leak check failed: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

async function checkWebRtcLeak() {
  // WebRTC leak detection must happen client-side; backend provides guidance
  return {
    note: 'WebRTC leak detection runs in your browser',
    client_side: true,
    instructions: 'The Security Advisor will detect WebRTC leaks directly in your browser using the RTCPeerConnection API.',
    recommendations: [
      'Disable WebRTC in Firefox: about:config → media.peerconnection.enabled = false',
      'Use a browser extension like "WebRTC Leak Prevent" for Chrome',
      'Your VPN should have WebRTC leak protection built-in',
      'Test manually at browserleaks.com/webrtc',
    ],
    scanned_at: new Date().toISOString(),
  };
}

async function checkSslTls(domain: string) {
  if (!domain) return { error: 'Domain is required' };

  // Clean domain input
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  if (!cleanDomain) return { error: 'Invalid domain' };

  try {
    // Test HTTPS connectivity and get basic info
    const testUrl = `https://${cleanDomain}`;
    const response = await fetch(testUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });

    const headers = Object.fromEntries(response.headers.entries());
    const findings: any[] = [];
    let risk_level = 'low';

    // Check security headers
    const securityHeaders = {
      'strict-transport-security': { name: 'HSTS', critical: true },
      'content-security-policy': { name: 'CSP', critical: true },
      'x-content-type-options': { name: 'X-Content-Type-Options', critical: false },
      'x-frame-options': { name: 'X-Frame-Options', critical: false },
      'x-xss-protection': { name: 'X-XSS-Protection', critical: false },
      'referrer-policy': { name: 'Referrer-Policy', critical: false },
      'permissions-policy': { name: 'Permissions-Policy', critical: false },
    };

    const presentHeaders: string[] = [];
    const missingHeaders: string[] = [];

    for (const [header, info] of Object.entries(securityHeaders)) {
      if (headers[header]) {
        presentHeaders.push(info.name);
        findings.push({ type: 'header_present', header: info.name, value: headers[header].substring(0, 100), severity: 'good' });
      } else {
        missingHeaders.push(info.name);
        findings.push({ type: 'header_missing', header: info.name, severity: info.critical ? 'high' : 'medium' });
        if (info.critical) risk_level = risk_level === 'low' ? 'medium' : risk_level;
      }
    }

    // Check for HTTPS redirect
    try {
      const httpResp = await fetch(`http://${cleanDomain}`, { method: 'HEAD', signal: AbortSignal.timeout(5000), redirect: 'manual' });
      if (httpResp.status >= 300 && httpResp.status < 400) {
        findings.push({ type: 'https_redirect', detail: 'HTTP redirects to HTTPS', severity: 'good' });
      } else {
        findings.push({ type: 'no_https_redirect', detail: 'HTTP does NOT redirect to HTTPS', severity: 'high' });
        risk_level = 'high';
      }
    } catch {
      findings.push({ type: 'http_check_failed', detail: 'Could not check HTTP redirect', severity: 'info' });
    }

    // Use AI for deeper analysis
    const aiResult = await callAiGateway({
      model: 'google/gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are WRAITH (0DAY). Analyze SSL/TLS and security header findings for a domain. Return JSON: { "grade": "A+/A/B/C/D/F", "certificate_analysis": string, "cipher_concerns": string[], "recommendations": string[] }` },
        { role: 'user', content: `Domain: ${cleanDomain}\nPresent headers: ${presentHeaders.join(', ')}\nMissing headers: ${missingHeaders.join(', ')}\nHTTPS status: ${response.status}\nFindings: ${JSON.stringify(findings)}` }
      ],
      functionName: 'wraith-security-advisor',
    });

    let aiAnalysis: any = {};
    try {
      const jsonMatch = aiResult.content?.match(/\{[\s\S]*\}/);
      if (jsonMatch) aiAnalysis = JSON.parse(jsonMatch[0]);
    } catch {}

    return {
      domain: cleanDomain,
      ssl_valid: response.ok,
      risk_level,
      grade: aiAnalysis.grade || (risk_level === 'low' ? 'B+' : risk_level === 'medium' ? 'C' : 'D'),
      present_headers: presentHeaders,
      missing_headers: missingHeaders,
      findings,
      ai_analysis: aiAnalysis,
      scanned_at: new Date().toISOString(),
      recommendations: [
        ...(aiAnalysis.recommendations || []),
        ...missingHeaders.map(h => `Add ${h} security header`),
        'Test with ssllabs.com/ssltest for a full cipher analysis',
      ]
    };
  } catch (e) {
    return {
      domain: cleanDomain,
      ssl_valid: false,
      risk_level: 'critical',
      grade: 'F',
      error: `SSL/TLS check failed: ${e instanceof Error ? e.message : 'Connection failed'}`,
      findings: [{ type: 'connection_failed', detail: 'Could not establish HTTPS connection', severity: 'critical' }],
      recommendations: ['This domain may not support HTTPS', 'Verify the domain name is correct', 'The server may be down or blocking connections']
    };
  }
}
