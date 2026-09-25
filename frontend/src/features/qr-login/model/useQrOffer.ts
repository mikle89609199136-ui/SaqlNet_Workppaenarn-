import { useCallback, useEffect, useRef, useState } from 'react';
import { services } from '@/services/serviceContainer';
import type { IApiError } from '@/shared/api';
import { buildQrOfferLink, createQrOffer, type IQrOffer } from '@/shared/crypto';
import { QR_ROTATE_MS } from './useQrLogin';

const POLL_INTERVAL_MS = 2000;

export type TQrOfferStage = 'starting' | 'showing' | 'claimed' | 'sending' | 'done' | 'error';

/** Кто отсканировал код и какие цифры должны быть у него на экране. */
export interface IQrOfferClaim {
  deviceName: string;
  userAgent: string;
  verificationCode: string;
}

/** `tampered` — ключ пришёл без верной подписи: код подменён по дороге. */
export type TQrOfferProblem = 'tampered' | 'confirmFailed' | null;

interface IShownOffer {
  token: string;
  offer: IQrOffer;
  claimPublicKey?: string;
}

/**
 * Вошедшее устройство показывает код для входа нового (#754).
 *
 * Правила жизни кода те же, что у кода на новом устройстве (#753): смена
 * каждые 30 секунд, первый отсканировавший захватывает код, уход со
 * страницы гасит его. Прежде чем спросить человека, ключ нового устройства
 * проверяется подписью из кода: без неё его мог подменить сервер.
 */
export function useQrOffer() {
  const [stage, setStage] = useState<TQrOfferStage>('starting');
  const [link, setLink] = useState<string | null>(null);
  const [rotatesAt, setRotatesAt] = useState<number | null>(null);
  const [claim, setClaim] = useState<IQrOfferClaim | null>(null);
  const [problem, setProblem] = useState<TQrOfferProblem>(null);
  const [attempt, setAttempt] = useState(0);
  const currentRef = useRef<IShownOffer | null>(null);

  /** Новый код с чистого листа. Причина прошлой неудачи остаётся видна. */
  const restart = useCallback(() => {
    setStage('starting');
    setLink(null);
    setRotatesAt(null);
    setClaim(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let rotateTimer: ReturnType<typeof setTimeout> | undefined;

    const withdraw = (shown: IShownOffer | null, keepalive = false) => {
      if (!shown) return;
      void services.authService.withdrawQrOffer(shown.token, { keepalive }).catch(() => {});
    };

    const show = async (replaces?: IShownOffer) => {
      const offer = await createQrOffer();
      const { offerToken } = await services.authService.createQrOffer(replaces?.token);
      const shown = { token: offerToken, offer };
      if (cancelled) {
        withdraw(shown);
        return;
      }

      currentRef.current = shown;
      setLink(
        buildQrOfferLink(window.location.origin, {
          token: offerToken,
          publicKey: offer.publicKey,
          macKey: offer.macKey,
        })
      );
      setRotatesAt(Date.now() + QR_ROTATE_MS);
      setStage('showing');
      rotateTimer = setTimeout(rotate, QR_ROTATE_MS);
    };

    async function rotate() {
      if (cancelled || !currentRef.current) return;
      try {
        await show(currentRef.current);
      } catch (error) {
        if ((error as IApiError).code !== 'qr_scanned') {
          rotateTimer = setTimeout(rotate, POLL_INTERVAL_MS);
        }
      }
    }

    const onClaimed = async (
      shown: IShownOffer,
      details: { publicKey: string; mac: string; deviceName: string; userAgent: string }
    ) => {
      clearTimeout(rotateTimer);

      if (!(await shown.offer.verifyClaim(shown.token, details.publicKey, details.mac))) {
        // Подтверждать такое нельзя: гасим код и показываем новый.
        currentRef.current = null;
        withdraw(shown);
        setProblem('tampered');
        restart();
        return false;
      }

      shown.claimPublicKey = details.publicKey;
      const verificationCode = await shown.offer.verificationCode(shown.token, details.publicKey);
      if (cancelled || shown !== currentRef.current) return false;

      setProblem(null);
      setClaim({ deviceName: details.deviceName, userAgent: details.userAgent, verificationCode });
      setStage('claimed');
      return true;
    };

    const poll = async () => {
      const shown = currentRef.current;
      // Кода нет — вход подтверждён, спрашивать не о чем.
      if (cancelled || !shown) return;

      try {
        const state = await services.authService.getQrOffer(shown.token);
        if (cancelled) return;

        // Ответ про код, который уже сменился, ничего не значит.
        if (shown === currentRef.current) {
          // Истёк, отозван или новое устройство так и не дождалось
          // решения — начинаем с нового кода.
          if (state.status === 'expired') {
            currentRef.current = null;
            restart();
            return;
          }
          if (state.status === 'claimed' && state.claim && !shown.claimPublicKey) {
            if (!(await onClaimed(shown, state.claim))) return;
          }
        }
      } catch {
        // Сеть моргнула — спросим ещё раз.
      }

      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    const onPageHide = () => {
      withdraw(currentRef.current, true);
      currentRef.current = null;
    };
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
        if (!cancelled) setStage('error');
      });

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
      clearTimeout(rotateTimer);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      withdraw(currentRef.current);
      currentRef.current = null;
    };
  }, [attempt, restart]);

  /** Человек сверил цифры и подтвердил. */
  const confirm = useCallback(async () => {
    const shown = currentRef.current;
    if (!shown?.claimPublicKey) return;

    setStage('sending');
    try {
      await services.authService.confirmQrOffer(
        shown.token,
        await services.cryptoService.sealMasterKeyForOffer(
          shown.offer,
          shown.token,
          shown.claimPublicKey
        )
      );
      // Код не гасим: по нему новое устройство заберёт сессию и ключ.
      currentRef.current = null;
      setStage('done');
    } catch {
      setProblem('confirmFailed');
      restart();
    }
  }, [restart]);

  /** Не моё устройство или цифры не совпали: гасим код и показываем новый. */
  const decline = useCallback(() => {
    const shown = currentRef.current;
    currentRef.current = null;
    if (shown) void services.authService.withdrawQrOffer(shown.token).catch(() => {});
    setProblem(null);
    restart();
  }, [restart]);

  return { stage, link, rotatesAt, claim, problem, confirm, decline, restart };
}
