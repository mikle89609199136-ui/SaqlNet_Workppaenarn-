import { describeApiError } from '@/api';
import { Avatar, Button, Icon, Modal } from '@/components/ui';
import { useToasts } from '@/hooks';
import { services } from '@/services';
import { membersQuery } from '@/queries/chat/membersQuery';
import { chatQuery } from '@/queries/chat/threadQueries';
import { chatKeys } from '@/queries/keys';
import { clearDraft } from '@/store/chatDrafts';
import { useProfileStore } from '@/store';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TChatRole } from '@/types';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function GroupInfoModal({ isOpen, onClose }: Props) {
  const { showToast } = useToasts();
  const [isEditMode, setEditMode] = useState(false);
  const navigate = useNavigate();
  const currentUserData = useProfileStore((state) => state.user);
  const { t } = useTranslation();
  const { chatId = '' } = useParams<{ chatId: string }>();
  const queryClient = useQueryClient();
  const { data: chat } = useQuery(chatQuery(chatId));
  const {
    data: members = [],
    isPending: isLoading,
    error: membersError,
  } = useQuery({ ...membersQuery(chatId), enabled: Boolean(chatId) && isOpen });

  // Права видны из той же записи об участнике, что и всё остальное.
  const currentUser = members.find((member) => member.id === currentUserData?.id) ?? null;

  /* Поле названия заполняется из чата сразу, а дальше следует за ним
     сравнением во время отрисовки, а не эффектом: тот заполнял бы поле
     после первой отрисовки, и правка открывалась бы пустой, а при
     переходе в другую группу показывала прежнее название. */
  const [chatName, setChatName] = useState(chat?.title ?? '');
  const [seenTitle, setSeenTitle] = useState(chat?.title);

  if (chat && chat.title !== seenTitle) {
    setSeenTitle(chat.title);
    setChatName(chat.title);
  }

  useEffect(() => {
    if (membersError) showToast('error', t('error', 'Ошибка загрузки участников'));
  }, [membersError, showToast, t]);

  if (!chat) return null;

  async function handleAction(
    action: string,
    userId: string,
    body: { role: TChatRole } | null = null
  ) {
    if (!body) return;
    try {
      if (action === 'change-participant-role') {
        await services.chatService.setMemberRole(chatId, userId, body?.role);
      } else if (action === 'kick-participant') {
        await services.chatService.removeMember(chatId, userId);
      } else {
        throw new Error('Unsupported group action');
      }

      // Перезапрос вместо правки списка на месте: раньше изменение жило
      // только в состоянии модалки и пропадало при переоткрытии.
      await queryClient.invalidateQueries({ queryKey: chatKeys.members(chatId) });
    } catch (err: any) {
      showToast(
        'error',
        describeApiError(err, t, t('toast.actionFailed', 'Ошибка выполнения действия'))
      );
    }
  }

  const handleToggleEditMode = () => {
    if (isEditMode) {
      setEditMode(false);
      setChatName(chat.title);
      return;
    }

    setEditMode(true);
  };

  const handleSaveEdited = async () => {
    if (!chat) return;

    await services.chatService.updateChat(chat.id, { title: chatName });
    // Название хранится в кеше чата: перезапрашиваем его вместо ручной правки
    // в двух местах, как было раньше.
    await queryClient.invalidateQueries({ queryKey: chatKeys.detail(chat.id) });
    handleToggleEditMode();
  };

  const handleLeaveChat = async () => {
    if (!currentUserData?.id || !chat) return;
    try {
      await services.chatService.removeMember(chat.id, currentUserData.id);
      clearDraft(chat.id);
      queryClient.removeQueries({ queryKey: chatKeys.detail(chat.id) });
      await queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      onClose();
      navigate('/chats');
    } catch (err: any) {
      showToast(
        'error',
        describeApiError(err, t, t('toast.leaveChatFailed', 'Не удалось покинуть чат'))
      );
    }
  };

  const handleDeleteChat = async () => {
    try {
      await services.chatService.deleteChat(chat.id);

      clearDraft(chat.id);
      queryClient.removeQueries({ queryKey: chatKeys.detail(chat.id) });
      await queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      navigate('/chats');
    } catch (err: any) {
      showToast(
        'error',
        describeApiError(
          err,
          t,
          t('toast.chatDeleteFailed', 'Не удалось удалить чат, попробуйте ещё раз')
        )
      );
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      className="flex h-full max-h-screen w-full max-w-125 flex-col overflow-hidden rounded-none bg-sheet pt-0 backdrop:bg-black/40 backdrop:backdrop-blur-sm md:max-h-[85vh] md:rounded-window"
      label={t('groupInfo', 'Сведения о группе')}
      onClose={onClose}
    >
      <header className="flex flex-col gap-y-4 justify-between items-center px-5 py-6 border-b border-line">
        <div className="flex w-full items-center justify-between gap-x-2">
          <div className="flex w-full items-center gap-x-3">
            <Avatar name={chat?.title} size="lg" src={chat?.avatarUrl} />
            <div className="flex flex-col w-full min-w-0">
              {!isEditMode ? (
                <h2 className="text-lg font-medium text-ink truncate">{chat?.title}</h2>
              ) : (
                <label className="flex flex-col border-b border-line focus-within:border-b-brand pb-1">
                  <span className="text-micro text-ink-3">{t('chatName', 'Название чата')}</span>
                  <input
                    className="w-full bg-transparent text-body text-ink outline-none"
                    type="text"
                    value={chatName}
                    onChange={(e) => setChatName(e.target.value)}
                  />
                </label>
              )}
              {!isEditMode && (
                <p className="text-micro text-ink-3">
                  {members.length} {t('participants', 'участников')}
                </p>
              )}
            </div>
          </div>
          <Button
            aria-label={t('close', 'Закрыть')}
            className="shrink-0 text-ink-3 hover:text-ink"
            onClick={onClose}
            size="sm"
            variant="ghost"
          >
            <Icon name="cross" size="md" />
          </Button>
        </div>

        <div className="flex gap-x-2 w-full">
          {!isEditMode && (
            <>
              <Button
                className="w-full"
                onClick={handleToggleEditMode}
                size="sm"
                variant="secondary"
              >
                {t('edit', 'Редактировать')}
              </Button>
              <Button className="w-full" onClick={handleLeaveChat} size="sm" variant="danger">
                {t('leaveChat', 'Покинуть чат')}
              </Button>
              {currentUser?.role === 'owner' && (
                <Button className="w-full" onClick={handleDeleteChat} size="sm" variant="danger">
                  {t('deleteChat', 'Удалить чат')}
                </Button>
              )}
            </>
          )}
          {isEditMode && (
            <>
              <Button className="w-full" onClick={handleSaveEdited} size="sm" variant="primary">
                {t('save', 'Сохранить')}
              </Button>
              <Button className="w-full" onClick={handleToggleEditMode} size="sm" variant="ghost">
                {t('cancel', 'Отменить')}
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="group-info-body flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="text-center py-6 text-ink-3">{t('loading', 'Загрузка...')}</div>
        ) : (
          <ul className="divide-y divide-divider rounded-window border border-line bg-sheet-2">
            {members.map((member) => {
              const memberId = member.id;
              const avatarUrl = member.avatarUrl;
              return (
                <li key={memberId} className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar id={memberId} name={member.username} size="md" src={avatarUrl} />
                    <div className="flex flex-col min-w-0">
                      <span className="text-body font-medium text-ink truncate">
                        {member.username}
                      </span>
                      <span className="text-micro text-ink-3">{member.role}</span>
                    </div>
                  </div>

                  {(currentUser?.role === 'owner' || currentUser?.role === 'admin') &&
                    memberId !== currentUserData?.id && (
                      <div className="flex items-center gap-2">
                        {currentUser?.role === 'owner' && (
                          <Button
                            onClick={() =>
                              handleAction('change-participant-role', memberId, {
                                role: member.role === 'admin' ? 'member' : 'admin',
                              })
                            }
                            size="sm"
                            variant="ghost"
                          >
                            {member.role === 'admin'
                              ? t('demoteAdmin', 'Снять админа')
                              : t('makeAdmin', 'Дать админа')}
                          </Button>
                        )}
                        {member.role !== 'owner' && (
                          <Button
                            onClick={() => handleAction('kick-participant', memberId)}
                            size="sm"
                            variant="danger"
                          >
                            {t('kick', 'Удалить')}
                          </Button>
                        )}
                      </div>
                    )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
