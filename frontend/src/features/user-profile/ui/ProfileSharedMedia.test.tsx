import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import { testI18n } from '@/test/harness/i18n';
import { makeMessage } from '@/test/fixtures';
import type { IMediaItem, TSharedKind } from '@/types';
import { isDisplayableMedia, ProfileSharedMedia } from './ProfileSharedMedia';

function makeMediaMessage(
  id: string,
  type: 'image' | 'video',
  mediaUrl: string | null
): IMediaItem {
  return { ...makeMessage({ id, type }), mediaUrl };
}

type TPages = Partial<Record<TSharedKind, { messages: IMediaItem[]; nextCursor?: string }[]>>;

/** Выдача общего по видам: страницы по порядку, курсор — номер следующей. */
function mockShared(pages: TPages) {
  return vi
    .spyOn(services.messageService, 'fetchSharedPage')
    .mockImplementation(async (_chatId, kind, before) => {
      const list = pages[kind] ?? [{ messages: [] }];
      const page = list[before ? Number(before) : 0] ?? { messages: [] };
      return page;
    });
}

function renderShared(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('общее в профиле (#842)', () => {
  it('три вкладки, выбрана «Медиа»; пустая — сообщение', async () => {
    mockShared({});
    renderShared(<ProfileSharedMedia chatId="chat-1" />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Медиа', 'Файлы', 'Ссылки']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Медиафайлов пока нет')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Ссылки' }));
    expect(await screen.findByText('Ссылок пока нет')).toBeInTheDocument();
  });

  it('вкладка грузит свой вид с сервера, только когда её открыли', async () => {
    const fetch = mockShared({});
    renderShared(<ProfileSharedMedia chatId="chat-1" />);

    await screen.findByText('Медиафайлов пока нет');
    expect(fetch.mock.calls.map((call) => call.slice(0, 2))).toEqual([['chat-1', 'media']]);

    await userEvent.click(screen.getByRole('tab', { name: 'Файлы' }));
    await screen.findByText('Файлов пока нет');
    await userEvent.click(screen.getByRole('tab', { name: 'Ссылки' }));
    await screen.findByText('Ссылок пока нет');
    expect(fetch.mock.calls.map((call) => call[1])).toEqual(['media', 'files', 'text']);
  });

  it('фото и видео — плиткой; нажатие открывает окно просмотра', async () => {
    /* Адрес берётся с самого сообщения: он появляется после расшифровки.
       В `metadata.mediaUrl` лежит эндпойнт с шифровкой. */
    mockShared({
      media: [
        {
          messages: [
            makeMediaMessage('msg-1', 'image', 'blob:crane/photo'),
            makeMediaMessage('msg-2', 'video', 'blob:crane/video'),
            makeMediaMessage('msg-3', 'image', null),
          ],
        },
      ],
    });
    const { container } = renderShared(<ProfileSharedMedia chatId="chat-1" />);

    const photo = await screen.findByRole('button', { name: 'Изображение' });
    expect(screen.getAllByRole('button', { name: /Изображение|Видео/ })).toHaveLength(2);
    expect(container.querySelector('video')).toHaveAttribute('src', 'blob:crane/video');

    await userEvent.click(photo);
    const viewer = screen.getByRole('dialog', { name: /просмотр изображения/i });
    expect(viewer.querySelector('img')).toHaveAttribute('src', 'blob:crane/photo');
  });

  it('«Показать ещё» догружает следующую страницу, пока она есть', async () => {
    const fetch = mockShared({
      media: [
        { messages: [makeMediaMessage('new', 'image', 'blob:crane/new')], nextCursor: '1' },
        { messages: [makeMediaMessage('old', 'image', 'blob:crane/old')] },
      ],
    });
    renderShared(<ProfileSharedMedia chatId="chat-1" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Показать ещё' }));

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Изображение' })).toHaveLength(2)
    );
    expect(fetch).toHaveBeenLastCalledWith('chat-1', 'media', '1', 24);
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument();
  });

  it('файлы и аудио — строкой с расширением; нажатие сохраняет файл', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mockShared({
      files: [
        {
          messages: [
            {
              ...makeMessage({ id: 'f-1', type: 'file' }),
              mediaUrl: 'blob:crane/report',
              mediaEncryption: { fileName: 'Отчёт.pdf', sizeBytes: 2048 } as never,
            },
            {
              ...makeMessage({ id: 'a-1', type: 'audio' }),
              mediaUrl: 'blob:crane/song',
              mediaEncryption: { fileName: 'Песня.mp3' } as never,
            },
          ],
        },
      ],
    });
    renderShared(<ProfileSharedMedia chatId="chat-1" />);
    await userEvent.click(screen.getByRole('tab', { name: 'Файлы' }));

    const report = await screen.findByRole('button', { name: /Скачать Отчёт\.pdf/ });
    expect(report).toHaveTextContent('PDF');
    expect(screen.getByRole('button', { name: /Скачать Песня\.mp3/ })).toHaveTextContent('MP3');

    await userEvent.click(report);
    // Окна выбора места в jsdom нет — обычное скачивание с исходным именем.
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('blob:crane/report');
    expect(link.download).toBe('Отчёт.pdf');
  });

  it('ссылки — из расшифрованного текста, от новых к старым, в новой вкладке', async () => {
    mockShared({
      text: [
        {
          messages: [
            makeMessage({ id: 'm-1', content: 'смотри https://www.example.com/docs и напиши' }),
            {
              ...makeMessage({ id: 'm-2', content: 'https://secret.example' }),
              undecryptable: 'keyUnavailable' as const,
            },
            makeMessage({ id: 'm-3', content: 'старое: https://old.example/a' }),
          ],
          nextCursor: '1',
        },
      ],
    });
    renderShared(<ProfileSharedMedia chatId="chat-1" />);
    await userEvent.click(screen.getByRole('tab', { name: 'Ссылки' }));

    await screen.findByText('example.com');
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://www.example.com/docs',
      'https://old.example/a',
    ]);
    expect(links[0]).toHaveAttribute('target', '_blank');
    // Ссылки дальше в истории ищутся по кнопке, не сами.
    expect(
      screen.getByRole('button', { name: 'Искать ссылки дальше в истории' })
    ).toBeInTheDocument();
  });

  it('контекстное меню элемента — «Перейти к сообщению»', async () => {
    const onJump = vi.fn();
    mockShared({ media: [{ messages: [makeMediaMessage('msg-7', 'image', 'blob:crane/p')] }] });
    renderShared(<ProfileSharedMedia chatId="chat-1" onJumpToMessage={onJump} />);

    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Изображение' }), {
      clientX: 10,
      clientY: 20,
    });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Перейти к сообщению' }));

    expect(onJump).toHaveBeenCalledWith('msg-7');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('без перехода — правый клик не перехватывается', async () => {
    mockShared({ media: [{ messages: [makeMediaMessage('msg-7', 'image', 'blob:crane/p')] }] });
    renderShared(<ProfileSharedMedia chatId="chat-1" />);

    const notPrevented = fireEvent.contextMenu(
      await screen.findByRole('button', { name: 'Изображение' })
    );
    expect(notPrevented).toBe(true);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('сбой загрузки — сообщение, а не пустота', async () => {
    vi.spyOn(services.messageService, 'fetchSharedPage').mockRejectedValue(new Error('500'));
    renderShared(<ProfileSharedMedia chatId="chat-1" />);

    expect(await screen.findByText('Не удалось загрузить — попробуйте позже')).toBeInTheDocument();
  });
});

describe('isDisplayableMedia', () => {
  it('пропускает расшифрованное изображение и видео', () => {
    expect(isDisplayableMedia(makeMediaMessage('msg-1', 'image', 'blob:crane/photo'))).toBe(true);
    expect(isDisplayableMedia(makeMediaMessage('msg-2', 'video', 'blob:crane/video'))).toBe(true);
  });

  it('отсеивает вложение без пригодного адреса', () => {
    expect(isDisplayableMedia(makeMediaMessage('msg-3', 'image', null))).toBe(false);
  });

  it('отсеивает вложение, помеченное недоступным', () => {
    const unavailable: IMediaItem = {
      ...makeMediaMessage('msg-4', 'image', 'blob:crane/legacy'),
      mediaUnavailable: true,
    };
    expect(isDisplayableMedia(unavailable)).toBe(false);
  });

  it('отсеивает текстовое сообщение', () => {
    expect(isDisplayableMedia(makeMessage({ id: 'msg-5', type: 'text' }))).toBe(false);
  });
});
