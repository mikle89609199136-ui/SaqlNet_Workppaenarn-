/* Поле ввода — по доске «Чат» (#821).

   Футер: 6 / 10 / 14 на телефоне, 8 / 16 / 18 на планшете вертикально,
   8 / 18 / 18 горизонтально, 8 / 20 / 20 на ПК — снизу ещё вырез экрана.
   Карточка: скругление 20, фон composer, декоративная рамка, лёгкая тень
   только в светлой теме. */
export const composerFooter =
  'w-full px-2.5 pt-1.5 pb-[calc(14px+env(safe-area-inset-bottom,0px))] md:px-4 md:pt-2 md:pb-4.5 lg:px-4.5 xl:px-5 xl:pb-5';

export const composerCard = [
  'relative flex flex-col rounded-window border border-divider bg-composer shadow-[var(--shadow-composer)]',
  'transition-[border-color,box-shadow] duration-[200ms]',
  /* В фокусе поля — рамка акцента и кольцо, как в макете. */
  'has-[[contenteditable]:focus]:border-brand has-[[contenteditable]:focus]:shadow-[0_0_0_3px_var(--color-brand-soft)]',
].join(' ');
