import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { chatKeys, chatQuery, useChatUiStore } from '@/entities/chat';
import { patchThreadMessage } from '@/entities/message';
import { services } from '@/services/serviceContainer';
import { ConfirmDialog } from '@/shared/ui';
import { describeApiError } from '@/shared/api';

export function PinMessageDialog() {
  const request = useChatUiStore((state) => state.pinRequest);
  return request ? <PinMessageDialogContent request={request} /> : null;
}

function PinMessageDialogContent({
  request,
}: {
  request: NonNullable<ReturnType<typeof useChatUiStore.getState>['pinRequest']>;
}) {
  const { chatId = '' } = useParams<{ chatId: string }>();
  const { data: chat } = useQuery(chatQuery(chatId));
  const setRequest = useChatUiStore((state) => state.setPinRequest);
  const client = useQueryClient();
  const { t } = useTranslation();
  const [scope, setScope] = useState<'chat' | 'personal'>(() =>
    request.unpin && !request.targets.some((message) => message.isPersonalPinned)
      ? 'chat'
      : 'personal'
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canShare =
    chat?.type !== 'self' &&
    (chat?.type === 'private' || chat?.role === 'owner' || chat?.role === 'admin');
  const canPersonal =
    !request?.unpin || request.targets.some((message) => message.isPersonalPinned);
  const canChat =
    canShare &&
    (!request?.unpin ||
      request.targets.some((message) => message.isChatPinned ?? message.isPinned));

  async function confirm() {
    if (!request || saving || (scope === 'chat' ? !canChat : !canPersonal)) return;
    setSaving(true);
    setError('');
    try {
      for (const message of request.targets) {
        if (message.chatId !== chatId) throw new Error('Chat changed');
        if (request.unpin) await services.messageService.unpinMessage(chatId, message.id, scope);
        else await services.messageService.pinMessage(chatId, message.id, scope);
        patchThreadMessage(
          client,
          chatId,
          message.id,
          scope === 'personal'
            ? { isPersonalPinned: !request.unpin }
            : { isPinned: !request.unpin, isChatPinned: !request.unpin }
        );
        await client.invalidateQueries({
          queryKey: scope === 'personal' ? chatKeys.personalPins(chatId) : chatKeys.pins(chatId),
        });
      }
      setRequest(null);
    } catch (err) {
      setError(describeApiError(err, t, t('pinDialog.error', 'Не удалось изменить закрепление')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConfirmDialog
      open={Boolean(request)}
      title={
        request?.unpin
          ? t('pinDialog.unpinTitle', 'Открепить сообщение?')
          : t('pinDialog.title', 'Закрепить сообщение?')
      }
      confirmLabel={
        request?.unpin
          ? t('messageActions.unpin', 'Открепить')
          : t('messageActions.pin', 'Закрепить')
      }
      confirming={saving}
      onConfirm={confirm}
      onCancel={() => {
        if (!saving) setRequest(null);
      }}
    >
      <fieldset className="flex flex-col gap-3" disabled={saving}>
        <legend className="mb-3">{t('pinDialog.visibility', 'Область закрепления')}</legend>
        {canPersonal && (
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="pin-scope"
              value="personal"
              checked={scope === 'personal'}
              onChange={() => setScope('personal')}
            />
            {t('pinDialog.personal', 'Только для себя')}
          </label>
        )}
        {canChat && (
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="pin-scope"
              value="chat"
              checked={scope === 'chat'}
              onChange={() => setScope('chat')}
            />
            {chat?.type === 'private'
              ? t('pinDialog.private', 'Для меня и {{name}}', { name: chat.title })
              : t('pinDialog.everyone', 'Для всех участников')}
          </label>
        )}
        {error && <p role="alert">{error}</p>}
      </fieldset>
    </ConfirmDialog>
  );
}
