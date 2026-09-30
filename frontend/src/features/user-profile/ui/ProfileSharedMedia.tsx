import { Button, ContextMenu, Icon, Modal, Spinner } from '@/shared/ui';
import { VideoPlayer, mediaBlobByUrl, mediaFileName, saveMedia } from '@/entities/media';
import { sharedMessagesQuery } from '@/entities/message';
import { cn, formatChatListTime, formatFileSize, useLongPress } from '@/shared/lib';
import type { IMediaItem, IMessageDto, TSharedKind } from '@/types';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

interface IOpenedMedia {
  url: string;
  isVideo: boolean;
}

interface Props {
  /** Чат, общее в котором показываем: выдачу по виду отдаёт сервер (#842). */
  chatId: string;
  /**
   * «Перейти к сообщению» из контекстного меню элемента. Нет — пункта нет
   * (например, профиль открыт не из этого чата).
   */
  onJumpToMessage?: (messageId: string) => void;
}

/**
 * Годится ли сообщение в плитку общих медиафайлов.
 *
 * Смотреть надо на `mediaUrl` самого сообщения, а не на
 * `metadata.mediaUrl`. Это разные адреса: в метаданных лежит эндпойнт,
 * требующий авторизации, а `MessageService.resolveMediaForDisplay` кладёт
 * `blob:` в `mediaUrl`. У нерасшифрованных вложений его нет вовсе.
 */
export function isDisplayableMedia(message: IMessageDto): message is IMediaItem {
  if (message.type !== 'image' && message.type !== 'video') return false;

  const item: IMediaItem = message;
  return typeof item.mediaUrl === 'string' && item.mediaUrl.length > 0 && !item.mediaUnavailable;
}

function isDisplayableFile(item: IMediaItem) {
  const type = item.mediaType || item.type;
  return (
    (type === 'file' || type === 'audio') &&
    typeof item.mediaUrl === 'string' &&
    item.mediaUrl.length > 0 &&
    !item.mediaUnavailable
  );
}

/* Ссылки — только из расшифрованного текста: серверу они не видны. */
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

interface ILink {
  id: string;
  messageId: string;
  url: string;
  host: string;
  createdAt: IMediaItem['createdAt'];
}

/** Ссылки из сообщений — в том же порядке, от новых к старым. */
function collectLinks(messages: IMediaItem[]): ILink[] {
  const links: ILink[] = [];
  for (const message of messages) {
    if (message.undecryptable || !message.content) continue;
    const found: string[] = message.content.match(URL_PATTERN) ?? [];
    found.forEach((url, index) => {
      let host = url;
      try {
        host = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        // Строка похожа на ссылку, но не разбирается — показываем как есть.
      }
      links.push({
        id: `${message.id}-${index}`,
        messageId: message.id,
        url,
        host,
        createdAt: message.createdAt,
      });
    });
  }
  return links;
}

function fileNameOf(message: IMediaItem): string {
  const meta = message.metadata as { fileName?: string } | undefined;
  return message.mediaEncryption?.fileName ?? meta?.fileName ?? message.content ?? '';
}

function fileSizeOf(message: IMediaItem): number | undefined {
  const meta = message.metadata as { sizeBytes?: number } | undefined;
  return message.mediaEncryption?.sizeBytes ?? meta?.sizeBytes;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1, dot + 5).toUpperCase() : '';
}

type TTab = 'media' | 'files' | 'links';

const TAB_KIND: Record<TTab, TSharedKind> = { media: 'media', files: 'files', links: 'text' };

const rowClass =
  'flex w-full cursor-pointer items-center gap-3 rounded-button px-2.5 py-2 text-left no-underline transition-colors duration-fast hover:layer-hover ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2';
const tileClass =
  'flex size-10.5 shrink-0 items-center justify-center rounded-icon bg-brand-fill font-semibold text-on-brand';

interface IItemMenu {
  messageId: string;
  x: number;
  y: number;
}

/**
 * Элемент вкладки с контекстным меню: правая кнопка и долгое нажатие на
 * телефоне открывают одно меню панели у этого элемента.
 */
function WithItemMenu({
  messageId,
  onOpen,
  children,
}: {
  messageId: string;
  onOpen: ((menu: IItemMenu) => void) | null;
  children: (handlers: {
    onContextMenu?: (event: ReactMouseEvent) => void;
    [key: string]: unknown;
  }) => ReactNode;
}) {
  const longPress = useLongPress((x, y) => onOpen?.({ messageId, x, y }));
  if (!onOpen) return <>{children({})}</>;
  return (
    <>
      {children({
        ...longPress,
        onContextMenu: (event: ReactMouseEvent) => {
          event.preventDefault();
          onOpen({ messageId, x: event.clientX, y: event.clientY });
        },
      })}
    </>
  );
}

/**
 * Общее с человеком — вкладки «Медиа», «Файлы», «Ссылки» по макету (#822).
 *
 * Выдачу по виду на всю историю отдаёт сервер (#842), страницами от новых
 * к старым; вложения расшифровываются так же, как в ленте. Ссылки сервер
 * не видит — они внутри шифровки: клиент листает текстовые сообщения и
 * собирает их сам.
 */
export function ProfileSharedMedia({ chatId, onJumpToMessage }: Props) {
  const { t, i18n } = useTranslation();
  const baseId = useId();
  const [tab, setTab] = useState<TTab>('media');
  const [openedMedia, setOpenedMedia] = useState<IOpenedMedia | null>(null);
  const [menu, setMenu] = useState<IItemMenu | null>(null);

  // Каждая вкладка грузится, когда её открыли; загруженное остаётся в кеше.
  const query = useInfiniteQuery({
    ...sharedMessagesQuery(chatId, TAB_KIND[tab]),
    enabled: Boolean(chatId),
  });
  const loaded = useMemo(
    () => query.data?.pages.flatMap((page) => page.messages as IMediaItem[]) ?? [],
    [query.data]
  );
  const media = useMemo(() => loaded.filter(isDisplayableMedia), [loaded]);
  const files = useMemo(() => loaded.filter(isDisplayableFile), [loaded]);
  const links = useMemo(() => (tab === 'links' ? collectLinks(loaded) : []), [loaded, tab]);

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const loadMore = () => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  };

  /* Медиа и файлы догружаются сами, когда низ списка показался. Ссылки —
     по «Показать ещё»: ради них листается вся текстовая история, и делать
     это молча, пока человек просто смотрит, незачем. */
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || tab === 'links' || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, tab]);

  const openMenu = onJumpToMessage ? setMenu : null;

  const tabs: { key: TTab; label: string }[] = [
    { key: 'media', label: t('profile.tabMedia', 'Медиа') },
    { key: 'files', label: t('profile.tabFiles', 'Файлы') },
    { key: 'links', label: t('profile.tabLinks', 'Ссылки') },
  ];
  const activeIndex = tabs.findIndex((item) => item.key === tab);

  const empty = (text: string) => (
    <p className="px-4 py-8 text-center text-ui text-ink-3">{text}</p>
  );

  const loadingFirstPage = query.isPending;
  const footer = (
    <div className="flex justify-center px-4 pb-4" ref={sentinelRef}>
      {isFetchingNextPage ? (
        <Spinner label={t('loading', 'Загрузка…')} size="sm" />
      ) : hasNextPage ? (
        <Button onClick={loadMore} size="sm" variant="ghost">
          {tab === 'links'
            ? t('profile.searchOlderLinks', 'Искать ссылки дальше в истории')
            : t('profile.showMore', 'Показать ещё')}
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        aria-label={t('profile.shared', 'Общее')}
        className="relative mx-4 grid grid-cols-3 border-b border-divider"
        role="tablist"
      >
        {tabs.map((item) => (
          <button
            aria-controls={`${baseId}-pane`}
            aria-selected={item.key === tab}
            className={cn(
              'h-10 cursor-pointer text-ui transition-colors duration-[200ms]',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2',
              item.key === tab ? 'font-semibold text-ink' : 'text-ink-2'
            )}
            id={`${baseId}-${item.key}`}
            key={item.key}
            onClick={() => setTab(item.key)}
            role="tab"
            tabIndex={item.key === tab ? 0 : -1}
            type="button"
          >
            {item.label}
          </button>
        ))}
        {/* Подчёркивание 56px под выбранной вкладкой — переезжает за 300ms. */}
        <span
          aria-hidden="true"
          className="absolute -bottom-px left-0 flex h-0.5 w-1/3 justify-center transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
          style={{ transform: `translateX(${activeIndex * 100}%)` }}
        >
          <span className="h-0.5 w-14 rounded-[2px] bg-brand" />
        </span>
      </div>

      <div
        aria-busy={loadingFirstPage || isFetchingNextPage}
        aria-labelledby={`${baseId}-${tab}`}
        className="styled-scrollbar min-h-0 flex-1 overflow-y-auto"
        id={`${baseId}-pane`}
        role="tabpanel"
      >
        {loadingFirstPage ? (
          <div className="flex justify-center py-8">
            <Spinner label={t('loading', 'Загрузка…')} size="md" />
          </div>
        ) : query.isError ? (
          empty(t('profileSharedError', 'Не удалось загрузить — попробуйте позже'))
        ) : (
          <>
            {tab === 'media' &&
              (media.length > 0 ? (
                <div className="grid grid-cols-3 gap-1 px-4 py-3">
                  {media.map((message) => {
                    const mediaUrl = message.mediaUrl!;
                    const isVideo = message.type === 'video';
                    return (
                      <WithItemMenu key={message.id} messageId={message.id} onOpen={openMenu}>
                        {(handlers) => (
                          <button
                            {...handlers}
                            aria-label={
                              isVideo
                                ? t('videoMessage', 'Видео')
                                : t('imageMessage', 'Изображение')
                            }
                            className="relative block aspect-square cursor-pointer overflow-hidden rounded-field bg-sheet-2"
                            onClick={() => setOpenedMedia({ url: mediaUrl, isVideo })}
                            type="button"
                          >
                            {isVideo ? (
                              <video
                                className="size-full object-cover"
                                muted
                                preload="metadata"
                                src={mediaUrl}
                              />
                            ) : (
                              <img
                                alt=""
                                className="size-full object-cover"
                                loading="lazy"
                                src={mediaUrl}
                              />
                            )}
                            {isVideo && (
                              <span
                                aria-hidden="true"
                                className="absolute inset-0 m-auto flex size-8 items-center justify-center rounded-pill bg-scrim-subtle text-on-scrim"
                              >
                                <Icon className="ml-0.5 size-4 fill-current stroke-0" name="play" />
                              </span>
                            )}
                          </button>
                        )}
                      </WithItemMenu>
                    );
                  })}
                </div>
              ) : (
                !hasNextPage && empty(t('profileMediaEmpty', 'Медиафайлов пока нет'))
              ))}

            {tab === 'files' &&
              (files.length > 0 ? (
                <div className="flex flex-col gap-0.5 px-2 pt-2 pb-3">
                  {files.map((message) => {
                    const name = fileNameOf(message) || t('lastMessage.file', 'Файл');
                    const size = fileSizeOf(message);
                    const meta = [
                      typeof size === 'number' ? formatFileSize(size) : null,
                      formatChatListTime(message.createdAt, i18n.language),
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <WithItemMenu key={message.id} messageId={message.id} onOpen={openMenu}>
                        {(handlers) => (
                          <button
                            {...handlers}
                            aria-label={`${t('download', 'Скачать')} ${name}${meta ? `, ${meta}` : ''}`}
                            className={rowClass}
                            onClick={() =>
                              void saveMedia(message.mediaUrl!, mediaFileName(message), {
                                blobByUrl: mediaBlobByUrl,
                              }).catch(() => {})
                            }
                            type="button"
                          >
                            <span
                              aria-hidden="true"
                              className={cn(tileClass, 'text-micro font-bold tracking-[0.02em]')}
                            >
                              {extensionOf(name) || <Icon className="size-5" name="file" />}
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-0.75">
                              <span className="truncate text-ui font-medium text-ink">{name}</span>
                              <span className="text-meta text-ink-3">{meta}</span>
                            </span>
                            <span
                              aria-hidden="true"
                              className="flex size-8.5 shrink-0 items-center justify-center rounded-pill bg-sheet-2 text-brand"
                            >
                              <Icon className="size-4" name="download" />
                            </span>
                          </button>
                        )}
                      </WithItemMenu>
                    );
                  })}
                </div>
              ) : (
                !hasNextPage && empty(t('profileFilesEmpty', 'Файлов пока нет'))
              ))}

            {tab === 'links' &&
              (links.length > 0 ? (
                <div className="flex flex-col gap-0.5 px-2 pt-2 pb-3">
                  {links.map((link) => (
                    <WithItemMenu key={link.id} messageId={link.messageId} onOpen={openMenu}>
                      {(handlers) => (
                        <a
                          {...handlers}
                          className={rowClass}
                          href={link.url}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          <span aria-hidden="true" className={cn(tileClass, 'text-title')}>
                            {link.host.charAt(0).toUpperCase()}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col gap-0.75">
                            <span className="flex items-baseline gap-2">
                              <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink">
                                {link.host}
                              </span>
                              <span className="shrink-0 text-meta text-ink-3">
                                {formatChatListTime(link.createdAt, i18n.language)}
                              </span>
                            </span>
                            <span className="truncate text-meta text-brand">{link.url}</span>
                          </span>
                        </a>
                      )}
                    </WithItemMenu>
                  ))}
                </div>
              ) : (
                !hasNextPage && empty(t('profileLinksEmpty', 'Ссылок пока нет'))
              ))}

            {footer}
          </>
        )}
      </div>

      {menu && onJumpToMessage && (
        <ContextMenu
          aria-label={t('profile.itemActions', 'Действия')}
          onClose={() => setMenu(null)}
          open
          x={menu.x}
          y={menu.y}
        >
          <ContextMenu.Item
            icon={<Icon name="arrowUpRight" />}
            onClick={() => {
              setMenu(null);
              onJumpToMessage(menu.messageId);
            }}
          >
            {t('profile.jumpToMessage', 'Перейти к сообщению')}
          </ContextMenu.Item>
        </ContextMenu>
      )}

      {/* Окно берётся из набора: оно на \`<dialog>\`, то есть Escape,
          ловушка фокуса и возврат фокуса уже сделаны браузером. */}
      {openedMedia && (
        <Modal
          className="w-[min(90vw,900px)] border-0 bg-transparent p-0 shadow-none"
          label={t('imageViewer', 'Просмотр изображения')}
          onClose={() => setOpenedMedia(null)}
        >
          {openedMedia.isVideo ? (
            <VideoPlayer src={openedMedia.url} />
          ) : (
            <img
              alt=""
              className="max-h-[80vh] w-full rounded-window object-contain"
              src={openedMedia.url}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
