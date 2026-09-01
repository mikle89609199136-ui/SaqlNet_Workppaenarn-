import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';
import { DEFAULT_SETTINGS_SECTION, isSettingsSection } from '@/consts/routes';
import { FixedSearchBar } from './FixedSearchBar.js';
import { SettingsSidebar } from './SettingsSidebar.js';

/* Поиск пока не ищет: запрос сверяется со строкой-описанием текущего
   раздела, и раздел целиком показывается или прячется. Судьба самой строки
   решается в #477 — до тех пор описания лежат здесь, а не в разделах:
   прятать содержимое, которое сам же и показал, — дело раскладки. */
const SECTION_KEYWORDS: Record<string, string> = {
  account: 'аккаунт профиль пароль безопасность сессии устройства выход',
  notifications: 'уведомления звуки сообщения звонки',
  appearance: 'внешний вид тема светлая темная',
  privacy: 'конфиденциальность приватность последняя активность сообщения группы',
  language: 'язык русский english',
  about: 'приложение версия экспорт данные',
};

/**
 * Раскладка настроек: меню слева, раздел справа.
 *
 * Сам раздел выбирается адресом, а не состоянием, поэтому здесь его нет —
 * страница только расставляет части и отдаёт место под то, что вернул
 * маршрут.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const { pathname } = useLocation();

  const section = pathname.split('/')[2];
  const activeSection = isSettingsSection(section) ? section : DEFAULT_SETTINGS_SECTION;
  const query = searchQuery.trim().toLocaleLowerCase();
  const matchesQuery = !query || SECTION_KEYWORDS[activeSection]?.includes(query);

  return (
    <div className="flex min-h-screen w-full flex-col bg-ground text-ink md:h-full md:flex-row">
      {/* На узком экране меню ложится полосой сверху, на широком — колонкой
          слева. Отсюда и граница: снизу в первом случае, справа во втором. */}
      <div className="flex w-full shrink-0 flex-col overflow-hidden border-b border-line bg-sheet md:min-h-screen md:w-[340px] md:border-r md:border-b-0">
        <FixedSearchBar onSearchChange={setSearchQuery} searchQuery={searchQuery} />
        <SettingsSidebar t={t} />
      </div>

      {/* Два уровня, а не один: внешний занимает свободное место и
          прокручивается, внутренний держит ширину колонки текста. Слить их
          нельзя — flex-1 на том же элементе перебивает width, и содержимое
          растягивается до края экрана. */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* Колонка текста: на широком экране прижата влево с отступом, на
            узком занимает ширину за вычетом полей. Прежний ручной порог
            760px сведён к md — восемь пикселей разницы на границе. */}
        <main className="mx-auto w-[calc(100%-28px)] pt-5 pb-16 md:mx-0 md:ml-12 md:w-[min(760px,calc(100%-40px))] md:pt-[34px]">
          {matchesQuery ? (
            <Outlet />
          ) : (
            <div className="text-body grid min-h-[60vh] place-items-center text-ink-2">
              Ничего не найдено
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
