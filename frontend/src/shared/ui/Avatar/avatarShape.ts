import { createContext, useContext } from 'react';

export type TAvatarShape = 'letter' | 'grid';

/**
 * Вид замены фотографии, общий для всего приложения.
 *
 * Аватарка стоит в двух десятках мест, и протаскивать выбор пропсом
 * через всё дерево бессмысленно: это не свойство конкретной аватарки, а
 * настройка оформления. Проп у компонента остаётся и побеждает контекст —
 * им пользуются витрина компонентов и те места, где вид задан замыслом,
 * а не настройкой.
 *
 * Значение сюда кладёт приложение: библиотека объявляет точку расширения,
 * но сама о настройках и запросах ничего не знает.
 */
const AvatarShapeContext = createContext<TAvatarShape>('letter');

export const AvatarShapeProvider = AvatarShapeContext.Provider;

export function useAvatarShape(): TAvatarShape {
  return useContext(AvatarShapeContext);
}
