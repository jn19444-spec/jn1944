import { useCallback, useEffect, useRef, useState } from 'react';
import { MenuBar, type Page } from '@/components/MenuBar';
import { HomePage } from '@/components/HomePage';
import { PlaylistView } from '@/components/PlaylistView';
import { PlayerBar } from '@/components/PlayerBar';
import { supabase, type PlaylistTrack } from '@/lib/supabase';
import { getYouTubeVideoId, isYouTube, isDirectAudio } from '@/lib/youtube';

declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [currentTrack, setCurrentTrack] = useState<PlaylistTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);

  const audioRef = useRef<HTMLAudioElement>(null);
  const ytPlayerRef = useRef<YT.Player | null>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const ytReadyRef = useRef(false);
  const pendingPlayRef = useRef(false);
  const timeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const canManage = true;

  // ---------- Load tracks ----------
  const loadTracks = useCallback(async () => {
    const { data, error } = await supabase
      .from('playlist')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) {
      console.error('Failed to load playlist:', error.message);
      return;
    }
    setTracks((data || []) as PlaylistTrack[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  // ---------- YouTube IFrame API ----------
  useEffect(() => {
    if (window.YT && window.YT.Player) {
      return;
    }
    if (!document.getElementById('yt-iframe-api')) {
      const tag = document.createElement('script');
      tag.id = 'yt-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
    window.onYouTubeIframeAPIReady = () => {
      // API ready — player created on demand
    };
  }, []);

  // ---------- Time tracking ----------
  useEffect(() => {
    if (isPlaying) {
      timeTimerRef.current = setInterval(() => {
        if (currentTrack && isYouTube(currentTrack.url) && ytPlayerRef.current && ytReadyRef.current) {
          try {
            setCurrentTime(ytPlayerRef.current.getCurrentTime() || 0);
            setDuration(ytPlayerRef.current.getDuration() || 0);
          } catch {
            // player not ready yet
          }
        }
      }, 500);
    } else {
      if (timeTimerRef.current) {
        clearInterval(timeTimerRef.current);
        timeTimerRef.current = null;
      }
    }
    return () => {
      if (timeTimerRef.current) clearInterval(timeTimerRef.current);
    };
  }, [isPlaying, currentTrack]);

  // ---------- Create YT player when needed ----------
  const ensureYtPlayer = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (ytPlayerRef.current && ytReadyRef.current) {
        resolve();
        return;
      }
      const checkAndCreate = () => {
        if (!window.YT || !window.YT.Player) {
          setTimeout(checkAndCreate, 200);
          return;
        }
        if (ytContainerRef.current && !ytPlayerRef.current) {
          ytPlayerRef.current = new window.YT.Player(ytContainerRef.current, {
            height: '0',
            width: '0',
            videoId: '',
            playerVars: { autoplay: 0, controls: 0 },
            events: {
              onReady: () => {
                ytReadyRef.current = true;
                resolve();
              },
              onStateChange: (e: YT.OnStateChangeEvent) => {
                if (e.data === YT.PlayerState.PLAYING) {
                  setIsPlaying(true);
                  setDuration(ytPlayerRef.current?.getDuration() || 0);
                } else if (e.data === YT.PlayerState.PAUSED) {
                  setIsPlaying(false);
                } else if (e.data === YT.PlayerState.ENDED) {
                  setIsPlaying(false);
                  handleNext();
                }
              },
            },
          });
        } else if (ytReadyRef.current) {
          resolve();
        }
      };
      checkAndCreate();
    });
  }, []);

  // ---------- Play track ----------
  const playTrack = useCallback(
    async (track: PlaylistTrack) => {
      setCurrentTrack(track);
      setIsPlaying(true);
      pendingPlayRef.current = true;

      if (isYouTube(track.url)) {
        const videoId = getYouTubeVideoId(track.url);
        if (!videoId) return;
        await ensureYtPlayer();
        if (audioRef.current) {
          audioRef.current.pause();
        }
        if (ytPlayerRef.current && ytReadyRef.current) {
          ytPlayerRef.current.loadVideoById(videoId);
          ytPlayerRef.current.playVideo();
        }
        pendingPlayRef.current = false;
      } else if (isDirectAudio(track.url)) {
        if (ytPlayerRef.current && ytReadyRef.current) {
          ytPlayerRef.current.pauseVideo();
        }
        if (audioRef.current) {
          audioRef.current.src = track.url;
          audioRef.current.play().catch(() => {
            setIsPlaying(false);
          });
        }
        pendingPlayRef.current = false;
      }
    },
    [ensureYtPlayer],
  );

  // ---------- Controls ----------
  const togglePlay = useCallback(() => {
    if (!currentTrack) return;
    if (isYouTube(currentTrack.url) && ytPlayerRef.current && ytReadyRef.current) {
      if (isPlaying) {
        ytPlayerRef.current.pauseVideo();
      } else {
        ytPlayerRef.current.playVideo();
      }
    } else if (isDirectAudio(currentTrack.url) && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(() => {});
      }
    }
  }, [currentTrack, isPlaying]);

  const handleNext = useCallback(() => {
    if (!currentTrack || tracks.length === 0) return;
    const idx = tracks.findIndex((t) => t.id === currentTrack.id);
    const next = tracks[(idx + 1) % tracks.length];
    playTrack(next);
  }, [currentTrack, tracks, playTrack]);

  const handlePrev = useCallback(() => {
    if (!currentTrack || tracks.length === 0) return;
    const idx = tracks.findIndex((t) => t.id === currentTrack.id);
    const prev = tracks[(idx - 1 + tracks.length) % tracks.length];
    playTrack(prev);
  }, [currentTrack, tracks, playTrack]);

  const handleSeek = useCallback(
    (time: number) => {
      if (currentTrack && isYouTube(currentTrack.url) && ytPlayerRef.current && ytReadyRef.current) {
        ytPlayerRef.current.seekTo(time, true);
        setCurrentTime(time);
      } else if (currentTrack && isDirectAudio(currentTrack.url) && audioRef.current) {
        audioRef.current.currentTime = time;
        setCurrentTime(time);
      }
    },
    [currentTrack],
  );

  // ---------- Audio element events ----------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onDur = () => setDuration(audio.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      handleNext();
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onDur);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onDur);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [handleNext]);

  // ---------- CRUD ----------
  const addTrack = useCallback(
    async (title: string, url: string) => {
      let cleanUrl = url;
      if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = 'https://' + cleanUrl;
      const sortOrder = tracks.length > 0 ? Math.max(...tracks.map((t) => t.sort_order)) + 1 : 0;
      const { error } = await supabase.from('playlist').insert({
        title: title || cleanUrl,
        url: cleanUrl,
        sort_order: sortOrder,
      });
      if (error) throw new Error('등록 실패: ' + error.message);
      await loadTracks();
    },
    [tracks, loadTracks],
  );

  const deleteTrack = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('playlist').delete().eq('id', id);
      if (error) {
        alert('삭제 실패: ' + error.message);
        return;
      }
      if (currentTrack?.id === id) {
        setCurrentTrack(null);
        setIsPlaying(false);
        if (ytPlayerRef.current && ytReadyRef.current) ytPlayerRef.current.stopVideo();
        if (audioRef.current) audioRef.current.pause();
      }
      await loadTracks();
    },
    [currentTrack, loadTracks],
  );

  const trackCount = tracks.length;

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <MenuBar currentPage={page} onNavigate={setPage} />

      <main>
        {page === 'home' && <HomePage onNavigate={setPage} trackCount={trackCount} />}

        {page === 'playlist' && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-32 text-neutral-500">
                불러오는 중...
              </div>
            ) : (
              <PlaylistView
                tracks={tracks}
                currentTrackId={currentTrack?.id ?? null}
                isPlaying={isPlaying}
                onSelect={playTrack}
                onAdd={addTrack}
                onDelete={deleteTrack}
                canManage={canManage}
              />
            )}
          </>
        )}

        {page === 'board' && (
          <iframe
            src="/board.html"
            title="게시판"
            className="h-[calc(100vh-64px)] w-full border-0"
          />
        )}
      </main>

      {/* Hidden YT container + audio element */}
      <div className="hidden">
        <div ref={ytContainerRef} />
      </div>
      <audio ref={audioRef} className="hidden" />

      <PlayerBar
        track={currentTrack}
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
        onNext={handleNext}
        onPrev={handlePrev}
        currentTime={currentTime}
        duration={duration}
        onSeek={handleSeek}
        audioRef={audioRef}
      />
    </div>
  );
}
