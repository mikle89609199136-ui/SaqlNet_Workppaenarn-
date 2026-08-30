import { Button, Slider } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { useMedia } from '@/hooks/useMedia';

interface AudioPlayerProps {
  src: string;
}

export const AudioPlayer = ({ src }: AudioPlayerProps) => {
  const {
    mediaRef,
    isPlaying,
    currentTime,
    duration,
    togglePlay,
    handleLoadedMetadata,
    handleEnded,
    handleSliderChange,
    handleSliderPointerDown,
    handleSliderPointerUp,
    formatTime,
  } = useMedia();

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
      </div>
    </div>
  );
};
