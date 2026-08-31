import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
/* Свод стилей разделов. Уходит вместе с последним переписанным разделом:
   меню, поиск и раскладка уже на утилитах, содержимое — ещё нет. */
import '../../styles/SettingsPage.css';
import { FixedSearchBar } from './FixedSearchBar.js';
import { SettingsSidebar } from './SettingsSidebar.js';

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

  return (
    <div className="flex min-h-screen w-full flex-col bg-ground text-ink md:h-full md:flex-row">
      {/* На узком экране меню ложится полосой сверху, на широком — колонкой
          слева. Отсюда и граница: снизу в первом случае, справа во втором. */}
      <div className="flex w-full shrink-0 flex-col overflow-hidden border-b border-line bg-sheet md:min-h-screen md:w-[340px] md:border-r md:border-b-0">
        <FixedSearchBar searchQuery={searchQuery} onSearchChange={setSearchQuery} />
        <SettingsSidebar t={t} />
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* Запрос поиска пока живёт здесь: судьба самой строки решается
            отдельно (#477), а разделу он нужен уже сейчас. */}
        <Outlet context={{ searchQuery }} />
      </div>
    </div>
  );
}
