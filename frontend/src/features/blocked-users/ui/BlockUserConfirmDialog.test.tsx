import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { BlockUserConfirmDialog } from './BlockUserConfirmDialog';

function renderDialog(props: Partial<Parameters<typeof BlockUserConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  render(
    <I18nextProvider i18n={testI18n}>
      <BlockUserConfirmDialog
        onCancel={onCancel}
        onConfirm={onConfirm}
        open={true}
        {...props}
      />
    </I18nextProvider>
  );

  return { onConfirm, onCancel };
}

describe('BlockUserConfirmDialog', () => {
  it('отображает заголовок, предупреждение и кнопки', () => {
    renderDialog();

    expect(screen.getByText('Заблокировать пользователя?')).toBeInTheDocument();
    expect(
      screen.getByText('Пользователь не сможет отправлять вам сообщения и совершать звонки.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Заблокировать' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeInTheDocument();
  });

  it('вызывает onConfirm при нажатии кнопки подтверждения', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Заблокировать' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('вызывает onCancel при нажатии кнопки отмены', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
