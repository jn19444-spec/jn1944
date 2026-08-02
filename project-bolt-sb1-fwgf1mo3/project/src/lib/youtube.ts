export function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.slice(1) || null;
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || null;
    }
    return null;
  } catch {
    return null;
  }
}

export function getYouTubeThumb(url: string): string | null {
  const id = getYouTubeVideoId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

export function isYouTube(url: string): boolean {
  return getYouTubeVideoId(url) !== null;
}

export function isDirectAudio(url: string): boolean {
  return /\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i.test(url);
}
