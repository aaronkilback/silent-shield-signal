import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Document, Paragraph, TextRun, HeadingLevel, Packer } from "docx";
import { toast } from "sonner";

export const KnowledgeBaseExport = () => {
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: categories } = useQuery({
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

  const { data: articles } = useQuery({
    queryKey: ["knowledge-base-articles-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_base_articles")
        .select(`
          *,
          knowledge_base_categories (
            name
          )
        `)
        .eq("is_published", true)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const generateDocument = async () => {
    if (!articles || articles.length === 0) {
      toast.error("No articles available to export");
      return;
    }

    setIsGenerating(true);
    try {
      const sections: Paragraph[] = [];

      // Title
      sections.push(
        new Paragraph({
          text: "Fortress Knowledge Base",
          heading: HeadingLevel.TITLE,
          spacing: { after: 400 },
        })
      );

      // Group articles by category
      const articlesByCategory = articles.reduce((acc, article) => {
        const categoryName = article.knowledge_base_categories?.name || "Uncategorized";
        if (!acc[categoryName]) acc[categoryName] = [];
        acc[categoryName].push(article);
        return acc;
      }, {} as Record<string, typeof articles>);

      // Generate content for each category
      Object.entries(articlesByCategory).forEach(([categoryName, categoryArticles]) => {
        sections.push(
          new Paragraph({
            text: categoryName,
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
          })
        );

        categoryArticles.forEach((article) => {
          sections.push(
            new Paragraph({
              text: article.title,
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 100 },
            })
          );

          if (article.summary) {
            sections.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: article.summary,
                    italics: true,
                  }),
                ],
                spacing: { after: 100 },
              })
            );
          }

          // Split content by newlines and create paragraphs
          const contentLines = article.content.split("\n");
          contentLines.forEach((line) => {
            sections.push(
              new Paragraph({
                text: line,
                spacing: { after: 100 },
              })
            );
          });

          sections.push(
            new Paragraph({
              text: "",
              spacing: { after: 200 },
            })
          );
        });
      });

      const doc = new Document({
        sections: [
          {
            properties: {},
            children: sections,
          },
        ],
      });

      const blob = await Packer.toBlob(doc);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Fortress_Knowledge_Base_${new Date().toISOString().split("T")[0]}.docx`;
      link.click();
      window.URL.revokeObjectURL(url);

      toast.success("Knowledge base document generated successfully");
    } catch (error) {
      console.error("Error generating document:", error);
      toast.error("Failed to generate document");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button
      onClick={generateDocument}
      disabled={isGenerating || !articles || articles.length === 0}
      variant="outline"
      size="sm"
    >
      <Download className="w-4 h-4 mr-2" />
      {isGenerating ? "Generating..." : "Download as Word Document"}
    </Button>
  );
};
