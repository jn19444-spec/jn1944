import { Music, MessageSquare, Heart, Users } from 'lucide-react';
import type { Page } from '@/components/MenuBar';

type Props = {
  onNavigate: (page: Page) => void;
  trackCount: number;
};

export function HomePage({ onNavigate, trackCount }: Props) {
  return (
    <div className="px-6 pb-32 pt-8 md:px-10">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-neutral-800 bg-gradient-to-br from-neutral-900 via-neutral-900 to-emerald-950/40 p-8 md:p-12">
        <div className="relative z-10">
          <h1 className="text-3xl font-bold text-white md:text-4xl">
            +구구+ 팬 홈페이지
          </h1>
          <p className="mt-3 max-w-lg text-neutral-400">
            게시판에서 이야기를 나누고, 플레이리스트에서 음악을 들어요.
            링크만 있으면 언제든 노래를 추가할 수 있어요.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => onNavigate('playlist')}
              className="flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-emerald-400"
            >
              <Music className="h-4 w-4" />
              플레이리스트 듣기
            </button>
            <button
              onClick={() => onNavigate('board')}
              className="flex items-center gap-2 rounded-full border border-neutral-700 px-6 py-3 text-sm font-semibold text-neutral-300 transition hover:border-neutral-500 hover:text-white"
            >
              <MessageSquare className="h-4 w-4" />
              게시판 가기
            </button>
          </div>
        </div>
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
              <Music className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{trackCount}</p>
              <p className="text-sm text-neutral-500">등록된 곡</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10">
              <MessageSquare className="h-5 w-5 text-sky-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">게시판</p>
              <p className="text-sm text-neutral-500">자유 게시판</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10">
              <Heart className="h-5 w-5 text-rose-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">팬 공간</p>
              <p className="text-sm text-neutral-500">함께 즐겨요</p>
            </div>
          </div>
        </div>
      </div>

      {/* Feature cards */}
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div
          onClick={() => onNavigate('playlist')}
          className="group cursor-pointer rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6 transition hover:border-emerald-500/50"
        >
          <Music className="h-8 w-8 text-emerald-400" />
          <h3 className="mt-4 text-lg font-bold text-white">링크 플레이리스트</h3>
          <p className="mt-2 text-sm text-neutral-400">
            유튜브 링크나 오디오 파일 링크를 등록하면 음악 앱처럼 재생할 수 있어요. 재생/일시정지, 다음곡/이전곡, 볼륨 조절까지 다 가능해요.
          </p>
        </div>
        <div
          onClick={() => onNavigate('board')}
          className="group cursor-pointer rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6 transition hover:border-sky-500/50"
        >
          <Users className="h-8 w-8 text-sky-400" />
          <h3 className="mt-4 text-lg font-bold text-white">게시판</h3>
          <p className="mt-2 text-sm text-neutral-400">
            여러 게시판에서 글을 쓰고 사진을 올릴 수 있어요. 검색도 가능하고 비공개 게시판도 만들 수 있어요.
          </p>
        </div>
      </div>
    </div>
  );
}
