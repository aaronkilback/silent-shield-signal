import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CheckCircle2, Shield } from "lucide-react";

const contactSchema = z.object({
  fullName: z.string().min(2, "Full name is required").max(100),
  address: z.string().min(5, "Address is required").max(500),
  email: z.string().email("Valid email is required").max(255),
  phone: z.string().min(10, "Valid phone number is required").max(50),
});

const profileSchema = z.object({
  clientType: z.array(z.string()).min(1, "Select at least one option"),
  hearAbout: z.string().min(1, "This field is required").max(500),
});

const riskProfileSchema = z.object({
  propertyType: z.string().min(1, "Select property type"),
  propertyTypeOther: z.string().optional(),
  numberOfProperties: z.string().min(1, "Enter number of properties"),
  securityBudget: z.string().min(1, "Select budget range"),
  currentSystems: z.array(z.string()),
  securityConcerns: z.string().max(1000),
});

const experienceSchema = z.object({
  previousConsultant: z.string().min(1, "Please select an option"),
  bestExperience: z.string().max(500),
  worstExperience: z.string().max(500),
  topPriorities: z.string().min(10, "Please list your top 3 priorities").max(500),
});

const threatSchema = z.object({
  primaryConcerns: z.array(z.string()).min(1, "Select at least one concern"),
  primaryConcernsOther: z.string().optional(),
  downtimeActivity: z.string().max(500),
  recentAssessment: z.string().min(1, "Please select an option"),
});

const visionSchema = z.object({
  idealSecurity: z.string().min(20, "Please describe your ideal security setup").max(1000),
  successStory: z.string().min(20, "Please share a brief example").max(1000),
  primaryMotivation: z.string().min(10, "Please describe your motivation").max(1000),
});

const commitmentSchema = z.object({
  timeline: z.string().min(1, "Select timeline"),
  decisionAuthority: z.string().min(1, "Select decision authority"),
  budgetReady: z.string().min(1, "Select budget readiness"),
});

type ContactData = z.infer<typeof contactSchema>;
type ProfileData = z.infer<typeof profileSchema>;
type RiskProfileData = z.infer<typeof riskProfileSchema>;
type ExperienceData = z.infer<typeof experienceSchema>;
type ThreatData = z.infer<typeof threatSchema>;
type VisionData = z.infer<typeof visionSchema>;
type CommitmentData = z.infer<typeof commitmentSchema>;

const steps = [
  { id: 1, title: "Contact", schema: contactSchema },
  { id: 2, title: "Profile", schema: profileSchema },
  { id: 3, title: "Risk Assessment", schema: riskProfileSchema },
  { id: 4, title: "Experience", schema: experienceSchema },
  { id: 5, title: "Threats", schema: threatSchema },
  { id: 6, title: "Vision", schema: visionSchema },
  { id: 7, title: "Commitment", schema: commitmentSchema },
];

export const ClientQualificationForm = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<any>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getCurrentSchema = () => {
    const step = steps.find(s => s.id === currentStep);
    return step?.schema || contactSchema;
  };

  const form = useForm({
    resolver: zodResolver(getCurrentSchema()),
    defaultValues: formData,
  });

  const progress = (currentStep / steps.length) * 100;

  const handleNext = async () => {
    const isValid = await form.trigger();
    if (isValid) {
      setFormData({ ...formData, ...form.getValues() });
      if (currentStep < steps.length) {
        setCurrentStep(currentStep + 1);
        form.reset({ ...formData, ...form.getValues() });
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      form.reset(formData);
    }
  };

  const onSubmit = async (data: any) => {
    setIsSubmitting(true);
    try {
      const completeData = { ...formData, ...data };
      
      const clientData = {
        name: completeData.fullName,
        contact_email: completeData.email,
        contact_phone: completeData.phone,
        organization: completeData.fullName,
        industry: completeData.propertyType === "Other" ? completeData.propertyTypeOther : completeData.propertyType,
        locations: [completeData.address],
        high_value_assets: completeData.currentSystems || [],
        onboarding_data: completeData,
      };

      const { error } = await supabase.functions.invoke("process-client-onboarding", {
        body: { clientData },
      });

      if (error) throw error;

      toast.success("Qualification submitted successfully! We'll review and contact you soon.", {
        duration: 5000,
      });
      
      form.reset();
      setFormData({});
      setCurrentStep(1);
    } catch (error) {
      console.error("Error submitting qualification:", error);
      toast.error("Failed to submit qualification. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <div className="flex items-center gap-3 mb-4">
          <Shield className="h-8 w-8 text-primary" />
          <div>
            <CardTitle className="text-2xl">Silent Shield™ Client Pre-Qualification</CardTitle>
            <CardDescription>
              Step {currentStep} of {steps.length}: {steps.find(s => s.id === currentStep)?.title}
            </CardDescription>
          </div>
        </div>
        <Progress value={progress} className="h-2" />
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(currentStep === steps.length ? onSubmit : handleNext)} className="space-y-6">
            
            {/* Step 1: Contact Information */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Contact Information</h3>
                <FormField
                  control={form.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="John Doe" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address of Primary Residence *</FormLabel>
                      <FormControl>
                        <Input placeholder="123 Main St, City, State, ZIP" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address *</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="john@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number *</FormLabel>
                      <FormControl>
                        <Input placeholder="+1 (555) 123-4567" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Step 2: Client Profile */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Client Profile</h3>
                <FormField
                  control={form.control}
                  name="clientType"
                  render={() => (
                    <FormItem>
                      <FormLabel>Which best describes you? (Check all that apply) *</FormLabel>
                      <div className="space-y-2">
                        {[
                          "Leader/Executive",
                          "Owner/manager of multiple properties",
                          "Experience with a security incident or near-miss",
                          "Privacy-focused—seeking silent solutions",
                          "Believe in prevention, not response",
                        ].map((option) => (
                          <FormField
                            key={option}
                            control={form.control}
                            name="clientType"
                            render={({ field }) => (
                              <FormItem className="flex items-center space-x-2 space-y-0">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(option)}
                                    onCheckedChange={(checked) => {
                                      const current = field.value || [];
                                      field.onChange(
                                        checked
                                          ? [...current, option]
                                          : current.filter((v: string) => v !== option)
                                      );
                                    }}
                                  />
                                </FormControl>
                                <FormLabel className="font-normal cursor-pointer">{option}</FormLabel>
                              </FormItem>
                            )}
                          />
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="hearAbout"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>How did you hear about Silent Shield? *</FormLabel>
                      <FormControl>
                        <Input placeholder="Referral, online search, etc." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Step 3: Risk Profile */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Risk Profile</h3>
                <FormField
                  control={form.control}
                  name="propertyType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>What type of property or lifestyle are you looking to secure? *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select property type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Private estate">Private estate</SelectItem>
                          <SelectItem value="Commercial property/asset">Commercial property/asset</SelectItem>
                          <SelectItem value="Family office">Family office</SelectItem>
                          <SelectItem value="Executive travel">Executive travel</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {form.watch("propertyType") === "Other" && (
                  <FormField
                    control={form.control}
                    name="propertyTypeOther"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Please specify</FormLabel>
                        <FormControl>
                          <Input placeholder="Describe property type" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="numberOfProperties"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>How many properties do you own? *</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="securityBudget"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current security budget? *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select budget range" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="< $5k USD/mo">{"< $5k USD/mo"}</SelectItem>
                          <SelectItem value="$7.5–15k USD/mo">$7.5–15k USD/mo</SelectItem>
                          <SelectItem value="$15–25k USD/mo">$15–25k USD/mo</SelectItem>
                          <SelectItem value="$50K USD +">$50K USD +</SelectItem>
                          <SelectItem value="Not sure yet">Not sure yet</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="currentSystems"
                  render={() => (
                    <FormItem>
                      <FormLabel>Current security systems/protocols?</FormLabel>
                      <div className="space-y-2">
                        {[
                          "Security cameras",
                          "Motion activated lighting",
                          "Digital footprint management",
                          "Secure communications protocols",
                          "Emergency drills/staff rehearsals",
                          "Off-site risk monitoring",
                          "None of the above",
                        ].map((option) => (
                          <FormField
                            key={option}
                            control={form.control}
                            name="currentSystems"
                            render={({ field }) => (
                              <FormItem className="flex items-center space-x-2 space-y-0">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(option)}
                                    onCheckedChange={(checked) => {
                                      const current = field.value || [];
                                      field.onChange(
                                        checked
                                          ? [...current, option]
                                          : current.filter((v: string) => v !== option)
                                      );
                                    }}
                                  />
                                </FormControl>
                                <FormLabel className="font-normal cursor-pointer">{option}</FormLabel>
                              </FormItem>
                            )}
                          />
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="securityConcerns"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>What concerns you most about your current security setup?</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Describe your main concerns..."
                          className="min-h-[100px]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Step 4: Past Experience */}
            {currentStep === 4 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Past Experience</h3>
                <FormField
                  control={form.control}
                  name="previousConsultant"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Have you worked with a security consultant before? *</FormLabel>
                      <FormControl>
                        <RadioGroup onValueChange={field.onChange} defaultValue={field.value}>
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="Yes—currently" />
                            </FormControl>
                            <FormLabel className="font-normal cursor-pointer">Yes—currently</FormLabel>
                          </FormItem>
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="Yes—in past" />
                            </FormControl>
                            <FormLabel className="font-normal cursor-pointer">Yes—in past</FormLabel>
                          </FormItem>
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="No—first time" />
                            </FormControl>
                            <FormLabel className="font-normal cursor-pointer">No—first time</FormLabel>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {form.watch("previousConsultant") !== "No—first time" && (
                  <>
                    <FormField
                      control={form.control}
                      name="bestExperience"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>What was the best thing about that experience?</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Describe the positive aspects..." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="worstExperience"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>What was the worst thing about that experience?</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Describe areas for improvement..." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
                <FormField
                  control={form.control}
                  name="topPriorities"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Top 3 things that matter most when choosing a security advisor? *</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="1. &#10;2. &#10;3. "
                          className="min-h-[100px]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Step 5: Threat Assessment */}
            {currentStep === 5 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Threat Assessment</h3>
                <FormField
                  control={form.control}
                  name="primaryConcerns"
                  render={() => (
                    <FormItem>
                      <FormLabel>What concerns you the most? (Check all that apply) *</FormLabel>
                      <div className="space-y-2">
                        {[
                          "Break-ins or home invasions",
                          "Data leaks or cyber intrusion",
                          "Reputation damage (media or social)",
                          "Insider threats (staff, contractors)",
                          "Physical surveillance or tracking",
                          "Emergency response/evacuation readiness",
                          "Human/Wildlife interactions",
                        ].map((option) => (
                          <FormField
                            key={option}
                            control={form.control}
                            name="primaryConcerns"
                            render={({ field }) => (
                              <FormItem className="flex items-center space-x-2 space-y-0">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(option)}
                                    onCheckedChange={(checked) => {
                                      const current = field.value || [];
                                      field.onChange(
                                        checked
                                          ? [...current, option]
                                          : current.filter((v: string) => v !== option)
                                      );
                                    }}
                                  />
                                </FormControl>
                                <FormLabel className="font-normal cursor-pointer">{option}</FormLabel>
                              </FormItem>
                            )}
                          />
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="primaryConcernsOther"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Other concerns</FormLabel>
                      <FormControl>
                        <Input placeholder="Specify other concerns..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="downtimeActivity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>When you get downtime, what do you choose to do?</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Describe your activities..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="recentAssessment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Conducted any threat assessment, security audit, or insurance risk review in the last 24 months? *</FormLabel>
                      <FormControl>
                        <RadioGroup onValueChange={field.onChange} defaultValue={field.value}>
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="Yes" />
                            </FormControl>
                            <FormLabel className="font-normal cursor-pointer">Yes</FormLabel>
                          </FormItem>
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="No" />
                            </FormControl>
                            <FormLabel className="font-normal cursor-pointer">No</FormLabel>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Step 6: Vision & Motivation */}
            {currentStep === 6 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Vision & Motivation</h3>
                <FormField
                  control={form.control}
                  name="idealSecurity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>What would ideal security look like to you? *</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Describe your vision of perfect security..."
                          className="min-h-[120px]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="successStory"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Describe a time when you invested in expertise, executed the plan, and achieved your desired outcome *</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Share a brief success story..."
                          className="min-h-[120px]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="primaryMotivation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>What is your primary motivation in seeking our services? *</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Describe what drives your interest..."
                          className="min-h-[120px]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Step 7: Commitment & Timeline */}
            {currentStep === 7 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Commitment & Timeline</h3>
                <FormField
                  control={form.control}
                  name="timeline"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>What's your ideal timeline for implementation? *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select timeline" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Immediate (within 30 days)">Immediate (within 30 days)</SelectItem>
                          <SelectItem value="1-3 months">1-3 months</SelectItem>
                          <SelectItem value="3-6 months">3-6 months</SelectItem>
                          <SelectItem value="6+ months">6+ months</SelectItem>
                          <SelectItem value="Just exploring">Just exploring</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="decisionAuthority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Are you the primary decision-maker? *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select option" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Yes—sole decision maker">Yes—sole decision maker</SelectItem>
                          <SelectItem value="Yes—but with input from others">Yes—but with input from others</SelectItem>
                          <SelectItem value="No—need approval from others">No—need approval from others</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="budgetReady"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Is budget allocated or approved? *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select option" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Yes—fully allocated">Yes—fully allocated</SelectItem>
                          <SelectItem value="Partially—needs approval">Partially—needs approval</SelectItem>
                          <SelectItem value="No—exploring costs first">No—exploring costs first</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="rounded-lg bg-primary/10 border border-primary/20 p-4 mt-6">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-medium text-sm">Review your submission</p>
                      <p className="text-sm text-muted-foreground">
                        By submitting this form, you confirm that all information provided is accurate. 
                        We'll review your qualification and contact you within 48 hours.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between pt-6 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                disabled={currentStep === 1 || isSubmitting}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>

              <div className="text-sm text-muted-foreground">
                Step {currentStep} of {steps.length}
              </div>

              {currentStep < steps.length ? (
                <Button type="submit" disabled={isSubmitting}>
                  Next
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Submitting..." : "Submit Qualification"}
                  <CheckCircle2 className="ml-2 h-4 w-4" />
                </Button>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
};