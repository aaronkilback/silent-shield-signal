import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Scale, AlertTriangle, CheckCircle, FileText, Send, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ComplianceCheckItem {
  id: string;
  label: string;
  description: string;
  category: "legal" | "ethical" | "opsec" | "scope";
  required: boolean;
}

const COMPLIANCE_CHECKLIST: ComplianceCheckItem[] = [
  // Scope
  { id: "scope_defined", label: "Investigation scope defined", description: "Target, time frame, geography, and data types are clearly specified", category: "scope", required: true },
  { id: "scope_proportional", label: "Scope is proportional", description: "Data collection methods are proportional to the legitimate interest", category: "scope", required: true },
  // Legal
  { id: "written_authorization", label: "Written client authorization on file", description: "Engagement letter or signed consent from client is confirmed before proceeding", category: "legal", required: true },
  { id: "gdpr_compliant", label: "GDPR/CCPA compliance verified", description: "Lawful basis for data processing identified (consent, legitimate interest, etc.)", category: "legal", required: true },
  { id: "tos_reviewed", label: "Terms of Service reviewed", description: "No restricted site scraping or ToS violations planned", category: "legal", required: true },
  { id: "local_laws", label: "Local laws reviewed", description: "Jurisdiction-specific privacy and surveillance laws checked (CFAA, ECPA, etc.)", category: "legal", required: true },
  { id: "data_retention_plan", label: "Data retention plan established", description: "Retention period defined; unnecessary data will be securely deleted post-investigation", category: "legal", required: true },
  // Ethical
  { id: "no_harassment", label: "No doxxing or harassment", description: "Investigation will not result in unauthorized disclosure of personal information", category: "ethical", required: true },
  { id: "no_unauthorized_access", label: "No unauthorized access", description: "Only publicly available and legally obtained information will be used", category: "ethical", required: true },
  { id: "dual_source", label: "Multi-source verification planned", description: "Findings will be verified against 2-3 independent sources before reporting", category: "ethical", required: false },
  // OpSec
  { id: "opsec_vpn", label: "Secure browsing environment", description: "VPN/Tor/secure browser configured to protect investigator identity", category: "opsec", required: false },
  { id: "opsec_pseudonym", label: "Pseudonym/burner accounts used", description: "No direct interaction with targets from identifiable accounts", category: "opsec", required: false },
  { id: "opsec_encrypted", label: "Encrypted storage prepared", description: "Findings will be stored in encrypted channels and secure storage", category: "opsec", required: false },
];

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  scope: { label: "Investigation Scope", icon: FileText, color: "text-blue-400" },
  legal: { label: "Legal Compliance", icon: Scale, color: "text-amber-400" },
  ethical: { label: "Ethical Standards", icon: Shield, color: "text-emerald-400" },
  opsec: { label: "Operational Security", icon: AlertTriangle, color: "text-purple-400" },
};

interface ComplianceGateProps {
  scanType: "vip_deep_scan" | "entity_deep_scan" | "osint_scan";
  targetName: string;
  targetId?: string;
  onApproved: (complianceId: string) => void;
  onSkip?: () => void;
}

export function ComplianceGate({ scanType, targetName, targetId, onApproved, onSkip }: ComplianceGateProps) {
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [jurisdiction, setJurisdiction] = useState("");
  const [legalBasis, setLegalBasis] = useState("");
  const [dataRetentionDate, setDataRetentionDate] = useState("");
  const [secureNotes, setSecureNotes] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [authStatus, setAuthStatus] = useState<"none" | "sending" | "pending" | "authorized">("none");
  const [authId, setAuthId] = useState<string | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const toggleItem = (id: string) => {
    setCheckedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const requiredItems = COMPLIANCE_CHECKLIST.filter(i => i.required);
  const allRequiredChecked = requiredItems.every(i => checkedItems.has(i.id)) &&
    !!jurisdiction.trim() && !!legalBasis.trim() && !!dataRetentionDate &&
    authStatus === "authorized";
  const totalChecked = checkedItems.size;
  const totalItems = COMPLIANCE_CHECKLIST.length;

  const sendAuthorizationRequest = async () => {
    if (!clientName.trim() || !clientEmail.trim()) {
      toast({ title: "Client details required", description: "Enter the client name and email to send the authorization request.", variant: "destructive" });
      return;
    }
    setAuthStatus("sending");
    try {
      const { data, error } = await supabase.functions.invoke("send-client-authorization", {
        body: {
          scan_type: scanType,
          target_name: targetName,
          scope_summary: secureNotes || null,
          data_retention_date: dataRetentionDate || null,
          client_name: clientName,
          client_email: clientEmail,
        },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      setAuthId(data.id);
      setAuthStatus("pending");
      toast({ title: "Authorization request sent", description: `Email sent to ${clientEmail}. Waiting for client to authorize.` });
    } catch (err: any) {
      setAuthStatus("none");
      toast({ title: "Failed to send request", description: err.message, variant: "destructive" });
    }
  };

  const checkAuthStatus = async () => {
    if (!authId) return;
    setIsCheckingAuth(true);
    try {
      const { data, error } = await supabase
        .from("client_authorizations")
        .select("status")
        .eq("id", authId)
        .single();
      if (error) throw error;
      if (data.status === "authorized") {
        setAuthStatus("authorized");
        toast({ title: "Client authorized ✓", description: "The client has confirmed their identity and authorized the scan." });
      } else {
        toast({ title: "Not yet authorized", description: "The client hasn't completed authorization yet." });
      }
    } catch {
      toast({ title: "Could not check status", variant: "destructive" });
    } finally {
      setIsCheckingAuth(false);
    }
  };

  const handleApprove = async () => {
    if (!requiredItems.every(i => checkedItems.has(i.id))) {
      toast({ title: "Required items incomplete", description: "All required compliance items must be checked.", variant: "destructive" });
      return;
    }
    if (!jurisdiction.trim() || !legalBasis.trim()) {
      toast({ title: "Required fields missing", description: "Jurisdiction and legal basis are required.", variant: "destructive" });
      return;
    }
    if (!dataRetentionDate) {
      toast({ title: "Data retention date required", description: "Specify when scan findings will be deleted.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const checklist = Object.fromEntries(
        COMPLIANCE_CHECKLIST.map(item => [item.id, checkedItems.has(item.id)])
      );
      const { data, error } = await supabase.from("investigation_compliance").insert({
        scan_type: scanType,
        target_name: targetName,
        target_id: targetId || null,
        user_id: user?.id,
        checklist,
        jurisdiction: jurisdiction || null,
        legal_basis: legalBasis || null,
        data_retention_date: dataRetentionDate || null,
        secure_notes: secureNotes || null,
        approved_at: new Date().toISOString(),
        approved_by: user?.id,
      }).select("id").single();

      if (error) throw error;
      toast({ title: "Compliance Approved", description: "Pre-investigation review completed and recorded." });
      onApproved(data.id);
    } catch (err) {
      console.error("Compliance save error:", err);
      toast({ title: "Error", description: "Failed to save compliance record.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const categories = ["scope", "legal", "ethical", "opsec"] as const;

  return (
    <Card className="border-amber-500/30 bg-card">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-amber-400" />
          <div>
            <CardTitle className="text-lg">Pre-Investigation Compliance Review</CardTitle>
            <CardDescription>
              ShadowDragon OSINT Standard — Complete required items before initiating scan on <span className="font-semibold text-foreground">{targetName}</span>
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Badge variant={allRequiredChecked ? "default" : "secondary"} className={allRequiredChecked ? "bg-emerald-600" : ""}>
            {totalChecked}/{totalItems} items
          </Badge>
          {allRequiredChecked && <Badge className="bg-emerald-600"><CheckCircle className="h-3 w-3 mr-1" /> Ready</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {categories.map(cat => {
          const meta = CATEGORY_META[cat];
          const items = COMPLIANCE_CHECKLIST.filter(i => i.category === cat);
          const Icon = meta.icon;
          return (
            <div key={cat} className="space-y-3">
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${meta.color}`} />
                <span className="font-medium text-sm">{meta.label}</span>
              </div>
              <div className="space-y-2 ml-6">
                {items.map(item => (
                  <div key={item.id} className="flex items-start gap-3">
                    <Checkbox
                      id={item.id}
                      checked={checkedItems.has(item.id)}
                      onCheckedChange={() => toggleItem(item.id)}
                    />
                    <div className="flex-1">
                      <Label htmlFor={item.id} className="text-sm font-medium cursor-pointer">
                        {item.label} {item.required && <span className="text-destructive">*</span>}
                      </Label>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border">
          <div className="space-y-2">
            <Label className="text-sm">Jurisdiction <span className="text-destructive">*</span></Label>
            <Input placeholder="e.g., US-CA, UK, EU" value={jurisdiction} onChange={e => setJurisdiction(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Legal Basis <span className="text-destructive">*</span></Label>
            <Input placeholder="e.g., Legitimate interest, Client consent" value={legalBasis} onChange={e => setLegalBasis(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Data Deletion Date <span className="text-destructive">*</span></Label>
            <Input type="date" value={dataRetentionDate} onChange={e => setDataRetentionDate(e.target.value)} min={new Date().toISOString().split('T')[0]} />
            <p className="text-xs text-muted-foreground">Date by which all scan findings will be securely deleted</p>
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Secure Notes</Label>
            <Textarea
              placeholder="Authorization reference number, engagement letter date, or other secure notes..."
              value={secureNotes}
              onChange={e => setSecureNotes(e.target.value)}
              className="resize-none text-sm"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">Stored encrypted at rest — do not include passwords or raw credentials</p>
          </div>
        </div>

        {/* Client Authorization */}
        <div className="pt-2 border-t border-border space-y-3">
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 text-blue-400" />
            <span className="font-medium text-sm">Client Authorization <span className="text-destructive">*</span></span>
            {authStatus === "authorized" && (
              <Badge className="bg-emerald-600 ml-auto"><CheckCircle className="h-3 w-3 mr-1" /> Authorized</Badge>
            )}
            {authStatus === "pending" && (
              <Badge variant="secondary" className="ml-auto">Awaiting client</Badge>
            )}
          </div>

          {authStatus === "none" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Client Name</Label>
                <Input placeholder="Jane Smith" value={clientName} onChange={e => setClientName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Client Email</Label>
                <Input type="email" placeholder="client@company.com" value={clientEmail} onChange={e => setClientEmail(e.target.value)} />
              </div>
              <Button
                variant="outline"
                className="md:col-span-2"
                onClick={sendAuthorizationRequest}
                disabled={!clientName.trim() || !clientEmail.trim()}
              >
                <Send className="h-4 w-4 mr-2" />
                Send Authorization Request to Client
              </Button>
            </div>
          )}

          {authStatus === "sending" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 bg-secondary/30 rounded-lg">
              <Loader2 className="h-4 w-4 animate-spin" />
              Sending authorization email...
            </div>
          )}

          {authStatus === "pending" && (
            <div className="space-y-2">
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-300">
                Authorization email sent to <strong>{clientEmail}</strong>. The client must click the link and enter their OTP to authorize.
              </div>
              <Button variant="outline" size="sm" onClick={checkAuthStatus} disabled={isCheckingAuth}>
                {isCheckingAuth ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <RefreshCw className="h-3 w-3 mr-2" />}
                Check Authorization Status
              </Button>
            </div>
          )}

          {authStatus === "authorized" && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-sm text-emerald-300">
              ✓ <strong>{clientName}</strong> has verified their identity via email OTP and authorized this scan. Timestamp and IP recorded.
            </div>
          )}
        </div>

        <div className="pt-2">
          <Button onClick={handleApprove} disabled={!allRequiredChecked || isSubmitting} className="w-full">
            <CheckCircle className="h-4 w-4 mr-2" />
            {isSubmitting ? "Recording..." : "Approve & Proceed"}
          </Button>
          {authStatus !== "authorized" && (
            <p className="text-xs text-muted-foreground text-center mt-2">Client authorization required before proceeding</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
