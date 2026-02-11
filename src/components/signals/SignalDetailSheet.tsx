import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserPlus, XCircle, Calendar, MapPin, Tag, AlertTriangle, ExternalLink, Shield, Check, History, Clock, Heart, MessageCircle, Eye, Hash, AtSign, Instagram, Twitter, Facebook } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { SignalAgeBadge } from "./SignalAgeBadge";
import { FacebookVideoEmbed, isFacebookVideoUrl } from "./FacebookVideoEmbed";
import { SignalUpdatesTimeline } from "./SignalUpdatesTimeline";

interface SignalDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signal: {
    id: string;
    primary_signal_id: string;
    category: string | null;
    severity: string | null;
    location: string | null;
    normalized_text: string | null;
    created_at: string;
    sources_json: any;
    signal_count: number | null;
    confidence?: number | null;
    source_reliability?: string | null;
    information_accuracy?: string | null;
    event_date?: string | null;
    // Social media fields
    post_caption?: string | null;
    thumbnail_url?: string | null;
    media_urls?: string[] | null;
    hashtags?: string[] | null;
    mentions?: string[] | null;
    engagement_metrics?: {
      likes?: number;
      comments?: number;
      views?: number;
      shares?: number;
    } | null;
    raw_json?: any;
  } | null;
  onAssign: () => void;
  onDismiss: () => void;
}

export function SignalDetailSheet({
  open,
  onOpenChange,
  signal,
  onAssign,
  onDismiss,
}: SignalDetailSheetProps) {
  if (!signal) return null;

  const [updateCount, setUpdateCount] = useState(0);

  const getSeverityColor = (severity: string | null) => {
    switch (severity?.toLowerCase()) {
      case "critical":
      case "p1":
        return "bg-destructive text-destructive-foreground";
      case "high":
      case "p2":
        return "bg-orange-500 text-white";
      case "medium":
      case "p3":
        return "bg-yellow-500 text-black";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const sources = signal.sources_json ? 
    (Array.isArray(signal.sources_json) ? signal.sources_json : [signal.sources_json]) : 
    [];

  // Extract source URL from sources
  const sourceUrl = sources.find((s: any) => s?.url || s?.link)?.url || 
                    sources.find((s: any) => s?.url || s?.link)?.link;

  // Detect if this is a social media signal
  const sourceMetadata = signal.raw_json?.source_metadata || signal.raw_json;
  const socialPlatform = sourceMetadata?.source || null;
  const isSocialMedia = ['instagram', 'twitter', 'facebook', 'x'].includes(socialPlatform?.toLowerCase() || '');
  
  // Get platform icon
  const getPlatformIcon = () => {
    switch (socialPlatform?.toLowerCase()) {
      case 'instagram': return <Instagram className="h-4 w-4" />;
      case 'twitter': 
      case 'x': return <Twitter className="h-4 w-4" />;
      case 'facebook': return <Facebook className="h-4 w-4" />;
      default: return null;
    }
  };

  // Clean hashtags (remove x prefixes from encoding issues)
  const cleanHashtags = (tags: string[] | null | undefined) => {
    if (!tags) return [];
    return tags
      .filter(tag => tag && !tag.match(/^x[0-9a-f]{4}$/i)) // Filter out encoded chars like x2019
      .map(tag => tag.startsWith('#') ? tag : `#${tag}`);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Signal Details</SheetTitle>
          <SheetDescription>
            Review the signal details and decide how to handle it
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-200px)] mt-6 pr-4">
          <div className="space-y-6">
            {/* Severity & Category */}
            <div className="flex flex-wrap gap-2">
              <Badge className={getSeverityColor(signal.severity)}>
                <AlertTriangle className="h-3 w-3 mr-1" />
                {signal.severity || "Unknown Severity"}
              </Badge>
              {signal.category && (
                <Badge variant="outline">
                  <Tag className="h-3 w-3 mr-1" />
                  {signal.category}
                </Badge>
              )}
              {signal.confidence != null && (
                <Badge variant="outline">
                  {Math.round(signal.confidence)}% confidence
                </Badge>
              )}
              {updateCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  Updated · {updateCount}
                </Badge>
              )}
            </div>

            {/* Date Information - Enhanced with Event Date */}
            <div className="space-y-3">
              {signal.event_date && (
                <div className="p-3 rounded-lg bg-muted/50 border">
                  <div className="flex items-center gap-2 mb-2">
                    {differenceInDays(new Date(), new Date(signal.event_date)) > 365 ? (
                      <AlertTriangle className="h-4 w-4 text-orange-500" />
                    ) : differenceInDays(new Date(), new Date(signal.event_date)) > 30 ? (
                      <History className="h-4 w-4 text-amber-500" />
                    ) : (
                      <Calendar className="h-4 w-4 text-primary" />
                    )}
                    <span className="text-sm font-medium">Event Timeline</span>
                  </div>
                  <SignalAgeBadge 
                    eventDate={signal.event_date} 
                    ingestedAt={signal.created_at} 
                  />
                </div>
              )}
              
              {!signal.event_date && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>Discovered: {format(new Date(signal.created_at), "PPp")}</span>
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              {signal.location && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  <span>{signal.location}</span>
                </div>
              )}
            </div>

            {/* Source Reliability & Information Accuracy */}
            {(signal.source_reliability || signal.information_accuracy) && (
              <div className="flex flex-wrap gap-3 text-sm">
                {signal.source_reliability && signal.source_reliability !== 'unknown' && (
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Reliability:</span>
                    <Badge variant="outline" className="capitalize">
                      {signal.source_reliability.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                )}
                {signal.information_accuracy && signal.information_accuracy !== 'cannot_be_judged' && (
                  <div className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Accuracy:</span>
                    <Badge variant="outline" className="capitalize">
                      {signal.information_accuracy.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                )}
              </div>
            )}

            <Separator />

            {/* Social Media Post Content */}
            {isSocialMedia && (
              <div className="space-y-4">
                {/* Platform Badge */}
                <div className="flex items-center gap-2">
                  {getPlatformIcon()}
                  <span className="text-sm font-medium capitalize">{socialPlatform} Post</span>
                </div>

                {/* Thumbnail/Media */}
                {signal.thumbnail_url && (
                  <div className="rounded-lg overflow-hidden border">
                    <img 
                      src={signal.thumbnail_url} 
                      alt="Post media" 
                      className="w-full h-auto max-h-64 object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}

                {/* Post Caption */}
                {signal.post_caption && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Original Post</h4>
                    <div className="bg-muted p-4 rounded-lg text-sm whitespace-pre-wrap border-l-4 border-primary/50">
                      {signal.post_caption}
                    </div>
                  </div>
                )}

                {/* Engagement Metrics */}
                {signal.engagement_metrics && (
                  <div className="flex flex-wrap gap-4 text-sm">
                    {signal.engagement_metrics.likes !== undefined && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Heart className="h-4 w-4 text-red-500" />
                        <span>{signal.engagement_metrics.likes.toLocaleString()} likes</span>
                      </div>
                    )}
                    {signal.engagement_metrics.comments !== undefined && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <MessageCircle className="h-4 w-4 text-blue-500" />
                        <span>{signal.engagement_metrics.comments.toLocaleString()} comments</span>
                      </div>
                    )}
                    {signal.engagement_metrics.views !== undefined && signal.engagement_metrics.views > 0 && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Eye className="h-4 w-4 text-green-500" />
                        <span>{signal.engagement_metrics.views.toLocaleString()} views</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Hashtags */}
                {cleanHashtags(signal.hashtags).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                      <Hash className="h-3.5 w-3.5" />
                      Hashtags
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {cleanHashtags(signal.hashtags).map((tag, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mentions */}
                {signal.mentions && signal.mentions.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                      <AtSign className="h-3.5 w-3.5" />
                      Mentions
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {signal.mentions.map((mention, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          @{mention.replace('@', '')}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Additional Media */}
                {signal.media_urls && signal.media_urls.length > 1 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Additional Media ({signal.media_urls.length})</h4>
                    <div className="grid grid-cols-3 gap-2">
                      {signal.media_urls.slice(1, 4).map((url, idx) => (
                        <a 
                          key={idx} 
                          href={url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="rounded overflow-hidden border hover:opacity-80 transition-opacity"
                        >
                          <img 
                            src={url} 
                            alt={`Media ${idx + 2}`} 
                            className="w-full h-20 object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).parentElement!.style.display = 'none';
                            }}
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <Separator />
              </div>
            )}

            {/* Facebook Video Embed */}
            {socialPlatform?.toLowerCase() === 'facebook' && isFacebookVideoUrl(sourceUrl) && (
              <div>
                <FacebookVideoEmbed url={sourceUrl} />
              </div>
            )}

            {/* Signal Text / Analysis */}
            <div>
              <h4 className="text-sm font-medium mb-2">
                {isSocialMedia ? "AI Analysis" : "Signal Content"}
              </h4>
              <div className="bg-muted p-4 rounded-lg text-sm whitespace-pre-wrap">
                {signal.normalized_text || "No text available"}
              </div>
            </div>

            {/* Original Source Link */}
            {sourceUrl && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2">Original Source</h4>
                  <a 
                    href={sourceUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span className="truncate">{sourceUrl}</span>
                  </a>
                </div>
              </>
            )}

            {/* Live Updates Timeline */}
            <Separator />
            <SignalUpdatesTimeline signalId={signal.id} onCountChange={setUpdateCount} />

            {/* Related Signals Count */}
            {signal.signal_count && signal.signal_count > 1 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2">Related Signals</h4>
                  <p className="text-sm text-muted-foreground">
                    This signal group contains {signal.signal_count} related signals
                  </p>
                </div>
              </>
            )}

            {/* Sources */}
            {sources.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2">Sources</h4>
                  <div className="space-y-2">
                    {sources.map((source: any, idx: number) => (
                      <div key={idx} className="text-sm bg-muted/50 p-2 rounded">
                        {source?.name || source?.source || (typeof source === 'string' ? source : JSON.stringify(source))}
                        {source?.url && (
                          <a 
                            href={source.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="ml-2 text-primary hover:underline inline-flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Signal ID */}
            <Separator />
            <div>
              <h4 className="text-sm font-medium mb-2">Signal ID</h4>
              <code className="text-xs bg-muted px-2 py-1 rounded">
                {signal.primary_signal_id}
              </code>
            </div>
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-background border-t">
          <div className="flex gap-3">
            <Button className="flex-1" onClick={onAssign}>
              <UserPlus className="h-4 w-4 mr-2" />
              Assign to Client
            </Button>
            <Button variant="outline" onClick={onDismiss}>
              <XCircle className="h-4 w-4 mr-2" />
              Dismiss
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
