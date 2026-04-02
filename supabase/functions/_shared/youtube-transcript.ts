export async function extractYouTubeTranscript(videoUrl: string): Promise<string | null> {
  try {
    // Extract video ID
    const videoId = videoUrl.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId) return null;

    // Fetch auto-generated transcript via YouTube's timedtext API
    const listUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const pageResp = await fetch(listUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await pageResp.text();

    // Extract caption track URL from page source
    const captionMatch = html.match(/"captionTracks":\[{"baseUrl":"([^"]+)"/);
    if (!captionMatch) return null;

    const captionUrl = captionMatch[1].replace(/\\u0026/g, '&');
    const captionResp = await fetch(captionUrl);
    const captionXml = await captionResp.text();

    // Parse XML transcript
    const text = captionXml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    return text.substring(0, 8000); // Cap at 8000 chars
  } catch {
    return null;
  }
}
