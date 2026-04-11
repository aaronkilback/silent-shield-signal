import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Shield, CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const TIER_LABELS: Record<string, string> = {
  foundation: "Foundation",
  advanced:   "Advanced",
  elite:      "Elite",
};

const DOMAIN_LABELS: Record<string, string> = {
  travel_security:         "Executive Protection & Travel Security",
  physical_security:       "Physical Security Operations",
  cyber_threat_intel:      "Cyber Threat Intelligence",
  osint_privacy:           "OSINT & Digital Intelligence",
  financial_security:      "Financial Security & Fraud",
  business_continuity:     "Business Continuity & Crisis Management",
  reputational_risk:       "Reputational Risk & Information Operations",
  intelligence_tradecraft: "Intelligence Tradecraft & Investigations",
  protective_intelligence: "Protective Intelligence",
};

const TIER_COLORS: Record<string, string> = {
  foundation: "#3b82f6",
  advanced:   "#f59e0b",
  elite:      "#ef4444",
};

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span style={{ color: "#94a3b8" }}>{label}</span>
        <span style={{ color: "#f1f5f9", fontWeight: 600 }}>{value}%</span>
      </div>
      <div style={{ height: 6, background: "#1e293b", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${value}%`, background: color, borderRadius: 999, transition: "width 1s ease" }} />
      </div>
    </div>
  );
}

export default function AcademyCredential() {
  const { id } = useParams<{ id: string }>();

  const { data: credential, isLoading, error } = useQuery({
    queryKey: ["academy-credential", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academy_credentials")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const linkedInUrl = credential ? (() => {
    const params = new URLSearchParams({
      startTask:        "CERTIFICATION_NAME",
      name:             `Fortress Academy — ${DOMAIN_LABELS[credential.domain] || credential.domain}`,
      organizationName: "Silent Shield Security",
      issueYear:        new Date(credential.issued_at).getFullYear().toString(),
      issueMonth:       (new Date(credential.issued_at).getMonth() + 1).toString(),
      certUrl:          `${window.location.origin}/credential/${credential.id}`,
      certId:           credential.id,
    });
    return `https://www.linkedin.com/profile/add?${params.toString()}`;
  })() : null;

  if (isLoading) return (
    <div style={{ minHeight: "100vh", background: "#0a0f1a", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Loader2 style={{ width: 32, height: 32, color: "#3b82f6", animation: "spin 1s linear infinite" }} />
    </div>
  );

  if (error || !credential) return (
    <div style={{ minHeight: "100vh", background: "#0a0f1a", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <Shield style={{ width: 48, height: 48, color: "#334155" }} />
      <p style={{ color: "#64748b", fontSize: 16 }}>Credential not found or has been revoked.</p>
    </div>
  );

  const tierColor    = TIER_COLORS[credential.matched_tier] || "#3b82f6";
  const preScore     = Math.round(credential.pre_score  * 100);
  const postScore    = Math.round(credential.post_score * 100);
  const delta        = Math.round(credential.judgment_delta * 100);
  const domainLabel  = DOMAIN_LABELS[credential.domain] || credential.domain;
  const tierLabel    = TIER_LABELS[credential.matched_tier] || credential.matched_tier;
  const issuedDate   = new Date(credential.issued_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1a", color: "#f1f5f9", fontFamily: "system-ui, sans-serif" }}>

      {/* Top bar */}
      <div style={{ borderBottom: "1px solid #1e293b", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ background: "#1e3a5f", borderRadius: 8, padding: 8 }}>
            <Shield style={{ width: 20, height: 20, color: "#3b82f6" }} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9" }}>Fortress Academy</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Silent Shield Security</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#22c55e", fontSize: 13 }}>
          <CheckCircle2 style={{ width: 16, height: 16 }} />
          Verified Credential
        </div>
      </div>

      {/* Main credential */}
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 24px" }}>

        {/* Tier badge */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
          <div style={{
            border: `2px solid ${tierColor}`,
            borderRadius: 999,
            padding: "6px 20px",
            fontSize: 13,
            fontWeight: 600,
            color: tierColor,
            background: `${tierColor}18`,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}>
            {tierLabel} Level
          </div>
        </div>

        {/* Name + title */}
        <div style={{ textAlign: "center", marginBottom: 40, space: 8 }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: "#f1f5f9", margin: 0, lineHeight: 1.2 }}>
            {credential.full_name}
          </h1>
          <p style={{ fontSize: 16, color: "#94a3b8", marginTop: 8 }}>
            has demonstrated professional-level judgment in
          </p>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", margin: "8px 0 0" }}>
            {domainLabel}
          </h2>
        </div>

        {/* Score card */}
        <div style={{
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: 16,
          padding: 32,
          marginBottom: 32,
        }}>
          {/* Delta hero */}
          <div style={{ textAlign: "center", marginBottom: 32, paddingBottom: 24, borderBottom: "1px solid #1e293b" }}>
            <div style={{ fontSize: 13, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              Judgment Delta
            </div>
            <div style={{ fontSize: 56, fontWeight: 800, color: delta >= 0 ? "#22c55e" : "#ef4444", lineHeight: 1 }}>
              {delta >= 0 ? "+" : ""}{delta}
              <span style={{ fontSize: 28 }}>pts</span>
            </div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 8 }}>
              Measured improvement from pre-test to post-training assessment
            </div>
          </div>

          {/* Score bars */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <ScoreBar label="Pre-Training Baseline" value={preScore} color="#64748b" />
            <ScoreBar label="Post-Training Score"   value={postScore} color={tierColor} />
          </div>

          {/* Assessment details */}
          <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid #1e293b", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[
              { label: "Course", value: credential.course_title },
              { label: "AI Agent", value: credential.agent_call_sign },
              { label: "Assessment Method", value: "Scenario-based judgment test" },
              { label: "Scoring", value: "65% choice quality + 35% reasoning" },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
                <div style={{ fontSize: 14, color: "#cbd5e1", marginTop: 3 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* What this means */}
        <div style={{
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: 16,
          padding: 24,
          marginBottom: 32,
        }}>
          <div style={{ fontSize: 13, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>
            About This Assessment
          </div>
          <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
            Fortress Academy assessments place practitioners in operational scenarios where critical information is incomplete or ambiguous — mirroring real-world conditions. There are no obviously correct answers. Each option carries a distinct risk profile. Scores reflect both the quality of the decision and the quality of the reasoning behind it, evaluated against professional security doctrine by Fortress AI.
          </p>
          <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.7, margin: "12px 0 0" }}>
            This is not a knowledge test. It is a judgment measurement.
          </p>
        </div>

        {/* Issued + credential ID */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32, flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 13, color: "#64748b" }}>
            Issued {issuedDate} · Credential ID: <span style={{ color: "#94a3b8", fontFamily: "monospace" }}>{credential.id.slice(0, 8).toUpperCase()}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#22c55e", fontSize: 13 }}>
            <CheckCircle2 style={{ width: 14, height: 14 }} />
            Verified by Fortress AI
          </div>
        </div>

        {/* LinkedIn CTA */}
        {linkedInUrl && (
          <a
            href={linkedInUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              width: "100%",
              padding: "16px 24px",
              background: "#0077b5",
              borderRadius: 10,
              color: "#fff",
              fontWeight: 600,
              fontSize: 15,
              textDecoration: "none",
              boxSizing: "border-box",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
            </svg>
            Add to LinkedIn Profile
            <ExternalLink style={{ width: 16, height: 16 }} />
          </a>
        )}

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: 40, paddingTop: 24, borderTop: "1px solid #1e293b" }}>
          <p style={{ fontSize: 12, color: "#475569" }}>
            fortress.silentshieldsecurity.com/academy · Silent Shield Security
          </p>
        </div>
      </div>
    </div>
  );
}
