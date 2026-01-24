import { useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { 
  Shield, User, Home, Users, Smartphone, Plane, AlertTriangle, 
  CheckCircle, ChevronRight, ChevronLeft, Clock, Zap, FileText,
  Plus, Trash2, MapPin, Car, Building, Globe, Mic, Sparkles
} from "lucide-react";
import { VoiceAssistantPanel } from "./VoiceAssistantPanel";
import { VoiceDictationInput } from "./VoiceDictationInput";
import { OSINTDiscoveryPanel } from "./OSINTDiscoveryPanel";
import { useOSINTDiscovery, type DiscoveryItem } from "@/hooks/useOSINTDiscovery";

interface FamilyMember {
  name: string;
  relationship: string;
  dateOfBirth: string;
  socialMedia: string;
}

interface TravelPlan {
  destination: string;
  departureDate: string;
  returnDate: string;
  purpose: string;
  accommodationType: string;
}

interface PropertyInfo {
  type: string;
  address: string;
  hasSecuritySystem: boolean;
  notes: string;
}

interface VIPIntakeData {
  // Step 1: Client Selection
  clientId: string;
  priorityLevel: "standard" | "priority";
  
  // Step 2: Principal Information
  fullLegalName: string;
  knownAliases: string;
  dateOfBirth: string;
  nationality: string;
  primaryEmail: string;
  secondaryEmails: string;
  primaryPhone: string;
  secondaryPhones: string;
  socialMediaHandles: string;
  
  // Step 3: Residence & Properties
  properties: PropertyInfo[];
  wildfirePreparedness: string;
  wildfireEvacuationPlan: string;
  
  // Step 4: Family & Household
  familyMembers: FamilyMember[];
  householdStaff: string;
  securityPersonnel: string;
  pets: string;
  humanWildlifeConflict: string;
  
  // Step 5: Digital Footprint
  primaryDevices: string;
  emailProviders: string;
  cloudServices: string;
  knownUsernames: string;
  corporateAffiliations: string;
  
  // Step 6: Vehicles & Movement
  vehicles: string;
  regularRoutes: string;
  frequentedLocations: string;
  gymClubMemberships: string;
  
  // Step 7: Travel Plans
  travelPlans: TravelPlan[];
  preferredAirlines: string;
  frequentDestinations: string;
  
  // Step 8: Threat Concerns
  knownAdversaries: string;
  previousIncidents: string;
  specificConcerns: string;
  industryThreats: string;
  
  // Consent
  consentDataCollection: boolean;
  consentDarkWebScan: boolean;
  consentSocialMediaAnalysis: boolean;
}

const STEPS = [
  { id: 1, title: "Client & Priority", icon: Shield, description: "Select client and scan priority" },
  { id: 2, title: "Principal Profile", icon: User, description: "Core identity information" },
  { id: 3, title: "Properties", icon: Home, description: "Residences and real estate" },
  { id: 4, title: "Family & Staff", icon: Users, description: "Household members and personnel" },
  { id: 5, title: "Digital Footprint", icon: Smartphone, description: "Devices, accounts, and online presence" },
  { id: 6, title: "Vehicles & Routes", icon: Car, description: "Transportation and movement patterns" },
  { id: 7, title: "Travel Plans", icon: Plane, description: "Upcoming travel for next 90 days" },
  { id: 8, title: "Threat Concerns", icon: AlertTriangle, description: "Known risks and adversaries" },
  { id: 9, title: "Review & Submit", icon: CheckCircle, description: "Confirm and initiate deep scan" },
];

const initialFormData: VIPIntakeData = {
  clientId: "",
  priorityLevel: "standard",
  fullLegalName: "",
  knownAliases: "",
  dateOfBirth: "",
  nationality: "",
  primaryEmail: "",
  secondaryEmails: "",
  primaryPhone: "",
  secondaryPhones: "",
  socialMediaHandles: "",
  properties: [{ type: "primary", address: "", hasSecuritySystem: false, notes: "" }],
  wildfirePreparedness: "",
  wildfireEvacuationPlan: "",
  familyMembers: [],
  householdStaff: "",
  securityPersonnel: "",
  pets: "",
  humanWildlifeConflict: "",
  primaryDevices: "",
  emailProviders: "",
  cloudServices: "",
  knownUsernames: "",
  corporateAffiliations: "",
  vehicles: "",
  regularRoutes: "",
  frequentedLocations: "",
  gymClubMemberships: "",
  travelPlans: [],
  preferredAirlines: "",
  frequentDestinations: "",
  knownAdversaries: "",
  previousIncidents: "",
  specificConcerns: "",
  industryThreats: "",
  consentDataCollection: false,
  consentDarkWebScan: false,
  consentSocialMediaAnalysis: false,
};

export function VIPDeepScanWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<VIPIntakeData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [appliedDiscoveryIds, setAppliedDiscoveryIds] = useState<Set<string>>(new Set());
  const [dismissedDiscoveryIds, setDismissedDiscoveryIds] = useState<Set<string>>(new Set());
  const [discoveryTriggered, setDiscoveryTriggered] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [autoAppliedFields, setAutoAppliedFields] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const navigate = useNavigate();
  
  // OSINT Discovery hook
  const osintDiscovery = useOSINTDiscovery();

  // Fetch clients
  const { data: clients } = useQuery({
    queryKey: ["clients-for-vip-scan"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, industry")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Get selected client's industry for threat context
  const selectedClient = useMemo(() => {
    return clients?.find(c => c.id === formData.clientId);
  }, [clients, formData.clientId]);

  // Auto-apply high-confidence discoveries to form fields
  useEffect(() => {
    if (!osintDiscovery.isRunning && osintDiscovery.discoveries.length > 0) {
      const newAppliedFields = new Set(autoAppliedFields);
      let appliedCount = 0;
      
      osintDiscovery.discoveries.forEach((discovery) => {
        // Only auto-apply high confidence discoveries with field mappings
        if (discovery.confidence >= 75 && discovery.fieldMapping && !appliedDiscoveryIds.has(discovery.id) && !dismissedDiscoveryIds.has(discovery.id)) {
          const field = discovery.fieldMapping as keyof VIPIntakeData;
          const currentValue = formData[field];
          
          // Auto-populate empty fields or append to list fields
          if (field === "socialMediaHandles") {
            const newLine = `${discovery.source}: ${discovery.value}`;
            const existingValue = typeof currentValue === "string" ? currentValue : "";
            if (!existingValue.toLowerCase().includes(discovery.value.toLowerCase())) {
              setFormData(prev => ({
                ...prev,
                socialMediaHandles: existingValue ? `${existingValue}\n${newLine}` : newLine,
              }));
              newAppliedFields.add(field);
              appliedCount++;
            }
          } else if (field === "corporateAffiliations") {
            const existingValue = typeof currentValue === "string" ? currentValue : "";
            if (!existingValue.toLowerCase().includes(discovery.value.toLowerCase())) {
              setFormData(prev => ({
                ...prev,
                corporateAffiliations: existingValue ? `${existingValue}, ${discovery.value}` : discovery.value,
              }));
              newAppliedFields.add(field);
              appliedCount++;
            }
          } else if (field === "primaryEmail" && typeof currentValue === "string" && !currentValue) {
            setFormData(prev => ({ ...prev, primaryEmail: discovery.value }));
            newAppliedFields.add(field);
            appliedCount++;
          } else if (field === "primaryPhone" && typeof currentValue === "string" && !currentValue) {
            setFormData(prev => ({ ...prev, primaryPhone: discovery.value }));
            newAppliedFields.add(field);
            appliedCount++;
          } else if (field === "knownAliases") {
            const existingValue = typeof currentValue === "string" ? currentValue : "";
            if (!existingValue.toLowerCase().includes(discovery.value.toLowerCase())) {
              setFormData(prev => ({
                ...prev,
                knownAliases: existingValue ? `${existingValue}, ${discovery.value}` : discovery.value,
              }));
              newAppliedFields.add(field);
              appliedCount++;
            }
          }
          
          // Mark as applied
          setAppliedDiscoveryIds(prev => new Set([...prev, discovery.id]));
        }
      });
      
      if (appliedCount > 0) {
        setAutoAppliedFields(newAppliedFields);
        toast({
          title: "Fields Auto-Populated",
          description: `${appliedCount} intelligence item(s) automatically applied to the form.`,
        });
      }
    }
  }, [osintDiscovery.isRunning, osintDiscovery.discoveries.length]);

  // Manual discovery trigger - no auto-trigger to ensure full name is entered
  const handleStartDiscovery = useCallback((isRescan = false) => {
    const nameToUse = formData.fullLegalName.trim();
    if (nameToUse.length < 3) {
      toast({
        title: "Name Required",
        description: "Please enter the principal's full legal name (at least 3 characters).",
        variant: "destructive",
      });
      return;
    }
    
    // Require at least a first and last name
    const nameParts = nameToUse.split(/\s+/).filter(p => p.length > 0);
    if (nameParts.length < 2) {
      toast({
        title: "Full Name Required",
        description: "Please enter both first and last name for accurate OSINT discovery.",
        variant: "destructive",
      });
      return;
    }
    
    setDiscoveryTriggered(true);
    setScanCount(prev => prev + 1);
    
    // Pass all available context to improve scan
    osintDiscovery.startDiscovery({
      name: nameToUse,
      email: formData.primaryEmail || undefined,
      dateOfBirth: formData.dateOfBirth || undefined,
      location: formData.properties[0]?.address || undefined,
      socialMediaHandles: formData.socialMediaHandles || undefined,
      industry: selectedClient?.industry || undefined,
    });
    
    toast({
      title: isRescan ? "Enhanced Scan Started" : "Deep Scan Started",
      description: isRescan 
        ? `Re-scanning with ${[formData.primaryEmail, formData.properties[0]?.address, formData.socialMediaHandles].filter(Boolean).length + 1} data points`
        : `Running Silent Shield™ intelligence sweep for "${nameToUse}"`,
    });
  }, [formData, selectedClient?.industry, osintDiscovery, toast]);

  // Check if we have new context for a rescan
  const hasNewContextForRescan = useMemo(() => {
    if (scanCount === 0) return false;
    const contextPoints = [
      formData.primaryEmail,
      formData.properties[0]?.address,
      formData.socialMediaHandles,
      formData.dateOfBirth,
    ].filter(Boolean).length;
    return contextPoints >= 2;
  }, [formData, scanCount]);

  // Apply a discovery to the form
  const handleApplyDiscovery = useCallback((discovery: DiscoveryItem) => {
    setAppliedDiscoveryIds((prev) => new Set([...prev, discovery.id]));

    // Map discovery to form fields
    if (discovery.fieldMapping) {
      const currentValue = formData[discovery.fieldMapping as keyof VIPIntakeData];
      
      if (discovery.fieldMapping === "socialMediaHandles") {
        const newLine = `${discovery.source}: ${discovery.value}`;
        const existingValue = typeof currentValue === "string" ? currentValue : "";
        if (!existingValue.includes(discovery.value)) {
          updateFormData("socialMediaHandles", existingValue ? `${existingValue}\n${newLine}` : newLine);
        }
      } else if (discovery.fieldMapping === "corporateAffiliations") {
        const existingValue = typeof currentValue === "string" ? currentValue : "";
        if (!existingValue.includes(discovery.value)) {
          updateFormData("corporateAffiliations", existingValue ? `${existingValue}, ${discovery.value}` : discovery.value);
        }
      } else if (discovery.fieldMapping === "knownAliases") {
        const existingValue = typeof currentValue === "string" ? currentValue : "";
        if (!existingValue.includes(discovery.value)) {
          updateFormData("knownAliases", existingValue ? `${existingValue}, ${discovery.value}` : discovery.value);
        }
      } else {
        // Generic string field
        if (typeof currentValue === "string" && !currentValue) {
          updateFormData(discovery.fieldMapping as keyof VIPIntakeData, discovery.value);
        }
      }
    }

    toast({
      title: "Discovery Applied",
      description: `Added: ${discovery.label}`,
    });
  }, [formData, toast]);

  const handleDismissDiscovery = useCallback((discoveryId: string) => {
    setDismissedDiscoveryIds((prev) => new Set([...prev, discoveryId]));
  }, []);

  const updateFormData = (field: keyof VIPIntakeData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const addFamilyMember = () => {
    setFormData(prev => ({
      ...prev,
      familyMembers: [...prev.familyMembers, { name: "", relationship: "", dateOfBirth: "", socialMedia: "" }]
    }));
  };

  const removeFamilyMember = (index: number) => {
    setFormData(prev => ({
      ...prev,
      familyMembers: prev.familyMembers.filter((_, i) => i !== index)
    }));
  };

  const updateFamilyMember = (index: number, field: keyof FamilyMember, value: string) => {
    setFormData(prev => ({
      ...prev,
      familyMembers: prev.familyMembers.map((member, i) => 
        i === index ? { ...member, [field]: value } : member
      )
    }));
  };

  const addProperty = () => {
    setFormData(prev => ({
      ...prev,
      properties: [...prev.properties, { type: "secondary", address: "", hasSecuritySystem: false, notes: "" }]
    }));
  };

  const removeProperty = (index: number) => {
    if (formData.properties.length > 1) {
      setFormData(prev => ({
        ...prev,
        properties: prev.properties.filter((_, i) => i !== index)
      }));
    }
  };

  const updateProperty = (index: number, field: keyof PropertyInfo, value: any) => {
    setFormData(prev => ({
      ...prev,
      properties: prev.properties.map((prop, i) => 
        i === index ? { ...prop, [field]: value } : prop
      )
    }));
  };

  const addTravelPlan = () => {
    setFormData(prev => ({
      ...prev,
      travelPlans: [...prev.travelPlans, { destination: "", departureDate: "", returnDate: "", purpose: "", accommodationType: "" }]
    }));
  };

  const removeTravelPlan = (index: number) => {
    setFormData(prev => ({
      ...prev,
      travelPlans: prev.travelPlans.filter((_, i) => i !== index)
    }));
  };

  const updateTravelPlan = (index: number, field: keyof TravelPlan, value: string) => {
    setFormData(prev => ({
      ...prev,
      travelPlans: prev.travelPlans.map((plan, i) => 
        i === index ? { ...plan, [field]: value } : plan
      )
    }));
  };

  const handleSubmit = async () => {
    if (!formData.consentDataCollection || !formData.consentDarkWebScan || !formData.consentSocialMediaAnalysis) {
      toast({
        title: "Consent Required",
        description: "All consent checkboxes must be checked to proceed with the deep scan.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("vip-deep-scan", {
        body: { intakeData: formData }
      });

      if (error) throw error;

      toast({
        title: "Deep Scan Initiated",
        description: `VIP Deep Scan for ${formData.fullLegalName} has been queued. ${formData.priorityLevel === 'priority' ? 'Priority processing (72 hours)' : 'Standard processing (14 days)'}.`,
      });

      navigate(`/client/${formData.clientId}`);
    } catch (error) {
      console.error("Error initiating deep scan:", error);
      toast({
        title: "Error",
        description: "Failed to initiate deep scan. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1: return formData.clientId && formData.priorityLevel;
      case 2: return formData.fullLegalName && formData.primaryEmail;
      case 3: return formData.properties.some(p => p.address);
      case 9: return formData.consentDataCollection && formData.consentDarkWebScan && formData.consentSocialMediaAnalysis;
      default: return true;
    }
  };

  const progress = (currentStep / STEPS.length) * 100;

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label>Select Client *</Label>
              <Select value={formData.clientId} onValueChange={(v) => updateFormData("clientId", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose the client for this VIP scan" />
                </SelectTrigger>
                <SelectContent>
                  {clients?.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name} {client.industry && `(${client.industry})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4">
              <Label>Processing Priority *</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card 
                  className={`cursor-pointer transition-all ${formData.priorityLevel === 'standard' ? 'border-primary ring-2 ring-primary/20' : 'hover:border-muted-foreground'}`}
                  onClick={() => updateFormData("priorityLevel", "standard")}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <Clock className="h-8 w-8 text-muted-foreground" />
                      <div>
                        <h4 className="font-semibold">Standard Processing</h4>
                        <p className="text-sm text-muted-foreground">14-day turnaround</p>
                        <Badge variant="secondary" className="mt-1">Included</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card 
                  className={`cursor-pointer transition-all ${formData.priorityLevel === 'priority' ? 'border-amber-500 ring-2 ring-amber-500/20' : 'hover:border-muted-foreground'}`}
                  onClick={() => updateFormData("priorityLevel", "priority")}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <Zap className="h-8 w-8 text-amber-500" />
                      <div>
                        <h4 className="font-semibold">Priority Processing</h4>
                        <p className="text-sm text-muted-foreground">72-hour turnaround</p>
                        <Badge className="mt-1 bg-amber-500">+10% Fee</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Full Legal Name *</Label>
                <div className="flex gap-2">
                  <Input 
                    value={formData.fullLegalName}
                    onChange={(e) => updateFormData("fullLegalName", e.target.value)}
                    placeholder="First and Last Name (e.g., Dan Martell)"
                    className="flex-1"
                  />
                  <VoiceDictationInput 
                    onTranscript={(text) => updateFormData("fullLegalName", text)}
                    placeholder="Dictate name"
                  />
                </div>
                {/* Discovery trigger button */}
                {!discoveryTriggered && !osintDiscovery.isRunning && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => handleStartDiscovery(false)}
                    className="mt-2 w-full"
                    disabled={formData.fullLegalName.trim().split(/\s+/).length < 2}
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    Run AI Discovery for "{formData.fullLegalName.trim() || '...'}"
                  </Button>
                )}
                {osintDiscovery.isRunning && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                    <div className="h-3 w-3 rounded-full bg-primary animate-pulse" />
                    Running Silent Shield™ intelligence sweep...
                  </div>
                )}
                {discoveryTriggered && !osintDiscovery.isRunning && osintDiscovery.discoveries.length > 0 && (
                  <div className="space-y-2 mt-2">
                    <div className="flex items-center gap-2 text-sm text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      Found {osintDiscovery.discoveries.length} intelligence items • {autoAppliedFields.size} fields auto-populated
                    </div>
                    {hasNewContextForRescan && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleStartDiscovery(true)}
                        className="w-full text-xs"
                      >
                        <Zap className="h-3 w-3 mr-1" />
                        Re-scan with additional context (more accurate)
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>Known Aliases / Nicknames</Label>
                  {autoAppliedFields.has("knownAliases") && (
                    <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      <Sparkles className="h-3 w-3 mr-1" />
                      AI Populated
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input 
                    value={formData.knownAliases}
                    onChange={(e) => updateFormData("knownAliases", e.target.value)}
                    placeholder="Separate with commas"
                    className={`flex-1 ${autoAppliedFields.has("knownAliases") ? "border-green-300 dark:border-green-700" : ""}`}
                  />
                  <VoiceDictationInput 
                    onTranscript={(text) => updateFormData("knownAliases", formData.knownAliases ? `${formData.knownAliases}, ${text}` : text)}
                    placeholder="Dictate alias"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date of Birth</Label>
                <Input 
                  type="date"
                  value={formData.dateOfBirth}
                  onChange={(e) => updateFormData("dateOfBirth", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Nationality / Citizenship</Label>
                <Input 
                  value={formData.nationality}
                  onChange={(e) => updateFormData("nationality", e.target.value)}
                  placeholder="Primary and secondary if applicable"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>Primary Email *</Label>
                  {autoAppliedFields.has("primaryEmail") && (
                    <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      <Sparkles className="h-3 w-3 mr-1" />
                      AI Discovered
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input 
                    type="email"
                    value={formData.primaryEmail}
                    onChange={(e) => updateFormData("primaryEmail", e.target.value)}
                    placeholder="Main email address"
                    className={`flex-1 ${autoAppliedFields.has("primaryEmail") ? "border-green-300 dark:border-green-700" : ""}`}
                  />
                  <VoiceDictationInput 
                    onTranscript={(text) => updateFormData("primaryEmail", text.toLowerCase().replace(/\s+/g, ""))}
                    placeholder="Dictate email"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Secondary Emails</Label>
                <div className="flex gap-2">
                  <Textarea 
                    value={formData.secondaryEmails}
                    onChange={(e) => updateFormData("secondaryEmails", e.target.value)}
                    placeholder="One per line"
                    rows={2}
                    className="flex-1"
                  />
                  <VoiceDictationInput 
                    onTranscript={(text) => updateFormData("secondaryEmails", formData.secondaryEmails ? `${formData.secondaryEmails}\n${text.toLowerCase().replace(/\s+/g, "")}` : text.toLowerCase().replace(/\s+/g, ""))}
                    placeholder="Dictate email"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>Primary Phone</Label>
                  {autoAppliedFields.has("primaryPhone") && (
                    <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      <Sparkles className="h-3 w-3 mr-1" />
                      AI Discovered
                    </Badge>
                  )}
                </div>
                <Input 
                  value={formData.primaryPhone}
                  onChange={(e) => updateFormData("primaryPhone", e.target.value)}
                  placeholder="+1 (555) 123-4567"
                  className={autoAppliedFields.has("primaryPhone") ? "border-green-300 dark:border-green-700" : ""}
                />
              </div>
              <div className="space-y-2">
                <Label>Secondary Phones</Label>
                <Textarea 
                  value={formData.secondaryPhones}
                  onChange={(e) => updateFormData("secondaryPhones", e.target.value)}
                  placeholder="One per line"
                  rows={2}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Social Media Handles</Label>
                {autoAppliedFields.has("socialMediaHandles") && (
                  <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    <Sparkles className="h-3 w-3 mr-1" />
                    AI Discovered
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                <Textarea 
                  value={formData.socialMediaHandles}
                  onChange={(e) => updateFormData("socialMediaHandles", e.target.value)}
                  placeholder="Twitter: @handle&#10;LinkedIn: /in/profile&#10;Instagram: @handle&#10;Facebook: profile.url"
                  rows={4}
                  className={`flex-1 ${autoAppliedFields.has("socialMediaHandles") ? "border-green-300 dark:border-green-700" : ""}`}
                />
                <VoiceDictationInput 
                  onTranscript={(text) => updateFormData("socialMediaHandles", formData.socialMediaHandles ? `${formData.socialMediaHandles}\n${text}` : text)}
                  placeholder="Dictate handle"
                />
              </div>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Add all known properties including primary residence, vacation homes, and office locations.</p>
              <Button type="button" variant="outline" size="sm" onClick={addProperty}>
                <Plus className="h-4 w-4 mr-1" /> Add Property
              </Button>
            </div>

            {formData.properties.map((property, index) => (
              <Card key={index} className="p-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Badge variant={property.type === "primary" ? "default" : "secondary"}>
                      {property.type === "primary" ? "Primary Residence" : "Additional Property"}
                    </Badge>
                    {index > 0 && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeProperty(index)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Property Type</Label>
                      <Select value={property.type} onValueChange={(v) => updateProperty(index, "type", v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="primary">Primary Residence</SelectItem>
                          <SelectItem value="secondary">Secondary Home</SelectItem>
                          <SelectItem value="vacation">Vacation Property</SelectItem>
                          <SelectItem value="office">Office/Business</SelectItem>
                          <SelectItem value="investment">Investment Property</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center space-x-2 pt-6">
                      <Checkbox 
                        id={`security-${index}`}
                        checked={property.hasSecuritySystem}
                        onCheckedChange={(checked) => updateProperty(index, "hasSecuritySystem", checked)}
                      />
                      <Label htmlFor={`security-${index}`}>Has Security System</Label>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Full Address *</Label>
                    <Textarea 
                      value={property.address}
                      onChange={(e) => updateProperty(index, "address", e.target.value)}
                      placeholder="Street address, City, State/Province, Country, Postal Code"
                      rows={2}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Security Notes</Label>
                    <Textarea 
                      value={property.notes}
                      onChange={(e) => updateProperty(index, "notes", e.target.value)}
                      placeholder="Gate codes, guard schedules, known vulnerabilities, neighboring concerns..."
                      rows={2}
                    />
                  </div>
                </div>
              </Card>
            ))}

            {/* Wildfire Preparedness Section */}
            <Card className="p-4 border-orange-200 bg-orange-50/30 dark:border-orange-900 dark:bg-orange-950/20">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
                  <AlertTriangle className="h-5 w-5" />
                  <h4 className="font-semibold">Wildfire Preparedness</h4>
                </div>
                
                <div className="space-y-2">
                  <Label>Current Wildfire Preparedness Measures</Label>
                  <Textarea 
                    value={formData.wildfirePreparedness}
                    onChange={(e) => updateFormData("wildfirePreparedness", e.target.value)}
                    placeholder="Defensible space around property, fire-resistant landscaping, ember-resistant vents, roof sprinkler system, fireproof safe location, important documents off-site backup..."
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Evacuation Plan</Label>
                  <Textarea 
                    value={formData.wildfireEvacuationPlan}
                    onChange={(e) => updateFormData("wildfireEvacuationPlan", e.target.value)}
                    placeholder="Primary and alternate evacuation routes, designated meeting points, go-bag locations, pet evacuation plan, livestock arrangements, important items to grab..."
                    rows={3}
                  />
                </div>
              </div>
            </Card>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium">Family Members</Label>
                <Button type="button" variant="outline" size="sm" onClick={addFamilyMember}>
                  <Plus className="h-4 w-4 mr-1" /> Add Family Member
                </Button>
              </div>

              {formData.familyMembers.length === 0 ? (
                <Card className="p-4 border-dashed">
                  <p className="text-center text-muted-foreground text-sm">
                    No family members added. Click "Add Family Member" to include spouse, children, or other household members.
                  </p>
                </Card>
              ) : (
                formData.familyMembers.map((member, index) => (
                  <Card key={index} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 flex-1">
                        <div className="space-y-2">
                          <Label>Full Name</Label>
                          <Input 
                            value={member.name}
                            onChange={(e) => updateFamilyMember(index, "name", e.target.value)}
                            placeholder="Name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Relationship</Label>
                          <Select value={member.relationship} onValueChange={(v) => updateFamilyMember(index, "relationship", v)}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="spouse">Spouse</SelectItem>
                              <SelectItem value="child">Child</SelectItem>
                              <SelectItem value="parent">Parent</SelectItem>
                              <SelectItem value="sibling">Sibling</SelectItem>
                              <SelectItem value="partner">Partner</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Date of Birth</Label>
                          <Input 
                            type="date"
                            value={member.dateOfBirth}
                            onChange={(e) => updateFamilyMember(index, "dateOfBirth", e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Social Media</Label>
                          <Input 
                            value={member.socialMedia}
                            onChange={(e) => updateFamilyMember(index, "socialMedia", e.target.value)}
                            placeholder="@handles"
                          />
                        </div>
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeFamilyMember(index)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Household Staff</Label>
                <Textarea 
                  value={formData.householdStaff}
                  onChange={(e) => updateFormData("householdStaff", e.target.value)}
                  placeholder="Nannies, housekeepers, drivers, personal assistants...&#10;Include names and roles"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Security Personnel</Label>
                <Textarea 
                  value={formData.securityPersonnel}
                  onChange={(e) => updateFormData("securityPersonnel", e.target.value)}
                  placeholder="Personal protection officers, estate security...&#10;Include names and schedules if known"
                  rows={3}
                />
              </div>
            </div>

            {/* Pets Section */}
            <div className="space-y-2 pt-4 border-t">
              <Label className="text-base font-medium">Pets & Animals</Label>
              <Textarea 
                value={formData.pets}
                onChange={(e) => updateFormData("pets", e.target.value)}
                placeholder="Dog: German Shepherd named Max, 4 years old&#10;Cat: Indoor only, named Luna&#10;Horse: Boarded at XYZ Stables&#10;Include species, breed, name, age, and any special needs or security considerations"
                rows={3}
              />
            </div>

            {/* Human-Wildlife Conflict Section */}
            <Card className="p-4 border-amber-200 bg-amber-50/30 dark:border-amber-900 dark:bg-amber-950/20">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-5 w-5" />
                  <h4 className="font-semibold">Human-Wildlife Conflict</h4>
                </div>
                
                <div className="space-y-2">
                  <Label>Wildlife Concerns at Properties</Label>
                  <Textarea 
                    value={formData.humanWildlifeConflict}
                    onChange={(e) => updateFormData("humanWildlifeConflict", e.target.value)}
                    placeholder="Bears frequently on property, coyotes near children's play area, mountain lion sightings, venomous snakes, aggressive deer during rutting season...&#10;Include any past incidents and current mitigation measures"
                    rows={3}
                  />
                </div>
              </div>
            </Card>
          </div>
        );

      case 5:
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Primary Devices</Label>
                <Textarea 
                  value={formData.primaryDevices}
                  onChange={(e) => updateFormData("primaryDevices", e.target.value)}
                  placeholder="iPhone 15 Pro (personal)&#10;MacBook Pro 16&quot; (work)&#10;iPad Pro (travel)"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Email Providers</Label>
                <Textarea 
                  value={formData.emailProviders}
                  onChange={(e) => updateFormData("emailProviders", e.target.value)}
                  placeholder="Gmail (personal)&#10;Outlook (corporate)&#10;ProtonMail (secure)"
                  rows={3}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cloud Services</Label>
                <Textarea 
                  value={formData.cloudServices}
                  onChange={(e) => updateFormData("cloudServices", e.target.value)}
                  placeholder="iCloud, Google Drive, Dropbox, OneDrive..."
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>Known Usernames</Label>
                <Textarea 
                  value={formData.knownUsernames}
                  onChange={(e) => updateFormData("knownUsernames", e.target.value)}
                  placeholder="Gaming handles, forum usernames, legacy accounts..."
                  rows={2}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Corporate Affiliations</Label>
                {autoAppliedFields.has("corporateAffiliations") && (
                  <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    <Sparkles className="h-3 w-3 mr-1" />
                    AI Discovered
                  </Badge>
                )}
              </div>
              <Textarea 
                value={formData.corporateAffiliations}
                onChange={(e) => updateFormData("corporateAffiliations", e.target.value)}
                placeholder="List all companies, board positions, advisory roles...&#10;Include ownership stakes if public"
                rows={3}
                className={autoAppliedFields.has("corporateAffiliations") ? "border-green-300 dark:border-green-700" : ""}
              />
            </div>
          </div>
        );

      case 6:
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Vehicles</Label>
              <Textarea 
                value={formData.vehicles}
                onChange={(e) => updateFormData("vehicles", e.target.value)}
                placeholder="2024 Mercedes S-Class (black, license: ABC123)&#10;2023 Range Rover (white)&#10;Include any distinctive features"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Regular Routes & Commutes</Label>
              <Textarea 
                value={formData.regularRoutes}
                onChange={(e) => updateFormData("regularRoutes", e.target.value)}
                placeholder="Home to office via I-95, departs 7:30am&#10;Weekly trip to country club on Saturdays&#10;School pickup at 3pm on weekdays"
                rows={4}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Frequented Locations</Label>
                <Textarea 
                  value={formData.frequentedLocations}
                  onChange={(e) => updateFormData("frequentedLocations", e.target.value)}
                  placeholder="Favorite restaurants, coffee shops, religious institutions..."
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Gym / Club Memberships</Label>
                <Textarea 
                  value={formData.gymClubMemberships}
                  onChange={(e) => updateFormData("gymClubMemberships", e.target.value)}
                  placeholder="Equinox (Tuesday/Thursday 6am)&#10;Country Club (weekend golf)"
                  rows={3}
                />
              </div>
            </div>
          </div>
        );

      case 7:
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Add all planned travel for the next 90 days. More detail enables better threat assessment.</p>
              <Button type="button" variant="outline" size="sm" onClick={addTravelPlan}>
                <Plus className="h-4 w-4 mr-1" /> Add Trip
              </Button>
            </div>

            {formData.travelPlans.length === 0 ? (
              <Card className="p-6 border-dashed">
                <p className="text-center text-muted-foreground">
                  No upcoming travel added. Click "Add Trip" to include planned trips.
                </p>
              </Card>
            ) : (
              formData.travelPlans.map((plan, index) => (
                <Card key={index} className="p-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Badge>Trip {index + 1}</Badge>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeTravelPlan(index)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Destination</Label>
                        <Input 
                          value={plan.destination}
                          onChange={(e) => updateTravelPlan(index, "destination", e.target.value)}
                          placeholder="City, Country"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Departure Date</Label>
                        <Input 
                          type="date"
                          value={plan.departureDate}
                          onChange={(e) => updateTravelPlan(index, "departureDate", e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Return Date</Label>
                        <Input 
                          type="date"
                          value={plan.returnDate}
                          onChange={(e) => updateTravelPlan(index, "returnDate", e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Purpose</Label>
                        <Select value={plan.purpose} onValueChange={(v) => updateTravelPlan(index, "purpose", v)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select purpose" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="business">Business</SelectItem>
                            <SelectItem value="personal">Personal/Vacation</SelectItem>
                            <SelectItem value="family">Family Event</SelectItem>
                            <SelectItem value="medical">Medical</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Accommodation</Label>
                        <Select value={plan.accommodationType} onValueChange={(v) => updateTravelPlan(index, "accommodationType", v)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hotel">Hotel</SelectItem>
                            <SelectItem value="private_residence">Private Residence</SelectItem>
                            <SelectItem value="rental">Rental Property</SelectItem>
                            <SelectItem value="yacht">Yacht/Cruise</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </Card>
              ))
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
              <div className="space-y-2">
                <Label>Preferred Airlines</Label>
                <Input 
                  value={formData.preferredAirlines}
                  onChange={(e) => updateFormData("preferredAirlines", e.target.value)}
                  placeholder="Delta, United, Emirates..."
                />
              </div>
              <div className="space-y-2">
                <Label>Frequent Destinations</Label>
                <Input 
                  value={formData.frequentDestinations}
                  onChange={(e) => updateFormData("frequentDestinations", e.target.value)}
                  placeholder="Cities visited regularly"
                />
              </div>
            </div>
          </div>
        );

      case 8:
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Known Adversaries / Threats</Label>
              <div className="flex gap-2">
                <Textarea 
                  value={formData.knownAdversaries}
                  onChange={(e) => updateFormData("knownAdversaries", e.target.value)}
                  placeholder="Disgruntled former employees, business rivals, stalkers, estranged family members...&#10;Include names, relationship, and threat level if known"
                  rows={4}
                  className="flex-1"
                />
                <VoiceDictationInput 
                  onTranscript={(text) => updateFormData("knownAdversaries", formData.knownAdversaries ? `${formData.knownAdversaries}\n${text}` : text)}
                  placeholder="Dictate threats"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Previous Security Incidents</Label>
              <div className="flex gap-2">
                <Textarea 
                  value={formData.previousIncidents}
                  onChange={(e) => updateFormData("previousIncidents", e.target.value)}
                  placeholder="Break-ins, threats received, doxing, stalking, kidnapping attempts...&#10;Include dates and outcomes"
                  rows={4}
                  className="flex-1"
                />
                <VoiceDictationInput 
                  onTranscript={(text) => updateFormData("previousIncidents", formData.previousIncidents ? `${formData.previousIncidents}\n${text}` : text)}
                  placeholder="Dictate incidents"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Specific Security Concerns</Label>
              <div className="flex gap-2">
                <Textarea 
                  value={formData.specificConcerns}
                  onChange={(e) => updateFormData("specificConcerns", e.target.value)}
                  placeholder="What keeps the principal up at night? Specific fears or vulnerabilities they've expressed?"
                  rows={3}
                  className="flex-1"
                />
                <VoiceDictationInput 
                  onTranscript={(text) => updateFormData("specificConcerns", formData.specificConcerns ? `${formData.specificConcerns} ${text}` : text)}
                  placeholder="Dictate concerns"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Industry-Specific Threats</Label>
              <div className="flex gap-2">
                <Textarea 
                  value={formData.industryThreats}
                  onChange={(e) => updateFormData("industryThreats", e.target.value)}
                  placeholder="Activist groups targeting the industry, regulatory investigations, competitor espionage..."
                  rows={3}
                  className="flex-1"
                />
                <VoiceDictationInput 
                  onTranscript={(text) => updateFormData("industryThreats", formData.industryThreats ? `${formData.industryThreats} ${text}` : text)}
                  placeholder="Dictate threats"
                />
              </div>
            </div>
          </div>
        );

      case 9:
        return (
          <div className="space-y-6">
            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Intake Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Principal</p>
                    <p className="font-medium">{formData.fullLegalName || "Not provided"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Priority</p>
                    <Badge className={formData.priorityLevel === "priority" ? "bg-amber-500" : ""}>
                      {formData.priorityLevel === "priority" ? "72 Hours" : "14 Days"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Properties</p>
                    <p className="font-medium">{formData.properties.filter(p => p.address).length} locations</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Family Members</p>
                    <p className="font-medium">{formData.familyMembers.length} people</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Upcoming Travel</p>
                    <p className="font-medium">{formData.travelPlans.length} trips</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Primary Email</p>
                    <p className="font-medium">{formData.primaryEmail || "Not provided"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-amber-500/50 bg-amber-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-600">
                  <Shield className="h-5 w-5" />
                  Consent & Authorization
                </CardTitle>
                <CardDescription>
                  The following scans require explicit authorization. All data is handled in accordance with applicable privacy laws.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start space-x-3">
                  <Checkbox 
                    id="consent1"
                    checked={formData.consentDataCollection}
                    onCheckedChange={(checked) => updateFormData("consentDataCollection", checked)}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="consent1" className="font-medium">Data Collection Authorization</Label>
                    <p className="text-sm text-muted-foreground">
                      I authorize FORTRESS to collect, process, and analyze the information provided in this intake form for security assessment purposes.
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <Checkbox 
                    id="consent2"
                    checked={formData.consentDarkWebScan}
                    onCheckedChange={(checked) => updateFormData("consentDarkWebScan", checked)}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="consent2" className="font-medium">Dark Web & Data Leak Scanning</Label>
                    <p className="text-sm text-muted-foreground">
                      I authorize scanning of dark web marketplaces, breach databases, and paste sites for exposed credentials, personal information, and digital leakage related to the principal and family members.
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <Checkbox 
                    id="consent3"
                    checked={formData.consentSocialMediaAnalysis}
                    onCheckedChange={(checked) => updateFormData("consentSocialMediaAnalysis", checked)}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="consent3" className="font-medium">Social Media & OSINT Analysis</Label>
                    <p className="text-sm text-muted-foreground">
                      I authorize analysis of publicly available social media profiles, online presence, and open-source intelligence gathering for the principal and associated individuals.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Shield className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold">Ready to Initiate Deep Scan</h4>
                    <p className="text-sm text-muted-foreground">
                      {formData.priorityLevel === "priority" 
                        ? "Results will be delivered within 72 hours via secure portal."
                        : "Results will be delivered within 14 days via secure portal."
                      }
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between bg-gradient-to-r from-primary/10 to-transparent p-4 rounded-lg border border-primary/20">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-7 w-7 text-primary" />
            Silent Shield™ Deep Scan
          </h1>
          <p className="text-muted-foreground mt-1">
            7-Day Intelligence Risk Snapshot — AI-Powered Terrain Mapping & Threat Detection
          </p>
        </div>
        <div className="text-right">
          <Badge variant="outline" className="text-lg px-4 py-2">
            Step {currentStep} of {STEPS.length}
          </Badge>
          {formData.priorityLevel === "priority" && (
            <p className="text-xs text-amber-600 mt-1 font-medium">72-Hour Priority</p>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="space-y-2">
        <Progress value={progress} className="h-2" />
        <div className="flex justify-between text-xs text-muted-foreground overflow-x-auto pb-2">
          {STEPS.map((step) => (
            <div 
              key={step.id}
              className={`flex flex-col items-center min-w-[80px] ${
                step.id === currentStep ? "text-primary font-medium" : 
                step.id < currentStep ? "text-primary/60" : ""
              }`}
            >
              <step.icon className="h-4 w-4 mb-1" />
              <span className="text-center">{step.title}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {(() => {
              const StepIcon = STEPS[currentStep - 1].icon;
              return <StepIcon className="h-5 w-5" />;
            })()}
            {STEPS[currentStep - 1].title}
          </CardTitle>
          <CardDescription>{STEPS[currentStep - 1].description}</CardDescription>
        </CardHeader>
        <CardContent>
          {renderStepContent()}
        </CardContent>
      </Card>

      {/* OSINT Discovery Panel - shows when discovery is active or has results */}
      {(osintDiscovery.isRunning || osintDiscovery.discoveries.length > 0) && currentStep >= 2 && (
        <OSINTDiscoveryPanel
          state={osintDiscovery}
          onApplyDiscovery={handleApplyDiscovery}
          onDismissDiscovery={handleDismissDiscovery}
          appliedIds={appliedDiscoveryIds}
          dismissedIds={dismissedDiscoveryIds}
          onStop={osintDiscovery.stopDiscovery}
        />
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button 
          variant="outline"
          onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))}
          disabled={currentStep === 1}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Previous
        </Button>

        {currentStep < STEPS.length ? (
          <Button 
            onClick={() => setCurrentStep(prev => Math.min(STEPS.length, prev + 1))}
            disabled={!canProceed()}
          >
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button 
            onClick={handleSubmit}
            disabled={!canProceed() || isSubmitting}
            className="bg-primary"
          >
            {isSubmitting ? (
              <>Processing...</>
            ) : (
              <>
                <Shield className="h-4 w-4 mr-1" /> Initiate Deep Scan
              </>
            )}
          </Button>
        )}
      </div>

      {/* Voice Assistant Panel */}
      <VoiceAssistantPanel
        formData={formData}
        onUpdateField={updateFormData}
        onAddFamilyMember={addFamilyMember ? () => addFamilyMember() : undefined}
        onAddProperty={addProperty ? () => addProperty() : undefined}
        onAddTravelPlan={addTravelPlan ? () => addTravelPlan() : undefined}
        currentStep={currentStep}
        stepTitle={STEPS[currentStep - 1].title}
      />
    </div>
  );
}
