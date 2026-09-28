import { useEffect, useState, useSyncExternalStore } from 'react';
import { holdAppUpdate } from '@/shared/lib';
import { browserVoiceEnvironment } from './voiceEnvironment';
import { VoiceRecorder, type IVoiceEnvironment } from './voiceRecorder';

/**
 * Рекордер голосового для открытого чата (#843).
 *
 * Запись не переживает ничего, что уводит человека от чата: смену чата,
 * размонтирование, уход вкладки в фон, закрытие страницы. В любом из этих
 * случаев она отменяется, и микрофон освобождается.
 */
export function useVoiceRecorder(chatId: string, env: IVoiceEnvironment = browserVoiceEnvironment) {
  const [recorder] = useState(() => new VoiceRecorder(env));
  const state = useSyncExternalStore(
    (onChange) => recorder.subscribe(onChange),
    () => recorder.getState()
  );

  // Пока записываем — приложение не перезагружается ради обновления (#892).
  const recording = state.status !== 'idle';
  useEffect(() => (recording ? holdAppUpdate('recording') : undefined), [recording]);

  // Смена чата — запись, начатая в прежнем, не уходит в новый.
  useEffect(() => () => recorder.cancel(), [recorder, chatId]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') recorder.cancel();
    };
    const onPageHide = () => recorder.cancel();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      recorder.cancel();
    };
  }, [recorder]);

  return { state, recorder };
}
