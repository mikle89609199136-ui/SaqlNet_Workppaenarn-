import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Progress } from './Progress';

describe('полоса загрузки', () => {
  it('should say what it is busy with', () => {
    render(<Progress label="Загрузка вложения" value={0.5} />);

    expect(screen.getByRole('progressbar', { name: 'Загрузка вложения' })).toBeInTheDocument();
  });

  it('should report the share it has done', () => {
    render(<Progress label="Загрузка" value={0.64} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '64');
  });

  it('should report no number when the share is unknown', () => {
    /* Ноль и «неизвестно» — разные вещи. Объявить неизвестной доле
       aria-valuenow значит прочитать диктору выдуманное число. */
    render(<Progress label="Экспорт данных" />);

    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  it('should keep the share inside its bounds', () => {
    const { rerender } = render(<Progress label="Загрузка" value={1.4} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');

    rerender(<Progress label="Загрузка" value={-0.2} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('should fill the bar to the share', () => {
    const { container } = render(<Progress label="Загрузка" value={0.25} />);

    expect(container.querySelector('[role="progressbar"] > div')).toHaveStyle({ width: '25%' });
  });

  it('should let the unknown one run', () => {
    const { container } = render(<Progress label="Экспорт" />);
    const bar = container.querySelector('[role="progressbar"] > div');

    expect(bar).toHaveClass('animate-[progress-crawl_1.2s_ease-in-out_infinite]');
    expect(bar).not.toHaveAttribute('style');
  });

  it('should hold the bounds even without a share', () => {
    render(<Progress label="Экспорт" />);

    const bar = screen.getByRole('progressbar');

    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('should put the caller className on the outside', () => {
    const { container } = render(<Progress className="w-40" label="Загрузка" value={0.5} />);

    expect(container.firstChild).toHaveClass('w-40');
  });
});
