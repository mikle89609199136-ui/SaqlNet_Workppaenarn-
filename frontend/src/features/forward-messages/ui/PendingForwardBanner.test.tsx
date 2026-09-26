import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { makeMessage } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import type { IMediaItem } from '@/entities/message';
import type { IMessageDto } from '@/types';
import { PendingForwardBanner } from './PendingForwardBanner';

function renderBanner(messages: IMessageDto[]) {
  return render(
    <I18nextProvider i18n={testI18n}>
      <PendingForwardBanner forward={{ targetChatId: 'chat-1', messages }} onCancel={vi.fn()} />
    </I18nextProvider>
  );
}

const photo = (overrides: Partial<IMediaItem> = {}) =>
  makeMessage({
    type: 'image',
    content: '',
    mediaType: 'image',
    mediaUrl: 'blob:photo',
    ...overrides,
  } as Partial<IMessageDto>);

describe('плашка пересылки показывает вложения (#93)', () => {
  it('фотография без подписи — миниатюра и «Фотография», а не пустая строка', () => {
    const { container } = renderBanner([photo()]);

    expect(screen.getByText('Фотография')).toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:photo');
  });

  it('фотография с подписью — тип и текст', () => {
    renderBanner([photo({ content: 'закат' })]);

    expect(screen.getByText('Фотография: закат')).toBeInTheDocument();
  });

  it('у файла и видео — значки вместо картинки', () => {
    const { container } = renderBanner([
      makeMessage({ type: 'file', content: '' }),
      makeMessage({ type: 'video', content: '' }),
    ]);

    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(3);
  });

  it('больше трёх вложений — три миниатюры и счётчик остальных', () => {
    const { container } = renderBanner(
      [1, 2, 3, 4, 5].map((n) => photo({ mediaUrl: `blob:${n}` }))
    );

    expect(container.querySelectorAll('img')).toHaveLength(3);
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('Переслать сообщения: 5')).toBeInTheDocument();
  });
});
