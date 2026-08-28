import { Avatar, Modal } from '@/components/ui';
import { useToasts } from '@/hooks';
import { services } from '@/services';
import { membersQuery } from '@/queries/chat/membersQuery';
import { chatQuery } from '@/queries/chat/threadQueries';
import { chatKeys } from '@/queries/keys';
import { clearDraft } from '@/store/chatDrafts';
import { useProfileStore } from '@/store';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TChatRole } from '@/types';
import { cn } from '@/utils';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const actionBtnStyles =
  'text-[#ddd] rounded-lg text-[0.8rem] cursor-pointer transition-all duration-200 font-medium bg-[rgba(255,255,255,0.1)] border border-[rgba(255,255,255,0.05)] px-3 py-1.5 hover:text-white hover:bg-[rgba(255,255,255,0.2)]';
const dangerBtn =
  'text-[#ff4444] bg-[rgba(255,50,50,0.1)] border-[rgba(255,50,50,0.2)] hover:text-[#ff6666] hover:bg-[rgba(255,50,50,0.2)]';

export function GroupInfoModal({ isOpen, onClose }: Props) {
  const { showToast } = useToasts();
  const [isEditMode, setEditMode] = useState(false);
  const [chatName, setChatName] = useState('');
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

  useEffect(() => {
    if (chat) {
      setChatName(chat.title);
    }
  }, [chat]);

  useEffect(() => {
    if (membersError) showToast('error', 'Ошибка загрузки участников', '❌');
  }, [membersError, showToast]);

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
      showToast('error', err.message || 'Ошибка выполнения действия', '❌');
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

  const handleLeaveChat = () => {};

  const handleDeleteChat = async () => {
    try {
      await services.chatService.deleteChat(chat.id);

      clearDraft(chat.id);
      queryClient.removeQueries({ queryKey: chatKeys.detail(chat.id) });
      await queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      navigate('/chats');
    } catch (err: any) {
      showToast('error', err.message || 'Не удалось удалить чат, попробуйте ещё раз', '❌');
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      classNameOverlay="fixed inset-0 z-[1000] flex justify-center items-center backdrop-blur-sm bg-[rgba(0,0,0,0.4)] animate-[fadeIn_0.2s_ease-out]"
      className="w-full flex flex-col overflow-hidden md:max-h-[85vh] h-full max-h-screen md:rounded-3xl max-w-125 bg-[rgba(20,20,22,0.85)] border border-[rgba(255,255,255,0.1)] border-b-none animate-[slideUp_0.3s_cubic-bezier(0.2,0.8,0.2,1)] shadow-[0_-10px_40px_rgba(0,0,0,0.5)] md:rounded-t-3xl pt-0"
      onClose={onClose}
    >
      <header className="flex flex-col gap-y-4 justify-between items-center px-5 py-6 border border-t-none border-[rgba(255,255,255,0.05)]">
        <div className="flex w-full items-center gap-x-2">
          <div className="flex w-full gap-x-2">
            <Avatar name={chat?.title} size="lg" src={chat?.avatarUrl} />
            <div className="flex flex-col w-full">
              {!isEditMode ? (
                <h2>{chat?.title}</h2>
              ) : (
                <label className="flex flex-col border-b border-border focus-within:border-b-[#2b77e7] pb-1">
                  <span className="text-sm">{t('chatName', 'Название чата')}</span>
                  <input
                    className="w-full outline-0"
                    type="text"
                    value={chatName}
                    onChange={(e) => setChatName(e.target.value)}
                  />
                </label>
              )}
              {!isEditMode && <p>{`${members.length} Участников`}</p>}
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="flex gap-x-2 w-full">
          {!isEditMode && (
            <>
              <button className={cn(actionBtnStyles, 'w-full')} onClick={handleToggleEditMode}>
                {t('edit', 'Редактировать')}
              </button>
              <button
                className={cn(actionBtnStyles, 'w-full', dangerBtn)}
                onClick={handleLeaveChat}
              >
                {t('leaveChat', 'Покинуть чат')}
              </button>
              {currentUser?.role === 'owner' && (
                <button
                  className={cn(actionBtnStyles, 'w-full', dangerBtn)}
                  onClick={handleDeleteChat}
                >
                  {t('deleteChat', 'Удалить чат')}
                </button>
              )}
            </>
          )}
          {isEditMode && (
            <>
              <button className={cn(actionBtnStyles, 'w-full')} onClick={handleSaveEdited}>
                {t('save', 'Сохранить')}
              </button>
              <button
                className={cn(actionBtnStyles, 'w-full', dangerBtn)}
                onClick={handleToggleEditMode}
              >
                {t('cancel', 'Отменить')}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="group-info-body">
        {isLoading ? (
          <div className="loading-state">{t('loading', 'Загрузка...')}</div>
        ) : (
          <ul className="members-list  styles-scroll">
            {members.map((member) => {
              const memberId = member.id;
              const avatarUrl = member.avatarUrl;
              return (
                <li key={memberId} className="member-item">
                  <Avatar
                    className="mr-4"
                    id={memberId}
                    name={member.username}
                    size="lg"
                    src={avatarUrl}
                  />
                  <div className="member-details">
                    <span className="member-name">{member.username}</span>
                    <span className={`member-role role-${member.role}`}>{member.role}</span>
                  </div>

                  {(currentUser?.role === 'owner' || currentUser?.role === 'admin') &&
                    memberId !== currentUserData?.id && (
                      <div className="member-actions">
                        {currentUser?.role === 'owner' && (
                          <button
                            className={cn(actionBtnStyles)}
                            onClick={() =>
                              handleAction('change-participant-role', memberId, {
                                role: member.role === 'admin' ? 'member' : 'admin',
                              })
                            }
                          >
                            {member.role === 'admin' ? 'Снять админа' : 'Дать админа'}
                          </button>
                        )}
                        {member.role !== 'owner' && (
                          <button
                            className={cn(actionBtnStyles, dangerBtn)}
                            onClick={() => handleAction('kick-participant', memberId)}
                          >
                            Кикнуть
                          </button>
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
