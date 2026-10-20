import type { TFunction } from 'i18next';
import type { IPrivacyDto, TPrivacyRule, TPrivacyVisibility } from '@/entities/user';
import type { TPrivacySubsection } from '@/shared/config/routes';

/** Подстраницы правил (#786) — все, кроме чёрного списка. */
export type TPrivacyRuleSubsection = Exclude<TPrivacySubsection, 'blocked'>;

export interface IPrivacyRuleView {
  rule: TPrivacyRule & keyof IPrivacyDto;
  title: (t: TFunction) => string;
  question: (t: TFunction) => string;
  hint: (t: TFunction) => string;
}

/**
 * Правила на экране «Конфиденциальность» — те, что сервер применяет
 * (#786, #714, #1043). Порядок — как в меню.
 */
export const PRIVACY_RULES: Record<TPrivacyRuleSubsection, IPrivacyRuleView> = {
  'last-seen': {
    rule: 'lastSeen',
    title: (t) => t('settings.privacy.lastSeen', 'Последняя активность'),
    question: (t) => t('settings.privacy.lastSeenQuestion', 'Кто видит, когда я был(а) в сети'),
    hint: (t) =>
      t(
        'settings.privacy.lastSeenHint',
        'Если скрыть время, собеседники увидят только приблизительное: «недавно», «на этой неделе», «в этом месяце» или «давно». Но и вы не будете видеть точное время других.'
      ),
  },
  photo: {
    rule: 'photoVisibility',
    title: (t) => t('settings.privacy.photo', 'Фото профиля'),
    question: (t) => t('settings.privacy.photoQuestion', 'Кто видит моё фото'),
    hint: (t) =>
      t('settings.privacy.photoHint', 'При «Никто» другие увидят вместо фото букву или узор.'),
  },
  forwards: {
    rule: 'forwards',
    title: (t) => t('settings.privacy.forwards', 'Пересылка сообщений'),
    question: (t) =>
      t('settings.privacy.forwardsQuestion', 'Кто может ссылаться на мой аккаунт при пересылке'),
    hint: (t) =>
      t(
        'settings.privacy.forwardsHint',
        'При «Никто» в ваших сообщениях, которые перешлют другие, останется только ваше имя — без перехода в ваш профиль. Уже пересланные сообщения не изменятся.'
      ),
  },
  calls: {
    rule: 'calls',
    title: (t) => t('settings.privacy.calls', 'Кто может звонить'),
    question: (t) => t('settings.privacy.callsQuestion', 'Кто может мне звонить'),
    hint: (t) =>
      t(
        'settings.privacy.callsHint',
        'При «Никто» входящие звонки будут отклоняться, кроме пользователей из списка «Всегда разрешать».'
      ),
  },
};

/** Значение правила; нет в настройках — «Все», как на сервере. */
export function ruleValue(privacy: Partial<IPrivacyDto>, rule: TPrivacyRule): TPrivacyVisibility {
  return (privacy[rule] as TPrivacyVisibility | undefined) ?? 'all';
}
