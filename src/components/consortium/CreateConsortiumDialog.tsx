import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateConsortium } from "@/hooks/useConsortia";
import { TLPClassification, SharingGranularity, TLP_DESCRIPTIONS, GRANULARITY_LABELS } from "@/lib/consortiumTypes";
import { Loader2, Shield, Globe } from "lucide-react";

interface CreateConsortiumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const CreateConsortiumDialog = ({ open, onOpenChange }: CreateConsortiumDialogProps) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [region, setRegion] = useState("");
  const [classification, setClassification] = useState<TLPClassification>("TLP:AMBER");
  const [granularity, setGranularity] = useState<SharingGranularity>("regional");
  
  const createConsortium = useCreateConsortium();
  
  const handleCreate = async () => {
    if (!name.trim()) return;
    
    await createConsortium.mutateAsync({
      name: name.trim(),
      description: description.trim() || undefined,
      region: region.trim() || undefined,
      classification_default: classification,
      sharing_granularity_default: granularity,
    });
    
    onOpenChange(false);
    resetForm();
  };
  
  const resetForm = () => {
    setName("");
    setDescription("");
    setRegion("");
    setClassification("TLP:AMBER");
    setGranularity("regional");
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Create Intelligence Sharing Consortium
          </DialogTitle>
          <DialogDescription>
            Create a secure consortium for sharing intelligence with trusted energy sector partners.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Consortium Name *</Label>
            <Input
              id="name"
              placeholder="e.g., BC/Alberta Energy Security Alliance"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Purpose and scope of this consortium..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="region">Geographic Focus</Label>
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-muted-foreground" />
              <Input
                id="region"
                placeholder="e.g., Northern Alberta/BC"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Default Classification</Label>
              <Select value={classification} onValueChange={(v) => setClassification(v as TLPClassification)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TLP_DESCRIPTIONS).map(([tlp, desc]) => (
                    <SelectItem key={tlp} value={tlp}>
                      <span className="font-mono text-xs">{tlp}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Default Sharing Level</Label>
              <Select value={granularity} onValueChange={(v) => setGranularity(v as SharingGranularity)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(GRANULARITY_LABELS).map(([key, { label }]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleCreate} 
            disabled={!name.trim() || createConsortium.isPending}
          >
            {createConsortium.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Consortium'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
