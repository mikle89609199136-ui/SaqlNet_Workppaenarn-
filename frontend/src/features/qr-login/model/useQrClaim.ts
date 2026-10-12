import { useEffect, useRef, useState } from 'react';
import { services } from '@/services/serviceContainer';
import type { IApiError } from '@/shared/api';
import { createQrClaim, type IQrClaim, type IQrOfferLink } from '@/shared/crypto';
import { describeDevice } from './describeDevice';
import type { IQrLoginResult } from './useQrLogin';

const POLL_INTERVAL_MS = 2000;

export type TQrClaimStage = 'claiming' | 'waiting' | 'finishing' | 'failed';

/**
 * Почему не вышло:
 * - `rotated` — код сменился, пока сканировали;
 * - `unavailable` — код истёк или его уже отсканировал кто-то другой;
 * - `declined` — на вошедшем устройстве отказались или не успели решить;
 * - `error` — сеть или сбой при входе.
 */
export type TQrClaimProblem = 'rotated' | 'unavailable' | 'declined' | 'error';

interface IClaimed {
  claim: IQrClaim;
  claimSecret: string;
  verificationCode: string;
}

async function claimOffer(link: IQrOfferLink): Promise<IClaimed> {
  const claim = await createQrClaim(link);
  const { claimSecret } = await services.authService.claimQrOffer(link.token, {
    publicKey: claim.publicKey,
    mac: claim.mac,
    deviceName: describeDevice(),
  });
  return { claim, claimSecret, verificationCode: await claim.verificationCode() };
}

function describeClaimError(error: unknown): TQrClaimProblem {
  const { status, code } = error as IApiError;
  if (code === 'qr_rotated') return 'rotated';
  return status === 404 ? 'unavailable' : 'error';
}

/**
 * Новое устройство отсканировало код с вошедшего (#754): занять код своим
 * ключом, показать цифры для сверки и дождаться подтверждения.
 *
 * Код занимается один раз на ссылку. Эффект в StrictMode запускается
 * дважды, а второй захват того же кода сервер отклонил бы.
 */
export function useQrClaim(
  link: IQrOfferLink,
  onConfirmed: (result: IQrLoginResult) => Promise<void>
) {
  const [stage, setStage] = useState<TQrClaimStage>('claiming');
  const [verificationCode, setVerificationCode] = useState<string | null>(null);
  const [problem, setProblem] = useState<TQrClaimProblem | null>(null);
  const confirmedRef = useRef(onConfirmed);
  const claimRef = useRef<{ token: string; claimed: Promise<IClaimed> } | null>(null);

  useEffect(() => {
    confirmedRef.current = onConfirmed;
  }, [onConfirmed]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (claimRef.current?.token !== link.token) {
      claimRef.current = { token: link.token, claimed: claimOffer(link) };
    }
    const { claimed } = claimRef.current;

    const fail = (reason: TQrClaimProblem) => {
      if (cancelled) return;
      setProblem(reason);
      setStage('failed');
    };

    const finish = async ({ claim }: IClaimed, payload: Parameters<IQrClaim['open']>[0]) => {
      setStage('finishing');
      const masterKey = await claim.open(payload).catch(() => null);
      try {
        await confirmedRef.current({ masterKey });
      } catch {
        fail('error');
      }
    };

    const poll = async (current: IClaimed) => {
      if (cancelled) return;
      let state: Awaited<ReturnType<typeof services.authService.getQrOfferStatus>> | null = null;
      try {
        state = await services.authService.getQrOfferStatus(link.token, current.claimSecret);
      } catch {
        // Сеть моргнула — спросим ещё раз.
      }
      if (cancelled) return;

      if (state?.status === 'expired') {
        fail('declined');
        return;
      }
      if (state?.status === 'confirmed' && state.payload) {
        await finish(current, state.payload);
        return;
      }
      timer = setTimeout(() => void poll(current), POLL_INTERVAL_MS);
    };

    claimed.then(
      (current) => {
        if (cancelled) return;
        setVerificationCode(current.verificationCode);
        setStage('waiting');
        timer = setTimeout(() => void poll(current), POLL_INTERVAL_MS);
      },
      (error: unknown) => fail(describeClaimError(error))
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [link]);

  return { stage, verificationCode, problem };
}
