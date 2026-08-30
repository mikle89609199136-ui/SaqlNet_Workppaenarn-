import { Button, Slider } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { useAudio } from '@/hooks/useAudio';
import { useIsMobile } from '@/hooks/useIsMobile';

interface AudioPlayerProps {
  src: string;
}

export const AudioPlayer = ({ src }: AudioPlayerProps) => {
  const isMobile = useIsMobile();
  const {
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
  } = useAudio();

  return (
    <div
      className="flex w-full flex-col gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-xl"
      onClick={(e) => e.currentTarget.focus()}
      tabIndex={0}
    >
      <audio
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        ref={mediaRef}
        src={src}
      />
      <div className="bg-sheet-2 flex items-center gap-3 rounded-xl p-3">
        <Button
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="shrink-0 rounded-full"
          iconOnly
          onClick={togglePlay}
          variant="primary"
        >
          {isPlaying ? (
            <Icon name="pause" className="fill-current w-5 h-5" />
          ) : (
            <Icon name="play" className="fill-current w-5 h-5 ml-1" />
          )}
        </Button>
        <Slider
          caption={`${formatTime(currentTime)} / ${formatTime(duration)}`}
          className="grow"
          max={duration || 100}
          min={0}
          step={0.01}
          onChange={handleSliderChange}
          onPointerDown={handleSliderPointerDown}
          onPointerUp={handleSliderPointerUp}
          value={currentTime}
        />
        {!isMobile && (
          <div className="relative group/vol shrink-0">
            <Button
              aria-label={isMuted ? 'Unmute' : 'Mute'}
              className="shrink-0"
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
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 opacity-0 pointer-events-none group-hover/vol:opacity-100 group-hover/vol:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity">
              <div className="bg-sheet shadow-[var(--elev-3)] rounded-field border border-line flex items-center justify-center w-10 h-28 mb-1">
                <div className="h-20 w-4 flex items-center justify-center">
                  <Slider
                    className="w-20 -rotate-90 origin-center shrink-0"
                    max={1}
                    min={0}
                    onChange={handleVolumeChange}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
