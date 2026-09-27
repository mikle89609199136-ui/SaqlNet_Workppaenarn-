import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import type { IMessageEntity } from '@/shared/lib/richText';
import { testI18n } from '@/test/harness/i18n';
import { MessageContentRenderer } from './MessageContent';

function renderContent(content: string, entities?: IMessageEntity[]) {
  return render(
    <I18nextProvider i18n={testI18n}>
      <MessageContentRenderer content={content} entities={entities} />
    </I18nextProvider>
  );
}

describe('текст сообщения с форматированием (#656)', () => {
  it('показывает каждый вид форматирования своим элементом', () => {
    const { container } = renderContent('жир кур под зач код', [
      { type: 'bold', offset: 0, length: 3 },
      { type: 'italic', offset: 4, length: 3 },
      { type: 'underline', offset: 8, length: 3 },
      { type: 'strikethrough', offset: 12, length: 3 },
      { type: 'monospace', offset: 16, length: 3 },
    ]);

    expect(screen.getByText('жир')).toHaveClass('font-semibold');
    expect(screen.getByText('кур')).toHaveClass('italic');
    expect(screen.getByText('под')).toHaveClass('underline');
    expect(screen.getByText('зач')).toHaveClass('line-through');
    expect(container.querySelector('code')).toHaveTextContent('код');
  });

  it('ссылка открывается в новой вкладке и ничего не передаёт сайту', () => {
    renderContent('см. доки', [
      { type: 'link', offset: 4, length: 4, data: { url: 'https://example.com/docs' } },
    ]);

    const link = screen.getByRole('link', { name: 'доки' });
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('javascript: не становится ссылкой', () => {
    renderContent('нажми', [
      { type: 'link', offset: 0, length: 5, data: { url: 'javascript:alert(1)' } },
    ]);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('нажми')).toBeInTheDocument();
  });

  it('скрытый текст открывается нажатием', async () => {
    renderContent('ответ: 42', [{ type: 'spoiler', offset: 7, length: 2 }]);

    const spoiler = screen.getByRole('button', { name: /Скрытый текст/ });
    // Закрытый — «пыль», как в макете: текст прозрачный под точками.
    expect(spoiler).toHaveClass('spoiler-dust');
    expect(spoiler).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(spoiler);

    const open = screen.getByRole('button', { name: 'Скрыть текст' });
    expect(open).toHaveClass('spoiler-open');
    expect(open).toHaveTextContent('42');

    // И прячется обратно тем же нажатием.
    await userEvent.click(open);
    expect(screen.getByRole('button', { name: /Скрытый текст/ })).toHaveClass('spoiler-dust');
  });

  it('цитата — отдельным блоком', () => {
    const { container } = renderContent('кто-то сказал\nмой ответ', [
      { type: 'blockquote', offset: 0, length: 13 },
    ]);

    expect(container.querySelector('blockquote')).toHaveTextContent('кто-то сказал');
  });

  it('без форматирования — как раньше, с хэштегами', () => {
    renderContent('смотри #релиз');

    expect(screen.getByText('#релиз')).toHaveClass('text-brand');
  });
});
