import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/Button';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  title: string;
  /** Что именно произойдёт — словами, а не «вы уверены?». */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Действие необратимо: кнопка подтверждения красная. */
  danger?: boolean;
  /** Подтверждение уже выполняется. */
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Подтверждение действия.
 *
 * Отдельно от каркаса, потому что здесь есть правило, которое нельзя
 * оставлять на усмотрение вызывающего: закрытие окна — по Escape, по
 * крестику, нажатием мимо — это **отказ**. Подтверждает только кнопка.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  danger = false,
  confirming = false,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();

  /* Диалог дизайн-системы (#817): узкий, кнопки маленькие; «Отмена» без
     фона, действие справа. Опасное — на подложке ошибки, и окно
     объявляется предупреждением. */
  return (
    <Modal
      alert={danger}
      className="w-[min(360px,calc(100vw-32px))]"
      footer={
        <>
          <Button onClick={onCancel} size="sm" variant="ghost">
            {cancelLabel ?? t('cancel', 'Отмена')}
          </Button>
          <Button
            loading={confirming}
            onClick={onConfirm}
            size="sm"
            variant={danger ? 'danger' : 'primary'}
          >
            {confirmLabel}
          </Button>
        </>
      }
      onClose={onCancel}
      open={open}
      title={title}
    >
      {children}
    </Modal>
  );
}
