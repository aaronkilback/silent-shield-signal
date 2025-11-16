import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";

const TEST_SCENARIOS = {
  critical: [
    {
      category: "cyber-attack",
      text: "Ransomware attack detected on industrial control systems. Multiple encryption attempts observed.",
      location: "Calgary Operations Center"
    },
    {
      category: "physical-security",
      text: "Unauthorized drone activity detected near critical infrastructure facility.",
      location: "Fort McMurray Facility"
    },
    {
      category: "insider-threat",
      text: "Unusual data exfiltration pattern detected from privileged user account after hours.",
      location: "Head Office - Calgary"
    }
  ],
  high: [
    {
      category: "social-engineering",
      text: "Targeted phishing campaign identified aimed at executive team with energy sector focus.",
      location: "Corporate Network"
    },
    {
      category: "protest-activity",
      text: "Climate activist group planning coordinated demonstration at production site.",
      location: "Peace River Site"
    },
    {
      category: "supply-chain",
      text: "Critical vendor experiencing cybersecurity incident affecting service delivery.",
      location: "Third-Party Network"
    }
  ],
  medium: [
    {
      category: "weather-event",
      text: "Severe winter storm forecast affecting transportation routes to remote sites.",
      location: "Northern Alberta"
    },
    {
      category: "regulatory-change",
      text: "New environmental regulations proposed affecting operational permits.",
      location: "Provincial Jurisdiction"
    },
    {
      category: "competitor-intelligence",
      text: "Competitor announced new technology deployment in similar market segment.",
      location: "Industry News"
    }
  ],
  low: [
    {
      category: "reputational-risk",
      text: "Minor social media mentions regarding company environmental practices.",
      location: "Social Media"
    },
    {
      category: "market-intelligence",
      text: "Industry analyst report discussing energy sector trends and forecasts.",
      location: "Market Analysis"
    },
    {
      category: "general-awareness",
      text: "Security best practices update from industry association.",
      location: "Industry Newsletter"
    }
  ]
};

export const TestSignalGenerator = () => {
  const [loading, setLoading] = useState(false);
  const [severity, setSeverity] = useState<string>("medium");
  const [count, setCount] = useState<string>("1");
  const { toast } = useToast();

  const generateSignals = async () => {
    try {
      setLoading(true);

      // Get all clients
      const { data: clients, error: clientError } = await supabase
        .from("clients")
        .select("id, name, industry, locations")
        .limit(10);

      if (clientError) throw clientError;

      if (!clients || clients.length === 0) {
        toast({
          title: "No clients found",
          description: "Please onboard a client first before generating test signals.",
          variant: "destructive",
        });
        return;
      }

      const signalsToCreate = parseInt(count);
      const scenarios = TEST_SCENARIOS[severity as keyof typeof TEST_SCENARIOS];
      const signals = [];

      for (let i = 0; i < signalsToCreate; i++) {
        const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];
        const client = clients[Math.floor(Math.random() * clients.length)];
        
        const confidenceMap = {
          critical: 0.9 + Math.random() * 0.1,
          high: 0.75 + Math.random() * 0.15,
          medium: 0.55 + Math.random() * 0.2,
          low: 0.3 + Math.random() * 0.3
        };

        signals.push({
          client_id: client.id,
          category: scenario.category,
          severity: severity,
          normalized_text: scenario.text,
          location: scenario.location,
          confidence: confidenceMap[severity as keyof typeof confidenceMap],
          entity_tags: [client.name, client.industry, severity],
          status: 'new',
          raw_json: {
            source: 'test-generator',
            timestamp: new Date().toISOString(),
            scenario_type: scenario.category,
            test_data: true
          }
        });
      }

      const { error: insertError } = await supabase
        .from("signals")
        .insert(signals);

      if (insertError) throw insertError;

      toast({
        title: "Test signals created",
        description: `Generated ${signalsToCreate} ${severity} severity signal(s) for testing.`,
      });

      // Optionally trigger processing
      setTimeout(() => {
        toast({
          title: "Tip",
          description: "Click 'Trigger Manual Scan' to process these signals now.",
        });
      }, 2000);

    } catch (error) {
      console.error('Error generating test signals:', error);
      toast({
        title: "Error",
        description: "Failed to generate test signals",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          Test Signal Generator
        </CardTitle>
        <CardDescription>
          Generate realistic demo signals to test the AI decision engine and reporting
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Severity Level</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Number of Signals</Label>
            <Select value={count} onValueChange={setCount}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 signal</SelectItem>
                <SelectItem value="3">3 signals</SelectItem>
                <SelectItem value="5">5 signals</SelectItem>
                <SelectItem value="10">10 signals</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="bg-muted/50 p-3 rounded-lg text-sm">
          <p className="font-medium mb-1">What will be generated:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Realistic {severity} severity scenarios</li>
            <li>Random assignment to your clients</li>
            <li>Appropriate confidence scores</li>
            <li>Marked as test data for easy identification</li>
          </ul>
        </div>

        <Button 
          onClick={generateSignals} 
          disabled={loading}
          className="w-full"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Generate Test Signals
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};
