import { safetyCodeFromFingerprint } from '@/crypto/safetyCode';
import { services } from '@/services/serviceContainer';
import { useEffect, useState } from 'react';

/**
 * Код безопасности собеседника.
 *
 * `null` — кода нет: человек ещё не входил с версией, которая публикует
 * ключи, и сверять пока нечего.
 */
export function useSafetyCode(userId: string | null | undefined): string | null {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setCode(null);
      return undefined;
    }

    let cancelled = false;

    services.cryptoService
      .fingerprintOf(userId)
      .then((fingerprint) => {
        if (cancelled) return;
        setCode(fingerprint ? safetyCodeFromFingerprint(fingerprint) : null);
      })
      .catch(() => {
        if (!cancelled) setCode(null);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return code;
}
