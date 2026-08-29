import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast';

const ЖИЗНЬ = 3000;
const УХОД = 160;

const make = (type: 'success' | 'error' | 'info' | 'warning' = 'success') => ({
  id: 'toast-1',
  message: 'Настройки сохранены',
  type,
});

describe('уведомление', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('should show its message', () => {
    render(<Toast onHide={vi.fn()} toast={make()} />);

    expect(screen.getByText('Настройки сохранены')).toBeInTheDocument();
  });

  it('should interrupt the reader when it is an error', () => {
    render(<Toast onHide={vi.fn()} toast={make('error')} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('should wait its turn when it is not', () => {
    /* «Настройки сохранены» не повод перебивать человека на полуслове. */
    render(<Toast onHide={vi.fn()} toast={make('success')} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should hide itself when its time runs out', () => {
    const onHide = vi.fn();

    render(<Toast onHide={onHide} toast={make()} />);
    /* Двумя шагами: между истечением срока и уходом React должен успеть
       перерисовать уведомление, иначе второй таймер просто не заводится. */
    act(() => vi.advanceTimersByTime(ЖИЗНЬ));
    act(() => vi.advanceTimersByTime(УХОД));

    expect(onHide).toHaveBeenCalledWith('toast-1');
  });

  it('should stay while the pointer is on it', () => {
    const onHide = vi.fn();

    render(<Toast onHide={onHide} toast={make()} />);
    fireEvent.mouseEnter(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(ЖИЗНЬ * 5));

    expect(onHide).not.toHaveBeenCalled();
  });

  it('should carry on counting instead of starting over', () => {
    /* Наведение замораживает отсчёт, а не сбрасывает: иначе уведомление
       живёт заново после каждого случайного движения мышью. */
    const onHide = vi.fn();

    render(<Toast onHide={onHide} toast={make()} />);
    act(() => vi.advanceTimersByTime(2000));

    fireEvent.mouseEnter(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(10000));
    fireEvent.mouseLeave(screen.getByRole('status'));

    act(() => vi.advanceTimersByTime(900));
    expect(onHide).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(100));
    act(() => vi.advanceTimersByTime(УХОД));
    expect(onHide).toHaveBeenCalledWith('toast-1');
  });

  it('should freeze the progress bar together with the countdown', () => {
    const { container } = render(<Toast onHide={vi.fn()} toast={make()} />);
    const bar = container.querySelector('[aria-hidden="true"].origin-left') as HTMLElement;

    expect(bar.style.animationPlayState).toBe('running');

    fireEvent.mouseEnter(screen.getByRole('status'));

    expect(bar.style.animationPlayState).toBe('paused');
  });
});
