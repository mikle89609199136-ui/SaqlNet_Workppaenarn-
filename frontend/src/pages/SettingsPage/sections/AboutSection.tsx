import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, ConfirmDialog } from '@/components/ui';
import { APP_VERSION } from '@/consts';
import { useTranslation } from 'react-i18next';
import { useToasts } from '@/hooks/useToasts';
import { services } from '@/services/serviceContainer';
import { SettingsRow, SettingsSection } from '../SettingsControls';

export function AboutSection() {
  const { t } = useTranslation();
  const { showToast } = useToasts();
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
      showToast('error', 'Не удалось выгрузить данные');
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
      showToast('success', 'Ключи удалены с этого устройства');
    } catch (_) {
      showToast('error', 'Не удалось удалить ключи');
    } finally {
      setWiping(false);
    }
  }

  return (
    <SettingsSection
      description={t('settings.about.description', 'CraneApp Messenger')}
      title={t('settings.about.title', 'О приложении')}
    >
      <SettingsRow label={t('settings.about.version', 'Версия')}>
        <span className="text-body text-ink-2">{APP_VERSION}</span>
      </SettingsRow>

      {/* Названия «экспортировать мои данные» человек читает как «выгрузить
          переписку». Переписки в выгрузке нет — сервер отдаёт профиль,
          настройки и перечень чатов без сообщений. Сказать об этом честно
          дешевле, чем разбирать потом, почему файл «пустой». */}
      <Banner tone="info">
        {t(
          'settings.about.exportBanner',
          'В файл попадут профиль, настройки и список чатов. Сообщений в нём нет: они зашифрованы ключами этого устройства и на сервере не хранятся в читаемом виде.'
        )}
      </Banner>

      <SettingsRow
        description={t('settings.about.exportHint', 'Файл JSON со сведениями об учётной записи')}
        label={t('settings.about.export', 'Выгрузить данные')}
      >
        <Button loading={exporting} onClick={downloadExport} variant="secondary">
          {t('settings.about.exportAction', 'Выгрузить')}
        </Button>
      </SettingsRow>

      <Banner icon="key" tone="warn">
        {t(
          'settings.about.wipeBanner',
          'Ключи шифрования хранятся только здесь и восстановлению не подлежат. После удаления прошлые сообщения на этом устройстве прочитать будет нечем — ни вам, ни поддержке.'
        )}
      </Banner>

      <SettingsRow
        description={t(
          'settings.about.wipeHint',
          'Прошлая переписка на этом устройстве перестанет открываться'
        )}
        label={t('settings.about.wipe', 'Удалить ключи с устройства')}
      >
        <Button onClick={() => setWipeAsked(true)} variant="danger">
          {t('settings.about.wipeAction', 'Удалить')}
        </Button>
      </SettingsRow>

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
          'Вся переписка, полученная на этом устройстве, перестанет открываться. Восстановить её нечем: ключи не покидают устройство и копии у сервера нет. Новые сообщения будут приходить после повторного входа.'
        )}
      </ConfirmDialog>
    </SettingsSection>
  );
}
