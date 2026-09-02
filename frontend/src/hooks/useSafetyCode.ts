import { safetyCodeFromFingerprint } from '@/crypto/safetyCode';
import { services } from '@/services/serviceContainer';
import { useEffect, useState } from 'react';

interface IResolvedCode {
  /** Чей код лежит в `code`. */
  userId: string | null;
  code: string | null;
}

const NOTHING: IResolvedCode = { userId: null, code: null };

/**
 * Код безопасности собеседника.
 *
 * `null` — кода нет: человек ещё не входил с версией, которая публикует
 * ключи, и сверять пока нечего.
 *
 * Код хранится вместе с тем, чей он: пока не пришёл ответ для нового
 * собеседника, наружу отдаётся `null`, а не код предыдущего. Прежде
 * сброс делался отдельным вызовом в эффекте — то есть кадр между сменой
 * собеседника и сбросом показывал чужой код. Для кода безопасности это
 * не косметика: человек сверяет его голосом и решает, доверять ли
 * переписке.
 */
export function useSafetyCode(userId: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<IResolvedCode>(NOTHING);

  useEffect(() => {
    if (!userId) return undefined;

    let cancelled = false;

    services.cryptoService
      .fingerprintOf(userId)
      .then((fingerprint) => {
        if (cancelled) return;
        setResolved({
          userId,
          code: fingerprint ? safetyCodeFromFingerprint(fingerprint) : null,
        });
      })
      .catch(() => {
        if (!cancelled) setResolved({ userId, code: null });
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return resolved.userId === userId ? resolved.code : null;
}
