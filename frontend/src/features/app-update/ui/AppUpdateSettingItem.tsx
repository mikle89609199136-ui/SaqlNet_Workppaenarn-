import { useTranslation } from 'react-i18next';
import { ListItemButton, ListStaticItem } from '@/shared/ui';
import { checkForUpdate, useAppUpdateStore } from '../model/appUpdate';
import { useUpdateAction } from './useUpdateAction';

/**
 * «Обновления» в «О приложении» (#892): итог последней проверки и кнопка —
 * «Проверить» или, если новая сборка есть, «Обновить».
 */
export function AppUpdateSettingItem({
  check = () => checkForUpdate({ manual: true }),
  ...actions
}: { check?: () => unknown } & Parameters<typeof useUpdateAction>[0]) {
  const { t } = useTranslation();
  const remote = useAppUpdateStore((state) => state.remote);
  const checking = useAppUpdateStore((state) => state.checking);
  const lastCheck = useAppUpdateStore((state) => state.lastCheck);
  const { label, busy, start, dialog } = useUpdateAction(actions);

  const hint = remote
    ? t('appUpdate.setting.available', 'Доступна версия {{version}}', { version: remote.version })
    : lastCheck === 'latest'
      ? t('appUpdate.setting.latest', 'Установлена последняя версия')
      : lastCheck === 'failed'
        ? t('appUpdate.setting.failed', 'Не удалось проверить: нет связи с сервером')
        : t('appUpdate.setting.hint', 'Проверяются сами, пока приложение открыто');

  return (
    <>
      <ListStaticItem
        hint={hint}
        icon="download"
        label={t('appUpdate.setting.label', 'Обновления')}
        trailing={
          remote ? (
            <ListItemButton disabled={busy} onClick={start}>
              {label}
            </ListItemButton>
          ) : (
            <ListItemButton disabled={checking} onClick={() => void check()}>
              {checking
                ? t('appUpdate.setting.checking', 'Проверка…')
                : t('appUpdate.setting.check', 'Проверить')}
            </ListItemButton>
          )
        }
      />
      {dialog}
    </>
  );
}
