'use client';
import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import type { YouTubePlayerError } from '@/lib/youtube/types';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export interface YouTubePlayerProps {
  videoId: string;
  playbackStatus?: 'playing' | 'paused' | 'buffering' | 'ended' | 'idle';
  onStateChange?: (state: string, currentTime: number) => void;
  onError?: (error: YouTubePlayerError | null) => void;
  onReady?: () => void;
  personalVolume: number; // 0 - 100
  isMuted: boolean;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
}

export interface YouTubePlayerHandle {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  loadVideoById: (id: string, startSeconds?: number) => void;
}

let ytInstanceCounter = 0;

const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(
  function YouTubePlayer(
    {
      videoId,
      playbackStatus = 'paused',
      onStateChange,
      onError,
      onReady,
      personalVolume,
      isMuted,
      onTimeUpdate,
    },
    ref
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const playerRef = useRef<any>(null);
    const [isPlayerReady, setIsPlayerReady] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [autoplayBlocked, setAutoplayBlocked] = useState(false);
    const timeIntervalRef = useRef<any>(null);
    const loadedVideoIdRef = useRef<string>(videoId);
    const desiredStatusRef = useRef(playbackStatus);
    desiredStatusRef.current = playbackStatus;

    const volumeRef = useRef({ personalVolume, isMuted });
    volumeRef.current = { personalVolume, isMuted };

    const callbacksRef = useRef({ onStateChange, onError, onReady, onTimeUpdate });
    callbacksRef.current = { onStateChange, onError, onReady, onTimeUpdate };

    useImperativeHandle(
      ref,
      () => ({
        play: () => {
          try {
            playerRef.current?.playVideo?.();
          } catch {}
        },
        pause: () => {
          try {
            playerRef.current?.pauseVideo?.();
          } catch {}
        },
        seekTo: (seconds: number) => {
          try {
            playerRef.current?.seekTo?.(Math.max(0, seconds), true);
          } catch {}
        },
        getCurrentTime: () => {
          try {
            return playerRef.current?.getCurrentTime?.() || 0;
          } catch {
            return 0;
          }
        },
        getDuration: () => {
          try {
            return playerRef.current?.getDuration?.() || 0;
          } catch {
            return 0;
          }
        },
        loadVideoById: (id: string, startSeconds = 0) => {
          try {
            setLoadError(null);
            callbacksRef.current.onError?.(null);
            loadedVideoIdRef.current = id;
            playerRef.current?.loadVideoById?.({ videoId: id, startSeconds });
          } catch {}
        },
      }),
      []
    );

    // Load YouTube IFrame API script & mount fresh DOM target inside hostRef
    useEffect(() => {
      if (typeof window === 'undefined') return;
      let cancelled = false;

      if (!window.YT) {
        const existingScript = document.querySelector(
          'script[src="https://www.youtube.com/iframe_api"]'
        );
        if (!existingScript) {
          const tag = document.createElement('script');
          tag.src = 'https://www.youtube.com/iframe_api';
          const firstScriptTag = document.getElementsByTagName('script')[0];
          if (firstScriptTag?.parentNode) {
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
          } else {
            document.head.appendChild(tag);
          }
        }
      }

      const initPlayer = () => {
        if (cancelled) return;
        if (!window.YT || !window.YT.Player) return;
        if (playerRef.current || !hostRef.current) return;

        try {
          hostRef.current.innerHTML = '';
          const mountDiv = document.createElement('div');
          const domId = `yt-player-dom-${++ytInstanceCounter}`;
          mountDiv.id = domId;
          mountDiv.style.width = '100%';
          mountDiv.style.height = '100%';
          hostRef.current.appendChild(mountDiv);

          playerRef.current = new window.YT.Player(domId, {
            width: '100%',
            height: '100%',
            videoId: loadedVideoIdRef.current || 'K4DyBUG242c',
            playerVars: {
              autoplay: desiredStatusRef.current === 'playing' ? 1 : 0,
              controls: 0,
              disablekb: 1,
              modestbranding: 1,
              rel: 0,
              playsinline: 1,
              fs: 0,
              iv_load_policy: 3,
              enablejsapi: 1,
              origin: window.location.origin,
            },
            events: {
              onReady: (event: any) => {
                if (cancelled) return;
                setIsPlayerReady(true);
                try {
                  event.target.setVolume(volumeRef.current.personalVolume);
                  if (volumeRef.current.isMuted) event.target.mute();
                  else event.target.unMute();
                  if (desiredStatusRef.current === 'playing') {
                    event.target.playVideo();
                  }
                } catch {}
                callbacksRef.current.onReady?.();
              },
              onStateChange: (event: any) => {
                if (cancelled) return;
                const stateCode = event.data;
                let stateName = 'UNKNOWN';
                if (stateCode === 1) {
                  stateName = 'PLAYING';
                  setAutoplayBlocked(false);
                  setLoadError(null);
                } else if (stateCode === 2) {
                  stateName = 'PAUSED';
                } else if (stateCode === 3) {
                  stateName = 'BUFFERING';
                } else if (stateCode === 0) {
                  stateName = 'ENDED';
                } else if (stateCode === 5) {
                  stateName = 'CUED';
                } else if (stateCode === -1) {
                  stateName = 'UNSTARTED';
                }

                const curTime = event.target.getCurrentTime
                  ? event.target.getCurrentTime()
                  : 0;
                callbacksRef.current.onStateChange?.(stateName, curTime);
              },
              onError: (event: any) => {
                if (cancelled) return;
                const code = event.data;
                let msg = 'Lỗi không xác định khi phát video.';
                if (code === 2) msg = 'URL hoặc ID video không hợp lệ.';
                else if (code === 5) msg = 'Lỗi trình phát HTML5 của YouTube.';
                else if (code === 100)
                  msg = 'Video không tồn tại hoặc đã chuyển sang riêng tư.';
                else if (code === 101 || code === 150)
                  msg = 'Video này bị chủ sở hữu chặn nhúng trên web ngoài.';

                setLoadError(msg);
                callbacksRef.current.onError?.({ code, message: msg });
              },
            },
          });
        } catch (err) {
          console.error('Failed to instantiate YT.Player:', err);
        }
      };

      if (window.YT && window.YT.Player) {
        initPlayer();
      } else {
        const prevCallback = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          if (prevCallback) prevCallback();
          initPlayer();
        };
      }

      return () => {
        cancelled = true;
        setIsPlayerReady(false);
        if (playerRef.current && playerRef.current.destroy) {
          try {
            playerRef.current.destroy();
          } catch {}
        }
        playerRef.current = null;
        if (hostRef.current) {
          hostRef.current.innerHTML = '';
        }
      };
    }, []);

    // Update video when videoId changes
    useEffect(() => {
      if (!isPlayerReady || !playerRef.current || !videoId) return;
      if (loadedVideoIdRef.current === videoId) return;

      loadedVideoIdRef.current = videoId;
      setLoadError(null);
      callbacksRef.current.onError?.(null);

      try {
        if (desiredStatusRef.current === 'playing') {
          playerRef.current.loadVideoById(videoId);
        } else {
          playerRef.current.cueVideoById(videoId);
        }
      } catch (e) {
        console.warn('loadVideoById caught:', e);
      }
    }, [videoId, isPlayerReady]);

    // Sync play / pause status from room state
    useEffect(() => {
      if (!isPlayerReady || !playerRef.current) return;
      try {
        const playerState = playerRef.current.getPlayerState
          ? playerRef.current.getPlayerState()
          : -1;
        if (playbackStatus === 'playing' && playerState !== 1 && playerState !== 3) {
          playerRef.current.playVideo();
        } else if (playbackStatus === 'paused' && playerState === 1) {
          playerRef.current.pauseVideo();
        }
      } catch {}
    }, [playbackStatus, isPlayerReady]);

    // Volume & Mute sync
    useEffect(() => {
      if (!isPlayerReady || !playerRef.current) return;
      try {
        playerRef.current.setVolume(personalVolume);
        if (isMuted || personalVolume <= 0) {
          playerRef.current.mute();
        } else {
          playerRef.current.unMute();
        }
      } catch {}
    }, [personalVolume, isMuted, isPlayerReady]);

    // Periodic time update
    useEffect(() => {
      if (!isPlayerReady) return;
      timeIntervalRef.current = setInterval(() => {
        if (
          playerRef.current &&
          playerRef.current.getCurrentTime &&
          playerRef.current.getDuration
        ) {
          const cur = playerRef.current.getCurrentTime() || 0;
          const dur = playerRef.current.getDuration() || 0;
          callbacksRef.current.onTimeUpdate?.(cur, dur);
        }
      }, 250);

      return () => clearInterval(timeIntervalRef.current);
    }, [isPlayerReady]);

    return (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          aspectRatio: '16 / 9',
          background: '#120d1a',
          overflow: 'hidden',
        }}
      >
        <div ref={hostRef} style={{ width: '100%', height: '100%' }} />

        {!isPlayerReady && !loadError && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(22, 16, 32, 0.92)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#f3e8ff',
              gap: 10,
              zIndex: 10,
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            <span>♫ Đang khởi tạo màn hình YouTube TV...</span>
          </div>
        )}

        {loadError && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(65, 18, 38, 0.94)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              gap: 6,
              zIndex: 20,
              color: '#ffe4ef',
            }}
          >
            <span style={{ fontSize: 26 }}>⚠️</span>
            <strong style={{ fontSize: 14 }}>Không thể phát video này</strong>
            <span style={{ fontSize: 11.5, opacity: 0.9, maxWidth: 360 }}>{loadError}</span>
          </div>
        )}

        {autoplayBlocked && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.78)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 20,
              gap: 8,
              color: '#fff',
            }}
          >
            <span style={{ fontSize: 12 }}>Trình duyệt tạm chặn tự động phát tiếng.</span>
            <button
              onClick={() => {
                if (playerRef.current?.playVideo) {
                  playerRef.current.playVideo();
                  setAutoplayBlocked(false);
                }
              }}
              style={{
                padding: '6px 14px',
                background: '#ff7ea5',
                color: '#fff',
                border: 0,
                borderRadius: 8,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              ▶ Bấm để phát ngay
            </button>
          </div>
        )}
      </div>
    );
  }
);

export default YouTubePlayer;
