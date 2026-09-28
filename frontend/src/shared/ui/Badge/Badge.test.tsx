import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';

describe('метка', () => {
  it('should show the number as it is', () => {
    render(<Badge>7</Badge>);

    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('should cap a big count', () => {
    render(<Badge>{140}</Badge>);

    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('should respect a different cap', () => {
    render(<Badge max={9}>{12}</Badge>);

    expect(screen.getByText('9+')).toBeInTheDocument();
  });

  it('should say what the number means when told', () => {
    /* Рядом с именем чата голое «12» диктор прочитает как «двенадцать»,
       и чего именно двенадцать — слушатель не узнает. */
    const { container } = render(<Badge label="12 непрочитанных">{12}</Badge>);

    expect(screen.getByText('12 непрочитанных')).toHaveClass('sr-only');
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('12');
  });

  it('should keep digits from jumping sideways', () => {
    /* Без tabular-nums счётчик дёргается при смене 9 на 10. */
    const { container } = render(<Badge>{9}</Badge>);

    expect(container.firstChild).toHaveClass('tabular-nums');
  });

  it('should draw an empty dot for a chat marked unread by hand', () => {
    const { container } = render(<Badge label="Отмечен непрочитанным" />);

    expect(container.firstChild).toHaveClass('h-5', 'min-w-5', 'rounded-pill');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument();
    expect(screen.getByText('Отмечен непрочитанным')).toHaveClass('sr-only');
  });

  it('should keep a white number on the muted counter', () => {
    const { container } = render(<Badge tone="quiet">{3}</Badge>);

    expect(container.firstChild).toHaveClass('bg-muted-badge', 'text-on-brand');
  });

  it('should also carry plain text', () => {
    render(<Badge tone="quiet">черновик</Badge>);

    expect(screen.getByText('черновик')).toBeInTheDocument();
  });
});
