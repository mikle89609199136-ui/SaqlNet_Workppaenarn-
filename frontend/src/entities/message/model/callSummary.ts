import { formatCallDuration, parseCallContent } from '@/shared/lib';
import type { TFunction } from 'i18next';

export function callSummary(content: string | null | undefined, t: TFunction): string {
  const duration = formatCallDuration(parseCallContent(content ?? '').duration);
  return [t('callEnded', 'Звонок завершен'), duration].filter(Boolean).join(', ');
}
