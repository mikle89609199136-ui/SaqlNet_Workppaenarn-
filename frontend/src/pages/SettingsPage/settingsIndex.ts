import { ROUTES } from '@/consts/routes';

export interface ISettingsEntry {
  /** Как пункт называется на экране. */
  title: string;
  /** Где он лежит — второй строкой в результатах. */
  section: string;
  path: string;
  /**
   * Слова, которыми пункт ищут, но которых нет в названии.
   *
   * Не украшение: человек набирает «2FA», а пункт называется
   * «Двухфакторная аутентификация»; набирает «тёмная» — а пункт называется
   * «Тема».
   */
  synonyms?: string[];
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
    title: 'Профиль',
    section: 'Аккаунт',
    path: ROUTES.SETTINGS_SUBSECTION('account', 'profile'),
    synonyms: ['имя', 'фамилия', 'о себе', 'фото', 'аватар'],
  },
  {
    title: 'Электронная почта',
    section: 'Аккаунт',
    path: ROUTES.SETTINGS_SUBSECTION('account', 'email'),
    synonyms: ['email', 'почта', 'адрес'],
  },
  {
    title: 'Пароль',
    section: 'Аккаунт',
    path: ROUTES.SETTINGS_SUBSECTION('account', 'password'),
    synonyms: ['сменить пароль', 'изменить пароль'],
  },
  {
    title: 'Активные сеансы',
    section: 'Аккаунт',
    path: ROUTES.SETTINGS_SUBSECTION('account', 'sessions'),
    synonyms: ['устройства', 'входы', 'сессии'],
  },
  {
    title: 'Выйти из аккаунта',
    section: 'Аккаунт',
    path: ROUTES.SETTINGS_SECTION('account'),
    synonyms: ['выход', 'логаут'],
  },
  {
    title: 'Уведомления',
    section: 'Уведомления',
    path: ROUTES.SETTINGS_SECTION('notifications'),
    synonyms: ['оповещения', 'пуши'],
  },
  {
    title: 'Звуки сообщений',
    section: 'Уведомления',
    path: ROUTES.SETTINGS_SECTION('notifications'),
    synonyms: ['звук', 'громкость', 'сигнал'],
  },
  {
    title: 'Тема оформления',
    section: 'Внешний вид',
    path: ROUTES.SETTINGS_SECTION('appearance'),
    synonyms: ['тёмная', 'светлая', 'оформление', 'цвет'],
  },
  {
    title: 'Аватарка без фотографии',
    section: 'Внешний вид',
    path: ROUTES.SETTINGS_SECTION('appearance'),
    synonyms: ['буква', 'сетка', 'аватар'],
  },
  {
    title: 'Последняя активность',
    section: 'Конфиденциальность',
    path: ROUTES.SETTINGS_SECTION('privacy'),
    synonyms: ['был в сети', 'кто видит', 'приватность'],
  },
  {
    title: 'Сообщения от незнакомых',
    section: 'Конфиденциальность',
    path: ROUTES.SETTINGS_SECTION('privacy'),
    synonyms: ['незнакомцы', 'приватность', 'кто может писать'],
  },
  {
    title: 'Язык приложения',
    section: 'Язык',
    path: ROUTES.SETTINGS_SECTION('language'),
    synonyms: ['language', 'русский', 'english'],
  },
  {
    title: 'Версия приложения',
    section: 'О приложении',
    path: ROUTES.SETTINGS_SECTION('about'),
    synonyms: ['версия', 'сборка'],
  },
  {
    title: 'Выгрузить данные',
    section: 'О приложении',
    path: ROUTES.SETTINGS_SECTION('about'),
    synonyms: ['экспорт', 'скачать данные'],
  },
  {
    title: 'Удалить ключи с устройства',
    section: 'О приложении',
    path: ROUTES.SETTINGS_SECTION('about'),
    synonyms: ['стереть ключи', 'шифрование', 'выйти везде'],
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

export function searchSettings(query: string): ISettingsEntry[] {
  const needle = normalize(query);
  if (!needle) return [];

  return SETTINGS_INDEX.filter((entry) => {
    const haystack = [entry.title, entry.section, ...(entry.synonyms ?? [])];
    return haystack.some((value) => normalize(value).includes(needle));
  });
}
