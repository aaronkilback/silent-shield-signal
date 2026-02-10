import { Video, ExternalLink } from "lucide-react";
import { useState } from "react";

interface FacebookVideoEmbedProps {
  url: string;
}

/**
 * Extracts a Facebook video/live URL and renders an embedded player.
 * Falls back to a link if embedding fails.
 */
export function FacebookVideoEmbed({ url }: FacebookVideoEmbedProps) {
  const [embedFailed, setEmbedFailed] = useState(false);

  // Normalize the URL for Facebook's video plugin
  const encodedUrl = encodeURIComponent(url);
  const embedSrc = `https://www.facebook.com/plugins/video.php?href=${encodedUrl}&show_text=false&width=500`;

  if (embedFailed) {
    return (
      <div className="rounded-lg border bg-muted/50 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Video className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-medium">Facebook Video</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          This video cannot be embedded. It may be private or require Facebook login.
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open on Facebook
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden bg-black">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
        <Video className="h-4 w-4 text-blue-500" />
        <span className="text-sm font-medium">Facebook Live / Video</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          <ExternalLink className="h-3 w-3" />
          Open
        </a>
      </div>
      <iframe
        src={embedSrc}
        width="100%"
        height="280"
        style={{ border: "none", overflow: "hidden" }}
        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
        allowFullScreen
        onError={() => setEmbedFailed(true)}
        onLoad={(e) => {
          // Check if iframe loaded but is blank (Facebook blocking)
          try {
            const iframe = e.target as HTMLIFrameElement;
            // We can't access cross-origin content, so just trust it loaded
            if (!iframe.contentDocument && !iframe.src) {
              setEmbedFailed(true);
            }
          } catch {
            // Cross-origin - expected, embed is working
          }
        }}
      />
    </div>
  );
}

/**
 * Checks if a URL is a Facebook video/live URL that can be embedded.
 */
export function isFacebookVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes("facebook.com") &&
    (lower.includes("/videos/") ||
      lower.includes("/live/") ||
      lower.includes("/watch/") ||
      lower.includes("video_id=") ||
      lower.includes("/reel/"))
  );
}
