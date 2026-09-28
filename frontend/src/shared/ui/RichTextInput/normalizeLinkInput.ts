import { isSafeLinkUrl } from '@/shared/lib/richText';

/** Адрес без схемы — это https: так его и ждут. Небезопасный — `null`. */
export function normalizeLinkInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return isSafeLinkUrl(candidate) ? candidate : null;
}
