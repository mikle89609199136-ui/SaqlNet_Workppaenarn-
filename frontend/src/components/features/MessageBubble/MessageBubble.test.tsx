import { testI18n } from '@/test/harness/i18n';
import { makeMessage } from '@/test/fixtures';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
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
          onSelection={vi.fn()}
          translations={{}}
        />
      )
    ).not.toThrow();

    expect(screen.getByText('просто сообщение')).toBeInTheDocument();
  });

  it('берёт запасное превью из самого сообщения, когда исходное не найдено', () => {
    /* Сообщение, на которое отвечают, может лежать за пределами
       загруженных страниц — тогда сервер присылает его текст прямо в
       ответе. */
    const reply = makeMessage({
      id: 'msg-2',
      content: 'ответ',
      replyTo: 'msg-0',
      replyToContent: 'текст из ответа',
    });

    renderBubble(
      <MessageBubble
        currentUserId="user-1"
        message={reply}
        onOpenImage={vi.fn()}
        onSelection={vi.fn()}
        translations={{}}
      />
    );

    expect(screen.getByText('текст из ответа')).toBeInTheDocument();
  });
});
