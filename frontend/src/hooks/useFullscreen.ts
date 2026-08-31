import { useCallback, useEffect, useState, type RefObject } from 'react';

export const useFullscreen = (targetRef?: RefObject<HTMLElement | null>) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => {
    const el = targetRef?.current;
    if (!el) return;

    const doc = document as any;
    const isCurrentlyFs = Boolean(
      document.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );

    if (isCurrentlyFs) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      } else if (doc.mozCancelFullScreen) {
        doc.mozCancelFullScreen();
      } else if (doc.msExitFullscreen) {
        doc.msExitFullscreen();
      }
    } else {
      const element = el as any;
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
        const video = (el.tagName === 'VIDEO' ? el : el.querySelector('video')) as any;
        if (video && video.webkitEnterFullscreen) {
          video.webkitEnterFullscreen();
        }
      }
    }
  }, [targetRef]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const el = targetRef?.current;
      const doc = document as any;
      const fsEl =
        document.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.mozFullScreenElement ||
        doc.msFullscreenElement;

      setIsFullscreen(Boolean(fsEl && (fsEl === el || el?.contains(fsEl))));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    // События для iOS Safari webkitbeginfullscreen / webkitendfullscreen
    const el = targetRef?.current;
    const video = (
      el?.tagName === 'VIDEO' ? el : el?.querySelector('video')
    ) as HTMLVideoElement | null;
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
