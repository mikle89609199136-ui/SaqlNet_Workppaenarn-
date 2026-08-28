import clsx, { type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/* tailwind-merge разбирает классы по своей таблице и не знает наших
   ступеней. Для него text-caption и text-ink — оба «text-» и оба про
   цвет, поэтому из пары он оставляет последний и размер шрифта молча
   пропадает. Поймано тестом кнопки: у мелкой не доезжали 13px.

   Здесь перечислена лесенка из design-system: с ней text-caption
   попадает в группу размера, а text-ink остаётся цветом, и спорить им
   больше не о чем. Новую ступень в scales.css надо добавлять и сюда. */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'caption', 'body', 'title', 'section', 'display'] }],
    },
  },
});

export const cn = (...classes: ClassValue[]) => {
  return twMerge(clsx(classes));
};
