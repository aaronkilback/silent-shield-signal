import { Header } from "@/components/Header";
import { useIsEmbedded } from "@/hooks/useIsEmbedded";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Loader2, Search, BookOpen, ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import { KnowledgeBaseExport } from "@/components/KnowledgeBaseExport";

const KnowledgeBase = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<any | null>(null);
  const isEmbedded = useIsEmbedded();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  const { data: categories, isLoading: categoriesLoading } = useQuery({
    queryKey: ["knowledge-base-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_base_categories")
        .select("*")
        .order("display_order");

      if (error) throw error;
      return data;
    },
  });

  const { data: articles, isLoading: articlesLoading } = useQuery({
    queryKey: ["knowledge-base-articles", selectedCategory, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from("knowledge_base_articles")
        .select("*")
        .eq("is_published", true);

      if (selectedCategory) {
        query = query.eq("category_id", selectedCategory);
      }

      if (searchQuery) {
        query = query.or(`title.ilike.%${searchQuery}%,summary.ilike.%${searchQuery}%,content.ilike.%${searchQuery}%`);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  if (loading || categoriesLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const kbContent = (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <BookOpen className="w-8 h-8" />
              Knowledge Base
            </h1>
            <p className="text-muted-foreground mt-2">
              Browse documentation, guides, and troubleshooting articles
            </p>
          </div>
          <KnowledgeBaseExport />
        </div>

        <div className="flex gap-2 items-center">
          <Search className="w-5 h-5 text-muted-foreground" />
          <Input
            placeholder="Search articles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-md"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Categories sidebar */}
          <div className="space-y-2">
            <h2 className="font-semibold mb-4">Categories</h2>
            <div className="space-y-1">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                  !selectedCategory ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
              >
                All Articles
              </button>
              {categories?.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                    selectedCategory === category.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          {/* Articles list */}
          <div className="md:col-span-3 space-y-4">
            {articlesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : articles && articles.length > 0 ? (
              articles.map((article) => (
                <Card
                  key={article.id}
                  className="cursor-pointer hover:border-primary transition-colors"
                  onClick={() => setSelectedArticle(article)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="flex items-center gap-2">
                          {article.title}
                          <ChevronRight className="w-4 h-4" />
                        </CardTitle>
                        <CardDescription className="mt-2">
                          {article.summary}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  {article.tags && article.tags.length > 0 && (
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {article.tags.map((tag: string) => (
                          <Badge key={tag} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No articles found. Try adjusting your search or category filter.
              </div>
            )}
        </div>
      </div>

      {/* Article dialog */}
      <Dialog open={!!selectedArticle} onOpenChange={() => setSelectedArticle(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{selectedArticle?.title}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[60vh] pr-4">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{selectedArticle?.content}</ReactMarkdown>
            </div>
            {selectedArticle?.tags && selectedArticle.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t">
                {selectedArticle.tags.map((tag: string) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );

  if (isEmbedded) {
    return <div className="space-y-6">{kbContent}</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        {kbContent}
      </main>
    </div>
  );
};

export default KnowledgeBase;
