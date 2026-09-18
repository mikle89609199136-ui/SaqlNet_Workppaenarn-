import { useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import type { IPrivacyDto, ISettingsDto, ISettingsPayloadDto } from '@/types';
import { userKeys } from '../model/userKeys';

/**
 * Сохранение настроек и приватности.
 *
 * Лежит рядом с `settingsQuery`, а не в отдельной папке мутаций: ключ кеша
 * у них общий, инвалидация общая, и читать их порознь бессмысленно.
 *
 * Три вещи, которые здесь делаются намеренно:
 *
 * **Уходит патч, а не весь объект.** Сервер сливает изменения
 * (`settings = settings || $2::jsonb`), поэтому слать нужно только
 * изменённое поле. Раньше уходил весь объект, собранный на момент клика, и
 * два быстрых переключения затирали друг друга: второй запрос отправлял
 * состояние, в котором первого изменения ещё не было.
 *
 * Оговорка на будущее: `||` сливает только верхний уровень. Если настройка
 * станет вложенной, патч `{ notifications: { sound: false } }` заменит весь
 * объект `notifications`, а не одно поле.
 *
 * **Значение показывается до ответа сервера.** Переключатель обязан
 * отзываться сразу, поэтому новое значение кладётся в кеш в `onMutate`.
 *
 * **Ошибка возвращает прежнее значение.** Снимок кеша сохраняется до
 * записи и восстанавливается в `onError`. Без этого человек видел
 * «не удалось сохранить» и включённый переключатель одновременно, а после
 * перезагрузки тот возвращался обратно.
 */

/** Слияние патча в ту половину ответа, к которой он относится. */
function mergeSettings(
  current: ISettingsPayloadDto | undefined,
  patch: Partial<ISettingsDto>
): ISettingsPayloadDto {
  return {
    settings: { ...current?.settings, ...patch },
    privacy: current?.privacy ?? {},
  };
}

function mergePrivacy(
  current: ISettingsPayloadDto | undefined,
  patch: Partial<IPrivacyDto>
): ISettingsPayloadDto {
  return {
    settings: current?.settings ?? {},
    privacy: { ...current?.privacy, ...patch },
  };
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: Partial<ISettingsDto>) => services.userService.updateSettings(patch),

    onMutate: async (patch) => {
      // Запрос, идущий прямо сейчас, ответит старым значением и затрёт
      // только что показанное новое — поэтому его нужно отменить.
      await queryClient.cancelQueries({ queryKey: userKeys.settings() });

      const previous = queryClient.getQueryData<ISettingsPayloadDto>(userKeys.settings());
      queryClient.setQueryData<ISettingsPayloadDto>(userKeys.settings(), (current) =>
        mergeSettings(current, patch)
      );

      return { previous };
    },

    onError: (_error, _patch, context) => {
      queryClient.setQueryData(userKeys.settings(), context?.previous);
    },

    // Ответ сервера — окончательное состояние: у него могли быть свои
    // умолчания и правки, которых клиент не предполагал.
    onSettled: () => queryClient.invalidateQueries({ queryKey: userKeys.settings() }),
  });
}

export function useUpdatePrivacy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: Partial<IPrivacyDto>) => services.userService.updatePrivacy(patch),

    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: userKeys.settings() });

      const previous = queryClient.getQueryData<ISettingsPayloadDto>(userKeys.settings());
      queryClient.setQueryData<ISettingsPayloadDto>(userKeys.settings(), (current) =>
        mergePrivacy(current, patch)
      );

      return { previous };
    },

    onError: (_error, _patch, context) => {
      queryClient.setQueryData(userKeys.settings(), context?.previous);
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: userKeys.settings() }),
  });
}
