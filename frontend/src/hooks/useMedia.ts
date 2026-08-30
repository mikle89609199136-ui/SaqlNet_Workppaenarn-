import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export const useMedia = (wrapperRef?: RefObject<HTMLElement | null>) => {
  const mediaRef = useRef<HTMLMediaElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  const handleLoadedMetadata = useCallback(() => {
    if (mediaRef.current) {
      setDuration(mediaRef.current.duration);
    }
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

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

  const [seekIndicator, setSeekIndicator] = useState<'forward' | 'backward' | null>(null);
  const seekTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const triggerSeekIndicator = useCallback((dir: 'forward' | 'backward') => {
    setSeekIndicator(dir);
    if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
    seekTimeoutRef.current = setTimeout(() => {
      setSeekIndicator(null);
    }, 600);
  }, []);

  const changeVolume = useCallback((newVolume: number) => {
    if (!mediaRef.current) return;
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    mediaRef.current.volume = clampedVolume;
    setVolume(clampedVolume);
    if (clampedVolume > 0 && isMuted) {
      setIsMuted(false);
      mediaRef.current.muted = false;
    }
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    if (!mediaRef.current) return;
    const newMuted = !isMuted;
    mediaRef.current.muted = newMuted;
    setIsMuted(newMuted);
    
    if (!newMuted && volume === 0) {
      changeVolume(1);
    }
  }, [isMuted, volume, changeVolume]);

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

  useEffect(() => {
    if (!isFullscreen) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
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

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isFullscreen, togglePlay, changeVolume, volume, toggleMute, triggerSeekIndicator]);

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return {
    mediaRef,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    isFullscreen,
    seekIndicator,
    togglePlay,
    handleLoadedMetadata,
    handleEnded,
    handleSliderChange,
    handleSliderPointerDown,
    handleSliderPointerUp,
    changeVolume,
    toggleMute,
    toggleFullscreen,
    formatTime,
  };
};
