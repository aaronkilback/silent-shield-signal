// Social media content parsing utilities
// Extracts structured data from social media posts including captions, mentions, hashtags, comments

export interface SocialMediaPost {
  platform: 'instagram' | 'facebook' | 'linkedin' | 'twitter' | 'tiktok';
  postUrl: string;
  authorHandle: string;
  authorName: string;
  caption: string;
  hashtags: string[];
  mentions: string[];
  mediaUrls: string[];
  mediaType: 'image' | 'video' | 'carousel' | 'reel' | 'story';
  engagement: {
    likes?: number;
    comments?: number;
    shares?: number;
    saves?: number;
    views?: number;
  };
  comments: SocialMediaComment[];
  postDate?: string;
  location?: string;
  eventDetails?: EventDetails;
}

export interface SocialMediaComment {
  authorHandle: string;
  authorName?: string;
  text: string;
  timestamp?: string;
  likes?: number;
  isReply?: boolean;
}

export interface EventDetails {
  name?: string;
  date?: string;
  time?: string;
  venue?: string;
  address?: string;
  ticketUrl?: string;
  ticketPrice?: string;
}

// Extract @mentions from text
export function extractMentions(text: string): string[] {
  const mentionPattern = /@([a-zA-Z0-9_\.]+)/g;
  const mentions: string[] = [];
  let match;
  
  while ((match = mentionPattern.exec(text)) !== null) {
    const mention = match[1].toLowerCase();
    if (!mentions.includes(mention) && mention.length > 1) {
      mentions.push(mention);
    }
  }
  
  return mentions;
}

// Extract #hashtags from text
export function extractHashtags(text: string): string[] {
  const hashtagPattern = /#([a-zA-Z0-9_]+)/g;
  const hashtags: string[] = [];
  let match;
  
  while ((match = hashtagPattern.exec(text)) !== null) {
    const hashtag = match[1].toLowerCase();
    if (!hashtags.includes(hashtag) && hashtag.length > 1) {
      hashtags.push(hashtag);
    }
  }
  
  return hashtags;
}

// Extract event details from text
export function extractEventDetails(text: string): EventDetails | null {
  const details: EventDetails = {};
  const lowerText = text.toLowerCase();
  
  // Look for date patterns
  const datePatterns = [
    /(?:on\s+)?(?:thursday|friday|saturday|sunday|monday|tuesday|wednesday)[,\s]+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?/gi,
    /(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?/gi,
    /\d{1,2}\/\d{1,2}\/\d{2,4}/g,
  ];
  
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      details.date = match[0];
      break;
    }
  }
  
  // Look for time patterns
  const timePatterns = [
    /\d{1,2}(?::\d{2})?\s*(?:am|pm)/gi,
    /doors?\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi,
    /show\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi,
  ];
  
  for (const pattern of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      details.time = match[0];
      break;
    }
  }
  
  // Look for venue/location patterns
  const venuePatterns = [
    /📍\s*([^📅🗓️🎫💳\n]+)/,
    /at\s+(?:the\s+)?([A-Z][a-zA-Z\s]+(?:Club|Hall|Centre|Center|Theatre|Theater|Bar|Venue|Room|Lounge|Arena|Stadium))/,
    /(?:venue|location):\s*([^\n]+)/i,
  ];
  
  for (const pattern of venuePatterns) {
    const match = text.match(pattern);
    if (match) {
      details.venue = match[1].trim();
      break;
    }
  }
  
  // Look for address patterns
  const addressPattern = /\d+\s+[A-Z][a-zA-Z\s]+(?:St(?:reet)?|Ave(?:nue)?|Rd|Road|Blvd|Boulevard|Dr(?:ive)?)[.,\s]+[A-Z][a-zA-Z\s]+(?:,\s*[A-Z]{2})?/;
  const addressMatch = text.match(addressPattern);
  if (addressMatch) {
    details.address = addressMatch[0].trim();
  }
  
  // Look for ticket info
  const ticketPatterns = [
    /tickets?\s+(?:at\s+)?(?:https?:\/\/)?([^\s]+)/i,
    /bit\.ly\/[a-zA-Z0-9_-]+/i,
    /🎫\s*(?:tickets?\s+)?(?:at\s+)?([^\n]+)/i,
  ];
  
  for (const pattern of ticketPatterns) {
    const match = text.match(pattern);
    if (match) {
      details.ticketUrl = match[1] || match[0];
      break;
    }
  }
  
  // Look for price
  const pricePattern = /\$\d+(?:\s*\/\s*\$\d+)*(?:\s*\+\s*fees)?/i;
  const priceMatch = text.match(pricePattern);
  if (priceMatch) {
    details.ticketPrice = priceMatch[0];
  }
  
  // Only return if we found meaningful event details
  if (details.date || details.venue || details.ticketUrl) {
    return details;
  }
  
  return null;
}

// Parse engagement metrics from text
export function parseEngagement(text: string): { likes?: number; comments?: number; shares?: number; saves?: number } {
  const engagement: { likes?: number; comments?: number; shares?: number; saves?: number } = {};
  
  // Common patterns for engagement counts
  const likePatterns = [
    /(\d+(?:,\d+)?(?:\.\d+)?[KkMm]?)\s*(?:likes?|❤️|♥️)/i,
    /(?:liked by|likes?:)\s*(\d+(?:,\d+)?(?:\.\d+)?[KkMm]?)/i,
  ];
  
  const commentPatterns = [
    /(\d+(?:,\d+)?(?:\.\d+)?[KkMm]?)\s*comments?/i,
    /💬\s*(\d+(?:,\d+)?)/i,
  ];
  
  const sharePatterns = [
    /(\d+(?:,\d+)?(?:\.\d+)?[KkMm]?)\s*(?:shares?|reposts?)/i,
    /🔄\s*(\d+(?:,\d+)?)/i,
  ];
  
  const savePatterns = [
    /(\d+(?:,\d+)?(?:\.\d+)?[KkMm]?)\s*saves?/i,
    /🔖\s*(\d+(?:,\d+)?)/i,
  ];
  
  const parseCount = (str: string): number => {
    const cleaned = str.replace(/,/g, '');
    const multiplier = cleaned.match(/[KkMm]$/);
    const num = parseFloat(cleaned.replace(/[KkMm]$/, ''));
    
    if (multiplier) {
      if (multiplier[0].toLowerCase() === 'k') return Math.round(num * 1000);
      if (multiplier[0].toLowerCase() === 'm') return Math.round(num * 1000000);
    }
    return Math.round(num);
  };
  
  for (const pattern of likePatterns) {
    const match = text.match(pattern);
    if (match) {
      engagement.likes = parseCount(match[1]);
      break;
    }
  }
  
  for (const pattern of commentPatterns) {
    const match = text.match(pattern);
    if (match) {
      engagement.comments = parseCount(match[1]);
      break;
    }
  }
  
  for (const pattern of sharePatterns) {
    const match = text.match(pattern);
    if (match) {
      engagement.shares = parseCount(match[1]);
      break;
    }
  }
  
  for (const pattern of savePatterns) {
    const match = text.match(pattern);
    if (match) {
      engagement.saves = parseCount(match[1]);
      break;
    }
  }
  
  return engagement;
}

// Parse comments from scraped content
export function parseComments(text: string): SocialMediaComment[] {
  const comments: SocialMediaComment[] = [];
  
  // Pattern to identify comment blocks (handle: comment text)
  const commentPattern = /@?([a-zA-Z0-9_\.]+)\s*[:\-]\s*(.+?)(?=@[a-zA-Z0-9_\.]+\s*[:\-]|$)/gs;
  
  let match;
  while ((match = commentPattern.exec(text)) !== null) {
    const authorHandle = match[1].toLowerCase();
    const commentText = match[2].trim();
    
    if (commentText.length > 5 && commentText.length < 500) {
      comments.push({
        authorHandle,
        text: commentText,
      });
    }
  }
  
  return comments.slice(0, 20); // Limit to top 20 comments
}

// Detect post type from URL or content
export function detectPostType(url: string, content: string): 'image' | 'video' | 'carousel' | 'reel' | 'story' {
  const urlLower = url.toLowerCase();
  const contentLower = content.toLowerCase();
  
  if (urlLower.includes('/reel/') || urlLower.includes('/reels/')) return 'reel';
  if (urlLower.includes('/stories/') || urlLower.includes('/story/')) return 'story';
  if (urlLower.includes('/tv/') || contentLower.includes('igtv')) return 'video';
  if (contentLower.includes('video') || contentLower.includes('watch')) return 'video';
  if (contentLower.includes('carousel') || contentLower.includes('swipe')) return 'carousel';
  
  return 'image';
}

// Extract author handle from URL
export function extractAuthorFromUrl(url: string, platform: string): string {
  const patterns: Record<string, RegExp> = {
    instagram: /instagram\.com\/([a-zA-Z0-9_\.]+)/,
    facebook: /facebook\.com\/([a-zA-Z0-9_\.]+)/,
    twitter: /(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/,
    linkedin: /linkedin\.com\/(?:in|company)\/([a-zA-Z0-9_-]+)/,
    tiktok: /tiktok\.com\/@([a-zA-Z0-9_\.]+)/,
  };
  
  const pattern = patterns[platform];
  if (pattern) {
    const match = url.match(pattern);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  
  return '';
}

// Create a structured post from raw scraped content
export function parsePostContent(
  rawText: string,
  url: string,
  platform: 'instagram' | 'facebook' | 'linkedin' | 'twitter' | 'tiktok'
): Partial<SocialMediaPost> {
  const authorHandle = extractAuthorFromUrl(url, platform);
  const mentions = extractMentions(rawText);
  const hashtags = extractHashtags(rawText);
  const engagement = parseEngagement(rawText);
  const eventDetails = extractEventDetails(rawText);
  const postType = detectPostType(url, rawText);
  
  return {
    platform,
    postUrl: url,
    authorHandle,
    caption: rawText,
    hashtags,
    mentions,
    mediaType: postType,
    engagement,
    eventDetails: eventDetails || undefined,
  };
}

// Keywords that indicate high-relevance content
export const SECURITY_KEYWORDS = [
  'protest', 'blockade', 'occupation', 'action', 'rally', 'march',
  'resistance', 'defend', 'defenders', 'frontlines', 'direct action',
  'shut down', 'stop', 'oppose', 'fight', 'resist'
];

export const PIPELINE_KEYWORDS = [
  'pipeline', 'lng', 'prgt', 'coastal gaslink', 'cgl', 'ksi lisims',
  'cedar lng', 'woodfibre lng', 'transmountain', 'tmx', 'line 3',
  'enbridge', 'tc energy', 'pembina'
];

export const INDIGENOUS_KEYWORDS = [
  'indigenous', 'first nation', 'land defenders', 'wet\'suwet\'en',
  'hereditary', 'unceded', 'territory', 'sovereignty', 'treaty',
  'reconciliation', 'undrip', 'land back'
];

// Check if content is high-priority security intelligence
export function isHighPriorityContent(text: string): boolean {
  const lowerText = text.toLowerCase();
  
  const hasSecurityKeyword = SECURITY_KEYWORDS.some(k => lowerText.includes(k));
  const hasPipelineKeyword = PIPELINE_KEYWORDS.some(k => lowerText.includes(k));
  const hasIndigenousKeyword = INDIGENOUS_KEYWORDS.some(k => lowerText.includes(k));
  
  // High priority if it mentions both security concern AND a target
  return (hasSecurityKeyword && hasPipelineKeyword) || 
         (hasSecurityKeyword && hasIndigenousKeyword);
}

// Extract publication date from social media content and text
export function extractPublicationDate(text: string, url: string = ''): Date | null {
  const now = new Date();
  
  // Pattern 1: Relative time in text (e.g., "2 hours ago", "3 days ago", "1 year ago")
  const relativeTimePatterns = [
    { pattern: /(\d+)\s*(?:second|sec)s?\s*ago/i, unit: 'seconds' },
    { pattern: /(\d+)\s*(?:minute|min)s?\s*ago/i, unit: 'minutes' },
    { pattern: /(\d+)\s*(?:hour|hr)s?\s*ago/i, unit: 'hours' },
    { pattern: /(\d+)\s*days?\s*ago/i, unit: 'days' },
    { pattern: /(\d+)\s*weeks?\s*ago/i, unit: 'weeks' },
    { pattern: /(\d+)\s*months?\s*ago/i, unit: 'months' },
    { pattern: /(\d+)\s*years?\s*ago/i, unit: 'years' },
  ];
  
  for (const { pattern, unit } of relativeTimePatterns) {
    const match = text.match(pattern);
    if (match) {
      const value = parseInt(match[1], 10);
      const date = new Date(now);
      switch (unit) {
        case 'seconds': date.setSeconds(date.getSeconds() - value); break;
        case 'minutes': date.setMinutes(date.getMinutes() - value); break;
        case 'hours': date.setHours(date.getHours() - value); break;
        case 'days': date.setDate(date.getDate() - value); break;
        case 'weeks': date.setDate(date.getDate() - (value * 7)); break;
        case 'months': date.setMonth(date.getMonth() - value); break;
        case 'years': date.setFullYear(date.getFullYear() - value); break;
      }
      return date;
    }
  }
  
  // Pattern 2: Absolute dates (e.g., "January 15, 2023", "Jan 15 2023", "2023-01-15")
  const absoluteDatePatterns = [
    // ISO format: 2023-01-15 or 2023/01/15
    /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/,
    // Month Day, Year: January 15, 2023
    /(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i,
    // Day Month Year: 15 January 2023
    /(\d{1,2})(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?),?\s+(\d{4})/i,
    // Short format: MM/DD/YYYY or DD/MM/YYYY
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/,
  ];
  
  for (const pattern of absoluteDatePatterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        const dateStr = match[0];
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime()) && parsed <= now) {
          return parsed;
        }
      } catch {
        continue;
      }
    }
  }
  
  // Pattern 3: Facebook-specific date formats (e.g., "March 15 at 3:30 PM")
  const fbDatePattern = /(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i;
  const fbMatch = text.match(fbDatePattern);
  if (fbMatch) {
    try {
      // Assume current year if not specified
      const dateStr = `${fbMatch[0]} ${now.getFullYear()}`;
      const parsed = new Date(dateStr);
      // If the date is in the future, it's probably from last year
      if (parsed > now) {
        parsed.setFullYear(parsed.getFullYear() - 1);
      }
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    } catch {
      // Ignore parsing errors
    }
  }
  
  return null;
}

// Calculate the age category of content
export type ContentAge = 'current' | 'recent' | 'dated' | 'historical';

export function categorizeContentAge(eventDate: Date | null, ingestedAt: Date = new Date()): ContentAge {
  if (!eventDate) return 'current'; // Unknown, assume current
  
  const diffMs = ingestedAt.getTime() - eventDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  
  if (diffDays <= 7) return 'current';      // Within the last week
  if (diffDays <= 30) return 'recent';      // Within the last month  
  if (diffDays <= 365) return 'dated';      // Within the last year
  return 'historical';                       // Older than a year
}

// Get a human-readable age description
export function getContentAgeDescription(eventDate: Date | null): string {
  if (!eventDate) return '';
  
  const now = new Date();
  const diffMs = now.getTime() - eventDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  
  const years = Math.floor(diffDays / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}