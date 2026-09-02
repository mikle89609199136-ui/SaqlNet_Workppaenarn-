import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
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
  cancelLabel = 'Отмена',
  danger = false,
  confirming = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal
      footer={
        <>
          <Button onClick={onCancel} variant="ghost">
            {cancelLabel}
          </Button>
          <Button loading={confirming} onClick={onConfirm} variant={danger ? 'danger' : 'primary'}>
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
