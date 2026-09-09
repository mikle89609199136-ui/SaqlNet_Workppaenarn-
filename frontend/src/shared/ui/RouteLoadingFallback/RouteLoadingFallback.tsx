/**
 * Заглушка на время загрузки маршрута.
 *
 * Показывается, пока подтягивается чанк страницы. Занимает всю высоту
 * области и держит текст по центру: иначе при переходе строка прыгает в
 * левый верхний угол и читается как ошибка, а не как ожидание.
 */
export function RouteLoadingFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center p-10 text-body text-ink-3">
      Загрузка…
    </div>
  );
}
