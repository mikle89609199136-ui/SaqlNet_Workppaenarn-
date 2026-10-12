import { useTranslation } from 'react-i18next';

/**
 * Заглушка на время загрузки маршрута.
 *
 * Показывается, пока подтягивается чанк страницы. Занимает всю высоту
 * области и держит текст по центру: иначе при переходе строка прыгает в
 * левый верхний угол и читается как ошибка, а не как ожидание.
 */
export function RouteLoadingFallback() {
  /* Без Suspense: заглушка показывается и пока грузятся сами переводы —
     ждать их здесь значило бы зависнуть. До загрузки — запасной текст. */
  const { t } = useTranslation(undefined, { useSuspense: false });
  return (
    <div className="flex h-full w-full items-center justify-center p-10 text-body text-ink-3">
      {t('loading', 'Загрузка…')}
    </div>
  );
}
