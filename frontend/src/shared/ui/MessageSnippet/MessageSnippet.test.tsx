import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageSnippet } from './MessageSnippet';
import type { IMessageEntity } from '@/shared/lib/richText';

describe('MessageSnippet (#971)', () => {
  it('не рендерит ничего для пустого текста', () => {
    const { container } = render(<MessageSnippet text="" />);
    expect(container.firstChild).toBeNull();
  });

  it('рендерит обычный текст без сущностей', () => {
    render(<MessageSnippet text="Привет мир" />);
    expect(screen.getByText('Привет мир')).toBeInTheDocument();
  });

  it('рендерит теги форматирования: strong, em, u, s, code', () => {
    const text = 'жирный курсив подчёркнутый зачёркнутый код';
    const entities: IMessageEntity[] = [
      { type: 'bold', offset: 0, length: 6 },
      { type: 'italic', offset: 7, length: 6 },
      { type: 'underline', offset: 14, length: 12 },
      { type: 'strikethrough', offset: 27, length: 11 },
      { type: 'monospace', offset: 39, length: 3 },
    ];

    const { container } = render(<MessageSnippet entities={entities} text={text} />);

    const strong = container.querySelector('strong');
    expect(strong).toHaveTextContent('жирный');
    expect(strong).toHaveClass('font-semibold');

    const em = container.querySelector('em');
    expect(em).toHaveTextContent('курсив');
    expect(em).toHaveClass('italic');

    const u = container.querySelector('u');
    expect(u).toHaveTextContent('подчёркнутый');

    const s = container.querySelector('s');
    expect(s).toHaveTextContent('зачёркнутый');

    const code = container.querySelector('code');
    expect(code).toHaveTextContent('код');
    expect(code).toHaveClass('font-mono');
  });

  it('ссылка рендерится как span со стилями ссылки, а НЕ тег <a>', () => {
    const text = 'посети https://example.com для деталей';
    const entities: IMessageEntity[] = [
      { type: 'link', offset: 7, length: 19, data: { url: 'https://example.com' } },
    ];

    const { container } = render(<MessageSnippet entities={entities} text={text} />);

    // Не должно быть тега <a>, так как превью живёт внутри NavLink
    expect(container.querySelector('a')).toBeNull();

    const linkSpan = container.querySelector('[data-entity="link"]');
    expect(linkSpan).toBeInTheDocument();
    expect(linkSpan).toHaveTextContent('https://example.com');
    expect(linkSpan).toHaveClass('text-brand', 'underline');
  });

  it('спойлер рендерится с размытием и без перехвата событий мыши', () => {
    const text = 'секрет: спойлер!';
    const entities: IMessageEntity[] = [{ type: 'spoiler', offset: 8, length: 8 }];

    const { container } = render(<MessageSnippet entities={entities} text={text} />);

    const spoiler = container.querySelector('[data-entity="spoiler"]');
    expect(spoiler).toBeInTheDocument();
    expect(spoiler).toHaveTextContent('спойлер!');
    expect(spoiler).toHaveClass('pointer-events-none', 'blur-[3px]', 'select-none');
    expect(spoiler).toHaveAttribute('aria-hidden', 'true');
  });

  it('комбинирует пересекающиеся стили (жирный + курсив)', () => {
    const text = 'жирный курсив';
    const entities: IMessageEntity[] = [
      { type: 'bold', offset: 0, length: 13 },
      { type: 'italic', offset: 0, length: 13 },
    ];

    const { container } = render(<MessageSnippet entities={entities} text={text} />);

    const strong = container.querySelector('strong');
    const em = strong?.querySelector('em');
    expect(em).toHaveTextContent('жирный курсив');
  });

  it('сглаживает переносы строк в пробелы без смещения форматирования', () => {
    const text = 'строка 1\nстрока 2';
    const entities: IMessageEntity[] = [{ type: 'bold', offset: 9, length: 8 }];

    const { container } = render(<MessageSnippet entities={entities} text={text} />);

    expect(container).toHaveTextContent('строка 1 строка 2');
    const strong = container.querySelector('strong');
    expect(strong).toHaveTextContent('строка 2');
  });
});
