import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface VideoSource {
  label: string;
  url: string;
}

interface UseVideoOptions {
  src: string;
  sources?: VideoSource[];
  isMobile?: boolean;
}

export const useVideo = (externalWrapperRef?: RefObject<HTMLElement | null>, options?: UseVideoOptions) => {
  const internalWrapperRef = useRef<HTMLElement>(null);
  const wrapperRef = externalWrapperRef ?? internalWrapperRef;
  const mediaRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isIdle, setIsIdle] = useState(false);

  const hasSources = options?.sources && options.sources.length > 1;
  const initialLabel = hasSources ? options.sources![0].label : 'Auto';
  const [activeSrc, setActiveSrc] = useState(hasSources ? options.sources![0].url : options?.src ?? '');
  const [quality, setQuality] = useState(initialLabel);
  const [qualityOpen, setQualityOpen] = useState(false);

  const idleTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isIntersectingRef = useRef(false);

  // Sync src prop
  useEffect(() => {
    if (!hasSources && options?.src) {
      setActiveSrc(options.src);
    }
  }, [options?.src, hasSources]);

  // --- Play/Pause ---

  const togglePlay = useCallback(() => {
    if (!mediaRef.current) return;
    if (mediaRef.current.paused) {
      if (mediaRef.current.ended || mediaRef.current.currentTime >= mediaRef.current.duration) {
        mediaRef.current.currentTime = 0;
      }
      mediaRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      mediaRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  // Sync isPlaying with native events (covers autoPlay, IntersectionObserver triggers, etc.)
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    media.addEventListener('play', onPlay);
    media.addEventListener('pause', onPause);

    // Sync initial state — autoplay may have already fired before this effect
    if (!media.paused) setIsPlaying(true);

    return () => {
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onPause);
    };
  }, []);

  // --- Metadata ---

  const handleLoadedMetadata = useCallback(() => {
    if (mediaRef.current) {
      setDuration(mediaRef.current.duration);
    }
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  // --- Time tracking (rAF loop) ---

  const isDraggingRef = useRef(false);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (isPlaying) {
      const update = () => {
        if (mediaRef.current && !isDraggingRef.current) {
          setCurrentTime(mediaRef.current.currentTime);
        }
        rafRef.current = requestAnimationFrame(update);
      };
      rafRef.current = requestAnimationFrame(update);
    } else {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
      if (mediaRef.current && !isDraggingRef.current) {
        setCurrentTime(mediaRef.current.currentTime);
      }
    }
    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);

  // --- Slider ---

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setCurrentTime(val);
    if (mediaRef.current) {
      mediaRef.current.currentTime = val;
    }
  }, []);

  const handleSliderPointerDown = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handleSliderPointerUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  // --- Seek indicator ---

  const [seekIndicator, setSeekIndicator] = useState<'forward' | 'backward' | null>(null);
  const seekTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const triggerSeekIndicator = useCallback((dir: 'forward' | 'backward') => {
    setSeekIndicator(dir);
    if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
    seekTimeoutRef.current = setTimeout(() => setSeekIndicator(null), 600);
  }, []);

  // --- Volume ---

  const changeVolume = useCallback((newVolume: number) => {
    if (!mediaRef.current) return;
    const clamped = Math.max(0, Math.min(1, newVolume));
    mediaRef.current.volume = clamped;
    setVolume(clamped);
    if (clamped > 0 && isMuted) {
      setIsMuted(false);
      mediaRef.current.muted = false;
    }
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    if (!mediaRef.current) return;
    const newMuted = !isMuted;
    mediaRef.current.muted = newMuted;
    setIsMuted(newMuted);
    if (!newMuted && volume === 0) changeVolume(1);
  }, [isMuted, volume, changeVolume]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    changeVolume(Number(e.target.value));
  }, [changeVolume]);

  // --- Fullscreen ---

  const toggleFullscreen = useCallback(() => {
    const el = wrapperRef?.current || mediaRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, [wrapperRef]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const el = wrapperRef?.current || mediaRef.current;
      setIsFullscreen(!!document.fullscreenElement && document.fullscreenElement === el);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [wrapperRef]);

  // --- Idle (auto-hide UI in fullscreen) ---

  const isFullscreenRef = useRef(isFullscreen);
  isFullscreenRef.current = isFullscreen;

  const resetIdle = useCallback(() => {
    setIsIdle(false);
    if (idleTimeout.current) clearTimeout(idleTimeout.current);
    if (isFullscreenRef.current) {
      idleTimeout.current = setTimeout(() => setIsIdle(true), 2000);
    }
  }, []);

  useEffect(() => {
    if (isFullscreen) {
      resetIdle();
      const handleActivity = () => resetIdle();
      window.addEventListener('mousemove', handleActivity);
      window.addEventListener('keydown', handleActivity);
      return () => {
        window.removeEventListener('mousemove', handleActivity);
        window.removeEventListener('keydown', handleActivity);
        if (idleTimeout.current) clearTimeout(idleTimeout.current);
      };
    } else {
      setIsIdle(false);
      if (idleTimeout.current) clearTimeout(idleTimeout.current);
    }
  }, [isFullscreen, resetIdle]);

  // --- Autoplay on viewport intersection ---

  useEffect(() => {
    const el = wrapperRef?.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        isIntersectingRef.current = entry.isIntersecting;
        if (entry.isIntersecting) {
          if (mediaRef.current && mediaRef.current.paused) {
            mediaRef.current.play().catch(() => {});
          }
        } else {
          if (mediaRef.current && !mediaRef.current.paused) {
            mediaRef.current.pause();
          }
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [wrapperRef]);

  const handleCanPlay = useCallback(() => {
    setIsBuffering(false);
    if (isIntersectingRef.current && mediaRef.current && mediaRef.current.paused) {
      mediaRef.current.play().catch(() => {});
    }
  }, []);

  const handleWaiting = useCallback(() => setIsBuffering(true), []);
  const handlePlaying = useCallback(() => setIsBuffering(false), []);

  // --- Auto-fullscreen on landscape (mobile) ---

  useEffect(() => {
    if (!options?.isMobile) return;

    const mq = window.matchMedia('(orientation: landscape)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches && !isFullscreen) {
        toggleFullscreen();
      } else if (!e.matches && isFullscreen) {
        toggleFullscreen();
      }
    };

    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
    } else {
      // @ts-ignore — older Safari
      mq.addListener(handler);
    }
    return () => {
      if (mq.removeEventListener) {
        mq.removeEventListener('change', handler);
      } else {
        // @ts-ignore
        mq.removeListener(handler);
      }
    };
  }, [options?.isMobile, isFullscreen, toggleFullscreen]);

  // --- Click/Touch handlers ---

  // Desktop: click toggles play or resets idle
  const handleVideoClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // On mobile, touch handler takes over — ignore click to avoid double-fire
    if (options?.isMobile) return;

    if (isFullscreen && isIdle) {
      resetIdle();
    } else {
      togglePlay();
    }
  }, [options?.isMobile, isFullscreen, isIdle, resetIdle, togglePlay]);

  // Mobile: touchEnd for instant response (no 300ms click delay)
  const handleVideoTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!options?.isMobile) return;
    e.preventDefault(); // prevent subsequent click
    e.stopPropagation();

    if (!isFullscreen) {
      toggleFullscreen();
    } else {
      // Toggle UI visibility
      if (isIdle) {
        resetIdle();
      } else {
        setIsIdle(true);
        if (idleTimeout.current) clearTimeout(idleTimeout.current);
      }
    }
  }, [options?.isMobile, isFullscreen, isIdle, resetIdle, toggleFullscreen]);

  // --- Quality switch ---

  const handleQualityChange = useCallback((url: string, label: string) => {
    if (mediaRef.current) {
      const time = mediaRef.current.currentTime;
      const wasPlaying = !mediaRef.current.paused;

      setActiveSrc(url);
      setQuality(label);
      setQualityOpen(false);
      setIsBuffering(true);

      const onLoaded = () => {
        if (mediaRef.current) {
          mediaRef.current.currentTime = time;
          if (wasPlaying) mediaRef.current.play().catch(() => {});
        }
        mediaRef.current?.removeEventListener('loadeddata', onLoaded);
      };
      mediaRef.current.addEventListener('loadeddata', onLoaded);
    }
  }, []);

  // --- Keyboard shortcuts (fullscreen only) ---

  useEffect(() => {
    if (!isFullscreen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (!mediaRef.current) return;
      switch (e.code) {
        case 'Space':
        case 'KeyK':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          mediaRef.current.currentTime = Math.max(0, mediaRef.current.currentTime - 5);
          setCurrentTime(mediaRef.current.currentTime);
          triggerSeekIndicator('backward');
          break;
        case 'ArrowRight':
          e.preventDefault();
          mediaRef.current.currentTime = Math.min(mediaRef.current.duration, mediaRef.current.currentTime + 5);
          setCurrentTime(mediaRef.current.currentTime);
          triggerSeekIndicator('forward');
          break;
        case 'ArrowUp':
          e.preventDefault();
          changeVolume(volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeVolume(volume - 0.1);
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMute();
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isFullscreen, togglePlay, changeVolume, volume, toggleMute, triggerSeekIndicator]);

  // --- Format ---

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return {
    mediaRef,
    wrapperRef,
    // Playback state
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    isFullscreen,
    isBuffering,
    isIdle,
    seekIndicator,
    // Source / quality
    activeSrc,
    quality,
    qualityOpen,
    setQualityOpen,
    hasSources,
    // Actions
    togglePlay,
    toggleMute,
    toggleFullscreen,
    changeVolume,
    resetIdle,
    // Handlers (pass directly to JSX)
    handleLoadedMetadata,
    handleEnded,
    handleSliderChange,
    handleSliderPointerDown,
    handleSliderPointerUp,
    handleVolumeChange,
    handleVideoClick,
    handleVideoTouchEnd,
    handleQualityChange,
    handleCanPlay,
    handleWaiting,
    handlePlaying,
    formatTime,
  };
};
