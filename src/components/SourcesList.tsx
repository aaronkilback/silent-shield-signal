import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Trash2, Settings, Pencil } from "lucide-react";
import { Tables } from "@/integrations/supabase/types";
import { formatDistanceToNow } from "date-fns";

interface SourcesListProps {
  sources: Tables<"sources">[];
  onToggleActive: (id: string, isActive: boolean) => void;
  onDelete: (id: string) => void;
  onEdit: (source: any) => void;
}

export const SourcesList = ({ sources, onToggleActive, onDelete, onEdit }: SourcesListProps) => {
  const getSourceTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      social_media: "bg-blue-500/10 text-blue-500",
      news: "bg-green-500/10 text-green-500",
      threat_intel: "bg-red-500/10 text-red-500",
      darkweb: "bg-purple-500/10 text-purple-500",
      domain: "bg-orange-500/10 text-orange-500",
      public_records: "bg-cyan-500/10 text-cyan-500",
      api: "bg-pink-500/10 text-pink-500",
      rss: "bg-yellow-500/10 text-yellow-500",
      other: "bg-gray-500/10 text-gray-500",
    };
    return colors[type] || colors.other;
  };

  return (
    <div className="space-y-4">
      {sources.map((source) => (
        <div
          key={source.id}
          className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
        >
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold">{source.name}</h3>
              <Badge className={getSourceTypeColor(source.type)}>
                {source.type.replace(/_/g, " ")}
              </Badge>
              {source.status === 'active' ? (
                <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                  Active
                </Badge>
              ) : source.status === 'failed' ? (
                <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">
                  Failed
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-gray-500/10 text-gray-500 border-gray-500/20">
                  Paused
                </Badge>
              )}
            </div>
            {source.config && Object.keys(source.config).length > 0 && (
              <p className="text-sm text-muted-foreground">
                <Settings className="w-3 h-3 inline mr-1" />
                Configured with custom settings
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Added {formatDistanceToNow(new Date(source.created_at), { addSuffix: true })}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Enable</span>
              <Switch
                checked={source.status === 'active'}
                onCheckedChange={() => onToggleActive(source.id, source.status === 'active')}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(source)}
              className="hover:bg-accent"
            >
              <Pencil className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (confirm("Are you sure you want to delete this source?")) {
                  onDelete(source.id);
                }
              }}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};
