import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { Modal } from '@/shared/ui/Modal';
import { normalizeLinkInput } from './normalizeLinkInput';

interface Props {
  open: boolean;
  /** Адрес уже стоящей ссылки: тогда её можно и убрать. */
  initialUrl: string | null;
  onApply: (url: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}

/** Адрес для выделенного текста (#656): добавить, поменять или убрать. */
export function LinkDialog({ open, initialUrl, onApply, onRemove, onCancel }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialUrl ?? '');
  const [invalid, setInvalid] = useState(false);

  const submit = (event?: SyntheticEvent) => {
    event?.preventDefault();
    const url = normalizeLinkInput(value);
    if (!url) {
      setInvalid(true);
      return;
    }
    onApply(url);
  };

  return (
    <Modal
      footer={
        <>
          {initialUrl && (
            <Button onClick={onRemove} variant="danger">
              {t('format.removeLink', 'Убрать ссылку')}
            </Button>
          )}
          <Button onClick={onCancel} variant="ghost">
            {t('cancel', 'Отмена')}
          </Button>
          <Button onClick={submit} type="button" variant="primary">
            {t('save', 'Сохранить')}
          </Button>
        </>
      }
      onClose={onCancel}
      open={open}
      title={
        initialUrl
          ? t('format.editLink', 'Изменить ссылку')
          : t('format.addLink', 'Добавить ссылку')
      }
    >
      <Input
        autoFocus
        error={invalid ? t('format.badLink', 'Нужен адрес вида https://example.com') : undefined}
        label={t('format.linkAddress', 'Адрес ссылки')}
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit(event);
          }
        }}
        placeholder="https://"
        value={value}
      />
    </Modal>
  );
}
