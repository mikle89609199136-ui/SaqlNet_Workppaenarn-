import { Button } from '@/shared/ui/Button';
import { Slider } from '@/shared/ui/Slider';
import { Icon } from '@/shared/ui/Icon';
import {
  applyPlaybackGain,
  claimPlayback,
  cn,
  releasePlaybackGain,
  useAudio,
  useIsMobile,
  VOICE_LEVEL_MAX,
} from '@/shared/lib';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface AudioPlayerProps {
  src: string;
  /**
   * voice — голосовое в пузыре, как в макете (#820): круглая кнопка,
   * волна и длительность. audio — плеер аудиофайла с громкостью.
   */
  variant?: 'audio' | 'voice';
  /** От чего строится рисунок волны: одно голосовое — всегда одна волна. */
  seed?: string;
  /** Время и статус сообщения — под длительностью голосового. */
  trailing?: ReactNode;
  /**
   * Длительность и волна голосового из шифрованных метаданных (#843).
   * Без них — длительность из файла, волна по `seed`.
   */
  durationMs?: number;
  waveform?: number[];
  /** Поправка громкости голосового, дБ (#843): все голосовые звучат ровно. */
  gainDb?: number;
}

const VOICE_BARS = 28;

/* Рисунок волны. Настоящая огибающая приходит в шифрованных метаданных
   (#843) и сжимается до числа столбиков пиками. У старых сообщений её нет
   — тогда высоты выводятся из идентификатора: детерминированно, без
   мелькания при перерисовке. Диапазон 6–25px, как в макете. */
function waveformBars(waveform: number[]): number[] {
  return Array.from({ length: VOICE_BARS }, (_, index) => {
    const from = Math.floor((index * waveform.length) / VOICE_BARS);
    const to = Math.max(from + 1, Math.floor(((index + 1) * waveform.length) / VOICE_BARS));
    let peak = 0;
    for (let i = from; i < to && i < waveform.length; i++) peak = Math.max(peak, waveform[i]);
    return 6 + Math.round((peak / VOICE_LEVEL_MAX) * 19);
  });
}

function voiceBars(seed: string): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 9973;
  return Array.from({ length: VOICE_BARS }, (_, i) => 6 + ((i * 29 + hash * 7) % 20));
}

export const AudioPlayer = ({
  src,
  variant = 'audio',
  seed = src,
  trailing,
  durationMs,
  waveform,
  gainDb,
}: AudioPlayerProps) => {
  const { t } = useTranslation();
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
  const [unplayable, setUnplayable] = useState(false);

  // Элемент уходит — отцепляем его от графа громкости, узлы не копятся.
  useEffect(() => {
    const media = mediaRef.current;
    return () => {
      if (media) releasePlaybackGain(media);
    };
  }, [mediaRef]);

  if (variant === 'voice') {
    /* Длительность — из метаданных: у записи Ogg/Opus элемент <audio>
       часто знает её только после проигрывания до конца (Infinity). */
    const fileDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const totalSeconds = durationMs ? durationMs / 1000 : fileDuration;
    const progress = totalSeconds > 0 ? Math.min(1, currentTime / totalSeconds) : 0;
    const bars = waveform?.length ? waveformBars(waveform) : voiceBars(seed);

    // Браузер не смог проиграть — не молчим: подпись и скачать.
    if (unplayable) {
      return (
        <div className="flex items-center gap-2.5 text-caption">
          <Icon className="size-5 shrink-0" name="mic" />
          <span className="flex flex-col gap-0.5">
            <span>{t('voice.unplayable', 'Этот браузер не проигрывает голосовое')}</span>
            <a className="underline" download href={src}>
              {t('voice.download', 'Скачать')}
            </a>
          </span>
          {trailing}
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2.5">
        <audio
          onEnded={handleEnded}
          onError={() => setUnplayable(true)}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={(event) => claimPlayback(event.currentTarget)}
          preload="metadata"
          ref={mediaRef}
          src={src}
        />
        {/* Кнопка: на чужом пузыре — заливка акцента, на своём — белая с
            иконкой цвета заливки. */}
        <button
          aria-label={
            isPlaying
              ? t('media.pause', 'Приостановить')
              : t('media.playVoice', 'Прослушать голосовое')
          }
          className={cn(
            'flex size-9.5 shrink-0 cursor-pointer items-center justify-center rounded-pill',
            'bg-brand-fill text-on-brand group-data-[mine]/bubble:bg-on-brand group-data-[mine]/bubble:text-brand-fill',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2'
          )}
          onClick={(event) => {
            event.stopPropagation();
            // Громкость — до запуска и в жесте: иначе браузер не даст звук.
            if (!isPlaying && mediaRef.current) applyPlaybackGain(mediaRef.current, gainDb);
            togglePlay();
          }}
          type="button"
        >
          <Icon
            className={cn('size-4 fill-current stroke-0', !isPlaying && 'ml-0.5')}
            name={isPlaying ? 'pause' : 'play'}
          />
        </button>

        {/* Волна — она же дорожка перемотки: невидимый ползунок поверх
            даёт и мышь, и стрелки с клавиатуры. */}
        <div className="relative flex h-7 items-center gap-0.5">
          {bars.map((height, index) => (
            <span
              aria-hidden="true"
              className={cn(
                'w-[3px] shrink-0 origin-center rounded-[2px] bg-brand group-data-[mine]/bubble:bg-on-brand',
                'transition-opacity duration-fast',
                (index + 0.5) / VOICE_BARS > progress && 'opacity-40',
                isPlaying &&
                  'animate-[voice-bar_520ms_ease-in-out_infinite_alternate] motion-reduce:animate-none'
              )}
              key={index}
              style={{ height, animationDelay: `${(index * 43) % 500}ms` }}
            />
          ))}
          <input
            aria-label={t('media.seek', 'Перемотка')}
            aria-valuetext={`${formatTime(currentTime)} / ${formatTime(totalSeconds)}`}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            max={totalSeconds || 0}
            min={0}
            onChange={handleSliderChange}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={handleSliderPointerDown}
            onPointerUp={handleSliderPointerUp}
            step={0.01}
            type="range"
            value={currentTime}
          />
        </div>

        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-meta text-ink tabular-nums group-data-[mine]/bubble:text-on-brand">
            {formatTime(isPlaying || currentTime > 0 ? currentTime : totalSeconds)}
          </span>
          {trailing}
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex w-full flex-col gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-bubble"
      onClick={(e) => e.currentTarget.focus()}
      tabIndex={0}
    >
      <audio
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPlay={(event) => claimPlayback(event.currentTarget)}
        ref={mediaRef}
        src={src}
      />
      <div className="bg-sheet-2 flex items-center gap-3 rounded-bubble p-3">
        <Button
          aria-label={
            isPlaying ? t('media.pause', 'Приостановить') : t('media.play', 'Воспроизвести')
          }
          className="shrink-0 rounded-pill"
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
              aria-label={
                isMuted ? t('media.unmute', 'Включить звук') : t('media.mute', 'Выключить звук')
              }
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
