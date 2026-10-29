import { makeMessage } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { useChatUiStore } from '@/entities/chat';
import { describe, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import { MessageBubble } from './MessageBubble';

function renderBubble(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>);
}

describe('MessageBubble', () => {
  it('показывает превью сообщения, на которое отвечают', () => {
    const replied = makeMessage({ id: 'msg-1', content: 'исходное сообщение' });
    const reply = makeMessage({ id: 'msg-2', content: 'ответ', replyTo: 'msg-1' });

    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={reply}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        repliedMessage={replied}
        translations={{}}
      />
    );

    expect(screen.getByText('исходное сообщение')).toBeInTheDocument();
    expect(screen.getByText('ответ')).toBeInTheDocument();
  });

  it('обходится без истории чата: ни кеша запросов, ни маршрутизатора', () => {
    /* Пузырь рисуется без `QueryClientProvider` и без роутера. Пока он
       искал цитату сам, ему требовались оба, а вместе с ними —
       подписка на всю ленту в каждом из сотен пузырей. */
    const message = makeMessage({ id: 'msg-1', content: 'просто сообщение' });

    expect(() =>
      renderBubble(
        <MessageBubble
          currentUserId="user-1"
          message={message}
          onOpenImage={vi.fn()}
          onReact={vi.fn()}
          onSelection={vi.fn()}
          translations={{}}
        />
      )
    ).not.toThrow();

    expect(screen.getByText('просто сообщение')).toBeInTheDocument();
  });

  it('показывает фоллбэк плашки ответа, когда исходное сообщение не найдено', () => {
    const reply = makeMessage({
      id: 'msg-2',
      content: 'ответ',
      replyTo: 'msg-0',
      replyToSenderName: 'Борис',
    });

    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={reply}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

    expect(screen.getByText('Борис')).toBeInTheDocument();
    expect(screen.getByText('Сообщение')).toBeInTheDocument();
  });

  it('вызывает onJumpToMessage при клике и нажатии клавиш на плашке ответа (#553)', async () => {
    const user = userEvent.setup();
    const onJumpToMessage = vi.fn();
    const reply = makeMessage({
      id: 'msg-2',
      content: 'ответ',
      replyTo: 'msg-target-99',
      replyToContent: 'текст цитаты',
    });

    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={reply}
        onJumpToMessage={onJumpToMessage}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

    const quoteButton = screen.getByRole('button', { name: /перейти к сообщению/i });
    expect(quoteButton).toHaveAttribute('tabindex', '0');

    // Клик мышью
    await user.click(quoteButton);
    expect(onJumpToMessage).toHaveBeenCalledWith('msg-target-99');

    // Клавиатура: Enter
    fireEvent.keyDown(quoteButton, { key: 'Enter' });
    expect(onJumpToMessage).toHaveBeenCalledTimes(2);

    // Клавиатура: Space
    fireEvent.keyDown(quoteButton, { key: ' ' });
    expect(onJumpToMessage).toHaveBeenCalledTimes(3);
  });

  it('применяет акцентный стиль при выделении сообщения', () => {
    const message = makeMessage({ id: 'msg-select-1', content: 'выбранное сообщение' });
    useChatUiStore.setState({
      selectedMessages: [message],
      selectionMode: true,
    });

    const { container } = renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={message}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

    const bubble = container.querySelector('.message-bubble');
    expect(bubble).toHaveAttribute('data-state', 'selected');
    expect(bubble).toHaveClass('is-selected');
  });

  it('показывает часы «Загрузка...» у исходящего сообщения со статусом uploading', () => {
    const message = makeMessage({
      id: 'msg-uploading-1',
      senderId: 'user-1',
      content: 'фотография',
      status: 'uploading',
    });

    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={message}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

    // Как в макете: пока сообщение уходит — часы вместо галочки.
    expect(screen.getByRole('img', { name: 'Загрузка...' })).toBeInTheDocument();
  });

  it('отображает плашку ошибки и вызывает onRetryMessage по клику на кнопку повтора', async () => {
    const user = userEvent.setup();
    const onRetryMessage = vi.fn();
    const message = makeMessage({
      id: 'msg-failed-1',
      senderId: 'user-1',
      content: 'не ушло',
      status: 'failed',
    });

    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={message}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onRetryMessage={onRetryMessage}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

    // Под пузырём, как в макете: «Не отправлено», «Повторить», «Удалить».
    expect(screen.getByText('Не отправлено')).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: /повторить отправку/i });
    await user.click(retryButton);

    expect(onRetryMessage).toHaveBeenCalledWith(message);
  });

  it('вызывает onCancelMessage по клику на кнопку отмены/удаления', async () => {
    const user = userEvent.setup();
    const onCancelMessage = vi.fn();
    const message = makeMessage({
      id: 'msg-failed-2',
      senderId: 'user-1',
      content: 'удалить ошибку',
      status: 'failed',
    });

    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={message}
        onCancelMessage={onCancelMessage}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

    const cancelButton = screen.getByRole('button', { name: /удалить/i });
    await user.click(cancelButton);

    expect(onCancelMessage).toHaveBeenCalledWith(message);
  });
});

describe('статус доставки', () => {
  const sent = () => makeMessage({ id: 'msg-1', content: 'моё сообщение', status: 'sent' });

  it('показывает галочку у своего отправленного в личном чате', () => {
    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={sent()}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        showDeliveryStatus
        translations={{}}
      />
    );

    expect(screen.getByText('моё сообщение')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Отправлено' })).toBeInTheDocument();
  });

  it('молчит в групповом чате: там у «прочитано» нет одного значения', () => {
    // `showDeliveryStatus` не передан — как это делает страница треда для группы.
    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={sent()}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

    expect(screen.getByText('моё сообщение')).toBeInTheDocument();
    expect(screen.queryByTitle('Отправлено')).not.toBeInTheDocument();
  });

  it('не помечает чужие сообщения', () => {
    renderBubble(
      <MessageBubble
        currentUserId="user-2"
        message={sent()}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        showDeliveryStatus
        translations={{}}
      />
    );

    expect(screen.getByText('моё сообщение')).toBeInTheDocument();
    expect(screen.queryByTitle('Отправлено')).not.toBeInTheDocument();
  });
});

describe('пересланное сообщение (#169)', () => {
  function renderForwarded(overrides: Parameters<typeof makeMessage>[0]) {
    return renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={makeMessage({ content: 'пересланный текст', ...overrides })}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );
  }

  it('называет исходного автора', () => {
    renderForwarded({ isForwarded: true, forwardedSenderName: 'Максим' });

    expect(screen.getByText(/Переслано от/)).toHaveTextContent('Переслано от Максим');
    expect(screen.getByText('Максим').tagName).toBe('B');
    expect(screen.getByText('пересланный текст')).toBeInTheDocument();
  });

  it('помечает пересылку и без имени: у старых пересылок его нет', () => {
    renderForwarded({ isForwarded: true, forwardedSenderName: '' });

    expect(screen.getByText('Переслано')).toBeInTheDocument();
    expect(screen.queryByText(/Переслано от/)).not.toBeInTheDocument();
  });

  it('при скрытой ссылке на автора — только имя, без перехода (#785)', () => {
    renderForwarded({
      isForwarded: true,
      forwardedSenderName: 'Анна',
      metadata: { forwardedHidden: true, forwardedSenderName: 'Анна' },
    });

    expect(screen.getByText(/Переслано от/)).toHaveTextContent('Переслано от Анна');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Анна/ })).not.toBeInTheDocument();
  });

  it('открывает профиль автора по клику на имя, если ссылка разрешена (#785)', async () => {
    const onOpenProfile = vi.fn();
    const onSelection = vi.fn();
    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={makeMessage({
          content: 'пересланный текст',
          isForwarded: true,
          forwardedSenderName: 'Анна',
          forwardedSenderId: 'user-anna',
        })}
        onOpenImage={vi.fn()}
        onOpenProfile={onOpenProfile}
        onReact={vi.fn()}
        onSelection={onSelection}
        translations={{}}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Анна' }));

    expect(onOpenProfile).toHaveBeenCalledWith('user-anna');
    expect(onSelection).not.toHaveBeenCalled();
  });

  it('без обработчика профиля имя остаётся текстом', () => {
    renderForwarded({
      isForwarded: true,
      forwardedSenderName: 'Анна',
      forwardedSenderId: 'user-anna',
    });

    expect(screen.getByText('Анна').tagName).toBe('B');
    expect(screen.queryByRole('button', { name: 'Анна' })).not.toBeInTheDocument();
  });

  it('молчит у обычного сообщения', () => {
    renderForwarded({ isForwarded: false, forwardedSenderName: 'Максим' });

    expect(screen.queryByText(/Переслано/)).not.toBeInTheDocument();
  });
});

describe('закреплённое сообщение (#170)', () => {
  function renderPinned(overrides: Parameters<typeof makeMessage>[0]) {
    return renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={makeMessage({ content: 'сообщение', ...overrides })}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );
  }

  it('показывает булавку 12px в строке времени, когда сообщение закреплено', () => {
    renderPinned({ isPinned: true });

    const pin = screen.getByRole('img', { name: 'Закреплено' });
    expect(pin.querySelector('svg')).toHaveClass('size-3');
  });

  it('не показывает иконку pin у обычного сообщения', () => {
    renderPinned({ isPinned: false });

    expect(screen.queryByLabelText('Закреплено')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Закреплено' })).not.toBeInTheDocument();
  });

  /* Пузырь по дизайн-системе (#820). */
  describe('по дизайн-системе', () => {
    const base = {
      onOpenImage: vi.fn(),
      onReact: vi.fn(),
      onSelection: vi.fn(),
      translations: {},
    };

    it('время и статус у текста — в правом нижнем углу, у звонка — строкой', () => {
      const text = renderBubble(
        <MessageBubble
          {...base}
          currentUserId="me"
          message={makeMessage({ senderId: 'me', content: 'текст', status: 'read' })}
        />
      );
      // Прижаты вправо в конце текста: на последней строке, если влезают,
      // иначе строкой ниже — но всегда справа.
      expect(text.container.querySelector('.message-meta')).toHaveClass('float-right');
      text.unmount();

      const call = renderBubble(
        <MessageBubble
          {...base}
          currentUserId="me"
          message={makeMessage({ senderId: 'me', type: 'call', content: '{}' })}
        />
      );
      expect(call.container.querySelector('.message-meta')).not.toHaveClass('float-right');
    });

    it('своё — на заливке акцента, белым; чужое — на bubble-in', () => {
      const { container, unmount } = renderBubble(
        <MessageBubble
          {...base}
          currentUserId="me"
          message={makeMessage({ senderId: 'me', content: 'моё' })}
        />
      );
      expect(container.querySelector('.message-bubble')).toHaveClass(
        'bg-brand-fill',
        'text-on-brand'
      );
      unmount();

      const other = renderBubble(
        <MessageBubble
          {...base}
          currentUserId="me"
          message={makeMessage({ senderId: 'u-2', content: 'чужое' })}
        />
      );
      expect(other.container.querySelector('.message-bubble')).toHaveClass(
        'bg-bubble-in',
        'text-ink'
      );
    });

    it('в группе у первого в серии — имя автора, по нему открывается профиль', async () => {
      const user = userEvent.setup();
      const onOpenProfile = vi.fn();

      renderBubble(
        <MessageBubble
          {...base}
          currentUserId="me"
          isFirstInGroup
          isGroupChat
          isLastInGroup={false}
          message={makeMessage({ senderId: 'u-2', senderName: 'Игорь', content: 'привет' })}
          onOpenProfile={onOpenProfile}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Игорь' }));
      expect(onOpenProfile).toHaveBeenCalledWith('u-2');
    });

    it('аватарка автора — у последнего в серии, у остальных место под неё пустое', () => {
      const message = makeMessage({ senderId: 'u-2', senderName: 'Игорь', content: 'привет' });

      const { unmount } = renderBubble(
        <MessageBubble
          {...base}
          currentUserId="me"
          isGroupChat
          isLastInGroup
          message={message}
          onOpenProfile={vi.fn()}
        />
      );
      expect(screen.getByRole('button', { name: 'Профиль: Игорь' })).toBeInTheDocument();
      unmount();

      renderBubble(
        <MessageBubble
          {...base}
          currentUserId="me"
          isFirstInGroup={false}
          isGroupChat
          isLastInGroup={false}
          message={message}
          onOpenProfile={vi.fn()}
        />
      );
      expect(screen.queryByRole('button', { name: 'Профиль: Игорь' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Игорь' })).not.toBeInTheDocument();
    });

    it('в личном чате ни имени, ни аватарки', () => {
      renderBubble(
        <MessageBubble
          {...base}
          currentUserId="me"
          message={makeMessage({ senderId: 'u-2', senderName: 'Игорь', content: 'привет' })}
          onOpenProfile={vi.fn()}
        />
      );

      expect(screen.queryByRole('button', { name: /Игорь/ })).not.toBeInTheDocument();
    });

    it('реакции — под пузырём, а не внутри', () => {
      const { container } = renderBubble(
        <MessageBubble
          {...base}
          currentUserId="me"
          message={makeMessage({
            senderId: 'u-2',
            content: 'привет',
            reactions: [{ emoji: '👍', count: 2, myReaction: false }] as never,
          })}
        />
      );

      const reactions = container.querySelector('.message-reactions');
      expect(reactions).not.toBeNull();
      expect(container.querySelector('.message-bubble')!.contains(reactions)).toBe(false);
    });
  });

  describe('статусы и реакции по макету', () => {
    const base = {
      onOpenImage: vi.fn(),
      onReact: vi.fn(),
      onSelection: vi.fn(),
      translations: {},
    };

    it('у своего сообщения из истории — галочка «Отправлено» в любом чате', () => {
      /* Сервер статуса отправки не присылает: всё, что пришло с него, уже
         отправлено. Раньше галочки стояли только сразу после отправки. */
      renderBubble(
        <MessageBubble
          {...base}
          currentUserId="me"
          isGroupChat
          message={makeMessage({ senderId: 'me', content: 'моё' })}
        />
      );

      expect(screen.getByRole('img', { name: 'Отправлено' })).toBeInTheDocument();
    });

    it('доставлено — две приглушённые галочки, прочитано — две яркие (#657)', () => {
      const at = '2026-09-29T12:00:00.000Z';
      const { unmount } = renderBubble(
        <MessageBubble
          {...base}
          currentUserId="me"
          message={makeMessage({ senderId: 'me', content: 'моё', deliveredAt: at })}
          showDeliveryStatus
        />
      );
      expect(screen.getByRole('img', { name: 'Доставлено' })).toHaveAttribute(
        'data-delivery',
        'delivered'
      );
      unmount();

      renderBubble(
        <MessageBubble
          {...base}
          currentUserId="me"
          message={makeMessage({ senderId: 'me', content: 'моё', deliveredAt: at, readAt: at })}
          showDeliveryStatus
        />
      );
      expect(screen.getByRole('img', { name: 'Прочитано' })).toHaveAttribute(
        'data-delivery',
        'read'
      );
    });

    it('«Прочитано» — только в личном чате и только когда известно', () => {
      const read = makeMessage({
        senderId: 'me',
        content: 'моё',
        readAt: '2026-09-29T12:00:00.000Z',
      });

      const { unmount } = renderBubble(
        <MessageBubble {...base} currentUserId="me" message={read} showDeliveryStatus />
      );
      expect(screen.getByRole('img', { name: 'Прочитано' })).toBeInTheDocument();
      unmount();

      renderBubble(<MessageBubble {...base} currentUserId="me" isGroupChat message={read} />);
      expect(screen.queryByRole('img', { name: 'Прочитано' })).not.toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Отправлено' })).toBeInTheDocument();
    });

    it('у чужого сообщения статуса нет', () => {
      renderBubble(
        <MessageBubble
          {...base}
          currentUserId="me"
          message={makeMessage({ senderId: 'u-2', content: 'чужое' })}
        />
      );

      expect(screen.queryByRole('img', { name: /Отправлено|Прочитано/ })).not.toBeInTheDocument();
    });

    it('реакция — картинка Noto, при появлении своей играет анимация', () => {
      // Без изоляции тестов matchMedia может остаться чужим — движение явно
      // не уменьшено; прежний matchMedia возвращаем как есть.
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia;
      const message = makeMessage({
        senderId: 'u-2',
        content: 'привет',
        reactions: [{ emoji: '👍', count: 1, myReaction: false }] as never,
      });
      const { container, rerender } = renderBubble(
        <MessageBubble {...base} currentUserId="me" message={message} />
      );

      // Картинки — из статики приложения, без запросов к Google (#824).
      const srcs = () =>
        [...container.querySelectorAll('.message-reactions img')].map((img) =>
          img.getAttribute('src')
        );
      expect(srcs()).toEqual(['/emoji/noto/1f44d.svg']);

      rerender(
        <I18nextProvider i18n={testI18n}>
          <MessageBubble
            {...base}
            currentUserId="me"
            message={{
              ...message,
              reactions: [{ emoji: '👍', count: 2, myReaction: true }] as never,
            }}
          />
        </I18nextProvider>
      );

      // Анимация ложится поверх статичной, статичная остаётся до загрузки.
      expect(srcs()).toEqual(['/emoji/noto/1f44d.svg', '/emoji/noto/1f44d.webp']);
      window.matchMedia = originalMatchMedia;
    });

    it('ReactionPill показывает тултип «Вы», если реакция только своя (count: 1, mine: true)', () => {
      const message = makeMessage({
        senderId: 'u-1',
        content: 'сообщение',
        reactions: [{ emoji: '👍', count: 1, myReaction: true }] as never,
      });

      renderBubble(<MessageBubble {...base} currentUserId="me" message={message} />);

      const pill = screen.getByRole('button', { name: /👍/ });
      expect(pill).toBeInTheDocument();
      expect(screen.getByText('Вы')).toBeInTheDocument();
    });

    it('ReactionPill запрашивает авторов после 500мс задержки при hover (#998)', async () => {
      vi.useFakeTimers();
      const listSpy = vi.spyOn(services.messageService, 'listReactionAuthors').mockResolvedValue({
        emoji: '👍',
        total: 2,
        users: [{ id: 'u-1', firstName: 'Алексей', lastName: 'Иванов' }],
      });

      const message = makeMessage({
        id: 'msg-test-hover',
        senderId: 'u-1',
        content: 'сообщение',
        reactions: [{ emoji: '👍', count: 2, myReaction: false }] as never,
      });

      renderBubble(<MessageBubble {...base} currentUserId="me" message={message} />);

      const pill = screen.getByRole('button', { name: /👍/ });

      fireEvent.mouseEnter(pill);

      // До 500мс запрос не отправляется
      vi.advanceTimersByTime(200);
      expect(listSpy).not.toHaveBeenCalled();

      // После 500мс запрос инициируется
      await act(async () => {
        vi.advanceTimersByTime(350);
      });
      expect(listSpy).toHaveBeenCalledWith('msg-test-hover', '👍', undefined, 50);

      listSpy.mockRestore();
      vi.useRealTimers();
    });
  });
});

/* Ширина пузыря (#843): голосовое — по содержимому, аудиофайл — во всю
   доступную ширину под ползунок; максимум у обоих общий. */
describe('ширина пузыря с аудио', () => {
  const bubbleOf = (type: 'voice' | 'audio') => {
    const message = {
      ...makeMessage({ id: `m-${type}`, content: '' }),
      type,
      mediaUrl: 'blob:audio',
      voice: type === 'voice' ? { durationMs: 3000, waveform: [1, 2] } : undefined,
    } as never;
    const { container } = renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={message}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );
    return container.querySelector('.message-bubble')!;
  };

  it('голосовое не растягивается, но ограничено максимумом', () => {
    const bubble = bubbleOf('voice');
    expect(bubble).toHaveClass('w-fit');
    expect(bubble).not.toHaveClass('w-full');
    expect(bubble.className).toMatch(/max-w-/);
  });

  it('аудиофайл — во всю ширину под ползунок', () => {
    expect(bubbleOf('audio')).toHaveClass('w-full');
  });
});

/* Вложение не скачалось (#1062): подпись по причине и «Повторить» только
   там, где повтор может помочь. */
describe('вложение, которое не открылось', () => {
  const unavailable = (reason: string) =>
    ({
      ...makeMessage({ id: `m-${reason}`, content: '' }),
      type: 'image',
      mediaUrl: null,
      mediaUnavailable: true,
      mediaUnavailableReason: reason,
    }) as never;

  const renderUnavailable = (reason: string, onRetryMedia?: () => Promise<void>) =>
    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={unavailable(reason)}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onRetryMedia={onRetryMedia}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

  it('не скачалось — своя подпись и «Повторить», пока повтор идёт, кнопка выключена', async () => {
    let finish!: () => void;
    const onRetryMedia = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const user = userEvent.setup();
    renderUnavailable('downloadFailed', onRetryMedia);

    expect(screen.getByText('Не удалось загрузить медиа')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Загрузить медиа ещё раз' });
    await user.click(retry);

    expect(onRetryMedia).toHaveBeenCalledTimes(1);
    expect(onRetryMedia).toHaveBeenCalledWith(expect.objectContaining({ id: 'm-downloadFailed' }));
    expect(retry).toBeDisabled();
    // Нажатие по кнопке не открывает меню сообщения.
    expect(useChatUiStore.getState().actionMenu).toBeNull();

    finish();
    await vi.waitFor(() => expect(retry).toBeEnabled());
  });

  it.each([
    ['notFound', 'Медиа недоступно: файла нет на сервере'],
    ['forbidden', 'Медиа недоступно: нет доступа к файлу'],
    ['decryptFailed', 'Медиа недоступно: ошибка расшифровки'],
    ['foreign', 'Медиа недоступно: файл не из этого приложения'],
    ['unencrypted', 'Медиа недоступно: файл не зашифрован'],
  ])('%s — своя подпись и без «Повторить»', (reason, text) => {
    renderUnavailable(
      reason,
      vi.fn(async () => {})
    );

    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Загрузить медиа ещё раз' })).toBeNull();
  });

  it('без обработчика повтора кнопки нет', () => {
    renderUnavailable('downloadFailed');

    expect(screen.getByText('Не удалось загрузить медиа')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Загрузить медиа ещё раз' })).toBeNull();
  });
});

/* Когда поправили (#1066): подсказкой у «изменено» и в подписи для диктора. */
describe('время правки', () => {
  const renderMessage = (overrides: Parameters<typeof makeMessage>[0]) =>
    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={makeMessage({ id: 'm-edited', content: 'текст', ...overrides })}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

  it('у «изменено» подсказка со временем правки, та же — в подписи сообщения', () => {
    renderMessage({ isEdited: true, updatedAt: new Date() });

    const mark = screen.getByText('изменено');
    expect(mark.getAttribute('title')).toMatch(/^Изменено сегодня в \d\d:\d\d$/);
    expect(screen.getByRole('article').getAttribute('aria-label')).toContain(
      mark.getAttribute('title')
    );
  });

  it('у неизменённого нет ни метки, ни строки в подписи', () => {
    renderMessage({ isEdited: false });

    expect(screen.queryByText('изменено')).toBeNull();
    expect(screen.getByRole('article').getAttribute('aria-label')).not.toMatch(/Изменено/);
  });
});

/* Тип и итог звонка в ленте (#1073). */
describe('звонок в ленте', () => {
  const renderCall = (senderId: string, fields: Record<string, unknown>) =>
    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={makeMessage({
          id: `call-${senderId}`,
          senderId,
          type: 'call',
          content: JSON.stringify(fields),
        })}
        onOpenImage={vi.fn()}
        onReact={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

  it('чужой пропущенный — «Пропущенный звонок», отмечен как пропущенный', () => {
    const { container } = renderCall('user-2', { status: 'missed', initiatorId: 'user-2' });

    expect(screen.getByText('Пропущенный звонок')).toBeInTheDocument();
    expect(container.querySelector('[data-call="missed"]')).not.toBeNull();
  });

  it('свой отвеченный видео — «Исходящий видеозвонок» и длительность', () => {
    renderCall('user-1', {
      callKind: 'video',
      status: 'answered',
      duration: 65,
      initiatorId: 'user-1',
    });

    expect(screen.getByText('Исходящий видеозвонок')).toBeInTheDocument();
    expect(screen.getByText('1:05')).toBeInTheDocument();
  });

  it('свой без ответа — «Без ответа»', () => {
    renderCall('user-1', { status: 'missed', initiatorId: 'user-1' });

    expect(screen.getByText('Исходящий звонок')).toBeInTheDocument();
    expect(screen.getByText('Без ответа')).toBeInTheDocument();
  });
});

describe('настройки ленты #728', () => {
  const base = {
    currentUserId: 'user-1',
    translations: {},
    onOpenImage: vi.fn(),
    onReact: vi.fn(),
    onSelection: vi.fn(),
  };
  it.each(['pending', 'sent', 'delivered', 'read'] as const)(
    'скрывает отметки %s и время',
    (status) => {
      renderBubble(
        <MessageBubble
          {...base}
          message={makeMessage({ senderId: 'user-1', status })}
          showDeliveryStatus
          showMessageStatus={false}
          showMessageTime={false}
        />
      );
      expect(document.querySelector('time')).toBeNull();
      expect(document.querySelector('[data-delivery]')).toBeNull();
      expect(document.querySelector('.message-meta')).toBeNull();
    }
  );
  it('при скрытых статусах оставляет ошибку и работающий retry', async () => {
    const retry = vi.fn();
    const message = makeMessage({ senderId: 'user-1', status: 'failed' });
    renderBubble(
      <MessageBubble
        {...base}
        message={message}
        showMessageStatus={false}
        showMessageTime={false}
        onRetryMessage={retry}
      />
    );
    expect(screen.getByText('Не отправлено')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить отправку' }));
    expect(retry).toHaveBeenCalledWith(message);
  });
  it('скрывает аватар группы, сохраняя имя и доступ к профилю', () => {
    renderBubble(
      <MessageBubble
        {...base}
        message={makeMessage({ senderId: 'user-2', senderName: 'Анна' })}
        isGroupChat
        showMessageAvatars={false}
        onOpenProfile={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Анна' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Профиль: Анна' })).not.toBeInTheDocument();
  });
});
