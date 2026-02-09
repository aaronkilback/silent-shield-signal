import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Scale, AlertTriangle, CheckCircle, FileText } from "lucide-react";
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
  { id: "gdpr_compliant", label: "GDPR/CCPA compliance verified", description: "Lawful basis for data processing identified (consent, legitimate interest, etc.)", category: "legal", required: true },
  { id: "tos_reviewed", label: "Terms of Service reviewed", description: "No restricted site scraping or ToS violations planned", category: "legal", required: true },
  { id: "local_laws", label: "Local laws reviewed", description: "Jurisdiction-specific privacy and surveillance laws checked (CFAA, ECPA, etc.)", category: "legal", required: true },
  { id: "data_retention", label: "Data retention plan established", description: "Retention period defined; unnecessary data will be securely deleted post-investigation", category: "legal", required: true },
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
  const allRequiredChecked = requiredItems.every(i => checkedItems.has(i.id));
  const totalChecked = checkedItems.size;
  const totalItems = COMPLIANCE_CHECKLIST.length;

  const handleApprove = async () => {
    if (!allRequiredChecked) {
      toast({ title: "Required items incomplete", description: "All required compliance items must be checked.", variant: "destructive" });
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
            <Label className="text-sm">Jurisdiction</Label>
            <Input placeholder="e.g., US-CA, UK, EU" value={jurisdiction} onChange={e => setJurisdiction(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Legal Basis</Label>
            <Input placeholder="e.g., Legitimate interest, Client consent" value={legalBasis} onChange={e => setLegalBasis(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={handleApprove} disabled={!allRequiredChecked || isSubmitting} className="flex-1">
            <CheckCircle className="h-4 w-4 mr-2" />
            {isSubmitting ? "Recording..." : "Approve & Proceed"}
          </Button>
          {onSkip && (
            <Button variant="ghost" onClick={onSkip} className="text-muted-foreground">
              Skip (not recommended)
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
