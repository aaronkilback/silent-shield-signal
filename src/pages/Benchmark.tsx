import { Header } from "@/components/Header";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Loader2, Target, Upload, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const Benchmark = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [expectedEntities, setExpectedEntities] = useState("");
  const [expectedSignals, setExpectedSignals] = useState("");
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<any>(null);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setDocumentFile(e.target.files[0]);
    }
  };

  const processDocument = async () => {
    if (!documentFile || !expectedEntities) {
      toast.error("Please upload a document and specify expected entities");
      return;
    }

    setProcessing(true);
    setResults(null);

    try {
      // Upload document
      const fileExt = documentFile.name.split('.').pop();
      const fileName = `benchmark-${Date.now()}.${fileExt}`;
      const filePath = `${user?.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('archival-documents')
        .upload(filePath, documentFile);

      if (uploadError) throw uploadError;

      // Create document record
      const { data: docData, error: docError } = await supabase
        .from('archival_documents')
        .insert({
          filename: documentFile.name,
          file_type: documentFile.type,
          file_size: documentFile.size,
          storage_path: filePath,
          uploaded_by: user?.id,
          metadata: { benchmark: true }
        })
        .select()
        .single();

      if (docError) throw docError;

      // Process document
      const { data: processData, error: processError } = await supabase.functions
        .invoke('process-stored-document', {
          body: { documentId: docData.id }
        });

      if (processError) throw processError;

      // Fetch extracted entities
      const { data: suggestions } = await supabase
        .from('entity_suggestions')
        .select('*')
        .eq('source_id', docData.id);

      // Parse expected entities
      const expectedList = expectedEntities
        .split('\n')
        .map(e => e.trim())
        .filter(e => e);

      const extractedList = suggestions?.map(s => s.suggested_name.toLowerCase()) || [];
      
      // Calculate metrics
      const extracted = new Set(extractedList);
      const expected = new Set(expectedList.map(e => e.toLowerCase()));
      
      const truePositives = [...extracted].filter(e => expected.has(e)).length;
      const falsePositives = extracted.size - truePositives;
      const falseNegatives = expected.size - truePositives;
      
      const precision = truePositives / (truePositives + falsePositives) || 0;
      const recall = truePositives / (truePositives + falseNegatives) || 0;
      const f1 = 2 * (precision * recall) / (precision + recall) || 0;

      setResults({
        extracted: [...extracted],
        expected: [...expected],
        truePositives,
        falsePositives,
        falseNegatives,
        precision: (precision * 100).toFixed(1),
        recall: (recall * 100).toFixed(1),
        f1: (f1 * 100).toFixed(1),
        suggestions
      });

      toast.success("Benchmark complete");
    } catch (error: any) {
      console.error('Benchmark error:', error);
      toast.error(error.message || "Failed to process benchmark");
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 rounded-lg bg-primary/10">
            <Target className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Intelligence Extraction Benchmark</h1>
            <p className="text-muted-foreground">Test document processing accuracy against known reference data</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Upload Test Document</CardTitle>
              <CardDescription>Upload a document to test extraction performance</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                <input
                  type="file"
                  onChange={handleFileChange}
                  accept=".pdf,.doc,.docx,.txt"
                  className="hidden"
                  id="benchmark-file"
                />
                <label htmlFor="benchmark-file" className="cursor-pointer">
                  <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {documentFile ? documentFile.name : "Click to upload document"}
                  </p>
                </label>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Expected Entities (one per line)</label>
                <Textarea
                  placeholder="Kelsey Bilsback&#10;PSE Healthy Energy&#10;Lax'yip Firekeepers&#10;Cedar LNG"
                  value={expectedEntities}
                  onChange={(e) => setExpectedEntities(e.target.value)}
                  rows={8}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Expected Signal Keywords (optional)</label>
                <Textarea
                  placeholder="health concerns&#10;methane emissions&#10;environmental racism"
                  value={expectedSignals}
                  onChange={(e) => setExpectedSignals(e.target.value)}
                  rows={4}
                />
              </div>

              <Button 
                onClick={processDocument} 
                disabled={processing || !documentFile}
                className="w-full"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Run Benchmark"
                )}
              </Button>
            </CardContent>
          </Card>

          {results && (
            <Card>
              <CardHeader>
                <CardTitle>Benchmark Results</CardTitle>
                <CardDescription>Extraction accuracy metrics</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <div className="text-2xl font-bold text-primary">{results.precision}%</div>
                    <div className="text-sm text-muted-foreground">Precision</div>
                  </div>
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <div className="text-2xl font-bold text-primary">{results.recall}%</div>
                    <div className="text-sm text-muted-foreground">Recall</div>
                  </div>
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <div className="text-2xl font-bold text-primary">{results.f1}%</div>
                    <div className="text-sm text-muted-foreground">F1 Score</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>True Positives</span>
                    <Badge variant="outline" className="bg-green-500/10 text-green-600">
                      {results.truePositives}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>False Positives</span>
                    <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600">
                      {results.falsePositives}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>False Negatives</span>
                    <Badge variant="outline" className="bg-red-500/10 text-red-600">
                      {results.falseNegatives}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="font-medium">Correctly Extracted</h4>
                  <div className="flex flex-wrap gap-2">
                    {results.extracted.filter((e: string) => results.expected.has(e)).map((entity: string) => (
                      <Badge key={entity} variant="outline" className="bg-green-500/10 text-green-600">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        {entity}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="font-medium">Missed (Should Extract)</h4>
                  <div className="flex flex-wrap gap-2">
                    {[...results.expected].filter((e: string) => !results.extracted.includes(e)).map((entity: string) => (
                      <Badge key={entity} variant="outline" className="bg-red-500/10 text-red-600">
                        <XCircle className="w-3 h-3 mr-1" />
                        {entity}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="font-medium">False Positives (Shouldn't Extract)</h4>
                  <div className="flex flex-wrap gap-2">
                    {results.extracted.filter((e: string) => !results.expected.has(e)).map((entity: string) => (
                      <Badge key={entity} variant="outline" className="bg-yellow-500/10 text-yellow-600">
                        <XCircle className="w-3 h-3 mr-1" />
                        {entity}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
};

export default Benchmark;
