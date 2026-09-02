import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface VideoSource {
  label: string;
  url: string;
}

interface UseVideoQualityOptions {
  src?: string;
  sources?: VideoSource[];
  mediaRef?: RefObject<HTMLVideoElement | null>;
  onQualityChanging?: () => void;
}

export const useVideoQuality = ({
  src,
  sources,
  mediaRef,
  onQualityChanging,
}: UseVideoQualityOptions = {}) => {
  const hasSources = Boolean(sources && sources.length > 1);
  const initialLabel = hasSources && sources ? sources[0].label : 'Авто';

  const [quality, setQuality] = useState(initialLabel);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [activeSrc, setActiveSrc] = useState<string | undefined>(
    hasSources && sources ? sources[0].url : src
  );
  const pendingRestoreRef = useRef<{ time: number; wasPlaying: boolean } | null>(null);

  /* Синхронизация с пропсом — сравнением во время отрисовки, а не
     эффектом: эффект переключал бы источник после того, как React уже
     нарисовал кадр со старым, то есть плеер успевал мигнуть прежним
     видео. Приём из документации React. */
  const [seenSrc, setSeenSrc] = useState(src);

  if (src !== seenSrc) {
    setSeenSrc(src);
    if (!hasSources && src !== undefined) setActiveSrc(src);
  }

  // Восстановление позиции воспроизведения после загрузки нового источника с авто-очисткой листенера
  useEffect(() => {
    const media = mediaRef?.current;
    if (!media) return;

    const onLoadedData = () => {
      if (pendingRestoreRef.current && mediaRef?.current) {
        mediaRef.current.currentTime = pendingRestoreRef.current.time;
        if (pendingRestoreRef.current.wasPlaying) {
          mediaRef.current.play().catch(() => {});
        }
        pendingRestoreRef.current = null;
      }
    };

    media.addEventListener('loadeddata', onLoadedData);
    return () => {
      media.removeEventListener('loadeddata', onLoadedData);
    };
  }, [mediaRef, activeSrc]);

  const handleQualityChange = useCallback(
    (url: string, label: string) => {
      const media = mediaRef?.current;
      if (media) {
        pendingRestoreRef.current = {
          time: media.currentTime,
          wasPlaying: !media.paused,
        };
        setActiveSrc(url);
        setQuality(label);
        setQualityOpen(false);
        onQualityChanging?.();
      } else {
        setActiveSrc(url);
        setQuality(label);
        setQualityOpen(false);
      }
    },
    [mediaRef, onQualityChanging]
  );

  return {
    activeSrc,
    quality,
    qualityOpen,
    hasSources,
    setQualityOpen,
    handleQualityChange,
  };
};
