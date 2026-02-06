import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search, Loader2, FileText, Radio, Sparkles, BookOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

interface SearchResult {
  chunk_id: string;
  content: string;
  similarity: number;
  source: {
    doc_id: string;
    title: string;
    type: string;
    source_id: string;
    metadata: any;
    created_at: string;
  };
}

interface SearchResponse {
  query: string;
  results: SearchResult[];
  total_results: number;
  summary: string | null;
}

export function SemanticSearchPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);

  const searchMutation = useMutation({
    mutationFn: async (searchQuery: string) => {
      const { data, error } = await supabase.functions.invoke("semantic-search", {
        body: {
          query: searchQuery,
          threshold: 0.45,
          max_results: 15,
          generate_summary: true,
        },
      });
      if (error) throw error;
      return data as SearchResponse;
    },
    onSuccess: (data) => {
      setResults(data);
      if (data.total_results === 0) {
        toast.info("No matching documents found. Try embedding more documents first.");
      }
    },
    onError: (error: any) => {
      console.error("Search error:", error);
      toast.error(error.message || "Search failed");
    },
  });

  const handleSearch = () => {
    if (query.trim().length < 3) {
      toast.warning("Query must be at least 3 characters");
      return;
    }
    searchMutation.mutate(query.trim());
  };

  const getSourceIcon = (type: string) => {
    switch (type) {
      case "signal": return <Radio className="h-3.5 w-3.5" />;
      case "archival_document": return <FileText className="h-3.5 w-3.5" />;
      default: return <BookOpen className="h-3.5 w-3.5" />;
    }
  };

  const getSimilarityColor = (sim: number) => {
    if (sim >= 0.8) return "text-green-400";
    if (sim >= 0.6) return "text-yellow-400";
    return "text-muted-foreground";
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search across all intelligence documents and signals..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="pl-10"
          />
        </div>
        <Button
          onClick={handleSearch}
          disabled={searchMutation.isPending || query.trim().length < 3}
        >
          {searchMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Sparkles className="h-4 w-4 mr-2" />
          )}
          Semantic Search
        </Button>
      </div>

      {results?.summary && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
              {results.summary}
            </p>
          </CardContent>
        </Card>
      )}

      {results && (
        <div className="text-xs text-muted-foreground">
          {results.total_results} result{results.total_results !== 1 ? "s" : ""} for "{results.query}"
        </div>
      )}

      {results?.results && results.results.length > 0 && (
        <ScrollArea className="h-[500px]">
          <div className="space-y-3">
            {results.results.map((result, idx) => (
              <Card key={result.chunk_id} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      {getSourceIcon(result.source.type)}
                      <span className="text-sm font-medium truncate max-w-[300px]">
                        {result.source.title}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {result.source.type === "archival_document" ? "Document" : result.source.type}
                      </Badge>
                    </div>
                    <span className={`text-xs font-mono ${getSimilarityColor(result.similarity)}`}>
                      {(result.similarity * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">
                    {result.content}
                  </p>
                  {result.source.metadata && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {result.source.metadata.category && (
                        <Badge variant="secondary" className="text-[10px]">
                          {result.source.metadata.category}
                        </Badge>
                      )}
                      {result.source.metadata.severity && (
                        <Badge variant="secondary" className="text-[10px]">
                          {result.source.metadata.severity}
                        </Badge>
                      )}
                      {result.source.metadata.date_of_document && (
                        <Badge variant="outline" className="text-[10px]">
                          {result.source.metadata.date_of_document}
                        </Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}

      {results?.total_results === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="h-8 w-8 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No matching results found.</p>
          <p className="text-xs mt-1">Try different keywords or embed more documents.</p>
        </div>
      )}
    </div>
  );
}
