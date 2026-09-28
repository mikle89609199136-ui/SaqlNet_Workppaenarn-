# Noto Emoji

Картинки эмодзи для панели в поле ввода и реакций (#824).

- `*.svg` — [Noto Emoji](https://github.com/googlefonts/noto-emoji), Google, лицензия Apache 2.0.
- `*.webp` — [Noto Emoji Animation](https://googlefonts.github.io/noto-emoji-animation/), Google, лицензия CC BY 4.0. Уменьшены до 72×72.

Имя файла — кодовые точки эмодзи в hex без селектора вида `fe0f`, через `_`: «❤️» → `2764.svg`.

Набор — `src/shared/config/emoji.ts`. Тест `emoji.node.test.ts` проверяет, что у каждого эмодзи набора есть файл.
