import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Link2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PlaylistTrack } from '@/lib/supabase';
import { getYouTubeThumb, isYouTube, isDirectAudio } from '@/lib/youtube';

type Props = {
  track: PlaylistTrack | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  audioRef: React.RefObject<HTMLAudioElement>;
};

export function PlayerBar({
  track,
  isPlaying,
  onTogglePlay,
  onNext,
  onPrev,
  currentTime,
  duration,
  onSeek,
  audioRef,
}: Props) {
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const prevVolume = useRef(0.8);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
  }, [volume, muted, audioRef]);

  const toggleMute = () => {
    if (muted) {
      setMuted(false);
      setVolume(prevVolume.current);
    } else {
      prevVolume.current = volume;
      setMuted(true);
    }
  };

  const fmt = (s: number) => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const thumb = track?.thumbnail_url || (track ? getYouTubeThumb(track.url) : null);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-neutral-800 bg-neutral-950/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        {/* Track info */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-800">
            {thumb ? (
              <img src={thumb} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Link2 className="h-5 w-5 text-neutral-600" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {track ? track.title || '제목 없음' : '재생 중인 곡 없음'}
            </p>
            <p className="truncate text-xs text-neutral-500">
              {track ? (isYouTube(track.url) ? 'YouTube' : isDirectAudio(track.url) ? '오디오 파일' : '링크') : ''}
            </p>
          </div>
        </div>

        {/* Controls + seek */}
        <div className="flex flex-[1.5] flex-col items-center gap-1">
          <div className="flex items-center gap-5">
            <button
              onClick={onPrev}
              disabled={!track}
              className="text-neutral-400 transition hover:text-white disabled:opacity-30"
            >
              <SkipBack className="h-5 w-5 fill-current" />
            </button>
            <button
              onClick={onTogglePlay}
              disabled={!track}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-900 transition hover:scale-105 disabled:opacity-30"
            >
              {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
            </button>
            <button
              onClick={onNext}
              disabled={!track}
              className="text-neutral-400 transition hover:text-white disabled:opacity-30"
            >
              <SkipForward className="h-5 w-5 fill-current" />
            </button>
          </div>
          <div className="flex w-full max-w-md items-center gap-2">
            <span className="w-10 text-right text-xs tabular-nums text-neutral-500">{fmt(currentTime)}</span>
            <div
              className="group relative h-1.5 flex-1 cursor-pointer rounded-full bg-neutral-700"
              onClick={(e) => {
                if (!duration) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                onSeek(pct * duration);
              }}
            >
              <div
                className="absolute left-0 top-0 h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${progress}%` }}
              />
              <div
                className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white opacity-0 transition group-hover:opacity-100"
                style={{ left: `calc(${progress}% - 6px)` }}
              />
            </div>
            <span className="w-10 text-xs tabular-nums text-neutral-500">{fmt(duration)}</span>
          </div>
        </div>

        {/* Volume */}
        <div className="hidden flex-1 items-center justify-end gap-2 sm:flex">
          <button onClick={toggleMute} className="text-neutral-400 transition hover:text-white">
            {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => {
              setVolume(parseFloat(e.target.value));
              setMuted(false);
            }}
            className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-neutral-700 accent-emerald-500"
          />
        </div>
      </div>
    </div>
  );
}
