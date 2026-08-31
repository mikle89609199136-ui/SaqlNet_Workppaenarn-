import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useFullscreen } from './useFullscreen';
import { useIdle } from './useIdle';
import { useVideoQuality, type VideoSource } from './useVideoQuality';

export type { VideoSource };

interface UseVideoOptions {
  src?: string;
  sources?: VideoSource[];
  isMobile?: boolean;
}

export const useVideo = (
  externalWrapperRef?: RefObject<HTMLElement | null>,
  options?: UseVideoOptions
) => {
  const internalWrapperRef = useRef<HTMLElement>(null);
  const wrapperRef = externalWrapperRef ?? internalWrapperRef;
  const mediaRef = useRef<HTMLVideoElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);

  const isIntersectingRef = useRef(false);

  // --- Полноэкранный режим ---
  const { isFullscreen, toggleFullscreen } = useFullscreen(wrapperRef);

  // --- Автоматическое скрытие UI при бездействии в полноэкранном режиме ---
  const { isIdle, resetIdle, setIsIdle } = useIdle({
    enabled: isFullscreen,
    timeoutMs: 2000,
  });

  // --- Качество и источники видео ---
  const { activeSrc, quality, qualityOpen, hasSources, setQualityOpen, handleQualityChange } =
    useVideoQuality({
      src: options?.src,
      sources: options?.sources,
      mediaRef,
      onQualityChanging: () => setIsBuffering(true),
    });

  // --- Воспроизведение и пауза ---
  const togglePlay = useCallback(() => {
    if (!mediaRef.current) return;
    if (mediaRef.current.paused) {
      if (mediaRef.current.ended || mediaRef.current.currentTime >= mediaRef.current.duration) {
        mediaRef.current.currentTime = 0;
      }
      mediaRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    } else {
      mediaRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  // --- Синхронизация времени (rAF обеспечивает плавность хода ползунка) ---
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

  // Синхронизация isPlaying с нативными событиями медиа
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    media.addEventListener('play', onPlay);
    media.addEventListener('pause', onPause);

    if (!media.paused) setIsPlaying(true);
    if (media.currentTime) setCurrentTime(media.currentTime);
    media.volume = volume;
    media.muted = isMuted;

    return () => {
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onPause);
    };
  }, []);

  // Синхронизация громкости и mute при их изменении
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.volume = volume;
    media.muted = isMuted;
  }, [volume, isMuted]);

  // --- Метаданные ---
  const handleLoadedMetadata = useCallback(() => {
    if (mediaRef.current) {
      setDuration(mediaRef.current.duration);
    }
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  // --- Ползунок прогресса ---
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

  // --- Индикатор перемотки (+5с / -5с) ---
  const [seekIndicator, setSeekIndicator] = useState<'forward' | 'backward' | null>(null);
  const seekTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const triggerSeekIndicator = useCallback((dir: 'forward' | 'backward') => {
    setSeekIndicator(dir);
    if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
    seekTimeoutRef.current = setTimeout(() => setSeekIndicator(null), 600);
  }, []);

  useEffect(() => {
    return () => {
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
    };
  }, []);

  // --- Громкость и звук ---
  const changeVolume = useCallback(
    (newVolume: number) => {
      const clamped = Math.max(0, Math.min(1, newVolume));
      if (mediaRef.current) {
        mediaRef.current.volume = clamped;
        if (clamped > 0 && isMuted) {
          mediaRef.current.muted = false;
        }
      }
      setVolume(clamped);
      if (clamped > 0 && isMuted) {
        setIsMuted(false);
      }
    },
    [isMuted]
  );

  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    if (mediaRef.current) {
      mediaRef.current.muted = newMuted;
    }
    setIsMuted(newMuted);
    if (!newMuted && volume === 0) changeVolume(1);
  }, [isMuted, volume, changeVolume]);

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      changeVolume(Number(e.target.value));
    },
    [changeVolume]
  );

  // --- Автовоспроизведение в области видимости ---
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

  // --- Обработчики кликов и тапов ---
  const handleVideoClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (options?.isMobile) return;

      if (isFullscreen && isIdle) {
        resetIdle();
      } else {
        togglePlay();
      }
    },
    [options?.isMobile, isFullscreen, isIdle, resetIdle, togglePlay]
  );

  const handleVideoTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!options?.isMobile) return;
      e.preventDefault();
      e.stopPropagation();

      if (!isFullscreen) {
        toggleFullscreen();
      } else {
        if (isIdle) {
          resetIdle();
        } else {
          setIsIdle(true);
        }
      }
    },
    [options?.isMobile, isFullscreen, isIdle, resetIdle, setIsIdle, toggleFullscreen]
  );

  // --- Горячие клавиши (только в полноэкранном режиме) ---
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
          mediaRef.current.currentTime = Math.min(
            mediaRef.current.duration,
            mediaRef.current.currentTime + 5
          );
          setCurrentTime(mediaRef.current.currentTime);
          triggerSeekIndicator('forward');
          break;
        case 'ArrowUp':
          e.preventDefault();
          changeVolume(Math.round((volume + 0.1) * 10) / 10);
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeVolume(Math.round((volume - 0.1) * 10) / 10);
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

  // --- Форматирование времени ---
  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return {
    mediaRef,
    wrapperRef,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    isFullscreen,
    isBuffering,
    isIdle,
    seekIndicator,
    activeSrc,
    quality,
    qualityOpen,
    setQualityOpen,
    hasSources,
    togglePlay,
    toggleMute,
    toggleFullscreen,
    changeVolume,
    resetIdle,
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
