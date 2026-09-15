import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tailwind from 'eslint-plugin-tailwindcss';
import tseslint from 'typescript-eslint';

/**
 * Проверка кода.
 *
 * Заведена предупреждениями, а не ошибками, и это осознанно (#365):
 * проверка типов уже отключена в конвейере из-за двух сотен ошибок
 * (#253), и если новый линтер сразу покрасит сборку в красный, его
 * выключат тем же способом. Сначала он должен показывать, что не так, —
 * обязательным делаем по частям, когда долг разобран.
 *
 * Исключение — правила хуков: неверные зависимости эффекта дают дефекты,
 * которые невозможно найти чтением, и такие у нас уже были.
 */
export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      // Генерируется openapi-typescript из contracts/openapi.
      'src/types/api.generated.ts',
      // Клиент до React: заморожен и ничем не собирается, см. legacy/README.md.
      '../legacy',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /* Единственное, что сразу ошибка: нарушение порядка хуков ломает
         React, а не просто пахнет. Нарушений сейчас нет — правило стоит
         как заслон на будущее, а не как долг.

         Остальное от хуков — предупреждения, хотя находки настоящие:
         девять эффектов с неполными зависимостями, двенадцать с
         синхронным setState, семь обращений к ref во время отрисовки.
         Разбирать их надо, но не ценой красной сборки на старте. */
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/incompatible-library': 'warn',

      /* Из рекомендованного набора эти приходят ошибками. Понижены по
         той же причине: сначала показать объём, потом ужесточать. */
      'no-empty': 'warn',
      'no-useless-assignment': 'warn',
      'prefer-const': 'warn',

      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      /* Неиспользуемое с подчёркиванием — намеренно оставленное:
         `catch (_error)` там, где ошибка не нужна, но поймать её надо. */
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      /* `any` в проекте есть, и разом его не убрать — предупреждение,
         чтобы новый не появлялся незаметно. */
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  /* Границы слоёв — Feature-Sliced Design (#623, #628, эпик #622).
     Зависимости направлены строго сверху вниз:
     app -> pages -> widgets -> features -> entities -> shared.
     Нижние слои не знают о верхних. */
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/entities',
                '@/entities/*',
                '@/features',
                '@/features/*',
                '@/widgets',
                '@/widgets/*',
                '@/pages',
                '@/pages/*',
                '@/app',
                '@/app/*',
                '@/store',
                '@/store/*',
                '@/services',
                '@/services/*',
                '@/queries/*',
                '@/hooks',
              ],
              message: 'Нижний слой не знает о верхних.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/types/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/features',
                '@/features/*',
                '@/widgets',
                '@/widgets/*',
                '@/pages',
                '@/pages/*',
                '@/app',
                '@/app/*',
                '@/store',
                '@/store/*',
                '@/services',
                '@/services/*',
                '@/queries/*',
                '@/hooks',
              ],
              message: 'Слой типов не знает о фичах, виджетах, страницах и сторах.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/entities/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/features',
                '@/features/*',
                '@/widgets',
                '@/widgets/*',
                '@/pages',
                '@/pages/*',
                '@/app',
                '@/app/*',
              ],
              message: 'Сущности не знают о фичах, виджетах, страницах и приложении.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/widgets',
                '@/widgets/*',
                '@/pages',
                '@/pages/*',
                '@/app',
                '@/app/*',
              ],
              message: 'Фичи не знают о виджетах, страницах и приложении.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/widgets/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/pages', '@/pages/*', '@/app', '@/app/*'],
              message: 'Виджет не знает о странице и о приложении.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/pages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/app', '@/app/*'],
              message: 'Страница не знает о слое приложения.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/store/**/*.{ts,tsx}', 'src/queries/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/widgets',
                '@/widgets/*',
                '@/pages',
                '@/pages/*',
                '@/app',
                '@/app/*',
              ],
              message: 'Слой данных не знает о разметке.',
            },
          ],
        },
      ],
    },
  },

  /* Запросам обращаться к сервисам положено — так устроен слой данных
     (docs/frontend-data-architecture.md). Хранилищам нет: состояние не
     ходит в сеть само. */
  {
    files: ['src/store/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/widgets',
                '@/widgets/*',
                '@/pages',
                '@/pages/*',
                '@/app',
                '@/app/*',
              ],
              message: 'Слой данных не знает о разметке.',
            },
            {
              group: [
                '@/services/serviceContainer',
                '@/services/WebSocketClient',
                '@/services/ringtone',
              ],
              message:
                'Хранилище не дёргает сервисы напрямую. Если нужно — это не хранилище, а сценарий: место в features. Пример — store/call.ts.',
            },
          ],
        },
      ],
    },
  },

  /* Проверка Tailwind вынесена отдельным блоком: правил немного, но
     каждое отвечает своему пункту из docs/frontend-style-system.md. */
  {
    files: ['**/*.tsx'],
    plugins: { tailwindcss: tailwind },
    settings: {
      tailwindcss: {
        // Токены объявлены в @theme, и плагин читает их оттуда — иначе
        // `bg-sheet-2` и прочая семантика окажется «неизвестной».
        // Параметр называется cssConfigPath: по умолчанию плагин ищет
        // src/style.css, которого у нас нет.
        cssConfigPath: 'src/app/styles/tailwind.css',
      },
    },
    rules: {
      /* Ловит `bg-sheet-3`, которого не существует. Ровно этот случай
         дважды за день доходил до ревью: класс не создаётся, наведение
         молча не работает, ошибки нигде нет.

         В исключениях — префиксы наших собственных классов из CSS
         (199 штук на два файла). Без них правило даёт 244 замечания на
         `message-bubble` и подобное, и полезные тонут в шуме.

         Список временный. Стили переезжают в разметку по одному экрану
         (#360), и с каждым переехавшим префикс уходит отсюда. Когда
         уйдут все, правило начнёт ловить и опечатки в своих классах. */
      'tailwindcss/no-custom-classname': [
        'warn',
        {
          whitelist: [
            '(accept|action|active|app|avatar|back|call|card|chat|chats|close|contact|contacts)(-[a-z0-9-]+)?',
            '(create|css|danger|emoji|empty|fullscreen|group|has|image|incoming|is|loading|logo)(-[a-z0-9-]+)?',
            '(logout|member|members|message|minimized|mobile|nav|pinned|rail|reject|remove|retry)(-[a-z0-9-]+)?',
            '(ring|role|safety|selected|settings|status|styled|success|thread|timer|toast|user)(-[a-z0-9-]+)?',
            // Классы редактора фотографий: crop-*, photo-*.
            '(crop|photo)(-[a-z0-9-]+)?',
          ],
        },
      ],
      /* `p-2 p-4` в одном className: побеждает последняя, и не всегда та,
         что имелась в виду. */
      'tailwindcss/no-contradicting-classname': 'warn',
    },
  },

  /* В тестах свои правила: там нарочно бывают any и пустые обработчики. */
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },

  /* Конфигурационные файлы выполняются в Node, а не в браузере. */
  {
    files: ['*.config.{js,ts}', 'scripts/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  }
);
