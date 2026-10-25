import { makeMessage } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { MessageReplyPreview } from './MessageReplyPreview';

function renderPreview(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>);
}

describe('MessageReplyPreview', () => {
  it('не рендерится, если у сообщения нет replyTo', () => {
    const message = makeMessage({ replyTo: null });
    const { container } = renderPreview(<MessageReplyPreview message={message} />);
    expect(container.firstChild).toBeNull();
  });

  it('отображает плашку, даже если исходное сообщение еще не было показано в чате', () => {
    const message = makeMessage({
      replyTo: 'msg-999',
      replyToSenderName: 'Анна',
      replyToContent: 'Текст исходного сообщения',
    });

    renderPreview(<MessageReplyPreview message={message} />);

    expect(screen.getByText('Анна')).toBeInTheDocument();
    expect(screen.getByText('Сообщение')).toBeInTheDocument();
  });

  it('показывает дефолтный заголовок и текст, когда исходное сообщение не загружено и нет метаданных', () => {
    const message = makeMessage({
      replyTo: 'msg-hidden',
      replyToSenderName: null,
      replyToContent: null,
    });

    renderPreview(<MessageReplyPreview message={message} />);

    expect(screen.getByText('Ответ')).toBeInTheDocument();
    expect(screen.getByText('Сообщение')).toBeInTheDocument();
  });

  it('отображает превью фотографии с изображением', () => {
    const replied = makeMessage({
      id: 'img-1',
      senderName: 'Иван',
      mediaUrl: 'https://example.com/photo.jpg',
      mediaType: 'image',
      content: 'Описание фото',
    });
    const message = makeMessage({
      replyTo: 'img-1',
    });

    const { container } = renderPreview(
      <MessageReplyPreview message={message} repliedMessage={replied} />
    );

    expect(screen.getByText('Иван')).toBeInTheDocument();
    expect(screen.getByText('Описание фото')).toBeInTheDocument();
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://example.com/photo.jpg');
  });

  it('отображает превью видео с иконкой воспроизведения', () => {
    const replied = makeMessage({
      id: 'vid-1',
      senderName: 'Ольга',
      mediaUrl: 'https://example.com/video.mp4',
      mediaType: 'video',
      content: '',
    });
    const message = makeMessage({
      replyTo: 'vid-1',
    });

    const { container } = renderPreview(
      <MessageReplyPreview message={message} repliedMessage={replied} />
    );

    expect(screen.getByText('Ольга')).toBeInTheDocument();
    expect(screen.getByText('Видео')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('вызывает onJumpToMessage при клике и нажатии клавиатурных клавиш', async () => {
    const user = userEvent.setup();
    const onJumpToMessage = vi.fn();
    const message = makeMessage({
      replyTo: 'target-123',
      replyToSenderName: 'Михаил',
      replyToContent: 'Привет',
    });

    renderPreview(<MessageReplyPreview message={message} onJumpToMessage={onJumpToMessage} />);

    const button = screen.getByRole('button', { name: /перейти к сообщению/i });
    expect(button).toHaveAttribute('tabindex', '0');

    // Клик мышью
    await user.click(button);
    expect(onJumpToMessage).toHaveBeenCalledWith('target-123');

    // Enter
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onJumpToMessage).toHaveBeenCalledTimes(2);

    // Space
    fireEvent.keyDown(button, { key: ' ' });
    expect(onJumpToMessage).toHaveBeenCalledTimes(3);
  });
});

/* Исходника нет в загруженной ленте — текст берётся из превью, которое
   сервер присылает вместе с ответом (#1065). */
describe('цитата на сообщение вне ленты', () => {
  const preview = (extra: Record<string, unknown> = {}) => ({
    id: 'msg-old',
    content: 'давнее сообщение',
    type: 'text' as const,
    senderId: 'user-2',
    senderName: 'Анна',
    reactions: [],
    ...extra,
  });

  it('показывает текст из превью сервера', () => {
    const message = makeMessage({ replyTo: 'msg-old', replyPreview: preview() });

    renderPreview(<MessageReplyPreview message={message} />);

    expect(screen.getByText('давнее сообщение')).toBeInTheDocument();
    expect(screen.getByText('Анна')).toBeInTheDocument();
  });

  it('фото с подписью — тип словами: миниатюры у превью нет', () => {
    const message = makeMessage({
      replyTo: 'msg-old',
      replyPreview: preview({ type: 'image', content: 'закат' }),
    });

    renderPreview(<MessageReplyPreview message={message} />);

    expect(screen.getByText('Фотография: закат')).toBeInTheDocument();
  });

  it('нерасшифрованное превью — строкой с замком', () => {
    const message = makeMessage({
      replyTo: 'msg-old',
      replyPreview: preview({ content: '', undecryptable: 'beforeJoin' }),
    });

    renderPreview(<MessageReplyPreview message={message} />);

    expect(screen.getByText(/^🔒/)).toBeInTheDocument();
  });

  it('звонок — подпись типа, без служебного JSON', () => {
    const message = makeMessage({
      replyTo: 'msg-old',
      replyPreview: preview({ type: 'call', content: '{"callKind":"audio"}' }),
    });

    renderPreview(<MessageReplyPreview message={message} />);

    expect(screen.getByText('Звонок')).toBeInTheDocument();
    expect(screen.queryByText(/callKind/)).toBeNull();
  });

  it('исходник в ленте важнее превью: в нём свежая правка', () => {
    const message = makeMessage({ replyTo: 'msg-old', replyPreview: preview() });
    const replied = makeMessage({ id: 'msg-old', content: 'исправленный текст' });

    renderPreview(<MessageReplyPreview message={message} repliedMessage={replied} />);

    expect(screen.getByText('исправленный текст')).toBeInTheDocument();
    expect(screen.queryByText('давнее сообщение')).toBeNull();
  });
});

/* Ответ на звонок (#1073): в цитате вид звонка, а не служебный JSON. */
describe('цитата звонка', () => {
  it('видеозвонок — «Видеозвонок», без callKind', () => {
    const replied = makeMessage({
      id: 'call-1',
      type: 'call',
      content: JSON.stringify({ callKind: 'video', status: 'answered', duration: 5 }),
    });
    const reply = makeMessage({ replyTo: 'call-1' });

    renderPreview(<MessageReplyPreview message={reply} repliedMessage={replied} />);

    expect(screen.getByText('Видеозвонок')).toBeInTheDocument();
    expect(screen.queryByText(/callKind/)).toBeNull();
  });
});
