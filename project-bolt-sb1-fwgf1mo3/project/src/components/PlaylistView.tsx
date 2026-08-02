import { Play, Plus, Trash2, Music, Link2, X } from 'lucide-react';
import { useState } from 'react';
import type { PlaylistTrack } from '@/lib/supabase';
import { getYouTubeThumb, isYouTube, isDirectAudio } from '@/lib/youtube';

type Props = {
  tracks: PlaylistTrack[];
  currentTrackId: string | null;
  isPlaying: boolean;
  onSelect: (track: PlaylistTrack) => void;
  onAdd: (title: string, url: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  canManage: boolean;
};

export function PlaylistView({
  tracks,
  currentTrackId,
  isPlaying,
  onSelect,
  onAdd,
  onDelete,
  canManage,
}: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError('링크를 입력해주세요.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onAdd(title.trim(), url.trim());
      setTitle('');
      setUrl('');
      setShowAdd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '등록에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="px-6 pb-32 pt-6 md:px-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">플레이리스트</h2>
          <p className="mt-1 text-sm text-neutral-400">
            {tracks.length}곡 · 링크로 노래를 추가하고 재생할 수 있어요
          </p>
        </div>
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-emerald-400"
        >
          <Plus className="h-4 w-4" />
          노래 추가
        </button>
      </div>

      {showAdd && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5"
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-300">새 노래 링크 등록</h3>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="text-neutral-500 transition hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="노래 제목 (선택)"
              className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="유튜브 / 오디오 링크"
              className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-emerald-400 disabled:opacity-50"
            >
              {submitting ? '등록 중...' : '등록'}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
          <p className="mt-2 text-xs text-neutral-500">
            유튜브 링크, 직접 오디오 파일(mp3, wav, ogg 등) 링크 모두 가능해요.
          </p>
        </form>
      )}

      {tracks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Music className="mb-4 h-12 w-12 text-neutral-700" />
          <p className="text-neutral-500">아직 등록된 노래가 없어요.</p>
          <p className="text-sm text-neutral-600">위쪽 "노래 추가" 버튼으로 링크를 등록해보세요.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {tracks.map((track) => {
            const thumb = track.thumbnail_url || getYouTubeThumb(track.url);
            const isActive = track.id === currentTrackId;
            const playable = isYouTube(track.url) || isDirectAudio(track.url);
            return (
              <div
                key={track.id}
                onClick={() => playable && onSelect(track)}
                className={`group relative cursor-pointer overflow-hidden rounded-xl border bg-neutral-900 transition ${
                  isActive
                    ? 'border-emerald-500 ring-1 ring-emerald-500/50'
                    : 'border-neutral-800 hover:border-neutral-600'
                }`}
              >
                <div className="relative aspect-video w-full overflow-hidden bg-neutral-800">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={track.title}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Link2 className="h-8 w-8 text-neutral-600" />
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition group-hover:opacity-100">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-neutral-900">
                      <Play className="h-5 w-5 fill-current" />
                    </div>
                  </div>
                  {isActive && isPlaying && (
                    <div className="absolute bottom-2 left-2 flex items-end gap-0.5">
                      <span className="h-3 w-1 animate-pulse rounded-full bg-emerald-400" />
                      <span className="h-4 w-1 animate-pulse rounded-full bg-emerald-400" style={{ animationDelay: '0.15s' }} />
                      <span className="h-2 w-1 animate-pulse rounded-full bg-emerald-400" style={{ animationDelay: '0.3s' }} />
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-semibold text-white">{track.title || track.url}</p>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    {isYouTube(track.url) ? 'YouTube' : isDirectAudio(track.url) ? '오디오 파일' : '링크'}
                  </p>
                </div>
                {canManage && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(track.id);
                    }}
                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-neutral-400 opacity-0 transition hover:bg-rose-500 hover:text-white group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
