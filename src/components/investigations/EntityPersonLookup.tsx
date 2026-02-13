import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Users, Building2, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface Entity {
  id: string;
  name: string;
  type: string;
  description: string | null;
  attributes: Record<string, unknown> | null;
  aliases: string[] | null;
}

interface EntityPersonLookupProps {
  value: string;
  onChange: (value: string) => void;
  onEntitySelect: (entity: Entity) => void;
  placeholder?: string;
}

export const EntityPersonLookup = ({ value, onChange, onEntitySelect, placeholder = "Name" }: EntityPersonLookupProps) => {
  const [suggestions, setSuggestions] = useState<Entity[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseSearch, setBrowseSearch] = useState("");
  const [browseResults, setBrowseResults] = useState<Entity[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Search-as-you-type
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("entities")
        .select("id, name, type, description, attributes, aliases")
        .or(`name.ilike.%${value}%,aliases.cs.{${value}}`)
        .in("type", ["person", "organization"])
        .eq("is_active", true)
        .limit(8);
      if (data && data.length > 0) {
        setSuggestions(data as Entity[]);
        setShowSuggestions(true);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 250);
  }, [value]);

  // Browse search
  useEffect(() => {
    if (!browseOpen) return;
    setIsSearching(true);
    const timeout = setTimeout(async () => {
      let query = supabase
        .from("entities")
        .select("id, name, type, description, attributes, aliases")
        .in("type", ["person", "organization"])
        .eq("is_active", true)
        .order("name")
        .limit(50);
      if (browseSearch.trim()) {
        query = query.or(`name.ilike.%${browseSearch}%,description.ilike.%${browseSearch}%`);
      }
      const { data } = await query;
      setBrowseResults((data as Entity[]) || []);
      setIsSearching(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [browseSearch, browseOpen]);

  const selectEntity = (entity: Entity) => {
    onChange(entity.name);
    setShowSuggestions(false);
    setBrowseOpen(false);
    onEntitySelect(entity);
  };

  const typeIcon = (type: string) => 
    type === "organization" ? <Building2 className="w-3.5 h-3.5 text-muted-foreground" /> : <User className="w-3.5 h-3.5 text-muted-foreground" />;

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex gap-1">
        <Input
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
        />
        <Dialog open={browseOpen} onOpenChange={setBrowseOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="icon" className="shrink-0" title="Browse entities">
              <Users className="w-4 h-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Select from existing entities</DialogTitle>
            </DialogHeader>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search entities..."
                value={browseSearch}
                onChange={(e) => setBrowseSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <ScrollArea className="h-[300px]">
              {isSearching ? (
                <p className="text-sm text-muted-foreground text-center py-8">Searching...</p>
              ) : browseResults.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No entities found</p>
              ) : (
                <div className="space-y-1">
                  {browseResults.map((entity) => (
                    <button
                      key={entity.id}
                      onClick={() => selectEntity(entity)}
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-accent transition-colors flex items-center gap-2"
                    >
                      {typeIcon(entity.type)}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{entity.name}</p>
                        {entity.description && (
                          <p className="text-xs text-muted-foreground truncate">{entity.description}</p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground capitalize">{entity.type}</span>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search-as-you-type dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
          {suggestions.map((entity) => (
            <button
              key={entity.id}
              onClick={() => selectEntity(entity)}
              className="w-full text-left px-3 py-2 hover:bg-accent transition-colors flex items-center gap-2"
            >
              {typeIcon(entity.type)}
              <span className="text-sm font-medium truncate">{entity.name}</span>
              {entity.description && (
                <span className="text-xs text-muted-foreground truncate ml-auto">{entity.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
