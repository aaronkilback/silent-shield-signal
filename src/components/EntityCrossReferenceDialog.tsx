import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface EntityCrossReferenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CrossReferenceResult {
  name: string;
  matched: boolean;
  entityId?: string;
  entityType?: string;
  riskLevel?: string;
}

export const EntityCrossReferenceDialog = ({ open, onOpenChange }: EntityCrossReferenceDialogProps) => {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [columnName, setColumnName] = useState("Name");
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<CrossReferenceResult[]>([]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResults([]);
    }
  };

  const handleCrossReference = async () => {
    if (!file) {
      toast({
        title: "No File Selected",
        description: "Please upload an Excel file first",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    try {
      // Convert file to base64
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target?.result as string;
        
        const { data, error } = await supabase.functions.invoke('cross-reference-entities', {
          body: {
            fileData: base64,
            columnName: columnName
          }
        });

        if (error) throw error;

        setResults(data.results || []);
        
        const matchCount = data.results.filter((r: CrossReferenceResult) => r.matched).length;
        toast({
          title: "Cross-Reference Complete",
          description: `Found ${matchCount} matches out of ${data.results.length} names`
        });
      };
      reader.readAsDataURL(file);
    } catch (error: any) {
      console.error('Cross-reference error:', error);
      toast({
        title: "Cross-Reference Failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const matchedCount = results.filter(r => r.matched).length;
  const unmatchedCount = results.filter(r => !r.matched).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cross-Reference Entity Names</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Alert>
            <FileSpreadsheet className="w-4 h-4" />
            <AlertDescription>
              Upload an Excel file (.xlsx, .xls) with a list of names to check against your entities database.
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div>
              <Label htmlFor="file-upload">Excel File</Label>
              <Input
                id="file-upload"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                disabled={isProcessing}
              />
              {file && (
                <p className="text-sm text-muted-foreground mt-1">
                  Selected: {file.name}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="column-name">Column Name (containing names to check)</Label>
              <Input
                id="column-name"
                value={columnName}
                onChange={(e) => setColumnName(e.target.value)}
                placeholder="e.g., Name, Full Name, Person"
                disabled={isProcessing}
              />
            </div>

            <Button 
              onClick={handleCrossReference} 
              disabled={!file || isProcessing}
              className="w-full"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Cross-Reference Names
                </>
              )}
            </Button>
          </div>

          {results.length > 0 && (
            <div className="space-y-4">
              <div className="flex gap-4">
                <Badge variant="default" className="flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  {matchedCount} Matched
                </Badge>
                <Badge variant="secondary" className="flex items-center gap-1">
                  <XCircle className="w-3 h-3" />
                  {unmatchedCount} Not Found
                </Badge>
              </div>

              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Entity Type</TableHead>
                      <TableHead>Risk Level</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((result, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{result.name}</TableCell>
                        <TableCell>
                          {result.matched ? (
                            <Badge variant="default" className="flex items-center gap-1 w-fit">
                              <CheckCircle2 className="w-3 h-3" />
                              Match Found
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                              <XCircle className="w-3 h-3" />
                              Not Found
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {result.entityType ? (
                            <Badge variant="outline" className="capitalize">
                              {result.entityType.replace('_', ' ')}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {result.riskLevel ? (
                            <Badge 
                              variant={result.riskLevel === 'critical' ? 'destructive' : 'outline'}
                              className="capitalize"
                            >
                              {result.riskLevel}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
