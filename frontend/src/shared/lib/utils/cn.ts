import clsx, { type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/* tailwind-merge разбирает классы по своей таблице и не знает наших
   ступеней. Для него text-caption и text-ink — оба «text-» и оба про
   цвет, поэтому из пары он оставляет последний и размер шрифта молча
   пропадает. Поймано тестом кнопки: у мелкой не доезжали 13px.

   С радиусами и длительностями то же самое: rounded-control ему
   незнаком, спора с rounded-[...] он не видит и оставляет оба — а
   побеждает тот, что стоит позже в собранном CSS. Так у скелетона
   пузыря пропадал срезанный угол.

   Здесь перечислены наши имена целиком: с ними text-caption попадает в
   группу размера, rounded-bubble в группу радиуса, и спорить им есть о
   чём. Новое имя в scales.css надо добавлять и сюда.

   Слои наведения layer-hover и layer-press — это background-image
   (tailwind.css), поэтому они в одной группе с bg-none: место, которому
   подсветка не нужна, гасит её обычным hover:bg-none. */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'micro',
            'meta',
            'caption',
            'ui',
            'body',
            'subtitle',
            'title',
            'section',
            'display',
          ],
        },
      ],
      rounded: [
        {
          rounded: [
            'control',
            'field',
            'icon',
            'button',
            'bubble',
            'dialog',
            'window',
            'card',
            'pill',
          ],
        },
      ],
      'transition-duration': [{ duration: ['fast', 'panel', 'modal'] }],
      'bg-image': [{ layer: ['hover', 'press'] }],
    },
  },
});

export const cn = (...classes: ClassValue[]) => {
  return twMerge(clsx(classes));
};
