// YouTube IFrame API type declarations
// Minimal types for the YouTube IFrame Player API used in this project.

interface YT {
  PlayerState: {
    UNSTARTED: -1;
    ENDED: 0;
    PLAYING: 1;
    PAUSED: 2;
    BUFFERING: 3;
    CUED: 5;
  };
  Player: YT.Player;
}

declare namespace YT {
  interface Player {
    loadVideoById(videoId: string): void;
    playVideo(): void;
    pauseVideo(): void;
    stopVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    getCurrentTime(): number;
    getDuration(): number;
    setVolume(volume: number): void;
    getVolume(): number;
    mute(): void;
    unMute(): void;
    destroy(): void;
  }

  interface PlayerOptions {
    width?: string | number;
    height?: string | number;
    videoId?: string;
    playerVars?: Record<string, unknown>;
    events?: {
      onReady?: (event: { target: Player }) => void;
      onStateChange?: (event: OnStateChangeEvent) => void;
      onError?: (event: { data: number; target: Player }) => void;
    };
  }

  interface OnStateChangeEvent {
    data: number;
    target: Player;
  }

  // Constructor signature
  interface PlayerConstructor {
    new (element: HTMLElement | string, options: PlayerOptions): Player;
  }

  interface Player extends PlayerConstructor {}
}

interface Window {
  YT: typeof YT;
  onYouTubeIframeAPIReady?: () => void;
}
