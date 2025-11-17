import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, X, Save, AlertCircle, Target, Users, Link2, TrendingUp } from 'lucide-react';

interface ClientMonitoringConfigProps {
  clientId: string;
  config?: {
    monitoring_keywords?: string[];
    competitor_names?: string[];
    supply_chain_entities?: string[];
    monitoring_config?: {
      min_relevance_score: number;
      auto_create_incidents: boolean;
      priority_keywords: string[];
      exclude_keywords: string[];
    };
  };
  onUpdate?: () => void;
}

export function ClientMonitoringConfig({ clientId, config, onUpdate }: ClientMonitoringConfigProps) {
  const [keywords, setKeywords] = useState<string[]>(config?.monitoring_keywords || []);
  const [competitors, setCompetitors] = useState<string[]>(config?.competitor_names || []);
  const [supplyChain, setSupplyChain] = useState<string[]>(config?.supply_chain_entities || []);
  const [priorityKeywords, setPriorityKeywords] = useState<string[]>(config?.monitoring_config?.priority_keywords || []);
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>(config?.monitoring_config?.exclude_keywords || []);
  const [minRelevance, setMinRelevance] = useState(config?.monitoring_config?.min_relevance_score || 50);
  const [autoIncidents, setAutoIncidents] = useState(config?.monitoring_config?.auto_create_incidents ?? true);
  const [isSaving, setIsSaving] = useState(false);

  const [newKeyword, setNewKeyword] = useState('');
  const [newCompetitor, setNewCompetitor] = useState('');
  const [newSupplyChain, setNewSupplyChain] = useState('');
  const [newPriority, setNewPriority] = useState('');
  const [newExclude, setNewExclude] = useState('');

  const addItem = (value: string, setter: (items: string[]) => void, current: string[]) => {
    if (value.trim() && !current.includes(value.trim())) {
      setter([...current, value.trim()]);
    }
  };

  const removeItem = (index: number, setter: (items: string[]) => void, current: string[]) => {
    setter(current.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({
          monitoring_keywords: keywords,
          competitor_names: competitors,
          supply_chain_entities: supplyChain,
          monitoring_config: {
            min_relevance_score: minRelevance,
            auto_create_incidents: autoIncidents,
            priority_keywords: priorityKeywords,
            exclude_keywords: excludeKeywords
          }
        })
        .eq('id', clientId);

      if (error) throw error;

      toast.success('Monitoring configuration saved successfully');
      onUpdate?.();
    } catch (error) {
      console.error('Error saving monitoring config:', error);
      toast.error('Failed to save monitoring configuration');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              OSINT Monitoring Configuration
            </CardTitle>
            <CardDescription className="mt-2">
              Configure custom keywords, competitors, and relevance scoring for intelligent monitoring
            </CardDescription>
          </div>
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Relevance Score Threshold */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">
              Minimum Relevance Score: {minRelevance}%
            </Label>
            <Badge variant="outline">{minRelevance >= 70 ? 'Strict' : minRelevance >= 50 ? 'Balanced' : 'Permissive'}</Badge>
          </div>
          <Slider
            value={[minRelevance]}
            onValueChange={(value) => setMinRelevance(value[0])}
            min={30}
            max={90}
            step={5}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            Only create signals when relevance score is at or above this threshold
          </p>
        </div>

        <Separator />

        {/* Auto-create Incidents */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-base font-semibold">Auto-create Incidents</Label>
            <p className="text-xs text-muted-foreground">
              Automatically escalate high-relevance signals to incidents
            </p>
          </div>
          <Switch
            checked={autoIncidents}
            onCheckedChange={setAutoIncidents}
          />
        </div>

        <Separator />

        {/* Custom Keywords */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            <Label className="text-base font-semibold">Custom Keywords</Label>
            <Badge variant="secondary">{keywords.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Industry-specific terms, project names, technologies (e.g., "LNG", "upstream", "Montney")
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Add keyword..."
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addItem(newKeyword, setKeywords, keywords);
                  setNewKeyword('');
                }
              }}
            />
            <Button
              size="sm"
              onClick={() => {
                addItem(newKeyword, setKeywords, keywords);
                setNewKeyword('');
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {keywords.map((keyword, index) => (
              <Badge key={index} variant="secondary" className="gap-1">
                {keyword}
                <X
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => removeItem(index, setKeywords, keywords)}
                />
              </Badge>
            ))}
          </div>
        </div>

        <Separator />

        {/* Priority Keywords */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <Label className="text-base font-semibold">Priority Keywords</Label>
            <Badge variant="destructive">{priorityKeywords.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Critical terms that boost relevance (e.g., "explosion", "spill", "violation", "incident")
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Add priority keyword..."
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addItem(newPriority, setPriorityKeywords, priorityKeywords);
                  setNewPriority('');
                }
              }}
            />
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                addItem(newPriority, setPriorityKeywords, priorityKeywords);
                setNewPriority('');
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {priorityKeywords.map((keyword, index) => (
              <Badge key={index} variant="destructive" className="gap-1">
                {keyword}
                <X
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => removeItem(index, setPriorityKeywords, priorityKeywords)}
                />
              </Badge>
            ))}
          </div>
        </div>

        <Separator />

        {/* Competitors */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <Label className="text-base font-semibold">Competitor Names</Label>
            <Badge variant="secondary">{competitors.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Track mentions of competitors for market intelligence
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Add competitor..."
              value={newCompetitor}
              onChange={(e) => setNewCompetitor(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addItem(newCompetitor, setCompetitors, competitors);
                  setNewCompetitor('');
                }
              }}
            />
            <Button
              size="sm"
              onClick={() => {
                addItem(newCompetitor, setCompetitors, competitors);
                setNewCompetitor('');
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {competitors.map((competitor, index) => (
              <Badge key={index} variant="outline" className="gap-1">
                {competitor}
                <X
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => removeItem(index, setCompetitors, competitors)}
                />
              </Badge>
            ))}
          </div>
        </div>

        <Separator />

        {/* Supply Chain */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            <Label className="text-base font-semibold">Supply Chain Entities</Label>
            <Badge variant="secondary">{supplyChain.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Monitor key vendors, contractors, and partners
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Add supply chain entity..."
              value={newSupplyChain}
              onChange={(e) => setNewSupplyChain(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addItem(newSupplyChain, setSupplyChain, supplyChain);
                  setNewSupplyChain('');
                }
              }}
            />
            <Button
              size="sm"
              onClick={() => {
                addItem(newSupplyChain, setSupplyChain, supplyChain);
                setNewSupplyChain('');
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {supplyChain.map((entity, index) => (
              <Badge key={index} variant="outline" className="gap-1">
                {entity}
                <X
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => removeItem(index, setSupplyChain, supplyChain)}
                />
              </Badge>
            ))}
          </div>
        </div>

        <Separator />

        {/* Exclude Keywords */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <X className="h-4 w-4 text-gray-500" />
            <Label className="text-base font-semibold">Exclude Keywords</Label>
            <Badge variant="secondary">{excludeKeywords.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Filter out irrelevant content (e.g., "automotive", "retail")
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Add exclude keyword..."
              value={newExclude}
              onChange={(e) => setNewExclude(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addItem(newExclude, setExcludeKeywords, excludeKeywords);
                  setNewExclude('');
                }
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                addItem(newExclude, setExcludeKeywords, excludeKeywords);
                setNewExclude('');
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {excludeKeywords.map((keyword, index) => (
              <Badge key={index} variant="outline" className="gap-1 text-gray-500">
                {keyword}
                <X
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => removeItem(index, setExcludeKeywords, excludeKeywords)}
                />
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
