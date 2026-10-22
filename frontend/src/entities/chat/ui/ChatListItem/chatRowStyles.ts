/* Оформление строки списка чатов — общее для всех, кто её рисует:
   самой строки, скелетона и найденных людей в поиске.

   По дизайн-системе (ListRow, #819): строка 64px — аватар 46 и отступы
   9 / 12, скругление 16, между строками 2px зазора вместо разделителя.
   Наведение — слоем поверх фона. Открытый чат (aria-current="page")
   залит акцентом, и весь текст в нём белый: полупрозрачный белый на
   заливке части акцентов не держит контраст. Строка с открытым меню
   подсвечивается, чтобы было видно, к чему меню относится.

   group — чтобы части строки перекрашивались вместе с ней.

   `text-inherit` — потому что строкой бывает и ссылка, и кнопка: у
   каждой свой цвет текста от браузера. */
export const chatRowStyles =
  'group flex items-center gap-3 rounded-bubble px-3 py-(--chat-row-py) text-inherit no-underline ' +
  'transition-colors duration-[200ms] hover:layer-hover data-[menu=open]:bg-sheet-2 ' +
  'aria-[current=page]:bg-brand-fill aria-[current=page]:text-on-brand aria-[current=page]:hover:bg-none ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2';

/* Цвета частей строки: на открытом чате — белые. */
export const onCurrentRow = 'group-aria-[current=page]:text-on-brand';
