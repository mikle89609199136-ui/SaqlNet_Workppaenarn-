import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { I18nextProvider } from 'react-i18next';
import { ChatsSearchField } from './ChatsSearchField';

function renderField(props: { value: string; onChange?: (val: string) => void; onReset?: () => void }) {
  return render(
    <I18nextProvider i18n={testI18n}>
      <ChatsSearchField
        onChange={props.onChange ?? vi.fn()}
        onReset={props.onReset ?? vi.fn()}
        value={props.value}
      />
    </I18nextProvider>
  );
}

describe('ChatsSearchField', () => {
  it('не показывает кнопку очистки при пустом значении', () => {
    renderField({ value: '' });
    expect(screen.queryByRole('button', { name: 'Очистить поиск' })).not.toBeInTheDocument();
  });

  it('показывает кнопку очистки с cursor-pointer и active:layer-press при наличии значения (#1082)', () => {
    const onReset = vi.fn();
    renderField({ value: 'тест', onReset });

    const clearButton = screen.getByRole('button', { name: 'Очистить поиск' });
    expect(clearButton).toBeInTheDocument();
    expect(clearButton).toHaveClass('cursor-pointer', 'active:layer-press');

    fireEvent.click(clearButton);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
