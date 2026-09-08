import { STORAGE_KEYS } from '@/consts';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePaneWidth } from './usePaneWidth';

const LIMITS = { min: 280, max: 520, fallback: 360 };

describe('ширина колонки', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('берёт значение по умолчанию, когда ничего не сохранено', () => {
    const { result } = renderHook(() => usePaneWidth('sidebar', LIMITS));

    expect(result.current.width).toBe(360);
  });

  it('восстанавливает сохранённую ширину', () => {
    localStorage.setItem(STORAGE_KEYS.PANE_WIDTHS, JSON.stringify({ sidebar: 440 }));

    const { result } = renderHook(() => usePaneWidth('sidebar', LIMITS));

    expect(result.current.width).toBe(440);
  });

  it('зажимает сохранённое в допустимые границы', () => {
    /* В хранилище может лежать что угодно: значение прошлой версии,
       правка руками, ширина с другого экрана. */
    localStorage.setItem(STORAGE_KEYS.PANE_WIDTHS, JSON.stringify({ sidebar: 9000 }));

    const { result } = renderHook(() => usePaneWidth('sidebar', LIMITS));

    expect(result.current.width).toBe(520);
  });

  it('переживает испорченное хранилище', () => {
    localStorage.setItem(STORAGE_KEYS.PANE_WIDTHS, 'не json');

    const { result } = renderHook(() => usePaneWidth('sidebar', LIMITS));

    expect(result.current.width).toBe(360);
  });

  it('складывает шаги, а не топчется на первом', () => {
    /* При удержании клавиши события идут чаще, чем React перерисовывает:
       шаг обязан считаться от последнего значения, а не от отрисованного. */
    const { result } = renderHook(() => usePaneWidth('sidebar', LIMITS));

    act(() => {
      result.current.nudge(16);
      result.current.nudge(16);
      result.current.nudge(16);
    });

    expect(result.current.width).toBe(408);
  });

  it('не выходит за границы шагами', () => {
    const { result } = renderHook(() => usePaneWidth('sidebar', LIMITS));

    act(() => {
      for (let step = 0; step < 30; step += 1) result.current.nudge(16);
    });

    expect(result.current.width).toBe(520);
  });

  it('прыгает к краю и запоминает это', () => {
    const { result } = renderHook(() => usePaneWidth('sidebar', LIMITS));

    act(() => result.current.jump('min'));

    expect(result.current.width).toBe(280);
    expect(localStorage.getItem(STORAGE_KEYS.PANE_WIDTHS)).toContain('280');
  });

  it('не путает колонки между собой', () => {
    localStorage.setItem(STORAGE_KEYS.PANE_WIDTHS, JSON.stringify({ sidebar: 300, profile: 500 }));

    const { result } = renderHook(() =>
      usePaneWidth('profile', { min: 300, max: 560, fallback: 380 })
    );

    expect(result.current.width).toBe(500);
  });
});
