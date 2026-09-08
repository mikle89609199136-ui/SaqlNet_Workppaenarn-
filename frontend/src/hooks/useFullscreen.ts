import { useCallback, useEffect, useState, type RefObject } from 'react';

interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  mozCancelFullScreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
}

interface FullscreenHTMLElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
}

interface HTMLVideoElementWithWebkit extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
}

const getFullscreenElement = (): Element | null => {
  const doc = document as FullscreenDocument;
  return (
    doc.fullscreenElement ??
    doc.webkitFullscreenElement ??
    doc.mozFullScreenElement ??
    doc.msFullscreenElement ??
    null
  );
};

export const useFullscreen = (targetRef?: RefObject<HTMLElement | null>) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => {
    const el = targetRef?.current;
    if (!el) return;

    const doc = document as FullscreenDocument;
    const fsEl = getFullscreenElement();
    const isOurFs = Boolean(fsEl && (fsEl === el || el.contains(fsEl) || fsEl.contains(el)));

    if (isOurFs) {
      // Сворачиваем только если полноэкранный режим занят именно нашим элементом
      if (doc.exitFullscreen) {
        doc.exitFullscreen().catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      } else if (doc.mozCancelFullScreen) {
        doc.mozCancelFullScreen();
      } else if (doc.msExitFullscreen) {
        doc.msExitFullscreen();
      }
    } else {
      // Разворачиваем наш элемент (даже если был открыт чужой элемент)
      const element = el as FullscreenHTMLElement;
      if (element.requestFullscreen) {
        element.requestFullscreen().catch(() => {});
      } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
      } else if (element.mozRequestFullScreen) {
        element.mozRequestFullScreen();
      } else if (element.msRequestFullscreen) {
        element.msRequestFullscreen();
      } else {
        // iOS Safari на iPhone: полноэкранный режим поддерживается напрямую на <video>
        const video = (
          el.tagName === 'VIDEO' ? el : el.querySelector('video')
        ) as HTMLVideoElementWithWebkit | null;
        if (video?.webkitEnterFullscreen) {
          video.webkitEnterFullscreen();
        }
      }
    }
  }, [targetRef]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const el = targetRef?.current;
      const fsEl = getFullscreenElement();
      setIsFullscreen(
        Boolean(fsEl && el && (fsEl === el || el.contains(fsEl) || fsEl.contains(el)))
      );
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    // События для iOS Safari webkitbeginfullscreen / webkitendfullscreen
    const el = targetRef?.current;
    const video = (
      el?.tagName === 'VIDEO' ? el : el?.querySelector('video')
    ) as HTMLVideoElementWithWebkit | null;
    const onBegin = () => setIsFullscreen(true);
    const onEnd = () => setIsFullscreen(false);

    video?.addEventListener('webkitbeginfullscreen', onBegin);
    video?.addEventListener('webkitendfullscreen', onEnd);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      video?.removeEventListener('webkitbeginfullscreen', onBegin);
      video?.removeEventListener('webkitendfullscreen', onEnd);
    };
  }, [targetRef]);

  return {
    isFullscreen,
    toggleFullscreen,
  };
};
