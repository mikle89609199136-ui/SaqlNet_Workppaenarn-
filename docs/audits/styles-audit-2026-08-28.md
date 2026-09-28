# Аудит стилей фронтенда

**Первичная версия:** 28 августа 2026<br>
**Актуализировано:** 18 сентября 2026, commit `d93a9ab`<br>
**Метод:** статический анализ `frontend/src`; числа относятся к текущему рабочему дереву.

## Итог

Главная проблема первичного аудита — стили в нескольких конкурирующих CSS-файлах с конфликтующими классами и случайным import order — в основном устранена. В `frontend/src` осталось семь CSS-файлов:

- единая точка входа `app/styles/tailwind.css`;
- шесть token-файлов в `app/styles/tokens/`.

`ChatThreadPage.css`, `Settings*.css` и `PhotoEditorModal.css`, на которых строилась большая часть старых находок, удалены. Компоненты заметно переведены на Tailwind utilities и общие UI primitives.

Текущий долг теперь другой: `tailwind.css` всё ещё является большим legacy-сводом, а новая semantic token system сосуществует со старым `@theme` и aliases.

## Текущие показатели

| Метрика | 28 августа | 18 сентября |
|---|---:|---:|
| CSS-файлы в `frontend/src` | 13+ | **7** |
| Общий entry CSS | 1413 строк | **965 строк** |
| Token CSS | 447 строк / 6 файлов | **503 строки / 6 файлов** |
| `@apply` в entry CSS | 293 | **95** |
| `!important` | 9 | **1** |
| `className=` в TSX | 297 utility-вхождений в 14 файлах по старому подсчёту | **680 атрибутов в 121 файле** |
| `style={{...}}` | 24 в 8 файлах | **20 в 15 файлах** |
| `@media` в CSS | 58 | **31** |

Метрики разных дат получены разными срезами и не являются строгой исторической статистикой, но направление миграции видно однозначно.

## Что исправлено

### 1. Удалены конкурирующие CSS-точки

Все runtime-стили подключаются через `tailwind.css`, который импортирует `tokens/index.css`. Случайного порядка между page/settings/editor CSS больше нет.

### 2. Устранён класс конфликтов между файлами

Старые конфликты `.active`, `.is-active`, `.thread-composer`, `.thread-call-button`, `.settings-left-pane` между разными файлами больше не существуют: второй competing stylesheet удалён. Локальные состояния в основном выражены utilities/data attributes.

### 3. Почти исчез `!important`

Осталось одно использование в `tailwind.css` для скрытия элемента. Это уже не системный способ разрешать cascade conflicts.

### 4. Компоненты используют общую UI-систему

В `shared/ui` есть Button, Modal, ContextMenu, Select, SegmentedControl, Slider, Radio, Switch, Toast, Skeleton и другие primitives. Semantic utilities `text-ink`, `bg-sheet`, `border-line`, `text-brand` широко используются в компонентах.

### 5. Темы реально работают через semantic tokens

Светлая тема задаётся semantic defaults, тёмная — `[data-theme='dark']`. Цвета поверхностей, текста, bubbles, status и elevation переключаются через CSS variables, а не отдельную копию component CSS.

### 6. Добавлен reduced-motion guard

Есть `@media (prefers-reduced-motion: reduce)`. Это хорошая основа, хотя будущая пользовательская настройка анимаций ещё не реализована.

## Актуальные находки

### 1. `tailwind.css` остаётся монолитом

965 строк и 95 `@apply` означают, что значительная часть стилей всё ещё живёт далеко от компонентов. Миграция стала последовательнее, но не закончена.

Рекомендация: новые компоненты писать utilities-first; существующие блоки переносить по feature, удаляя правило сразу после переноса и не создавая новые глобальные component classes без причины.

### 2. Две системы цветовых имён всё ещё сосуществуют

В начале `tailwind.css` остаётся старый `@theme`:

- `--color-accent`, `--color-accent-2`;
- `--color-bg`, `--color-panel`, `--color-muted`;
- `--color-surface`, `--color-border`, `--color-rail`, `--color-nav`.

Новая система использует `--color-brand*`, `--color-ground`, `--color-sheet*`, `--color-ink*`, `--color-line*`. Старые значения всё ещё используются gradients/call UI и нескольких backgrounds, поэтому удалить блок целиком пока нельзя.

Рекомендация: заменить оставшиеся runtime-ссылки и затем удалить legacy `@theme` одним изменением.

### 3. `--react-*` aliases больше не используются потребителями

Восемь `--react-*` встречаются только в месте объявления. Их можно удалить после подтверждения, что public/legacy HTML не импортирует этот CSS напрямую.

Отдельный дефект:

```css
--react-text: var(--color-ink)fff;
```

Значение синтаксически некорректно как цвет. Сейчас это не ломает UI лишь потому, что alias не используется.

### 4. Breakpoints почти унифицированы, но не полностью

Основной порог — 768px: 23 `min-width: 768px`. При этом остаются два `max-width: 767px`, два `max-width: 768px` и три desktop range до 920/980/1180px.

Range breakpoints могут быть обоснованы pane layout, но граница 767/768 должна иметь одну договорённость, иначе ровно на 768px одновременно включаются несовместимые правила.

### 5. Остались raw colors вне token layer

Большинство допустимы как содержимое media editor/canvas или scrim поверх медиа. Но есть UI-исключения:

- hashtag fallback `#ff2d8b` в `MessageContent.tsx`;
- media metadata `rgba(255,255,255,0.58)`;
- scrollbar `#0d0e13`;
- старые call/image overlay colors в `tailwind.css`.

Рекомендация: разделить policy на «контентные цвета редактора» и «цвета chrome UI». Первые могут быть literal palette, вторые должны идти через semantic tokens.

### 6. Inline styles теперь в основном вычисляемые

20 `style={{...}}` используются для virtualized positions, progress width, slider thumb, drag/crop, menu coordinates и canvas/text overlays. Это корректные случаи, которые utilities не заменяют.

Стоит оставить lint/review-правило: inline style допустим для runtime geometry/content color, но не для постоянного цвета/spacing компонента.

### 7. Accent presets уже есть в токенах, но не подключены к настройкам

`tokens/accents.css` содержит несколько готовых наборов brand/bubble colors. `AppearanceSection` пока предлагает только light/dark и не меняет accent attribute/preset. Это не дефект CSS-архитектуры, но незавершённая продуктовая интеграция обязательного appearance block.

### 8. Нет автоматической проверки style regressions

В CI нет отдельной проверки:

- запрета новых raw UI colors;
- появления новых `!important`;
- возврата page-level CSS;
- неизвестных semantic tokens;
- visual regression light/dark/mobile.

## Рекомендуемый порядок работ

1. Исправить/удалить мёртвые `--react-*`, особенно некорректный `--react-text`.
2. Перевести оставшиеся `--color-accent/bg/panel` consumers на semantic tokens и удалить legacy `@theme` aliases.
3. Зафиксировать breakpoint policy (`md = 768`, mobile максимум 767).
4. Вынести оставшиеся крупные global component blocks в utilities/component ownership по мере изменений экранов.
5. Подключить accent presets и системную тему через root attributes.
6. Добавить visual smoke для light/dark × desktop/mobile и CI guard на новые raw UI colors/`!important`.

## Проверка после актуализации

- `npm test`: 125 test files, 759 tests — пройдены.
- `git diff --check` — пройден.
- Полный screenshot/visual regression в рамках этой актуализации не выполнялся.
