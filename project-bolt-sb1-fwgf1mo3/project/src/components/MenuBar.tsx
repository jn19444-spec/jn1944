import { Home, Music, MessageSquare, Menu, X } from 'lucide-react';
import { useState } from 'react';

export type Page = 'home' | 'playlist' | 'board';

type Props = {
  currentPage: Page;
  onNavigate: (page: Page) => void;
};

const navItems: { id: Page; label: string; icon: typeof Home }[] = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'playlist', label: '플레이리스트', icon: Music },
  { id: 'board', label: '게시판', icon: MessageSquare },
];

export function MenuBar({ currentPage, onNavigate }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-emerald-400">+구구+</span>
          <span className="hidden text-xs text-neutral-500 sm:inline">팬 홈페이지</span>
        </div>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                  active
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Mobile toggle */}
        <button
          onClick={() => setMobileOpen((s) => !s)}
          className="rounded-lg p-2 text-neutral-400 transition hover:bg-neutral-800 hover:text-white md:hidden"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <nav className="flex flex-col gap-1 border-t border-neutral-800 px-4 py-3 md:hidden">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.id);
                  setMobileOpen(false);
                }}
                className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                  active
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
}
