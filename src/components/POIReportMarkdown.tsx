import { useMemo } from "react";
import DOMPurify from "dompurify";

interface POIReportMarkdownProps {
  markdown: string;
}

/**
 * Renders a POI intelligence report markdown string as sanitized HTML.
 * Supports: h2, h3, bold, italic, code blocks, inline code, bullet lists.
 */
function markdownToHtml(md: string): string {
  let html = md
    // Escape HTML special chars before processing
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Fenced code blocks (```json ... ``` or ``` ... ```)
    .replace(/```[\w]*\n([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // h2 (## heading)
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    // h3 (### heading)
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    // Bold (**text**)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic (*text*)
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Bullet list items (- item or * item)
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    // Numbered list items (1. item)
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    // Wrap consecutive <li> blocks in <ul>
    .replace(/(<li>[\s\S]*?<\/li>)(\n<li>|$)/g, (match) => match)
    // Line breaks: double newline → paragraph break
    .replace(/\n\n+/g, "\n\n");

  // Wrap <li> sequences in <ul>
  html = html.replace(/((?:<li>.*?<\/li>\n?)+)/g, "<ul>$1</ul>");

  // Convert remaining single newlines (not inside block elements) to <br>
  html = html
    .split("\n")
    .map(line => {
      if (/^<(h2|h3|ul|li|pre|code)/.test(line) || line === "") return line;
      return line + "<br>";
    })
    .join("\n");

  return html;
}

export const POIReportMarkdown = ({ markdown }: POIReportMarkdownProps) => {
  const sanitizedHtml = useMemo(() => {
    const rawHtml = markdownToHtml(markdown);
    return DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: ["h2", "h3", "p", "br", "strong", "em", "li", "ul", "ol", "pre", "code"],
      ALLOWED_ATTR: [],
    });
  }, [markdown]);

  return (
    <div
      className="poi-report prose prose-invert max-w-none text-sm space-y-1 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-1 [&_h2]:text-primary [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-3 [&_h3]:mb-1 [&_ul]:pl-4 [&_li]:list-disc [&_li]:ml-2 [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:rounded [&_pre]:text-xs [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_code]:text-xs"
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
};
