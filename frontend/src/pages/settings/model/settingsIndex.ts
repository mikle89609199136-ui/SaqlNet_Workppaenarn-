import type { TFunction } from 'i18next';
import { ROUTES, type TSettingsSection } from '@/shared/config/routes';
import { SECTION_TITLES } from '../ui/settingsHeader';

export interface ISettingsEntry {
  /** Как пункт называется на экране: ключ перевода и запасной текст. */
  title: readonly [string, string];
  /** Где он лежит — второй строкой в результатах. */
  section: TSettingsSection;
  path: string;
  /**
   * Слова, которыми пункт ищут, но которых нет в названии.
   *
   * Не украшение: человек набирает «2FA», а пункт называется
   * «Двухфакторная аутентификация»; набирает «тёмная» — а пункт называется
   * «Тема». Ищутся оба языка сразу: человек с английским интерфейсом мог
   * по привычке набрать «пароль».
   */
  synonyms?: { ru?: readonly string[]; en?: readonly string[] };
}

/** Найденный пункт — уже на языке интерфейса. */
export interface ISettingsResult {
  title: string;
  section: string;
  path: string;
}

/**
 * Что можно найти в настройках.
 *
 * Список ведётся руками, а не собирается из разметки: в разметке названия
 * лежат вперемешку с подписями полей внутри форм — «Повторите новый
 * пароль» искать незачем. Здесь перечислено то, куда имеет смысл вести.
 *
 * Половина пунктов — на подстраницах, которых в меню не видно: за этим
 * поиск и нужен. В меню шесть разделов, а пунктов семнадцать.
 */
export const SETTINGS_INDEX: ISettingsEntry[] = [
  {
    title: ['settings.search.profile', 'Профиль'],
    section: 'account',
    path: ROUTES.SETTINGS_SUBSECTION('account', 'profile'),
    synonyms: {
      ru: ['имя', 'фамилия', 'о себе', 'фото', 'аватар'],
      en: ['name', 'bio', 'photo', 'avatar'],
    },
  },
  {
    title: ['settings.account.email', 'Электронная почта'],
    section: 'account',
    path: ROUTES.SETTINGS_SUBSECTION('account', 'email'),
    synonyms: { ru: ['почта', 'адрес'], en: ['email', 'mail', 'address'] },
  },
  {
    title: ['settings.account.password', 'Пароль'],
    section: 'account',
    path: ROUTES.SETTINGS_SUBSECTION('account', 'password'),
    synonyms: { ru: ['сменить пароль', 'изменить пароль'], en: ['change password'] },
  },
  {
    title: ['settings.account.sessions', 'Активные сеансы'],
    section: 'account',
    path: ROUTES.SETTINGS_SUBSECTION('account', 'sessions'),
    synonyms: { ru: ['устройства', 'входы', 'сессии'], en: ['devices', 'sign-ins', 'sessions'] },
  },
  {
    title: ['settings.account.logout', 'Выйти из аккаунта'],
    section: 'account',
    path: ROUTES.SETTINGS_SECTION('account'),
    synonyms: { ru: ['выход', 'логаут'], en: ['log out', 'logout', 'sign out'] },
  },
  {
    title: ['settings.search.notifications', 'Уведомления'],
    section: 'notifications',
    path: ROUTES.SETTINGS_SECTION('notifications'),
    synonyms: { ru: ['оповещения', 'пуши'], en: ['alerts', 'push'] },
  },
  {
    title: ['settings.search.sounds', 'Звуки сообщений'],
    section: 'notifications',
    path: ROUTES.SETTINGS_SECTION('notifications'),
    synonyms: { ru: ['звук', 'громкость', 'сигнал'], en: ['sound', 'volume'] },
  },
  {
    title: ['settings.search.callSounds', 'Звуки звонков'],
    section: 'notifications',
    path: ROUTES.SETTINGS_SECTION('notifications'),
    synonyms: {
      ru: ['звонок', 'рингтон', 'вызов', 'гудок'],
      en: ['call', 'ringtone', 'incoming call'],
    },
  },
  {
    title: ['settings.search.theme', 'Тема оформления'],
    section: 'appearance',
    path: ROUTES.SETTINGS_SECTION('appearance'),
    synonyms: {
      ru: ['тёмная', 'светлая', 'оформление', 'цвет'],
      en: ['dark', 'light', 'color'],
    },
  },
  {
    title: ['settings.search.avatarPlaceholder', 'Аватарка без фотографии'],
    section: 'appearance',
    path: ROUTES.SETTINGS_SECTION('appearance'),
    synonyms: { ru: ['буква', 'сетка', 'аватар'], en: ['letter', 'grid', 'avatar'] },
  },
  {
    title: ['settings.privacy.lastSeen', 'Последняя активность'],
    section: 'privacy',
    path: ROUTES.SETTINGS_SUBSECTION('privacy', 'last-seen'),
    synonyms: {
      ru: ['был в сети', 'кто видит', 'приватность', 'исключения'],
      en: ['online', 'who can see', 'privacy', 'exceptions'],
    },
  },
  {
    title: ['settings.privacy.photo', 'Фото профиля'],
    section: 'privacy',
    path: ROUTES.SETTINGS_SUBSECTION('privacy', 'photo'),
    synonyms: {
      ru: ['аватар', 'кто видит фото', 'приватность', 'исключения'],
      en: ['avatar', 'who can see', 'privacy', 'exceptions'],
    },
  },
  {
    title: ['settings.privacy.forwards', 'Пересылка сообщений'],
    section: 'privacy',
    path: ROUTES.SETTINGS_SUBSECTION('privacy', 'forwards'),
    synonyms: {
      ru: ['пересылка', 'ссылка на профиль', 'приватность', 'исключения'],
      en: ['forward', 'profile link', 'privacy', 'exceptions'],
    },
  },
  {
    title: ['settings.privacy.calls', 'Кто может звонить'],
    section: 'privacy',
    path: ROUTES.SETTINGS_SUBSECTION('privacy', 'calls'),
    synonyms: {
      ru: ['звонки', 'вызовы', 'кто может звонить', 'приватность звонков', 'исключения'],
      en: ['calls', 'who can call', 'incoming calls', 'call privacy', 'exceptions'],
    },
  },
  {
    title: ['settings.privacy.blocked', 'Чёрный список'],
    section: 'privacy',
    path: ROUTES.SETTINGS_SUBSECTION('privacy', 'blocked'),
    synonyms: {
      ru: ['заблокировать', 'блокировка', 'заблокированные', 'незнакомцы'],
      en: ['block', 'blocked', 'blacklist', 'strangers'],
    },
  },
  {
    title: ['settings.language.appLanguage', 'Язык приложения'],
    section: 'language',
    path: ROUTES.SETTINGS_SECTION('language'),
    synonyms: { ru: ['русский'], en: ['language', 'english'] },
  },
  {
    title: ['settings.search.version', 'Версия приложения'],
    section: 'about',
    path: ROUTES.SETTINGS_SECTION('about'),
    synonyms: { ru: ['версия', 'сборка'], en: ['version', 'build'] },
  },
  {
    title: ['settings.search.export', 'Выгрузить данные'],
    section: 'about',
    path: ROUTES.SETTINGS_SECTION('about'),
    synonyms: { ru: ['экспорт', 'скачать данные'], en: ['export', 'download data'] },
  },
  {
    title: ['settings.search.wipeKeys', 'Удалить ключи с устройства'],
    section: 'about',
    path: ROUTES.SETTINGS_SECTION('about'),
    synonyms: {
      ru: ['стереть ключи', 'шифрование', 'выйти везде'],
      en: ['delete keys', 'encryption', 'sign out everywhere'],
    },
  },
];

/**
 * Приведение к виду, в котором сравниваются запрос и название.
 *
 * «ё» к «е» — потому что ищут «темная», а пункт называется «Тёмная», и
 * человек не обязан помнить, какую букву мы выбрали.
 */
function normalize(value: string): string {
  return value.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
}

/**
 * Поиск по настройкам. Находит по названию на языке интерфейса, по
 * русскому названию и по словам на обоих языках; отдаёт пункты уже
 * переведёнными.
 */
export function searchSettings(query: string, t: TFunction): ISettingsResult[] {
  const needle = normalize(query);
  if (!needle) return [];

  return SETTINGS_INDEX.flatMap((entry) => {
    const title = t(entry.title[0], entry.title[1]);
    const [sectionKey, sectionFallback] = SECTION_TITLES[entry.section];
    const section = t(sectionKey, sectionFallback);
    const haystack = [
      title,
      entry.title[1],
      section,
      sectionFallback,
      ...(entry.synonyms?.ru ?? []),
      ...(entry.synonyms?.en ?? []),
    ];
    return haystack.some((value) => normalize(value).includes(needle))
      ? [{ title, section, path: entry.path }]
      : [];
  });
}
