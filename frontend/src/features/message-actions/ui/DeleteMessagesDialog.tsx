import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatUiStore } from '@/entities/chat';
import { Checkbox, ConfirmDialog } from '@/shared/ui';
import type { IMessageDto } from '@/types';

interface Props {
  /** Тип открытого чата: подпись галочки в группе и в личном чате своя. */
  isGroup: boolean;
  currentUserId?: string;
  /** Удаляет выбранное; `false` — не вышло, диалог остаётся открытым. */
  onConfirm: (targets: IMessageDto[], forEveryone: boolean) => Promise<boolean>;
}

/**
 * «Удалить сообщение?» — по макету (#840).
 *
 * Все выбранные свои — галочка «Удалить и у собеседника» (в группе —
 * «Удалить у всех»), по умолчанию включена. Среди выбранных есть чужое —
 * галочки нет: удаляется только у себя, у остальных сообщения остаются.
 *
 * Что удалить, лежит в chatUiStore: меню сообщения закрывается сразу после
 * нажатия и унесло бы выбор с собой.
 */
export function DeleteMessagesDialog({ isGroup, currentUserId, onConfirm }: Props) {
  const { t } = useTranslation();
  const targets = useChatUiStore((state) => state.deleteTargets);
  const setDeleteTargets = useChatUiStore((state) => state.setDeleteTargets);
  const [forEveryone, setForEveryone] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const open = Boolean(targets?.length);
  // Каждое открытие — с включённой галочкой, как в макете.
  useEffect(() => {
    if (open) setForEveryone(true);
  }, [open]);

  const count = targets?.length ?? 0;
  const allOwn = Boolean(
    targets?.length && targets.every((item) => item.senderId === currentUserId)
  );
  const everyone = allOwn && forEveryone;

  const close = () => {
    if (!deleting) setDeleteTargets(null);
  };

  const confirm = async () => {
    if (!targets) return;
    setDeleting(true);
    try {
      if (await onConfirm(targets, everyone)) setDeleteTargets(null);
    } finally {
      setDeleting(false);
    }
  };

  const text = !everyone
    ? t('deleteMessages.onlyMe', 'Сообщения исчезнут только у вас.')
    : isGroup
      ? t('deleteMessages.everyoneGroup', 'Сообщения исчезнут у всех участников.')
      : t('deleteMessages.everyonePrivate', 'Сообщения исчезнут и у вас, и у собеседника.');

  return (
    <ConfirmDialog
      confirmLabel={t('deleteMessages.confirm', 'Удалить')}
      confirming={deleting}
      danger
      onCancel={close}
      onConfirm={confirm}
      open={open}
      title={t('deleteMessages.title', {
        count,
        defaultValue: count > 1 ? 'Удалить {{count}} сообщения?' : 'Удалить сообщение?',
      })}
    >
      <span className="flex flex-col gap-3.5">
        <span>{text}</span>
        {allOwn && (
          <Checkbox
            checked={forEveryone}
            label={
              isGroup
                ? t('deleteMessages.forEveryoneGroup', 'Удалить у всех')
                : t('deleteMessages.forEveryonePrivate', 'Удалить и у собеседника')
            }
            onChange={(event) => setForEveryone(event.target.checked)}
          />
        )}
      </span>
    </ConfirmDialog>
  );
}
