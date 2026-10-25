import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

/* Граница вокруг всего приложения (#1071): оверлей звонка и менеджеры
   стоят вне роутера, и исключение в них оставляло белый экран. */
describe('граница ошибок приложения', () => {
  beforeEach(() => {
    // React пишет об исключении при отрисовке, граница — тоже.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function Crash(): never {
    throw new Error('overlay crashed');
  }

  it('потомок упал при отрисовке — экран ошибки с «Перезагрузить»', async () => {
    const reload = vi.fn();
    render(
      <AppErrorBoundary reload={reload}>
        <Crash />
      </AppErrorBoundary>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Что-то пошло не так');
    await userEvent.click(screen.getByRole('button', { name: 'Перезагрузить' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('без ошибки рисует потомков', () => {
    render(
      <AppErrorBoundary>
        <span>приложение</span>
      </AppErrorBoundary>
    );

    expect(screen.getByText('приложение')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
