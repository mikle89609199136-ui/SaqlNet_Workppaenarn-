import { Button, Slider } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useMedia } from '@/hooks/useMedia';
import { useState, useRef, type ChangeEvent, type RefObject } from 'react';

interface VideoPlayerProps {
  src: string;
}

const QUALITY_OPTIONS = [
  { label: 'Auto', value: 'auto' },
  { label: '1080p', value: '1080p' },
  { label: '720p', value: '720p' },
  { label: '480p', value: '480p' },
];

export const VideoPlayer = ({ src }: VideoPlayerProps) => {
  const wrapperRef = useRef<HTMLElement>(null);
  const isMobile = useIsMobile();
  const {
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
  } = useMedia(wrapperRef);

  const [quality, setQuality] = useState('auto');
  const [qualityOpen, setQualityOpen] = useState(false);

  const handleVolumeChange = (e: ChangeEvent<HTMLInputElement>) => {
    changeVolume(Number(e.target.value));
  };

  const handleVideoClick = () => {
    if (isMobile) {
      if (!isFullscreen) {
        toggleFullscreen();
        if (!isPlaying) togglePlay();
      } else {
        togglePlay();
      }
    } else {
      togglePlay();
    }
  };

  return (
    <div
      className="flex w-full flex-col gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-xl"
      onClick={(e) => e.currentTarget.focus()}
      tabIndex={0}
    >
      <div className="bg-ink relative w-full overflow-hidden rounded-xl group" ref={wrapperRef as RefObject<HTMLDivElement>}>
        <video
          className="block w-full"
          onClick={handleVideoClick}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          ref={mediaRef as RefObject<HTMLVideoElement>}
          src={src}
        />

        {/* Seek Indicator Overlay */}
        {isFullscreen && seekIndicator && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
            <div className="bg-black/60 backdrop-blur-md text-white rounded-full w-16 h-16 flex flex-col items-center justify-center animate-pulse">
              {seekIndicator === 'forward' ? (
                <>
                  <Icon name="fastForward" className="w-6 h-6 mb-0.5" />
                  <span className="text-[10px] font-bold leading-none">+5s</span>
                </>
              ) : (
                <>
                  <Icon name="rewind" className="w-6 h-6 mb-0.5" />
                  <span className="text-[10px] font-bold leading-none">-5s</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Top Right Controls (Fullscreen only) */}
        {isFullscreen && (
          <div className="absolute top-4 right-4 z-20">
            <div className="relative">
              <Button
                className="bg-black/40 hover:bg-black/60 text-white border-transparent backdrop-blur-md"
                onClick={() => setQualityOpen(!qualityOpen)}
                size="sm"
                variant="secondary"
              >
                {QUALITY_OPTIONS.find((o) => o.value === quality)?.label}
                <Icon name="chevronDown" className="w-4 h-4 ml-1" />
              </Button>
              {qualityOpen && (
                <div className="absolute right-0 top-full mt-1 bg-sheet shadow-[var(--elev-3)] rounded-field border border-line z-50 overflow-hidden min-w-30 flex flex-col">
                  {QUALITY_OPTIONS.map((opt) => (
                    <Button
                      key={opt.value}
                      className="w-full justify-start rounded-none px-3 py-2 text-sm text-ink hover:bg-sheet-2 border-transparent"
                      onClick={() => {
                        setQuality(opt.value);
                        setQualityOpen(false);
                      }}
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

        {/* Bottom Controls Overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex flex-col gap-3">
          {isFullscreen && !isMobile && (
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
              {!isMobile && (
                <>
                  <Button
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                    className="shrink-0 rounded-full bg-white/20 hover:bg-white/30 text-white border-transparent"
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

                  <div className="flex items-center gap-2 group/vol">
                    <Button
                      aria-label="Mute"
                      className="shrink-0 text-white hover:text-white hover:bg-transparent active:bg-transparent border-transparent"
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

                  {isFullscreen && (
                    <span className="text-sm text-white tabular-nums shrink-0">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-3">
              {isMobile && !isFullscreen && (
                <Button
                  className="bg-black/40 hover:bg-black/60 text-white border-transparent backdrop-blur-md"
                  onClick={() => toggleFullscreen()}
                  size="sm"
                  variant="secondary"
                >
                  Quality: {QUALITY_OPTIONS.find((o) => o.value === quality)?.label}
                </Button>
              )}
              
              <Button
                aria-label="Fullscreen"
                className="shrink-0 text-white hover:text-white hover:bg-transparent active:bg-transparent border-transparent"
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
