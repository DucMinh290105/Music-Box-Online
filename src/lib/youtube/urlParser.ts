/**
 * YouTube URL Parser & Normalizer
 * Supports:
 * - youtube.com/watch?v=VIDEO_ID
 * - youtu.be/VIDEO_ID
 * - youtube.com/shorts/VIDEO_ID
 * - youtube.com/live/VIDEO_ID
 * - youtube.com/embed/VIDEO_ID
 * - Raw 11-char video ID
 */
export function extractYouTubeId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  // 1. Raw 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    let urlStr = trimmed;
    if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
      urlStr = 'https://' + urlStr;
    }
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();

    // youtu.be/VIDEO_ID
    if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
      const id = url.pathname.slice(1).split(/[?#&]/)[0];
      if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }

    // youtube.com / m.youtube.com / www.youtube.com
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      // /watch?v=VIDEO_ID
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
        return v;
      }

      // /shorts/VIDEO_ID
      const shortsMatch = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];

      // /live/VIDEO_ID
      const liveMatch = url.pathname.match(/\/live\/([a-zA-Z0-9_-]{11})/);
      if (liveMatch) return liveMatch[1];

      // /embed/VIDEO_ID
      const embedMatch = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
      if (embedMatch) return embedMatch[1];
    }
  } catch {
    // If URL parsing fails, fallback to regex
  }

  // Fallback regex pattern matching
  const match = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/))([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}
