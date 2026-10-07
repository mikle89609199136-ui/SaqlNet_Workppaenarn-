import { useCallback, useEffect, useRef, useState } from 'react';
import { services } from '@/services/serviceContainer';
import type { IApiError } from '@/shared/api';
import { buildQrLink, createQrReceiver, type IQrReceiver } from '@/shared/crypto';
import { describeDevice } from './describeDevice';

const POLL_INTERVAL_MS = 2000;
/** Как часто меняется код на экране (#753). Сервер держит его 60 секунд. */
export const QR_ROTATE_MS = 30_000;

/** `scanned` — код отсканировали, человек решает на другом устройстве. */
export type TQrLoginStatus = 'starting' | 'pending' | 'scanned' | 'error';

export interface IQrLoginResult {
  /** Мастер-ключ копии; `null` — вошедшее устройство прислало не то. */
  masterKey: Uint8Array<ArrayBuffer> | null;
}

interface IShownCode {
  token: string;
  secret: string;
  receiver: IQrReceiver;
}

/**
 * Новое устройство: показать код и дождаться подтверждения (#745).
 *
 * Код на экране легко сфотографировать, поэтому он меняется каждые 30
 * секунд, а прежний сразу перестаёт работать (#753). Отсканированный код
 * больше не меняется: его захватил тот, кто сканировал, и ждёт решения.
 * Отказ или истёкшее ожидание — и всё начинается с нового кода. Так же —
 * если завершить вход не вышло: подтверждённый код одноразовый.
 *
 * Уходя со страницы, код гасим: иначе он жил бы ещё минуту.
 */
export function useQrLogin(onConfirmed: (result: IQrLoginResult) => Promise<void>) {
  const [status, setStatus] = useState<TQrLoginStatus>('starting');
  const [link, setLink] = useState<string | null>(null);
  const [rotatesAt, setRotatesAt] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const confirmedRef = useRef(onConfirmed);

  useEffect(() => {
    confirmedRef.current = onConfirmed;
  }, [onConfirmed]);

  const restart = useCallback(() => {
    setStatus('starting');
    setLink(null);
    setRotatesAt(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let rotateTimer: ReturnType<typeof setTimeout> | undefined;
    let current: IShownCode | null = null;

    const withdraw = (code: IShownCode | null, keepalive = false) => {
      if (!code) return;
      void services.authService
        .cancelQrLogin(code.token, code.secret, { keepalive })
        .catch(() => {});
    };

    const show = async (replaces?: IShownCode) => {
      const receiver = await createQrReceiver();
      const created = await services.authService.startQrLogin(
        receiver.publicKey,
        describeDevice(),
        replaces && { token: replaces.token, secret: replaces.secret }
      );
      const code = { token: created.qrToken, secret: created.secret, receiver };
      if (cancelled) {
        withdraw(code);
        return;
      }

      current = code;
      setLink(
        buildQrLink(window.location.origin, { token: code.token, publicKey: receiver.publicKey })
      );
      setRotatesAt(Date.now() + QR_ROTATE_MS);
      setStatus('pending');
      rotateTimer = setTimeout(rotate, QR_ROTATE_MS);
    };

    async function rotate() {
      if (cancelled || !current) return;
      try {
        await show(current);
      } catch (error) {
        // Код успели отсканировать — опрос вот-вот скажет об этом. Иначе
        // пробуем ещё: прежний код живёт до минуты, время есть.
        if ((error as IApiError).code !== 'qr_scanned') {
          rotateTimer = setTimeout(rotate, POLL_INTERVAL_MS);
        }
      }
    }

    const poll = async () => {
      if (cancelled) return;
      const code = current;

      if (code) {
        try {
          const state = await services.authService.getQrStatus(code.token, code.secret);
          if (cancelled) return;

          // Ответ про код, который уже сменился, ничего не значит.
          if (code === current) {
            if (state.status === 'expired') {
              current = null;
              restart();
              return;
            }

            if (state.status === 'scanned') {
              clearTimeout(rotateTimer);
              setStatus('scanned');
            }

            if (state.status === 'confirmed') {
              current = null;
              const masterKey = state.payload
                ? await code.receiver.open(state.payload, code.token).catch(() => null)
                : null;
              await confirmedRef.current({ masterKey }).catch(restart);
              return;
            }
          }
        } catch {
          // Сеть моргнула — просто спросим ещё раз.
        }
      }

      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    // Закрытие вкладки: обычный запрос браузер оборвёт, keepalive — нет.
    const onPageHide = () => {
      withdraw(current, true);
      current = null;
    };
    // Страницу вернули из кеша «назад-вперёд», а код уже погашен.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) restart();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);

    show()
      .then(() => {
        if (!cancelled) pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
      clearTimeout(rotateTimer);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      withdraw(current);
      current = null;
    };
  }, [attempt, restart]);

  return { status, link, rotatesAt, restart };
}
