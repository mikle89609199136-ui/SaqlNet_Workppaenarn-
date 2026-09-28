import { useChatUiStore } from '@/entities/chat';
import { getMessagePreview } from '@/entities/message';
import { useProfileStore } from '@/entities/user';
import { useTranslation } from 'react-i18next';
import { ComposerStrip } from './ComposerStrip';

interface Props {
  onCancel: () => void;
}

/**
 * Над полем — на что отвечают или что правят, по макету (#821): иконка
 * действия, под полосой акцента — чьё сообщение и его текст.
 */
export const ComposerContextBanner = ({ onCancel }: Props) => {
  const { t } = useTranslation();
  const editingMessage = useChatUiStore((state) => state.editingMessage);
  const replyToMessage = useChatUiStore((state) => state.replyToMessage);
  const me = useProfileStore((state) => state.user?.id);
  if (!editingMessage && !replyToMessage) return null;

  if (editingMessage) {
    return (
      <ComposerStrip
        cancelLabel={t('cancelEditing', 'Отменить редактирование')}
        icon="edit"
        onCancel={onCancel}
        text={getMessagePreview(editingMessage)}
        title={t('editingMessage', 'Редактирование')}
      />
    );
  }

  const author =
    replyToMessage?.senderId === me
      ? t('you', 'Вы')
      : replyToMessage?.senderName || replyToMessage?.senderFirstName || t('replyTo', 'Ответ');

  return (
    <ComposerStrip
      cancelLabel={t('cancelReply', 'Отменить ответ')}
      icon="reply"
      onCancel={onCancel}
      text={getMessagePreview(replyToMessage)}
      title={author}
    />
  );
};
