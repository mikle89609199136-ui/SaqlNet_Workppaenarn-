import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearToasts, getToasts } from '@/shared/ui';
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

  it('комбинирует одновременное подчёркивание и зачёркивание без взаимного затирания (#915)', () => {
    const { container } = renderContent('подчёркнутый и зачёркнутый', [
      { type: 'underline', offset: 0, length: 26 },
      { type: 'strikethrough', offset: 0, length: 26 },
    ]);

    const u = container.querySelector('u');
    const s = container.querySelector('s');
    expect(u).toBeInTheDocument();
    expect(s).toBeInTheDocument();
    expect(u).toContainElement(s);
    expect(s).toHaveClass('line-through');
  });

  it('комбинирует все стили одновременно: жирный, курсив, подчёркнутый, зачёркнутый, спойлер (#915)', async () => {
    renderContent('комбо стиль', [
      { type: 'bold', offset: 0, length: 11 },
      { type: 'italic', offset: 0, length: 11 },
      { type: 'underline', offset: 0, length: 11 },
      { type: 'strikethrough', offset: 0, length: 11 },
      { type: 'spoiler', offset: 0, length: 11 },
    ]);

    const spoilerBtn = screen.getByRole('button', { name: /Скрытый текст/ });
    expect(spoilerBtn).toBeInTheDocument();
    await userEvent.click(spoilerBtn);

    const el = screen.getByText('комбо стиль');
    expect(el.closest('strong')).toHaveClass('font-semibold');
    expect(el.closest('em')).toHaveClass('italic');
    expect(el.closest('u')).toBeInTheDocument();
    expect(el.closest('s')).toHaveClass('line-through');
  });

  it('скрывает моноширинный код внутри спойлера и раскрывает по клику (#915)', async () => {
    const { container } = renderContent('пароль: 12345', [
      { type: 'spoiler', offset: 8, length: 5 },
      { type: 'monospace', offset: 8, length: 5 },
    ]);

    const spoilerBtn = screen.getByRole('button', { name: /Скрытый текст/ });
    expect(spoilerBtn).toHaveClass('spoiler-dust');
    expect(spoilerBtn.firstElementChild).toHaveClass('invisible');
    const code = container.querySelector('code');
    expect(code).toBeInTheDocument();
    expect(code).toHaveTextContent('12345');

    await userEvent.click(spoilerBtn);
    expect(screen.getByRole('button', { name: 'Скрыть текст' })).toHaveClass('spoiler-open');
    expect(spoilerBtn.firstElementChild).not.toHaveClass('invisible');
  });

  it('рендерит семантические HTML-теги для совместимости с буфером обмена (strong, em, u, s, mark) (#915)', () => {
    const { container } = renderContent('жир кур под зач спойлер', [
      { type: 'bold', offset: 0, length: 3 },
      { type: 'italic', offset: 4, length: 3 },
      { type: 'underline', offset: 8, length: 3 },
      { type: 'strikethrough', offset: 12, length: 3 },
      { type: 'spoiler', offset: 16, length: 7 },
    ]);

    expect(container.querySelector('strong')).toHaveTextContent('жир');
    expect(container.querySelector('em')).toHaveTextContent('кур');
    expect(container.querySelector('u')).toHaveTextContent('под');
    expect(container.querySelector('s')).toHaveTextContent('зач');
    expect(container.querySelector('mark')).toHaveTextContent('спойлер');
  });

  it('сочетание зачёркнутого скрытого текста и ссылки содержит оба тега s, mark и a (#915)', () => {
    const { container } = renderContent('скрытый зачёркнутый и ссылка', [
      { type: 'strikethrough', offset: 0, length: 19 },
      { type: 'spoiler', offset: 0, length: 19 },
      { type: 'link', offset: 22, length: 6, data: { url: 'https://example.com' } },
    ]);

    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark?.querySelector('s')).toHaveTextContent('скрытый зачёркнутый');
    const link = container.querySelector('a');
    expect(link).toHaveTextContent('ссылка');
    expect(link).toHaveAttribute('href', 'https://example.com');
  });
});

describe('блок кода (#823)', () => {
  beforeEach(() => clearToasts());

  it('```язык — карточка с языком, код подсвечивается, «Копировать» кладёт код в буфер', async () => {
    const user = userEvent.setup();
    const { container } = renderContent('Вот:\n```js\nconst a = 1;\n```\nвсё');

    expect(screen.getByText('js')).toBeInTheDocument();
    expect(container.querySelector('pre')).toHaveTextContent('const a = 1;');
    // Подсветка догружается отдельным куском.
    await waitFor(() =>
      expect(container.querySelector('pre .hljs-keyword')).toHaveTextContent('const')
    );

    await user.click(screen.getByRole('button', { name: 'Скопировать код' }));

    expect(await navigator.clipboard.readText()).toBe('const a = 1;');
    await waitFor(() =>
      expect(getToasts()).toEqual([expect.objectContaining({ message: 'Код скопирован' })])
    );
  });

  it('строки подряд моноширинные — тоже блок кода', () => {
    const { container } = renderContent('a()\nb()', [
      { type: 'monospace', offset: 0, length: 3 },
      { type: 'monospace', offset: 4, length: 3 },
    ]);

    expect(container.querySelector('pre')).toHaveTextContent('a() b()');
    expect(screen.getByRole('button', { name: 'Скопировать код' })).toBeInTheDocument();
  });
});
