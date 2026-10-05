import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { LinkDialog } from './LinkDialog';

function renderDialog(props: {
  initialUrl?: string | null;
  open?: boolean;
  onApply?: (url: string) => void;
  onRemove?: () => void;
  onCancel?: () => void;
  parentOnSubmit?: (event: React.FormEvent) => void;
}) {
  const onApply = props.onApply ?? vi.fn();
  const onRemove = props.onRemove ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  const parentOnSubmit = props.parentOnSubmit ?? vi.fn((e) => e.preventDefault());

  const result = render(
    <I18nextProvider i18n={testI18n}>
      <form data-testid="parent-form" onSubmit={parentOnSubmit}>
        <LinkDialog
          initialUrl={props.initialUrl ?? null}
          onApply={onApply}
          onCancel={onCancel}
          onRemove={onRemove}
          open={props.open ?? true}
        />
      </form>
    </I18nextProvider>
  );

  return { ...result, onApply, onRemove, onCancel, parentOnSubmit };
}

describe('диалог ссылки (#915, #656)', () => {
  it('не содержит тега form и не триггерит submit родительской формы при клике «Сохранить»', async () => {
    const { container, onApply, parentOnSubmit } = renderDialog({});

    // Внутри модалки нет своего тега form
    expect(container.querySelector('#link-dialog-form')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveAttribute('type', 'button');

    await userEvent.type(screen.getByLabelText('Адрес ссылки'), 'https://example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(onApply).toHaveBeenCalledWith('https://example.com');
    expect(parentOnSubmit).not.toHaveBeenCalled();
  });

  it('сохраняет ссылку по нажатию Enter в поле ввода без перезагрузки и submit родительской формы', async () => {
    const { onApply, parentOnSubmit } = renderDialog({});

    const input = screen.getByLabelText('Адрес ссылки');
    await userEvent.type(input, 'https://test.com{Enter}');

    expect(onApply).toHaveBeenCalledWith('https://test.com');
    expect(parentOnSubmit).not.toHaveBeenCalled();
  });

  it('показывает ошибку при невалидном URL и не вызывает onApply', async () => {
    const { onApply } = renderDialog({});

    await userEvent.type(screen.getByLabelText('Адрес ссылки'), 'javascript:alert(1){Enter}');

    expect(screen.getByText('Нужен адрес вида https://example.com')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('кнопка «Убрать ссылку» отображается только при initialUrl и вызывает onRemove', async () => {
    const { onRemove } = renderDialog({ initialUrl: 'https://example.com' });

    const removeBtn = screen.getByRole('button', { name: 'Убрать ссылку' });
    expect(removeBtn).toBeInTheDocument();

    await userEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalled();
  });

  it('кнопка «Отмена» вызывает onCancel', async () => {
    const { onCancel } = renderDialog({});

    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('обновляет значение в поле при изменении initialUrl без размонтирования диалога', () => {
    const { rerender } = renderDialog({ initialUrl: 'https://first.com' });
    expect(screen.getByLabelText('Адрес ссылки')).toHaveValue('https://first.com');

    rerender(
      <I18nextProvider i18n={testI18n}>
        <LinkDialog
          initialUrl="https://second.com"
          onApply={vi.fn()}
          onCancel={vi.fn()}
          onRemove={vi.fn()}
          open
        />
      </I18nextProvider>
    );
    expect(screen.getByLabelText('Адрес ссылки')).toHaveValue('https://second.com');
  });
});
