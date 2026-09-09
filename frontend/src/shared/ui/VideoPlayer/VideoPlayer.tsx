import { Button } from '@/shared/ui/Button';
import { Slider } from '@/shared/ui/Slider';
import { Spinner } from '@/shared/ui/Spinner';
import { Icon } from '@/shared/ui/Icon';
import { useIsMobile } from '@/shared/lib/useIsMobile';
import { useVideo, type VideoSource } from '@/shared/lib/useVideo';
import { type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib';

export type { VideoSource };

interface VideoPlayerProps {
  src: string;
  sources?: VideoSource[];
}

export const VideoPlayer = ({ src, sources }: VideoPlayerProps) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const {
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
  } = useVideo(undefined, { src, sources, isMobile });

  const controlsClass = cn(
    'absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-scrim to-transparent transition-opacity flex flex-col gap-3',
    isMobile && !isFullscreen
      ? 'hidden'
      : isFullscreen
        ? isIdle
          ? 'opacity-0 pointer-events-none'
          : 'opacity-100'
        : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 group-focus-within/container:opacity-100'
  );

  return (
    <div
      className={cn(
        'flex w-full flex-col group/container',
        isFullscreen ? 'h-screen bg-ink' : 'gap-2 rounded-bubble',
        isFullscreen && isIdle && 'cursor-none'
      )}
      role="region"
      aria-label={t('media.videoPlayer', 'Видеоплеер')}
      onPointerMove={resetIdle}
      onPointerDown={(e) => {
        if (e.target !== mediaRef.current) resetIdle();
      }}
      onKeyDown={resetIdle}
    >
      <div
        className={cn(
          'bg-ink relative w-full overflow-hidden group flex items-center justify-center',
          isFullscreen ? 'h-full' : 'rounded-bubble h-full'
        )}
        ref={wrapperRef as RefObject<HTMLDivElement>}
      >
        <video
          autoPlay
          muted={isMuted}
          playsInline
          loop
          className={cn(
            'block w-full h-full cursor-pointer',
            isFullscreen ? 'portrait:object-contain landscape:object-cover' : 'object-contain'
          )}
          onClick={handleVideoClick}
          onTouchEnd={handleVideoTouchEnd}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          onWaiting={handleWaiting}
          onPlaying={handlePlaying}
          onCanPlay={handleCanPlay}
          ref={mediaRef as RefObject<HTMLVideoElement>}
          src={activeSrc}
        />

        {isBuffering && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <Spinner className="w-10 h-10 text-on-scrim" />
          </div>
        )}

        {isFullscreen && seekIndicator && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
            <div className="bg-scrim-subtle backdrop-blur-md text-on-scrim rounded-pill w-16 h-16 flex flex-col items-center justify-center animate-pulse">
              {seekIndicator === 'forward' ? (
                <>
                  <Icon name="fastForward" className="w-6 h-6 mb-0.5" />
                  <span className="text-[10px] font-bold leading-none">+5с</span>
                </>
              ) : (
                <>
                  <Icon name="rewind" className="w-6 h-6 mb-0.5" />
                  <span className="text-[10px] font-bold leading-none">-5с</span>
                </>
              )}
            </div>
          </div>
        )}

        {isFullscreen && hasSources && (
          <div
            className={cn(
              'absolute top-4 right-4 z-20 transition-opacity',
              isIdle && 'opacity-0 pointer-events-none'
            )}
          >
            <div className="relative">
              <Button
                className="bg-scrim-subtle hover:bg-scrim-control-hover text-on-scrim border-transparent backdrop-blur-md"
                onClick={() => setQualityOpen(!qualityOpen)}
                size="sm"
                variant="secondary"
              >
                {quality}
                <Icon name="chevronDown" className="w-4 h-4 ml-1" />
              </Button>
              {qualityOpen && (
                <div className="absolute right-0 top-full mt-1 bg-sheet shadow-[var(--elev-3)] rounded-field border border-line z-50 overflow-hidden min-w-30 flex flex-col p-1 gap-0.5">
                  {sources?.map((opt) => (
                    <Button
                      key={opt.url}
                      className="w-full justify-start rounded-control px-3 py-2 text-sm text-ink hover:bg-sheet-2 border-transparent"
                      onClick={() => handleQualityChange(opt.url, opt.label)}
                      variant="ghost"
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className={controlsClass}>
          {isFullscreen && (
            <Slider
              className="w-full"
              max={duration || 100}
              min={0}
              step={0.01}
              onChange={handleSliderChange}
              onPointerDown={handleSliderPointerDown}
              onPointerUp={handleSliderPointerUp}
              value={currentTime}
            />
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                aria-label={
                  isPlaying ? t('media.pause', 'Приостановить') : t('media.play', 'Воспроизвести')
                }
                className="shrink-0 rounded-pill bg-scrim-control hover:bg-scrim-control-hover text-on-scrim border-transparent"
                iconOnly
                onClick={togglePlay}
                size="sm"
              >
                {isPlaying ? (
                  <Icon name="pause" className="fill-current w-4 h-4" />
                ) : (
                  <Icon name="play" className="fill-current w-4 h-4 ml-0.5" />
                )}
              </Button>

              {!isMobile && (
                <div className="flex items-center gap-2 group/vol">
                  <Button
                    aria-label={
                      isMuted
                        ? t('media.unmute', 'Включить звук')
                        : t('media.mute', 'Выключить звук')
                    }
                    className="shrink-0 text-on-scrim hover:text-on-scrim hover:bg-transparent active:bg-transparent border-transparent"
                    iconOnly
                    onClick={toggleMute}
                    size="sm"
                    variant="ghost"
                  >
                    {isMuted || volume === 0 ? (
                      <Icon name="volumeMute" className="w-5 h-5" />
                    ) : (
                      <Icon name="volume" className="w-5 h-5" />
                    )}
                  </Button>
                  <div className="w-0 overflow-hidden group-hover/vol:w-20 focus-within:w-20 transition-all duration-300">
                    <Slider
                      max={1}
                      min={0}
                      onChange={handleVolumeChange}
                      step={0.05}
                      value={isMuted ? 0 : volume}
                    />
                  </div>
                </div>
              )}

              {(!isMobile || isFullscreen) && (
                <span className="text-sm text-on-scrim tabular-nums shrink-0">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Button
                aria-label={
                  isFullscreen
                    ? t('media.exitFullscreen', 'Выйти из полноэкранного режима')
                    : t('media.fullscreen', 'Во весь экран')
                }
                className="shrink-0 text-on-scrim hover:text-on-scrim hover:bg-transparent active:bg-transparent border-transparent"
                iconOnly
                onClick={toggleFullscreen}
                size="sm"
                variant="ghost"
              >
                <Icon name="maximize" className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
