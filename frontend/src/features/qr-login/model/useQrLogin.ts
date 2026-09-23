import { useCallback, useEffect, useRef, useState } from 'react';
import { services } from '@/services/serviceContainer';
import { buildQrLink, createQrReceiver } from '@/shared/crypto';
import { describeDevice } from './describeDevice';

const POLL_INTERVAL_MS = 2000;

export type TQrLoginStatus = 'starting' | 'pending' | 'error';

export interface IQrLoginResult {
  authToken: string;
  /** Мастер-ключ копии; `null` — вошедшее устройство прислало не то. */
  masterKey: Uint8Array<ArrayBuffer> | null;
}

/**
 * Новое устройство: показать код и дождаться подтверждения (#745).
 *
 * Код обновляется сам, когда истекает: человек мог отвлечься, и
 * вернувшись, он должен увидеть живой код, а не «истёк». Так же — если
 * завершить вход не вышло: подтверждённый код одноразовый, и показывать
 * его снова бесполезно.
 */
export function useQrLogin(onConfirmed: (result: IQrLoginResult) => Promise<void>) {
  const [status, setStatus] = useState<TQrLoginStatus>('starting');
  const [link, setLink] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const confirmedRef = useRef(onConfirmed);

  useEffect(() => {
    confirmedRef.current = onConfirmed;
  }, [onConfirmed]);

  const restart = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      setStatus('starting');
      setLink(null);

      try {
        const receiver = await createQrReceiver();
        const { qrToken } = await services.authService.startQrLogin(
          receiver.publicKey,
          describeDevice()
        );
        if (cancelled) return;

        setLink(
          buildQrLink(window.location.origin, { token: qrToken, publicKey: receiver.publicKey })
        );
        setStatus('pending');

        const poll = async () => {
          if (cancelled) return;

          try {
            const state = await services.authService.getQrStatus(qrToken);
            if (cancelled) return;

            if (state.status === 'expired') {
              restart();
              return;
            }

            if (state.status === 'confirmed' && state.authToken) {
              const masterKey = state.payload
                ? await receiver.open(state.payload, qrToken).catch(() => null)
                : null;
              await confirmedRef.current({ authToken: state.authToken, masterKey }).catch(restart);
              return;
            }
          } catch {
            // Сеть моргнула — просто спросим ещё раз.
          }

          timer = setTimeout(poll, POLL_INTERVAL_MS);
        };

        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [attempt, restart]);

  return { status, link, restart };
}
