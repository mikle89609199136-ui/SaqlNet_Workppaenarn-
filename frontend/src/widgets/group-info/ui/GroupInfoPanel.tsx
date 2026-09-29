import { describeApiError } from '@/shared/api';
import { services } from '@/services';
import {
  chatKeys,
  chatQuery,
  chatsQuery,
  clearDraft,
  getChatSubtitle,
  membersQuery,
  onlineMembersQuery,
} from '@/entities/chat';
import { messagesQuery } from '@/entities/message';
import { type IProfileState, ProfilePanelBar, useProfileStore } from '@/entities/user';
import { BlockUserButton } from '@/features/block-user';
import { UserProfilePanel, type IProfileCall } from '@/features/user-profile';
import { useLeaveGroupFlow, usePeopleSearch } from '@/features/group-management';
import { cn } from '@/shared/lib';
import { Avatar, Button, Chip, ConfirmDialog, Icon, showToast } from '@/shared/ui';
import type { IMemberDto, ISearchUserDto, TChatRole, TIconTypes } from '@/types';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

interface Props {
  chatId: string;
  onClose: () => void;
  /** Позвонить участнику из его профиля — от страницы, см. UserProfilePanel. */
  startCall?: (call: IProfileCall) => void;
}

type TView = { kind: 'info' } | { kind: 'member'; memberId: string } | { kind: 'add' };

/* Кнопка внизу панели: 44px, скругление 14, 14px. */
const panelButton = 'w-full py-3 text-ui font-medium';
const rowClass =
  'flex w-full cursor-pointer items-center gap-3 rounded-button px-3 py-2 text-left transition-colors duration-fast hover:layer-hover ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2';
const sectionLabel =
  'px-5 pt-1 pb-1.5 text-meta font-semibold tracking-[0.04em] text-ink-3 uppercase';

function memberName(member: { firstName?: string; lastName?: string; username?: string }) {
  return [member.firstName, member.lastName].filter(Boolean).join(' ') || member.username || '';
}

function Tile({ icon, label, onClick }: { icon: TIconTypes; label: string; onClick: () => void }) {
  return (
    <button
      className={cn(
        'flex cursor-pointer flex-col items-center gap-1.5 rounded-button bg-sheet-2 pt-3 pb-2.5 text-meta text-brand',
        'transition-colors duration-fast hover:layer-hover active:layer-press',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2'
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className="size-5" name={icon} />
      <span className="text-ink-2">{label}</span>
    </button>
  );
}

/**
 * Сведения о группе — в правой панели, а не в модальном окне (#822).
 *
 * Три вида, как в макете: сведения (шапка, плитки, описание, участники,
 * «Покинуть группу»), профиль участника с «Назад» и действиями владельца,
 * добавление участников с поиском и выбором.
 */
/**
 * Сведения о группе (#822). Виджет, а не фича (#863): собирает управление
 * группой, профиль участника и блокировку — три отдельные фичи.
 */
export function GroupInfoPanel({ chatId, onClose, startCall }: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<TView>({ kind: 'info' });

  if (view.kind === 'member') {
    return (
      <MemberView
        chatId={chatId}
        memberId={view.memberId}
        onBack={() => setView({ kind: 'info' })}
        onClose={onClose}
        startCall={startCall}
      />
    );
  }

  if (view.kind === 'add') {
    return (
      <AddMembersView chatId={chatId} onBack={() => setView({ kind: 'info' })} onClose={onClose} />
    );
  }

  return (
    <InfoView
      chatId={chatId}
      onAdd={() => setView({ kind: 'add' })}
      onClose={onClose}
      onOpenMember={(memberId) => setView({ kind: 'member', memberId })}
      t={t}
    />
  );
}

/* --- Сведения ------------------------------------------------------ */

function InfoView({
  chatId,
  onClose,
  onAdd,
  onOpenMember,
  t,
}: {
  chatId: string;
  onClose: () => void;
  onAdd: () => void;
  onOpenMember: (memberId: string) => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useProfileStore((state) => state.user?.id);
  const leave = useLeaveGroupFlow();
  const { data: chat } = useQuery(chatQuery(chatId));
  const { data: members = [], isPending } = useQuery(membersQuery(chatId));
  const { data: online = [] } = useQuery(onlineMembersQuery(chatId));
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [deleteAsked, setDeleteAsked] = useState(false);

  if (!chat) return null;

  const myRole = members.find((member) => member.id === me)?.role;
  const canManage = myRole === 'owner' || myRole === 'admin';
  const onlineSet = new Set(online);

  const startEdit = () => {
    setTitle(chat.title);
    setEditing(true);
  };

  const saveTitle = async () => {
    try {
      await services.chatService.updateChat(chat.id, { title: title.trim() });
      // Название — в кеше чата и списка: перечитываем, а не правим руками.
      await queryClient.invalidateQueries({ queryKey: chatKeys.detail(chat.id) });
      await queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      setEditing(false);
    } catch (error) {
      showToast(
        'error',
        describeApiError(error as never, t, t('toast.actionFailed', 'Ошибка выполнения действия'))
      );
    }
  };

  const deleteGroup = async () => {
    try {
      await services.chatService.deleteChat(chat.id);
      clearDraft(chat.id);
      queryClient.removeQueries({ queryKey: chatKeys.detail(chat.id) });
      await queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      navigate('/chats');
    } catch (error) {
      showToast(
        'error',
        describeApiError(
          error as never,
          t,
          t('toast.chatDeleteFailed', 'Не удалось удалить чат, попробуйте ещё раз')
        )
      );
    }
  };

  const roleLabel = (role: string) =>
    role === 'owner'
      ? t('role.owner', 'владелец')
      : role === 'admin'
        ? t('role.admin', 'админ')
        : '';

  return (
    <aside
      aria-label={t('groupInfo', 'Сведения о группе')}
      className="flex h-full flex-col overflow-hidden bg-sheet"
      role="complementary"
    >
      <ProfilePanelBar onClose={onClose} />

      <div className="styled-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col items-center gap-1.5 px-5 pb-5 text-center">
          <Avatar className="mb-2" name={chat.title} size="2xl" src={chat.avatarUrl} />
          {editing ? (
            <form
              className="flex w-full flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void saveTitle();
              }}
            >
              <input
                aria-label={t('chatName', 'Название группы')}
                autoFocus
                className="h-11 w-full rounded-button border border-divider bg-chat-bg px-3.5 text-center text-body text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand-soft"
                onChange={(event) => setTitle(event.target.value)}
                value={title}
              />
              <div className="flex justify-center gap-2">
                <Button onClick={() => setEditing(false)} size="sm" type="button" variant="ghost">
                  {t('cancel', 'Отмена')}
                </Button>
                <Button disabled={!title.trim()} size="sm" type="submit">
                  {t('save', 'Сохранить')}
                </Button>
              </div>
            </form>
          ) : (
            <h2 className="text-section font-semibold text-ink">{chat.title}</h2>
          )}
          <p className="text-ui text-ink-2">
            {getChatSubtitle(
              // Число участников — из загруженного списка: он свежее чата.
              { ...chat, memberCount: members.length || chat.memberCount },
              null,
              t,
              new Date(),
              online.length
            )}
          </p>
        </div>

        {/* Плитки из макета — «Поиск» и «Звук» появятся с #841 и #559. */}
        {canManage && !editing && (
          <div className="grid grid-cols-2 gap-2 px-4 pb-5">
            <Tile icon="groupAdd" label={t('group.add', 'Добавить')} onClick={onAdd} />
            <Tile icon="edit" label={t('group.edit', 'Изменить')} onClick={startEdit} />
          </div>
        )}

        {chat.description && (
          <div className="mx-4 mb-4 flex flex-col gap-0.5 rounded-bubble bg-sheet-2 px-3.5 py-3">
            <span className="text-meta text-ink-3">{t('group.description', 'Описание')}</span>
            <span className="text-ui leading-[1.4] whitespace-pre-wrap text-ink">
              {chat.description}
            </span>
          </div>
        )}

        <h3 className={sectionLabel}>
          {t('group.members', 'Участники')} · {members.length || chat.memberCount}
        </h3>
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {canManage && (
            <button className={cn(rowClass, 'text-body text-brand')} onClick={onAdd} type="button">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-brand-soft"
              >
                <Icon className="size-5" name="groupAdd" />
              </span>
              {t('group.addMembers', 'Добавить участников')}
            </button>
          )}

          {isPending && (
            <p className="px-3 py-4 text-ui text-ink-3">{t('loading', 'Загрузка...')}</p>
          )}

          {members.map((member) => {
            const name = memberName(member);
            const isOnline = onlineSet.has(member.id);
            const role = roleLabel(member.role);
            return (
              <button
                aria-label={[name, role].filter(Boolean).join(', ')}
                className={rowClass}
                key={member.id}
                onClick={() => onOpenMember(member.id)}
                type="button"
              >
                <Avatar
                  id={member.id}
                  name={name}
                  online={isOnline}
                  size="md"
                  src={member.avatarUrl}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-body text-ink">
                    {member.id === me ? `${name} (${t('you', 'Вы')})` : name}
                  </span>
                  <span className={cn('text-caption', isOnline ? 'text-brand' : 'text-ink-3')}>
                    {isOnline ? t('online', 'в сети') : member.username && `@${member.username}`}
                  </span>
                </span>
                {role && <span className="shrink-0 text-meta text-ink-3">{role}</span>}
              </button>
            );
          })}
        </div>

        <div className="mt-auto flex flex-col gap-2 px-4 pt-2 pb-4">
          <Button className={panelButton} onClick={() => leave.requestLeave(chat)} variant="danger">
            {t('group.leave', 'Покинуть группу')}
          </Button>
          {myRole === 'owner' && (
            <Button className={panelButton} onClick={() => setDeleteAsked(true)} variant="danger">
              {t('group.delete', 'Удалить группу')}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        confirmLabel={t('group.delete', 'Удалить группу')}
        danger
        onCancel={() => setDeleteAsked(false)}
        onConfirm={() => {
          setDeleteAsked(false);
          void deleteGroup();
        }}
        open={deleteAsked}
        title={t('group.deleteTitle', 'Удалить группу «{{title}}»?', { title: chat.title })}
      >
        {t('group.deleteText', 'Сообщения исчезнут у всех участников.')}
      </ConfirmDialog>
      {leave.dialog}
    </aside>
  );
}

/* --- Участник ------------------------------------------------------ */

const NO_MESSAGES: IProfileState['messages'] = [];

function MemberView({
  chatId,
  memberId,
  onBack,
  onClose,
  startCall,
}: {
  chatId: string;
  memberId: string;
  onBack: () => void;
  onClose: () => void;
  startCall?: (call: IProfileCall) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const me = useProfileStore((state) => state.user?.id);
  const { data: members = [] } = useQuery(membersQuery(chatId));
  const [ownerAsked, setOwnerAsked] = useState(false);
  const member = members.find((item) => item.id === memberId);
  const myRole = members.find((item) => item.id === me)?.role;

  /* Профиль участника — тот же, что из личного чата: звонок, общие медиа
     и файлы берутся из личной переписки с ним, если она есть. */
  const { data: chats = [] } = useQuery(chatsQuery());
  const personal =
    chats.find((chat) => chat.type === 'private' && chat.peerId === memberId) ?? null;
  const { data: personalMessages = NO_MESSAGES } = useInfiniteQuery(
    messagesQuery(personal?.id ?? '')
  );
  const profileState = useMemo<IProfileState>(
    () => ({ isOpen: true, userId: memberId, chat: personal, messages: personalMessages }),
    [memberId, personal, personalMessages]
  );

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: chatKeys.members(chatId) });
    } catch (error) {
      showToast(
        'error',
        describeApiError(error as never, t, t('toast.actionFailed', 'Ошибка выполнения действия'))
      );
    }
  };

  /* Внизу — как в личном профиле: блокировка. Над ней то, что можно
     сделать с участником владельцу и админу: права и владение,
     исключение из группы. */
  const renderActions = (): ReactNode => {
    if (!member || member.id === me) return null;
    const canManage = (myRole === 'owner' || myRole === 'admin') && member.role !== 'owner';

    const nextRole: TChatRole = member.role === 'admin' ? 'member' : 'admin';
    return (
      <div className="flex flex-col gap-2">
        {canManage && myRole === 'owner' && (
          <>
            <Button
              className={panelButton}
              onClick={() =>
                run(() => services.chatService.setMemberRole(chatId, member.id, nextRole))
              }
              variant="secondary"
            >
              {member.role === 'admin'
                ? t('demoteAdmin', 'Снять админа')
                : t('makeAdmin', 'Сделать админом')}
            </Button>
            <Button className={panelButton} onClick={() => setOwnerAsked(true)} variant="secondary">
              {t('group.makeOwner', 'Сделать владельцем')}
            </Button>
          </>
        )}
        {canManage && (
          <Button
            className={panelButton}
            onClick={() =>
              run(async () => {
                await services.chatService.removeMember(chatId, member.id);
                onBack();
              })
            }
            variant="danger"
          >
            {t('group.remove', 'Удалить из группы')}
          </Button>
        )}
        <BlockUserButton className={panelButton} name={memberName(member)} userId={member.id} />
        <ConfirmDialog
          confirmLabel={t('group.makeOwner', 'Сделать владельцем')}
          onCancel={() => setOwnerAsked(false)}
          onConfirm={() => {
            setOwnerAsked(false);
            void run(() => services.chatService.transferOwnership(chatId, member.id));
          }}
          open={ownerAsked}
          title={t('group.makeOwnerTitle', 'Передать группу {{name}}?', {
            name: memberName(member),
          })}
        >
          {t(
            'group.makeOwnerText',
            'Вы станете админом, а управлять группой будет новый владелец.'
          )}
        </ConfirmDialog>
      </div>
    );
  };

  return (
    <UserProfilePanel
      backLabel={t('group.backToInfo', 'Назад к сведениям о группе')}
      onBack={onBack}
      onClose={onClose}
      profileState={profileState}
      renderActions={renderActions}
      startCall={startCall}
    />
  );
}

/* --- Добавление участников ---------------------------------------- */

function AddMembersView({
  chatId,
  onBack,
  onClose,
}: {
  chatId: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const me = useProfileStore((state) => state.user?.id);
  const { data: members = [] } = useQuery(membersQuery(chatId));
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ISearchUserDto[]>([]);
  const [adding, setAdding] = useState(false);
  const { people, isSearching, isLoading } = usePeopleSearch(
    search,
    me,
    members.map((member: IMemberDto) => member.id)
  );

  const isSelected = (id: string) => selected.some((user) => user.id === id);
  const toggle = (user: ISearchUserDto) =>
    setSelected((prev) =>
      isSelected(user.id) ? prev.filter((item) => item.id !== user.id) : [...prev, user]
    );

  const confirm = async () => {
    setAdding(true);
    try {
      // Сервер добавляет по одному; порядок не важен, ждём всех.
      await Promise.all(selected.map((user) => services.chatService.addMember(chatId, user.id)));
      await queryClient.invalidateQueries({ queryKey: chatKeys.members(chatId) });
      await queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
      onBack();
    } catch (error) {
      showToast(
        'error',
        describeApiError(error as never, t, t('toast.actionFailed', 'Ошибка выполнения действия'))
      );
    } finally {
      setAdding(false);
    }
  };

  return (
    <aside
      aria-label={t('group.addMembers', 'Добавить участников')}
      className="flex h-full flex-col overflow-hidden bg-sheet"
      role="complementary"
    >
      <ProfilePanelBar
        backLabel={t('group.backToInfo', 'Назад к сведениям о группе')}
        onBack={onBack}
        onClose={onClose}
      />
      <h2 className="px-5 pt-1 pb-3 text-title font-semibold text-ink">
        {t('group.addMembers', 'Добавить участников')}
      </h2>

      <div className="px-4 pb-2.5">
        <label className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-icon border border-divider px-2.5 py-1.5 focus-within:border-brand">
          {selected.map((user) => (
            <Chip
              key={user.id}
              leading={
                <Avatar id={user.id} name={memberName(user)} size="xs" src={user.avatarUrl} />
              }
              onRemove={() => toggle(user)}
              removeLabel={t('group.unselect', 'Убрать {{name}}', { name: memberName(user) })}
            >
              {user.firstName || user.username}
            </Chip>
          ))}
          <input
            aria-label={t('group.searchPeople', 'Имя или @username')}
            className="h-7.5 min-w-20 flex-1 bg-transparent text-ui text-ink outline-none placeholder:text-ink-3"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              selected.length
                ? t('group.searchMore', 'Ещё кого-нибудь')
                : t('group.searchPeople', 'Имя или @username')
            }
            value={search}
          />
        </label>
      </div>

      <div className="styled-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <h3 className="px-3 py-1.5 text-meta font-semibold tracking-[0.04em] text-ink-3 uppercase">
          {isSearching
            ? t('group.searchResults', 'Результаты поиска')
            : t('group.contacts', 'Контакты')}
        </h3>
        {people.map((user) => {
          const name = memberName(user);
          const on = isSelected(user.id);
          return (
            <button
              aria-checked={on}
              className={cn(rowClass, on && 'bg-brand-soft')}
              key={user.id}
              onClick={() => toggle(user)}
              role="checkbox"
              type="button"
            >
              <Avatar id={user.id} name={name} size="md" src={user.avatarUrl} />
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate text-body text-ink">{name}</span>
                {user.username && <span className="text-caption text-ink-3">@{user.username}</span>}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-5.5 shrink-0 items-center justify-center rounded-pill border-2 transition-colors duration-[140ms]',
                  on
                    ? 'border-brand-fill bg-brand-fill text-on-brand'
                    : 'border-ink-3 text-transparent'
                )}
              >
                <Icon className="size-3.25 stroke-3" name="check" />
              </span>
            </button>
          );
        })}
        {!isLoading && people.length === 0 && (
          <p className="px-3 py-8 text-center text-ui text-ink-3">
            {t('nothingFound', 'Никого не нашлось')}
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-divider px-4 pt-3 pb-4">
        <Button
          className="w-full"
          disabled={selected.length === 0}
          loading={adding}
          onClick={() => void confirm()}
          variant={selected.length ? 'primary' : 'secondary'}
        >
          {selected.length
            ? t('group.addCount', 'Добавить ({{count}})', { count: selected.length })
            : t('group.pickSomeone', 'Выберите, кого добавить')}
        </Button>
      </div>
    </aside>
  );
}
