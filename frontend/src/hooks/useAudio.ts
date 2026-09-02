import { useCallback, useEffect, useRef, useState } from 'react';

export const useAudio = () => {
  const mediaRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

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

  const handleLoadedMetadata = useCallback(() => {
    if (mediaRef.current) {
      setDuration(mediaRef.current.duration);
    }
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    media.addEventListener('play', onPlay);
    media.addEventListener('pause', onPause);

    return () => {
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onPause);
    };
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

  const formatTime = useCallback((seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }, []);

  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

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
    if (isMuted) {
      if (mediaRef.current) mediaRef.current.muted = false;
      setIsMuted(false);
      if (volume === 0) changeVolume(1);
    } else {
      if (mediaRef.current) mediaRef.current.muted = true;
      setIsMuted(true);
    }
  }, [isMuted, volume, changeVolume]);

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      changeVolume(Number(e.target.value));
    },
    [changeVolume]
  );

  return {
    mediaRef,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    togglePlay,
    toggleMute,
    handleLoadedMetadata,
    handleEnded,
    handleSliderChange,
    handleSliderPointerDown,
    handleSliderPointerUp,
    handleVolumeChange,
    formatTime,
  };
};
