import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  { id: "role",       type: "text",    title: "What is your current job title or role?",
    placeholder: "e.g. Director of Security, Close Protection Officer, Intelligence Analyst",
    required: true },

  { id: "sector",     type: "choice",  title: "Which sector best describes your current work?",
    options: [
      { value: "corporate",      label: "Corporate Security",         sub: "In-house security for a company or organization" },
      { value: "law_enforcement",label: "Law Enforcement / Government", sub: "Police, federal agency, border services" },
      { value: "military_intel", label: "Military / Intelligence",    sub: "Armed forces, national intelligence community" },
      { value: "private",        label: "Private / Consulting",       sub: "Independent operator, security firm, consultant" },
      { value: "transitioning",  label: "Transitioning / Studying",   sub: "Moving into the field or building credentials" },
      { value: "other",          label: "Other",                      sub: "" },
    ]},

  { id: "operational_experience", type: "choice", title: "What is your primary area of operational experience?",
    options: [
      { value: "close_protection",  label: "Close Protection / EP",        sub: "Executive protection, personal security details" },
      { value: "threat_assessment", label: "Threat Assessment / Intel",     sub: "Protective intelligence, threat analysis" },
      { value: "physical_security", label: "Physical Security Operations",  sub: "Facilities, access control, guard operations" },
      { value: "investigations",    label: "Investigations",                sub: "Corporate, criminal, or intelligence investigations" },
      { value: "crisis_management", label: "Crisis / Incident Management",  sub: "Emergency response, business continuity" },
      { value: "cyber",             label: "Cyber / Technical Security",    sub: "Cybersecurity, digital threat intelligence" },
      { value: "other",             label: "Other / Multiple",              sub: "" },
    ]},

  { id: "decision_authority", type: "choice", title: "Have you ever been the primary decision-maker in a life-safety incident?",
    sub: "An incident where your call directly affected whether people were safe or in danger.",
    options: [
      { value: "yes_many",  label: "Yes — multiple times",     sub: "This is a regular part of my role" },
      { value: "yes_once",  label: "Yes — at least once",      sub: "I have been in that position" },
      { value: "no_close",  label: "Not directly, but close",  sub: "I've been involved but not the primary decision-maker" },
      { value: "no",        label: "No",                       sub: "Not yet" },
    ]},

  { id: "high_risk_exposure", type: "choice", title: "Have you personally operated in a high-risk environment?",
    sub: "Hostile surveillance, organized crime exposure, conflict zones, active threat environments.",
    options: [
      { value: "yes_sustained", label: "Yes — sustained exposure",   sub: "Extended deployment or ongoing operational environment" },
      { value: "yes_incident",  label: "Yes — specific incidents",   sub: "One or more high-risk assignments or events" },
      { value: "adjacent",      label: "Adjacent experience",        sub: "Trained for it or supported those who were" },
      { value: "no",            label: "No",                         sub: "No direct high-risk exposure" },
    ]},

  { id: "current_status", type: "choice", title: "Which best describes your current position?",
    options: [
      { value: "operational",  label: "Active operational role",     sub: "Currently deployed or operationally responsible" },
      { value: "management",   label: "Management / Executive",      sub: "Leading a security function or team" },
      { value: "consulting",   label: "Consulting / Advisory",       sub: "Independent or firm-based security consulting" },
      { value: "transitioning",label: "Transitioning / Studying",    sub: "Building toward an operational role" },
    ]},

  { id: "team_size", type: "choice", title: "How many people are you currently responsible for?",
    options: [
      { value: "individual",   label: "Just myself",           sub: "Individual contributor" },
      { value: "small",        label: "2–10 people",           sub: "Small team" },
      { value: "medium",       label: "11–50 people",          sub: "Mid-size team or department" },
      { value: "large",        label: "50+ people",            sub: "Large organization or program" },
    ]},

  { id: "highest_threat", type: "textarea",
    title: "Describe the highest-threat environment you have personally operated in.",
    sub: "Be specific — location type, threat type, your role. Vague answers are noted.",
    placeholder: "e.g. Close protection for an executive in Bogotá during an active kidnap threat against the principal's family. Primary responsibility for route planning and safe house selection...",
    required: true, minLength: 60 },

  { id: "doctrine", type: "textarea",
    title: "What doctrine or framework guides your threat assessment decisions?",
    sub: "There is no right answer — we want to understand how you actually think, not what sounds best.",
    placeholder: "e.g. I use a modified CARVER matrix for targeting analysis combined with the PATH threat assessment model. In the field I default to...",
    required: false, minLength: 0 },

  { id: "confidence", type: "scale",
    title: "How confident are you in your ability to make the right call in an ambiguous threat situation?",
    sub: "1 = not confident at all. 10 = fully confident. This will be compared to your actual scenario score." },

  { id: "goal", type: "choice", title: "What is your primary goal in using Fortress Academy?",
    options: [
      { value: "calibrate",  label: "Calibrate my judgment",  sub: "Validate against professional doctrine" },
      { value: "learn",      label: "Learn a new domain",     sub: "Build knowledge in an unfamiliar area" },
      { value: "credential", label: "Build credentials",      sub: "Demonstrate competence to employers or clients" },
      { value: "team",       label: "Train my team",          sub: "Benchmark team judgment at scale" },
    ]},
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactInfo {
  full_name: string;
  email:     string;
  phone:     string;
  address:   string;
  city:      string;
  country:   string;
}

interface AcademyIntakeProps {
  onComplete: (answers: Record<string, string>, contact: ContactInfo) => void;
  loading?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AcademyIntake({ onComplete, loading = false }: AcademyIntakeProps) {
  const [step, setStep]       = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [contact, setContact] = useState<ContactInfo>({
    full_name: "", email: "", phone: "", address: "", city: "", country: "",
  });

  const CONTACT_STEP = STEPS.length;
  const total        = STEPS.length + 1;
  const isContact    = step === CONTACT_STEP;
  const s            = !isContact ? STEPS[step] : null;

  const canNext = (() => {
    if (isContact) return contact.full_name.trim().length > 1 && contact.email.includes("@");
    if (!s) return false;
    const val = answers[s.id] || "";
    if (s.type === "choice") return !!val;
    if (s.type === "scale")  return !!val;
    if (s.type === "text")   return s.required ? val.trim().length > 2 : true;
    if (s.type === "textarea") return s.required ? val.trim().length >= (s.minLength || 0) : true;
    return true;
  })();

  const setValue = (val: string) => {
    if (s) setAnswers(prev => ({ ...prev, [s.id]: val }));
  };

  const handleNext = () => {
    if (step < total - 1) setStep(n => n + 1);
    else onComplete(answers, contact);
  };

  const handleBack = () => {
    if (step > 0) setStep(n => n - 1);
  };

  const pct = Math.round(((step + 1) / total) * 100);

  return (
    <div className="max-w-2xl mx-auto space-y-8">

      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Operational Profile Assessment</span>
          <span>{step + 1} of {total}</span>
        </div>
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Step content */}
      {isContact ? (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-foreground leading-snug">Your contact information</h2>
            <p className="text-sm text-muted-foreground mt-1">Used to issue credentials and send you your results report.</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Full name *</label>
              <Input value={contact.full_name} onChange={e => setContact(c => ({ ...c, full_name: e.target.value }))} placeholder="Jane Smith" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Email *</label>
              <Input type="email" value={contact.email} onChange={e => setContact(c => ({ ...c, email: e.target.value }))} placeholder="jane@company.com" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Phone</label>
              <Input type="tel" value={contact.phone} onChange={e => setContact(c => ({ ...c, phone: e.target.value }))} placeholder="+1 555 000 0000" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Street address</label>
              <Input value={contact.address} onChange={e => setContact(c => ({ ...c, address: e.target.value }))} placeholder="123 Main St" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">City</label>
                <Input value={contact.city} onChange={e => setContact(c => ({ ...c, city: e.target.value }))} placeholder="Calgary" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Country</label>
                <Input value={contact.country} onChange={e => setContact(c => ({ ...c, country: e.target.value }))} placeholder="Canada" />
              </div>
            </div>
          </div>
        </div>

      ) : s?.type === "choice" ? (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold text-foreground leading-snug">{s.title}</h2>
            {s.sub && <p className="text-sm text-muted-foreground mt-1">{s.sub}</p>}
          </div>
          <div className="space-y-2">
            {s.options?.map(opt => {
              const sel = answers[s.id] === opt.value;
              return (
                <button key={opt.value} onClick={() => setValue(opt.value)}
                  className={cn(
                    "w-full text-left px-4 py-3.5 rounded-lg border transition-all",
                    "hover:border-primary/50 hover:bg-primary/5",
                    sel ? "border-primary bg-primary/10" : "border-border bg-card/40",
                  )}>
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                      sel ? "border-primary bg-primary" : "border-muted-foreground/40",
                    )}>
                      {sel && <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />}
                    </div>
                    <div>
                      <div className="font-medium text-sm text-foreground">{opt.label}</div>
                      {opt.sub && <div className="text-xs text-muted-foreground">{opt.sub}</div>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

      ) : s?.type === "text" ? (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold text-foreground leading-snug">{s.title}</h2>
            {s.sub && <p className="text-sm text-muted-foreground mt-1">{s.sub}</p>}
          </div>
          <Input
            value={answers[s.id] || ""}
            onChange={e => setValue(e.target.value)}
            placeholder={s.placeholder}
            className="text-sm"
            autoFocus
          />
        </div>

      ) : s?.type === "textarea" ? (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold text-foreground leading-snug">{s.title}</h2>
            {s.sub && <p className="text-sm text-amber-400/80 mt-1 text-sm">{s.sub}</p>}
          </div>
          <Textarea
            value={answers[s.id] || ""}
            onChange={e => setValue(e.target.value)}
            placeholder={s.placeholder}
            className="min-h-[130px] text-sm"
            autoFocus
          />
          {s.required && s.minLength && (
            <div className={cn("text-xs text-right", (answers[s.id] || "").length >= s.minLength ? "text-green-400" : "text-muted-foreground")}>
              {(answers[s.id] || "").length} / {s.minLength} chars minimum
            </div>
          )}
        </div>

      ) : s?.type === "scale" ? (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-foreground leading-snug">{s.title}</h2>
            {s.sub && <p className="text-sm text-muted-foreground mt-1">{s.sub}</p>}
          </div>
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              {[1,2,3,4,5,6,7,8,9,10].map(n => {
                const sel = answers[s.id] === String(n);
                return (
                  <button key={n} onClick={() => setValue(String(n))}
                    className={cn(
                      "w-11 h-11 rounded-lg border text-sm font-semibold transition-all",
                      sel ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card/40 text-muted-foreground hover:border-primary/50",
                    )}>
                    {n}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1 — Not confident</span>
              <span>10 — Fully confident</span>
            </div>
            {answers[s.id] && (
              <div className="text-sm text-foreground font-medium">
                You selected: {answers[s.id]}/10
                {Number(answers[s.id]) >= 8 && <span className="text-amber-400 ml-2">— Your scenario score will tell us if this holds up.</span>}
                {Number(answers[s.id]) <= 4 && <span className="text-blue-400 ml-2">— Honest self-assessment is itself a good sign.</span>}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="sm" onClick={handleBack} disabled={step === 0} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button size="sm" onClick={handleNext} disabled={!canNext || loading} className="gap-2">
          {loading ? "Matching you..." : step === total - 1 ? (
            <><CheckCircle2 className="w-4 h-4" /> Complete</>
          ) : (
            <>Next <ArrowRight className="w-4 h-4" /></>
          )}
        </Button>
      </div>
    </div>
  );
}
