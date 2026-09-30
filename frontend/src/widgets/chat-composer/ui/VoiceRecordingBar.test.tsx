import { testI18n } from '@/test/harness/i18n';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { VoiceRecordingBar } from './VoiceRecordingBar';

function renderBar(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>);
}

/* Вход (кнопка микрофона) скрыт до #843 — компонент проверяется сам. */
describe('полоса записи голосового', () => {
  it('пока держат кнопку — таймер и подсказка про отмену', () => {
    renderBar(<VoiceRecordingBar locked={false} seconds={75} />);

    expect(screen.getByRole('group', { name: 'Запись голосового' })).toBeInTheDocument();
    expect(screen.getByText('1:15')).toBeInTheDocument();
    expect(screen.getByText('‹ Влево — отмена')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отменить запись' })).not.toBeInTheDocument();
  });

  it('подсказка уезжает и гаснет, пока смахивают влево', () => {
    renderBar(<VoiceRecordingBar cancelProgress={0.5} locked={false} seconds={3} />);

    const hint = screen.getByText('‹ Влево — отмена');
    expect(hint.style.opacity).toBe('0.5');
    expect(hint.style.transform).toBe('translateX(-20px)');
  });

  it('закреплённая запись — корзина и волна вместо подсказки', async () => {
    const onCancel = vi.fn();
    const { container } = renderBar(
      <VoiceRecordingBar levels={[0.2, 0.9, 0.5]} locked onCancel={onCancel} seconds={9} />
    );

    expect(screen.queryByText('‹ Влево — отмена')).not.toBeInTheDocument();
    expect(screen.getByText('0:09')).toBeInTheDocument();
    // Волна — сорок столбиков, последние три — по уровням громкости.
    const bars = container.querySelectorAll('.bg-brand');
    expect(bars).toHaveLength(40);
    expect((bars[39] as HTMLElement).style.height).toBe('16px');

    await userEvent.click(screen.getByRole('button', { name: 'Отменить запись' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
