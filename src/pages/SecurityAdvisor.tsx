import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Shield, AlertTriangle, Search, RefreshCw, Wifi, Smartphone, Key, Globe, Mail, Link, CheckCircle, XCircle, Clock, Radar, Lock, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

const riskColors: Record<string, string> = {
  critical: 'text-red-500',
  high: 'text-orange-500',
  medium: 'text-yellow-500',
  low: 'text-green-500',
  unknown: 'text-muted-foreground',
};

const riskBg: Record<string, string> = {
  critical: 'bg-red-500/10 border-red-500/30',
  high: 'bg-orange-500/10 border-orange-500/30',
  medium: 'bg-yellow-500/10 border-yellow-500/30',
  low: 'bg-green-500/10 border-green-500/30',
  unknown: 'bg-muted/50 border-border',
};

export default function SecurityAdvisor() {
  const [securityScore, setSecurityScore] = useState<any>(null);
  const [threatFeed, setThreatFeed] = useState<any>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [urlInput, setUrlInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [emailContentInput, setEmailContentInput] = useState('');
  const [breachEmail, setBreachEmail] = useState('');
  const [sslDomain, setSslDomain] = useState('');
  const [networkResults, setNetworkResults] = useState<any>(null);
  const [webrtcLeaks, setWebrtcLeaks] = useState<any>(null);

  useEffect(() => {
    loadSecurityScore();
    loadThreatFeed();
  }, []);

  const callWraith = async (action: string, body: Record<string, string> = {}) => {
    setLoading(prev => ({ ...prev, [action]: true }));
    try {
      const { data, error } = await supabase.functions.invoke('wraith-security-advisor', {
        body: { action, ...body }
      });
      if (error) throw error;
      return data;
    } catch (err: any) {
      toast.error(`Analysis failed: ${err.message || 'Unknown error'}`);
      return null;
    } finally {
      setLoading(prev => ({ ...prev, [action]: false }));
    }
  };

  const loadSecurityScore = async () => {
    const data = await callWraith('get_security_score');
    if (data) setSecurityScore(data);
  };

  const loadThreatFeed = async () => {
    const data = await callWraith('get_threat_feed');
    if (data) setThreatFeed(data);
  };

  const runFullAudit = async () => {
    if (!breachEmail) { toast.error('Enter your email for the security audit'); return; }
    const data = await callWraith('full_security_audit', { email: breachEmail });
    if (data) {
      setSecurityScore(data);
      setAnalysisResult({ type: 'audit', data });
      toast.success('Security audit complete');
    }
  };

  const analyzeUrl = async () => {
    if (!urlInput.trim()) { toast.error('Enter a URL to analyze'); return; }
    const data = await callWraith('analyze_url', { input: urlInput });
    if (data) setAnalysisResult({ type: 'url', data });
  };

  const analyzeEmail = async () => {
    if (!emailContentInput.trim()) { toast.error('Paste email content to analyze'); return; }
    const data = await callWraith('analyze_email', { input: emailContentInput });
    if (data) setAnalysisResult({ type: 'email', data });
  };

  const checkBreaches = async () => {
    if (!emailInput.trim()) { toast.error('Enter an email to check'); return; }
    const data = await callWraith('check_breaches', { email: emailInput });
    if (data) setAnalysisResult({ type: 'breach', data });
  };

  const scanIpExposure = async () => {
    const data = await callWraith('scan_ip_exposure');
    if (data) setNetworkResults({ type: 'ip', data });
  };

  const checkDnsLeaks = async () => {
    const data = await callWraith('check_dns_leaks');
    if (data) setNetworkResults({ type: 'dns', data });
  };

  const checkSsl = async () => {
    if (!sslDomain.trim()) { toast.error('Enter a domain to check'); return; }
    const data = await callWraith('check_ssl', { input: sslDomain });
    if (data) setNetworkResults({ type: 'ssl', data });
  };

  const detectWebRtcLeaks = async () => {
    // Client-side WebRTC leak detection
    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      const ips: string[] = [];
      
      pc.createDataChannel('');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 3000);
        pc.onicecandidate = (e) => {
          if (!e.candidate) { clearTimeout(timeout); resolve(); return; }
          const match = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
          if (match && !ips.includes(match[1])) ips.push(match[1]);
        };
      });

      pc.close();

      const localIps = ips.filter(ip => /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip));
      const publicIps = ips.filter(ip => !localIps.includes(ip));

      setWebrtcLeaks({
        detected_ips: ips,
        local_ips: localIps,
        public_ips: publicIps,
        leak_detected: publicIps.length > 0,
        risk_level: publicIps.length > 0 ? 'high' : 'low',
        scanned_at: new Date().toISOString(),
      });

      if (publicIps.length > 0) {
        toast.error(`WebRTC leak detected: ${publicIps.length} public IP(s) exposed`);
      } else {
        toast.success('No WebRTC IP leaks detected');
      }
    } catch {
      toast.error('WebRTC detection not supported in this browser');
    }
  };

  const scoreColor = (score: number | null) => {
    if (score === null) return 'text-muted-foreground';
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-yellow-500';
    if (score >= 40) return 'text-orange-500';
    return 'text-red-500';
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-red-500/10">
          <Shield className="h-6 w-6 text-red-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">WRAITH Security Advisor</h1>
          <p className="text-sm text-muted-foreground">Personal security posture analysis & threat prevention</p>
        </div>
      </div>

      {/* Security Scorecard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className={`border ${riskBg[securityScore?.risk_level || 'unknown']}`}>
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-muted-foreground mb-1">Security Score</p>
            <p className={`text-5xl font-bold ${scoreColor(securityScore?.score)}`}>
              {securityScore?.score ?? '—'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {securityScore?.last_scan ? `Last scan: ${new Date(securityScore.last_scan).toLocaleDateString()}` : 'No scan yet'}
            </p>
            <Progress value={securityScore?.score || 0} className="mt-3 h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-muted-foreground mb-1">Breaches Detected</p>
            <p className={`text-5xl font-bold ${(securityScore?.breach_count || 0) > 0 ? 'text-red-500' : 'text-green-500'}`}>
              {securityScore?.breach_count ?? '—'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Across monitored emails</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-2">Quick Audit</p>
            <div className="flex gap-2">
              <Input
                placeholder="your@email.com"
                value={breachEmail}
                onChange={e => setBreachEmail(e.target.value)}
                className="text-sm"
              />
              <Button onClick={runFullAudit} disabled={loading['full_security_audit']} size="sm">
                {loading['full_security_audit'] ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="analyze" className="space-y-4">
        <TabsList className="grid grid-cols-5 w-full max-w-2xl">
          <TabsTrigger value="analyze" className="text-xs sm:text-sm"><Search className="h-3 w-3 mr-1" />Analyze</TabsTrigger>
          <TabsTrigger value="network" className="text-xs sm:text-sm"><Radar className="h-3 w-3 mr-1" />Network</TabsTrigger>
          <TabsTrigger value="threats" className="text-xs sm:text-sm"><AlertTriangle className="h-3 w-3 mr-1" />Threats</TabsTrigger>
          <TabsTrigger value="hardening" className="text-xs sm:text-sm"><Key className="h-3 w-3 mr-1" />Harden</TabsTrigger>
          <TabsTrigger value="mobile" className="text-xs sm:text-sm"><Smartphone className="h-3 w-3 mr-1" />Mobile</TabsTrigger>
        </TabsList>

        {/* Submit for Analysis */}
        <TabsContent value="analyze" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* URL Scanner */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2"><Link className="h-4 w-4" /> URL Scanner</CardTitle>
                <CardDescription className="text-xs">Check for phishing, malware & spoofing</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Input placeholder="https://suspicious-site.com" value={urlInput} onChange={e => setUrlInput(e.target.value)} className="text-sm" />
                <Button onClick={analyzeUrl} disabled={loading['analyze_url']} className="w-full" size="sm">
                  {loading['analyze_url'] ? 'Analyzing...' : 'Scan URL'}
                </Button>
              </CardContent>
            </Card>

            {/* Email Phishing Check */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2"><Mail className="h-4 w-4" /> Phishing Detector</CardTitle>
                <CardDescription className="text-xs">Paste suspicious email content</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <textarea
                  placeholder="Paste email content here..."
                  value={emailContentInput}
                  onChange={e => setEmailContentInput(e.target.value)}
                  className="w-full h-20 text-sm rounded-md border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <Button onClick={analyzeEmail} disabled={loading['analyze_email']} className="w-full" size="sm">
                  {loading['analyze_email'] ? 'Analyzing...' : 'Detect Phishing'}
                </Button>
              </CardContent>
            </Card>

            {/* Breach Check */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2"><Globe className="h-4 w-4" /> Breach Check</CardTitle>
                <CardDescription className="text-xs">Check if your email is in data breaches</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Input placeholder="your@email.com" type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)} className="text-sm" />
                <Button onClick={checkBreaches} disabled={loading['check_breaches']} className="w-full" size="sm">
                  {loading['check_breaches'] ? 'Checking...' : 'Check Breaches'}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Analysis Results */}
          {analysisResult && (
            <Card className="border-primary/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shield className="h-4 w-4" /> Analysis Results
                  {analysisResult.data?.analysis?.risk_level && (
                    <Badge variant="outline" className={riskColors[analysisResult.data.analysis.risk_level]}>
                      {analysisResult.data.analysis.risk_level?.toUpperCase()}
                    </Badge>
                  )}
                  {analysisResult.data?.risk_level && (
                    <Badge variant="outline" className={riskColors[analysisResult.data.risk_level]}>
                      {analysisResult.data.risk_level?.toUpperCase()}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AnalysisResultView result={analysisResult} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Network Scanning */}
        <TabsContent value="network" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* IP Exposure */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2"><Radar className="h-4 w-4" /> IP Exposure Scan</CardTitle>
                <CardDescription className="text-xs">Check your public IP against threat databases</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={scanIpExposure} disabled={loading['scan_ip_exposure']} className="w-full" size="sm">
                  {loading['scan_ip_exposure'] ? 'Scanning...' : 'Scan My IP'}
                </Button>
              </CardContent>
            </Card>

            {/* DNS Leak */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2"><Globe className="h-4 w-4" /> DNS Leak Test</CardTitle>
                <CardDescription className="text-xs">Check if your VPN is leaking DNS queries</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={checkDnsLeaks} disabled={loading['check_dns_leaks']} className="w-full" size="sm">
                  {loading['check_dns_leaks'] ? 'Checking...' : 'Test DNS Leaks'}
                </Button>
              </CardContent>
            </Card>

            {/* WebRTC Leak */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2"><Eye className="h-4 w-4" /> WebRTC Leak Detection</CardTitle>
                <CardDescription className="text-xs">Detect if WebRTC exposes your real IP</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={detectWebRtcLeaks} className="w-full" size="sm">
                  Detect WebRTC Leaks
                </Button>
                {webrtcLeaks && (
                  <div className="mt-3 space-y-2">
                    <div className={`p-2 rounded border text-xs ${webrtcLeaks.leak_detected ? 'border-destructive/30 bg-destructive/5' : 'border-green-500/30 bg-green-500/5'}`}>
                      <p className="font-medium">{webrtcLeaks.leak_detected ? '⚠️ Leak Detected' : '✅ No Leak'}</p>
                      {webrtcLeaks.public_ips?.length > 0 && <p className="text-muted-foreground mt-1">Exposed IPs: {webrtcLeaks.public_ips.join(', ')}</p>}
                      {webrtcLeaks.local_ips?.length > 0 && <p className="text-muted-foreground">Local IPs: {webrtcLeaks.local_ips.join(', ')}</p>}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* SSL/TLS Check */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2"><Lock className="h-4 w-4" /> SSL/TLS Checker</CardTitle>
                <CardDescription className="text-xs">Analyze certificate & security headers</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Input placeholder="example.com" value={sslDomain} onChange={e => setSslDomain(e.target.value)} className="text-sm" />
                <Button onClick={checkSsl} disabled={loading['check_ssl']} className="w-full" size="sm">
                  {loading['check_ssl'] ? 'Checking...' : 'Check SSL/TLS'}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Network Results */}
          {networkResults && (
            <Card className="border-primary/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Radar className="h-4 w-4" /> Network Scan Results
                  {networkResults.data?.risk_level && (
                    <Badge variant="outline" className={riskColors[networkResults.data.risk_level]}>
                      {networkResults.data.risk_level?.toUpperCase()}
                    </Badge>
                  )}
                  {networkResults.data?.grade && (
                    <Badge variant="outline" className="text-primary">{networkResults.data.grade}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <NetworkResultView result={networkResults} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Live Threat Feed */}
        <TabsContent value="threats" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Active Threat Intelligence</h3>
            <Button onClick={loadThreatFeed} variant="outline" size="sm" disabled={loading['get_threat_feed']}>
              <RefreshCw className={`h-3 w-3 mr-1 ${loading['get_threat_feed'] ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
          
          {threatFeed?.vulnerabilities?.length > 0 ? (
            <div className="space-y-2">
              {threatFeed.vulnerabilities.map((vuln: any, i: number) => (
                <Card key={i} className="border-orange-500/20">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{vuln.cve}</p>
                        <p className="text-xs text-muted-foreground">{vuln.vendor} — {vuln.product}</p>
                        {vuln.description && <p className="text-xs mt-1 text-muted-foreground line-clamp-2">{vuln.description}</p>}
                      </div>
                      <Badge variant="outline" className="text-orange-500 shrink-0 text-xs">Active</Badge>
                    </div>
                    {vuln.action && <p className="text-xs mt-2 text-primary font-medium">Action: {vuln.action}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No active threat data available</CardContent></Card>
          )}
        </TabsContent>

        {/* Hardening Checklist */}
        <TabsContent value="hardening" className="space-y-4">
          <h3 className="font-semibold">Security Hardening Checklist</h3>
          <p className="text-sm text-muted-foreground">Complete these items to maximize your security score.</p>
          
          <div className="space-y-2">
            {hardeningItems.map((item, i) => (
              <Card key={i}>
                <CardContent className="py-3 px-4 flex items-center gap-3">
                  <div className={`p-1.5 rounded ${item.critical ? 'bg-red-500/10' : 'bg-primary/10'}`}>
                    <item.icon className={`h-4 w-4 ${item.critical ? 'text-red-500' : 'text-primary'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">+{item.points}pts</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Mobile Security */}
        <TabsContent value="mobile" className="space-y-4">
          <h3 className="font-semibold">Mobile & Wireless Security</h3>
          <p className="text-sm text-muted-foreground">Protect your phone and wireless connections.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mobileSecurityCards.map((card, i) => (
              <Card key={i} className={`border ${card.critical ? 'border-red-500/30' : 'border-border'}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <card.icon className={`h-4 w-4 ${card.critical ? 'text-red-500' : 'text-primary'}`} />
                    {card.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {card.tips.map((tip, j) => (
                      <li key={j} className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                        {tip}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AnalysisResultView({ result }: { result: any }) {
  const { type, data } = result;

  if (type === 'url' && data?.analysis) {
    const a = data.analysis;
    return (
      <div className="space-y-3">
        <p className="text-sm"><strong>URL:</strong> {data.url}</p>
        {a.threat_type && <p className="text-sm"><strong>Threat Type:</strong> {a.threat_type}</p>}
        {a.indicators?.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-1">Indicators:</p>
            <ul className="space-y-1">{a.indicators.map((ind: string, i: number) => (
              <li key={i} className="text-xs flex items-start gap-1.5"><XCircle className="h-3 w-3 text-red-400 mt-0.5 shrink-0" />{ind}</li>
            ))}</ul>
          </div>
        )}
        {a.recommendation && <p className="text-sm text-primary">{a.recommendation}</p>}
      </div>
    );
  }

  if (type === 'email' && data?.analysis) {
    const a = data.analysis;
    return (
      <div className="space-y-3">
        {a.phishing_score != null && (
          <div><p className="text-sm mb-1"><strong>Phishing Score:</strong> {a.phishing_score}/100</p><Progress value={a.phishing_score} className="h-2" /></div>
        )}
        {a.social_engineering_tactics?.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-1">Social Engineering Tactics:</p>
            <div className="flex flex-wrap gap-1">{a.social_engineering_tactics.map((t: string, i: number) => <Badge key={i} variant="outline" className="text-xs">{t}</Badge>)}</div>
          </div>
        )}
        {a.indicators?.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-1">Red Flags:</p>
            <ul className="space-y-1">{a.indicators.map((ind: string, i: number) => (
              <li key={i} className="text-xs flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-orange-400 mt-0.5 shrink-0" />{ind}</li>
            ))}</ul>
          </div>
        )}
        {a.recommendation && <p className="text-sm text-primary">{a.recommendation}</p>}
      </div>
    );
  }

  if (type === 'breach' && data) {
    return (
      <div className="space-y-3">
        <p className="text-sm"><strong>Email:</strong> {data.email}</p>
        <p className="text-sm"><strong>Breaches Found:</strong> {data.breach_count || 0}{data.critical_count > 0 && <span className="text-red-500"> ({data.critical_count} critical)</span>}</p>
        {data.breaches?.length > 0 && (
          <div className="space-y-2">
            {data.breaches.map((b: any, i: number) => (
              <div key={i} className={`p-2 rounded border text-xs ${b.is_critical ? 'border-red-500/30 bg-red-500/5' : 'border-border'}`}>
                <span className="font-medium">{b.name}</span> — {b.date}
                {b.data_exposed?.length > 0 && <p className="text-muted-foreground mt-0.5">Exposed: {b.data_exposed.join(', ')}</p>}
              </div>
            ))}
          </div>
        )}
        {data.recommendations?.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-1">Recommendations:</p>
            <ul className="space-y-1">{data.recommendations.map((r: string, i: number) => (
              <li key={i} className="text-xs flex items-start gap-1.5"><CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />{r}</li>
            ))}</ul>
          </div>
        )}
        {data.message && <p className="text-sm text-green-500">{data.message}</p>}
      </div>
    );
  }

  if (type === 'audit' && data) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className={`text-3xl font-bold ${data.score >= 80 ? 'text-green-500' : data.score >= 60 ? 'text-yellow-500' : 'text-red-500'}`}>{data.score}</p>
            <p className="text-xs text-muted-foreground">Score</p>
          </div>
          <div className="flex-1"><Progress value={data.score} className="h-3" /></div>
        </div>
        {data.recommendations?.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-1">Priority Actions:</p>
            <ul className="space-y-1">{data.recommendations.slice(0, 5).map((r: string, i: number) => (
              <li key={i} className="text-xs flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-orange-400 mt-0.5 shrink-0" />{r}</li>
            ))}</ul>
          </div>
        )}
      </div>
    );
  }

  return <pre className="text-xs overflow-auto max-h-48">{JSON.stringify(data, null, 2)}</pre>;
}

function NetworkResultView({ result }: { result: any }) {
  const { type, data } = result;

  if (type === 'ip') {
    return (
      <div className="space-y-3">
        <p className="text-sm"><strong>Public IP:</strong> {data.ip}</p>
        {data.findings?.length > 0 && (
          <div className="space-y-1">
            {data.findings.map((f: any, i: number) => (
              <div key={i} className="text-xs flex items-start gap-1.5">
                {f.severity === 'good' || f.severity === 'info' ? <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3 w-3 text-orange-400 mt-0.5 shrink-0" />}
                <span><strong>{f.source || f.type}:</strong> {f.detail}</span>
              </div>
            ))}
          </div>
        )}
        {data.ai_analysis?.exposure_summary && <p className="text-sm text-muted-foreground">{data.ai_analysis.exposure_summary}</p>}
        {data.recommendations?.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-1">Recommendations:</p>
            <ul className="space-y-1">{data.recommendations.slice(0, 5).map((r: string, i: number) => (
              <li key={i} className="text-xs flex items-start gap-1.5"><CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />{r}</li>
            ))}</ul>
          </div>
        )}
      </div>
    );
  }

  if (type === 'dns') {
    return (
      <div className="space-y-3">
        <p className="text-sm"><strong>Public IP:</strong> {data.public_ip}</p>
        <p className="text-sm"><strong>DNS Resolver:</strong> {data.dns_resolver_ip}</p>
        <p className={`text-sm font-medium ${data.possible_dns_leak ? 'text-orange-400' : 'text-green-500'}`}>
          {data.possible_dns_leak ? '⚠️ Possible DNS leak detected' : '✅ No DNS leak detected'}
        </p>
        {data.findings?.length > 0 && (
          <div className="space-y-1">
            {data.findings.map((f: any, i: number) => (
              <div key={i} className="text-xs flex items-start gap-1.5">
                <span className="text-muted-foreground"><strong>{f.type}:</strong> {f.detail}</span>
              </div>
            ))}
          </div>
        )}
        {data.recommendations?.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-1">Recommendations:</p>
            <ul className="space-y-1">{data.recommendations.map((r: string, i: number) => (
              <li key={i} className="text-xs flex items-start gap-1.5"><CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />{r}</li>
            ))}</ul>
          </div>
        )}
      </div>
    );
  }

  if (type === 'ssl') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <p className="text-sm"><strong>Domain:</strong> {data.domain}</p>
          {data.grade && <Badge variant="outline" className="text-primary font-bold">{data.grade}</Badge>}
          {data.ssl_valid ? <Badge variant="outline" className="text-green-500">SSL Valid</Badge> : <Badge variant="outline" className="text-destructive">SSL Invalid</Badge>}
        </div>
        {data.present_headers?.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-1 text-green-500">Present Headers:</p>
            <div className="flex flex-wrap gap-1">{data.present_headers.map((h: string, i: number) => <Badge key={i} variant="outline" className="text-xs text-green-500">{h}</Badge>)}</div>
          </div>
        )}
        {data.missing_headers?.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-1 text-orange-400">Missing Headers:</p>
            <div className="flex flex-wrap gap-1">{data.missing_headers.map((h: string, i: number) => <Badge key={i} variant="outline" className="text-xs text-orange-400">{h}</Badge>)}</div>
          </div>
        )}
        {data.ai_analysis?.certificate_analysis && <p className="text-xs text-muted-foreground">{data.ai_analysis.certificate_analysis}</p>}
        {data.recommendations?.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-1">Recommendations:</p>
            <ul className="space-y-1">{data.recommendations.slice(0, 5).map((r: string, i: number) => (
              <li key={i} className="text-xs flex items-start gap-1.5"><CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />{r}</li>
            ))}</ul>
          </div>
        )}
      </div>
    );
  }

  return <pre className="text-xs overflow-auto max-h-48">{JSON.stringify(data, null, 2)}</pre>;
}

const hardeningItems = [
  { icon: Key, label: 'Password Manager', description: 'Use 1Password, Bitwarden, or similar for unique passwords', points: 10, critical: true },
  { icon: Shield, label: 'Multi-Factor Authentication', description: 'Enable MFA on all accounts — prefer FIDO2/hardware keys over SMS', points: 15, critical: true },
  { icon: Key, label: 'Hardware Security Key', description: 'YubiKey or similar FIDO2 key for critical accounts', points: 10, critical: false },
  { icon: Mail, label: 'Email Aliases', description: 'Use SimpleLogin or Apple Hide My Email for signups', points: 5, critical: false },
  { icon: Wifi, label: 'VPN on Public Networks', description: 'Always use VPN on hotel/cafe/airport WiFi', points: 5, critical: true },
  { icon: Smartphone, label: 'Full Device Encryption', description: 'Enable FileVault (Mac), BitLocker (Windows), or device encryption', points: 10, critical: true },
  { icon: RefreshCw, label: 'Automatic OS Updates', description: 'Keep all devices on latest OS and security patches', points: 5, critical: true },
  { icon: Wifi, label: 'WPA3 Home WiFi', description: 'Upgrade router to WPA3, disable WPS, change default credentials', points: 5, critical: false },
  { icon: Smartphone, label: 'Bluetooth Discipline', description: 'Turn off Bluetooth when not in use to prevent BlueBorne attacks', points: 5, critical: false },
  { icon: Smartphone, label: 'Biometric Lock', description: 'Enable Face ID/fingerprint with short auto-lock timer', points: 5, critical: true },
];

const mobileSecurityCards = [
  {
    icon: Wifi, title: 'WiFi Protection', critical: true,
    tips: [
      'Disable auto-connect to open networks',
      'Use VPN on any public WiFi',
      'Watch for Evil Twin attacks (duplicate network names)',
      'Forget networks after use',
      'Verify hotel/cafe WiFi names with staff',
    ]
  },
  {
    icon: Smartphone, title: 'Bluetooth & NFC', critical: true,
    tips: [
      'Disable Bluetooth when not in active use',
      'Disable NFC unless making a payment',
      'Never accept unknown Bluetooth pairing requests',
      'Use BLE-only mode when possible',
      'Watch for BlueBorne and BLE relay attacks',
    ]
  },
  {
    icon: Shield, title: 'Device Hardening', critical: false,
    tips: [
      'Enable biometric + strong PIN (6+ digits)',
      'Set auto-lock to 30 seconds',
      'Enable Find My Device and remote wipe',
      'Review app permissions quarterly',
      'Disable USB debugging / developer mode',
    ]
  },
  {
    icon: AlertTriangle, title: 'Attack Prevention', critical: false,
    tips: [
      'Never use public USB charging (juice jacking)',
      'Use data-blocking USB adapters',
      'Beware of IMSI catchers (Stingray devices)',
      'Install apps only from official stores',
      'Watch for SIM swap indicators (sudden signal loss)',
    ]
  },
];
