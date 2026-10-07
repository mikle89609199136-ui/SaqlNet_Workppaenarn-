import { Checkbox, ConfirmDialog } from '@/shared/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  /** Название чата — для текста подтверждения. */
  title: string;
  confirming?: boolean;
  /** `forBoth` — удалить и у собеседника. */
  onConfirm: (forBoth: boolean) => void;
  onCancel: () => void;
}

/**
 * Подтверждение «Удалить чат» — по макету (#825): чат исчезает у вас на
 * всех устройствах, галочкой — и у собеседника.
 *
 * Вход скрыт, пока нет самой функции на сервере (#838): меню строки
 * показывает пункт, только когда ему передали обработчик удаления.
 */
export function DeleteChatDialog({ open, title, confirming, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const [forBoth, setForBoth] = useState(false);

  return (
    <ConfirmDialog
      confirmLabel={t('deleteChat.confirm', 'Удалить')}
      confirming={confirming}
      danger
      onCancel={() => {
        setForBoth(false);
        onCancel();
      }}
      onConfirm={() => onConfirm(forBoth)}
      open={open}
      title={t('deleteChat.title', 'Удалить чат?')}
    >
      <span className="flex flex-col gap-3.5">
        <span>
          {t(
            'deleteChat.text',
            'Чат «{{title}}» исчезнет из списка на этом и других ваших устройствах.',
            { title }
          )}
        </span>
        <Checkbox
          checked={forBoth}
          label={t('deleteChat.forBoth', 'Удалить и у собеседника')}
          onChange={(event) => setForBoth(event.target.checked)}
        />
      </span>
    </ConfirmDialog>
  );
}
