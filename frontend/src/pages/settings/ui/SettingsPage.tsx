import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import { SettingsSearch } from './SettingsSearch';
import { SettingsSidebar } from './SettingsSidebar';

/**
 * Раскладка настроек: меню слева, раздел справа.
 *
 * Сам раздел выбирается адресом, а не состоянием, поэтому здесь его нет —
 * страница только расставляет части и отдаёт место под то, что вернул
 * маршрут.
 */
export function SettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen w-full flex-col bg-ground text-ink md:h-full md:flex-row">
      {/* На узком экране меню ложится полосой сверху, на широком — колонкой
          слева. Отсюда и граница: снизу в первом случае, справа во втором. */}
      <div className="flex w-full shrink-0 flex-col overflow-hidden border-b border-line bg-sheet md:min-h-screen md:w-[340px] md:border-r md:border-b-0">
        <SettingsSearch />
        <SettingsSidebar t={t} />
      </div>

      {/* Два уровня, а не один: внешний занимает свободное место и
          прокручивается, внутренний держит ширину колонки текста. Слить их
          нельзя — flex-1 на том же элементе перебивает width, и содержимое
          растягивается до края экрана. */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* Колонка текста: на широком экране прижата влево с отступом, на
            узком занимает ширину за вычетом полей. Отступ снизу на мобильном
            (pb-24 = 96px) перекрывает высоту навбара (60px) + bottom-8 (32px)
            с запасом в 4px. Прежний ручной порог 760px сведён к md. */}
        <main className="mx-auto w-[calc(100%-28px)] pt-5 pb-26 md:mx-0 md:ml-12 md:w-[min(760px,calc(100%-40px))] md:pt-[34px] md:pb-16">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
