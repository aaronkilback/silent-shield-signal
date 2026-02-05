import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  FileText, Loader2, MapPin, AlertTriangle, Shield, 
  Heart, Car, Building, Plane, Download, Volume2
} from "lucide-react";
import { toast } from "sonner";

interface GeneratedBriefing {
  location: {
    city: string;
    country: string;
  };
  risk_rating: string;
  overview: string;
  key_risks: Array<{
    category: string;
    level: string;
    description: string;
  }>;
  latest_developments: Array<{
    date: string;
    title: string;
    description: string;
  }>;
  security_advice: Array<{
    category: string;
    recommendations: string[];
  }>;
  transportation: {
    airport: string;
    ground_transport: string;
    recommendations: string[];
  };
  emergency_contacts: Array<{
    name: string;
    number: string;
  }>;
  travel_advisory: string;
  sources: string[];
}

export function GenerateSecurityBriefing() {
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [travelDates, setTravelDates] = useState("");
  const [briefing, setBriefing] = useState<GeneratedBriefing | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  const generateMutation = useMutation({
    mutationFn: async ({ city, country, travelDates }: { city: string; country: string; travelDates: string }) => {
      const { data, error } = await supabase.functions.invoke("generate-security-briefing", {
        body: { city, country, travel_dates: travelDates },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setBriefing(data.briefing);
      toast.success("Security briefing generated");
    },
    onError: (error) => {
      toast.error("Failed to generate briefing: " + (error as Error).message);
    },
  });

  const audioMutation = useMutation({
    mutationFn: async () => {
      if (!briefing) return;
      const { data, error } = await supabase.functions.invoke("generate-briefing-audio", {
        body: { briefing },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.audio_url) {
        const audio = new Audio(data.audio_url);
        audio.play();
      }
    },
    onError: (error) => {
      toast.error("Failed to generate audio: " + (error as Error).message);
    },
  });

  const handleGenerate = () => {
    if (!city || !country) {
      toast.error("Please enter city and country");
      return;
    }
    generateMutation.mutate({ city, country, travelDates });
  };

  const getRiskColor = (risk: string) => {
    const lower = risk?.toLowerCase() || "";
    if (lower.includes("extreme") || lower.includes("critical")) return "destructive";
    if (lower.includes("high")) return "destructive";
    if (lower.includes("medium")) return "default";
    return "secondary";
  };

  const getCategoryIcon = (category: string) => {
    const lower = category.toLowerCase();
    if (lower.includes("crime")) return AlertTriangle;
    if (lower.includes("health")) return Heart;
    if (lower.includes("transport") || lower.includes("road")) return Car;
    if (lower.includes("terror")) return Shield;
    if (lower.includes("infrastructure")) return Building;
    return AlertTriangle;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Generate Security Briefing
          </CardTitle>
          <CardDescription>
            Create an International SOS-style security briefing using Fortress intelligence data
            and real-time information from multiple sources.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>City</Label>
              <Input
                placeholder="e.g., Kuala Lumpur"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Country</Label>
              <Input
                placeholder="e.g., Malaysia"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Travel Dates (optional)</Label>
              <Input
                placeholder="e.g., Feb 10-15, 2026"
                value={travelDates}
                onChange={(e) => setTravelDates(e.target.value)}
              />
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={generateMutation.isPending}
            className="w-full"
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating Briefing...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                Generate Security Briefing
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {briefing && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  {briefing.location.city}, {briefing.location.country}
                </CardTitle>
                <CardDescription>Security Briefing • Generated by Fortress</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={getRiskColor(briefing.risk_rating)} className="text-lg px-3 py-1">
                  {briefing.risk_rating} Risk
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => audioMutation.mutate()}
                  disabled={audioMutation.isPending}
                >
                  <Volume2 className="h-4 w-4 mr-1" />
                  Listen
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="risks">Risks</TabsTrigger>
                <TabsTrigger value="developments">Updates</TabsTrigger>
                <TabsTrigger value="advice">Advice</TabsTrigger>
                <TabsTrigger value="transport">Transport</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4 pt-4">
                <div>
                  <h4 className="font-medium mb-2">Location Overview</h4>
                  <p className="text-sm text-muted-foreground">{briefing.overview}</p>
                </div>

                <div>
                  <h4 className="font-medium mb-2">Travel Advisory</h4>
                  <p className="text-sm">{briefing.travel_advisory}</p>
                </div>

                {briefing.emergency_contacts.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Emergency Contacts</h4>
                    <div className="grid gap-2">
                      {briefing.emergency_contacts.map((contact, i) => (
                        <div key={i} className="flex justify-between text-sm p-2 bg-muted rounded">
                          <span>{contact.name}</span>
                          <span className="font-mono font-medium">{contact.number}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="risks" className="space-y-4 pt-4">
                {briefing.key_risks.map((risk, i) => {
                  const Icon = getCategoryIcon(risk.category);
                  return (
                    <div key={i} className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <span className="font-medium">{risk.category}</span>
                        </div>
                        <Badge variant={getRiskColor(risk.level)}>{risk.level}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{risk.description}</p>
                    </div>
                  );
                })}
              </TabsContent>

              <TabsContent value="developments" className="space-y-4 pt-4">
                {briefing.latest_developments.map((dev, i) => (
                  <div key={i} className="p-4 border rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">{dev.date}</Badge>
                      <span className="font-medium">{dev.title}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{dev.description}</p>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="advice" className="space-y-4 pt-4">
                {briefing.security_advice.map((section, i) => (
                  <div key={i} className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">{section.category}</h4>
                    <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                      {section.recommendations.map((rec, j) => (
                        <li key={j}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="transport" className="space-y-4 pt-4">
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Plane className="h-4 w-4" />
                    <span className="font-medium">Airport</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{briefing.transportation.airport}</p>
                </div>

                <div className="p-4 border rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Car className="h-4 w-4" />
                    <span className="font-medium">Ground Transportation</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{briefing.transportation.ground_transport}</p>
                  <ul className="text-sm list-disc list-inside space-y-1">
                    {briefing.transportation.recommendations.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                </div>

                {briefing.sources.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium">Sources:</span> {briefing.sources.join(", ")}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
