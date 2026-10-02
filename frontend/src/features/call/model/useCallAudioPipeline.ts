import { useEffect, useMemo, useRef, useState } from 'react';
import {
  browserCallAudioEnvironment,
  callAudioConstraints,
  CallAudioPipeline,
  type ICallAudioEnvironment,
} from './callAudioPipeline';
import type { LocalMediaManager } from './localMedia';

interface IParams {
  /** Локальный поток звонка: сырой микрофон и камера. */
  stream: MediaStream | null;
  isAudioMuted: boolean;
  manager: Pick<LocalMediaManager, 'onTrackReplaced'>;
  /** Отправка звука переключилась на другой трек — подставить в соединение. */
  onAudioTrackChange: (track: MediaStreamTrack) => void;
  env?: ICallAudioEnvironment;
}

function replaceTracks(stream: MediaStream, kind: 'audio' | 'video', track: MediaStreamTrack) {
  const current = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
  if (current.length === 1 && current[0] === track) return;
  current.forEach((old) => stream.removeTrack(old));
  stream.addTrack(track);
}

/**
 * Поток для отправки в звонке (#947): микрофон через обработку
 * (`CallAudioPipeline`), камера как есть.
 *
 * Поток один на локальный поток звонка, треки в нём подменяются на месте —
 * как в `LocalMediaManager`: соединение, пересозданное после обрыва (#934),
 * берёт из него уже текущие треки.
 */
export function useCallAudioPipeline({
  stream,
  isAudioMuted,
  manager,
  onAudioTrackChange,
  env = browserCallAudioEnvironment,
}: IParams) {
  const [pipeline] = useState(() => new CallAudioPipeline(env));
  const onAudioTrackChangeRef = useRef(onAudioTrackChange);

  const sendStream = useMemo(() => {
    if (!stream) return null;
    const audio = pipeline.outputTrack ?? stream.getAudioTracks()[0];
    return new MediaStream([...(audio ? [audio] : []), ...stream.getVideoTracks()]);
  }, [stream, pipeline]);
  const sendStreamRef = useRef(sendStream);

  useEffect(() => {
    onAudioTrackChangeRef.current = onAudioTrackChange;
    sendStreamRef.current = sendStream;
  });

  useEffect(() => {
    const unsubscribe = pipeline.onOutputChange((track) => {
      const current = sendStreamRef.current;
      if (current) replaceTracks(current, 'audio', track);
      onAudioTrackChangeRef.current(track);
    });
    // Остановка, а не уничтожение: в StrictMode эффект монтируется дважды.
    return () => {
      unsubscribe();
      pipeline.stop();
    };
  }, [pipeline]);

  useEffect(() => {
    const mic = stream?.getAudioTracks()[0];
    if (mic) void pipeline.start(mic);
  }, [stream, pipeline]);

  useEffect(
    () =>
      manager.onTrackReplaced((kind, _oldTrack, newTrack) => {
        if (kind === 'audio') {
          pipeline.setSource(newTrack);
          return;
        }
        const current = sendStreamRef.current;
        if (current) replaceTracks(current, 'video', newTrack);
      }),
    [manager, pipeline]
  );

  useEffect(() => {
    pipeline.setEnabled(!isAudioMuted);
  }, [pipeline, isAudioMuted]);

  // Один объект на звонок: он в зависимостях эффекта, который просит микрофон.
  const audioConstraints = useMemo(() => callAudioConstraints(pipeline.denoises), [pipeline]);

  return {
    sendStream,
    /** Настройки микрофона: без браузерного шумодава, если будет свой. */
    audioConstraints,
  };
}
