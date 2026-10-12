import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ConfirmDialog,
  Icon,
  ListGroup,
  ListItemButton,
  ListNavItem,
  ListStaticItem,
  showToast,
} from '@/shared/ui';
import { AppUpdateSettingItem } from '@/features/app-update';
import { APP_BUILT_AT, APP_VERSION } from '@/shared/config';
import { useTranslation } from 'react-i18next';
import { services } from '@/services/serviceContainer';

export function AboutSection() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [wipeAsked, setWipeAsked] = useState(false);
  const [wiping, setWiping] = useState(false);

  async function downloadExport() {
    setExporting(true);
    try {
      const data = await services.userService.exportData();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'craneapp-data.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (_) {
      showToast('error', t('toast.exportFailed', 'Не удалось выгрузить данные'));
    } finally {
      setExporting(false);
    }
  }

  async function wipeDevice() {
    setWiping(true);
    try {
      await services.cryptoService.wipeDevice();

      /* Ключей больше нет, но расшифрованные сообщения остались в памяти
         вкладки — до перезагрузки их видно как ни в чём не бывало. Тот же
         запрет, что при выходе из аккаунта. */
      queryClient.clear();

      setWipeAsked(false);
      showToast('success', t('toast.keysDeleted', 'Ключи удалены с этого устройства'));
    } catch (_) {
      showToast('error', t('toast.keysDeleteFailed', 'Не удалось удалить ключи'));
    } finally {
      setWiping(false);
    }
  }

  return (
    <>
      <ListGroup>
        <ListStaticItem
          hint={
            APP_BUILT_AT
              ? t('settings.about.builtAt', 'Сборка от {{date}}', {
                  date: new Intl.DateTimeFormat(i18n.language, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(APP_BUILT_AT)),
                })
              : undefined
          }
          label={t('settings.about.description', 'CraneApp Messenger')}
          leading={
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-brand-fill text-on-brand"
            >
              <Icon className="size-4.5 stroke-[1.8px]" name="info" />
            </span>
          }
          trailing={
            <span className="shrink-0 text-ui text-ink-3">
              {t('settings.about.versionValue', 'Версия {{version}}', { version: APP_VERSION })}
            </span>
          }
        />
        {/* Новая версия без переустановки (#892). */}
        <AppUpdateSettingItem />
      </ListGroup>

      {/* Названия «экспортировать мои данные» человек читает как «выгрузить
          переписку». Переписки в выгрузке нет — сервер отдаёт профиль,
          настройки и перечень чатов без сообщений. Сказать об этом честно
          дешевле, чем разбирать потом, почему файл «пустой». */}
      <ListGroup
        note={t(
          'settings.about.exportBanner',
          'В файл попадут профиль, настройки и список чатов. Сообщений в нём нет: они зашифрованы ключами этого устройства и на сервере не хранятся в читаемом виде.'
        )}
        title={t('settings.about.yourData', 'Ваши данные')}
      >
        <ListStaticItem
          hint={t('settings.about.exportHint', 'Файл JSON со сведениями об учётной записи')}
          icon="download"
          label={t('settings.about.export', 'Выгрузить данные')}
          trailing={
            <ListItemButton disabled={exporting} onClick={downloadExport}>
              {t('settings.about.exportAction', 'Выгрузить')}
            </ListItemButton>
          }
        />
      </ListGroup>

      {/* Что будет с перепиской — в окне подтверждения. */}
      <ListGroup title={t('settings.about.thisDevice', 'Это устройство')}>
        <ListNavItem
          icon="trash"
          label={t('settings.about.wipe', 'Удалить ключи с этого устройства')}
          onClick={() => setWipeAsked(true)}
          tone="danger"
        />
      </ListGroup>

      <ConfirmDialog
        confirmLabel={t('settings.about.wipeConfirm', 'Удалить ключи')}
        confirming={wiping}
        danger
        onCancel={() => setWipeAsked(false)}
        onConfirm={wipeDevice}
        open={wipeAsked}
        title={t('settings.about.wipeTitle', 'Удалить ключи с этого устройства?')}
      >
        {t(
          'settings.about.wipeConfirmText',
          'Ключи шифрования будут удалены с этого устройства. Переписка останется в резервной копии: чтобы снова читать её здесь, введите облачный пароль или подтвердите вход с другого устройства.'
        )}
      </ConfirmDialog>
    </>
  );
}
