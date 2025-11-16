import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CreateEntityDialog } from "@/components/CreateEntityDialog";
import { Plus, Search, Users, MapPin, Building2, Globe } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Entities() {
  const [searchTerm, setSearchTerm] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const { data: entities = [] } = useQuery({
    queryKey: ['entities', searchTerm, selectedType],
    queryFn: async () => {
      let query = supabase
        .from('entities')
        .select(`
          *,
          entity_mentions(count),
          created_by_profile:profiles!entities_created_by_fkey(name)
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (searchTerm) {
        query = query.or(`name.ilike.%${searchTerm}%,aliases.cs.{${searchTerm}}`);
      }

      if (selectedType) {
        query = query.eq('type', selectedType as any);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
  });

  const getTypeIcon = (type: string) => {
    const icons: Record<string, any> = {
      person: Users,
      organization: Building2,
      location: MapPin,
      domain: Globe,
      ip_address: Globe
    };
    return icons[type] || Users;
  };

  const getRiskColor = (level: string) => {
    const colors: Record<string, string> = {
      critical: 'destructive',
      high: 'default',
      medium: 'secondary',
      low: 'outline'
    };
    return colors[level] || 'outline';
  };

  const entityTypes = [
    { value: 'person', label: 'People' },
    { value: 'organization', label: 'Organizations' },
    { value: 'location', label: 'Locations' },
    { value: 'infrastructure', label: 'Infrastructure' },
    { value: 'domain', label: 'Domains' },
    { value: 'ip_address', label: 'IP Addresses' }
  ];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Entity Tracking</h1>
            <p className="text-muted-foreground">
              Track persons, organizations, and indicators across signals
            </p>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Entity
          </Button>
        </div>

        <div className="space-y-4 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search entities..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button
              variant={selectedType === null ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedType(null)}
            >
              All
            </Button>
            {entityTypes.map(type => (
              <Button
                key={type.value}
                variant={selectedType === type.value ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedType(type.value)}
              >
                {type.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entities.map((entity: any) => {
            const Icon = getTypeIcon(entity.type);
            return (
              <Card key={entity.id} className="p-4 hover:shadow-lg transition-shadow cursor-pointer">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="w-5 h-5 text-primary" />
                      <h3 className="font-semibold">{entity.name}</h3>
                    </div>
                    <Badge variant={getRiskColor(entity.risk_level) as any}>
                      {entity.risk_level}
                    </Badge>
                  </div>

                  {entity.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {entity.description}
                    </p>
                  )}

                  {entity.aliases && entity.aliases.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {entity.aliases.slice(0, 3).map((alias: string, idx: number) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {alias}
                        </Badge>
                      ))}
                      {entity.aliases.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{entity.aliases.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                    <span>{entity.entity_mentions?.[0]?.count || 0} mentions</span>
                    <span>{formatDistanceToNow(new Date(entity.created_at), { addSuffix: true })}</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {entities.length === 0 && (
          <div className="text-center py-12">
            <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No entities yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first entity to start tracking across signals
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Entity
            </Button>
          </div>
        )}
      </main>

      <CreateEntityDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </div>
  );
}
