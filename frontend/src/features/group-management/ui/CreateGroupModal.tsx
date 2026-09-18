import { downscaleImage, useDebounce } from '@/shared/lib';
import { chatsQuery } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { chatKeys } from '@/queries/keys';
import { services } from '@/services';
import type { ISearchUserDto } from '@/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Icon, Input, Modal, Textarea, showToast } from '@/shared/ui';
import { Avatar } from '@/shared/ui/Avatar';
import { Chip } from '@/shared/ui/Chip';
import { suggestedMembers } from '../model/suggestedMembers';

interface Props {
  onClose: () => void;
}

/** Со скольких знаков искать. Один знак находит половину списка. */
const SEARCH_FROM = 2;

const TITLE_LIMIT = 50;
const DESCRIPTION_LIMIT = 255;

/**
 * Создание группы.
 *
 * Раньше это была отдельная страница, попасть на которую было неоткуда:
 * маршрут существовал, ссылки на него не было ни на одном экране. То есть
 * групповой чат нельзя было создать вообще.
 *
 * Пока поиск пуст, предлагаются те, с кем уже есть переписка: группу почти
 * всегда собирают из них, и заставлять искать по имени тех, кто и так на
 * виду, — лишняя работа.
 */
export function CreateGroupModal({ onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const meId = useProfileStore((state) => state.user?.id);
  const { data: chats = [] } = useQuery(chatsQuery());

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [search, setSearch] = useState('');
  /* Результат поиска хранится вместе с запросом, по которому получен.
     Иначе при новом запросе показывались бы люди из прошлого, пока не
     придёт ответ, — и очищать их пришлось бы вызовом прямо в эффекте,
     то есть лишним рендером сразу после первого. */
  const [foundFor, setFoundFor] = useState<{ query: string; users: ISearchUserDto[] }>({
    query: '',
    users: [],
  });
  const [selected, setSelected] = useState<ISearchUserDto[]>([]);
  const [isCreating, setCreating] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const query = useDebounce(search);

  const suggestions = useMemo(() => suggestedMembers(chats, meId), [chats, meId]);

  useEffect(() => {
    if (query.trim().length < SEARCH_FROM) return undefined;

    let cancelled = false;

    services.chatService
      .searchUsers(query)
      .then((users) => {
        if (!cancelled) setFoundFor({ query, users: users.filter((u) => u.id !== meId) });
      })
      .catch(() => {
        if (!cancelled) setFoundFor({ query, users: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [meId, query]);

  const isSearching = query.trim().length >= SEARCH_FROM;
  const found = foundFor.query === query ? foundFor.users : [];
  const people = isSearching ? found : suggestions;

  const toggle = (user: ISearchUserDto) => {
    setSelected((prev) =>
      prev.some((member) => member.id === user.id)
        ? prev.filter((member) => member.id !== user.id)
        : [...prev, user]
    );
  };

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;

    try {
      setAvatarUrl(await downscaleImage(file));
    } catch {
      showToast('error', t('avatarReadError', 'Не удалось прочитать изображение'));
    }
  };

  const create = async () => {
    if (!title.trim()) {
      showToast('error', t('groupTitleRequired', 'Введите название группы'));
      return;
    }
    if (selected.length === 0) {
      showToast('error', t('groupMembersRequired', 'Выберите хотя бы одного участника'));
      return;
    }

    setCreating(true);

    try {
      const { chatId } = await services.chatService.createGroup({
        title: title.trim(),
        description: description.trim(),
        members: selected.map((member) => member.id),
        avatarUrl,
      });

      // Без этого созданная группа появлялась в списке только после
      // перезагрузки страницы.
      await queryClient.invalidateQueries({ queryKey: chatKeys.list() });

      onClose();
      navigate(`/chats/${encodeURIComponent(chatId)}`);
    } catch {
      // Окно не закрывается: введённое не должно пропасть из-за отказа.
      showToast(
        'error',
        t('createChat.creationError', 'Не удалось создать групповой чат, что-то пошло не так')
      );
      setCreating(false);
    }
  };

  return (
    <Modal
      /* Высота по содержимому, а не фиксированная: при пустом поиске окно
         в 720px наполовину состояло из пустоты, а кнопка висела посреди
         неё. Ограничение сверху оставлено — список людей прокручивается
         внутри, а не растит окно за край экрана. */
      className="flex w-[min(92vw,620px)] max-w-none flex-col gap-y-4 bg-sheet py-4 md:max-h-[min(720px,88vh)]"
      label="Новая группа"
      onClose={onClose}
    >
      <header className="flex justify-between px-6">
        <h2 className="text-xl w-full text-left">{t('newGroup', 'Новая группа')}</h2>

        <button
          aria-label={t('close', 'Закрыть')}
          /* Был синий #2b77e7 — цвет не из палитры проекта. */
          className="shrink-0 cursor-pointer text-ink-3 transition-colors hover:text-ink"
          onClick={onClose}
          type="button"
        >
          <Icon name="cross" />
        </button>
      </header>

      <div className="flex min-h-0 flex-col gap-y-4 overflow-hidden">
        <div className="flex gap-x-4 px-6">
          <button
            aria-label={t('groupAvatar', 'Аватар группы')}
            className="create-group-avatar shrink-0"
            onClick={() => avatarInputRef.current?.click()}
            type="button"
          >
            {avatarUrl ? <img alt="" src={avatarUrl} /> : <Icon name="camera" />}
          </button>

          <input
            accept="image/*"
            className="hidden"
            onChange={(event) => void pickAvatar(event.target.files?.[0])}
            ref={avatarInputRef}
            type="file"
          />

          <div className="flex flex-col gap-y-2 w-full min-w-0">
            <Input
              aria-label={t('groupTitlePlaceholder', 'Название группы')}
              maxLength={TITLE_LIMIT}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('groupTitlePlaceholder', 'Название группы')}
              required
              value={title}
            />
            {/* Описание было однострочным полем на 255 знаков: текст
                уезжал за край, и о пределе человек узнавал, упёршись
                в него. */}
            <Textarea
              aria-label={t('groupDescPlaceholder', 'Описание (необязательно)')}
              maxLength={DESCRIPTION_LIMIT}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('groupDescPlaceholder', 'Описание (необязательно)')}
              rows={2}
              value={description}
            />
          </div>
        </div>

        {selected.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-6">
            {selected.map((member) => (
              <li key={member.id}>
                <Chip
                  onRemove={() => toggle(member)}
                  removeLabel={t('removeMember', 'Убрать участника')}
                >
                  {member.firstName || member.username}
                </Chip>
              </li>
            ))}
          </ul>
        )}

        <div className="px-6 border-b border-border">
          <label className="flex gap-x-2 items-center relative">
            <Icon
              className="size-5 shrink-0 absolute top-1/2 -translate-y-1/2 opacity-70"
              name="search"
            />
            <input
              className="py-3 text-lg pr-1 pl-7 w-full outline-none rounded-xl"
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('searchUsers', 'Поиск по юзернейму...')}
              type="search"
              value={search}
            />
          </label>
        </div>

        <ul className="flex flex-col overflow-y-auto overflow-x-hidden styled-scrollbar">
          {people.length === 0 ? (
            <li className="mx-auto py-2 opacity-70">
              {isSearching
                ? t('usersNotFound', 'Никого не нашлось')
                : t('noChatsYet', 'Пока не с кем начинать группу — найдите людей поиском')}
            </li>
          ) : (
            people.map((user) => {
              const isChosen = selected.some((member) => member.id === user.id);
              const name = user.firstName || user.username || t('user', 'Пользователь');

              return (
                <li className="w-full" key={user.id}>
                  <button
                    aria-pressed={isChosen}
                    className="w-full flex items-center gap-x-3 cursor-pointer transition-colors hover:bg-panel px-6 py-3 text-left"
                    onClick={() => toggle(user)}
                    type="button"
                  >
                    <Avatar id={user.id} name={name} size="lg" src={user.avatarUrl} />

                    <span className="min-w-0 flex flex-col">
                      <strong className="truncate">{name}</strong>
                      {user.username && (
                        <span className="text-sm opacity-60 truncate">@{user.username}</span>
                      )}
                    </span>

                    {isChosen && <Icon className="ml-auto shrink-0" name="checkCircle" />}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <footer className="px-6">
        <button
          className="create-group-submit"
          disabled={isCreating}
          onClick={() => void create()}
          type="button"
        >
          {isCreating ? t('creating', 'Создание...') : t('createGroupAction', 'Создать группу')}
        </button>
      </footer>
    </Modal>
  );
}
