import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';

/**
 * Escape и подложка проверяются не здесь: `showModal` в jsdom не
 * реализован, поэтому окно остаётся обычным блоком в потоке, а событие
 * `cancel` браузер не присылает. Это проверено живьём.
 */
describe('модальное окно', () => {
  it('называет себя заголовком', () => {
    render(
      <Modal onClose={() => {}} title="Удалить чат?">
        Содержимое
      </Modal>
    );

    expect(screen.getByRole('dialog', { name: 'Удалить чат?' })).toBeInTheDocument();
  });

  it('берёт имя из label, когда шапка своя', () => {
    render(
      <Modal label="Новая группа" onClose={() => {}}>
        <header>Своя шапка</header>
      </Modal>
    );

    expect(screen.getByRole('dialog', { name: 'Новая группа' })).toBeInTheDocument();
    // Своя шапка — значит чужой заголовок рисовать нельзя.
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('закрывается крестиком', async () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} title="Окно">
        Содержимое
      </Modal>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('не показывает крестик там, где выбор обязателен', () => {
    render(
      <Modal closable={false} onClose={() => {}} title="Окно">
        Содержимое
      </Modal>
    );

    expect(screen.queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument();
  });

  it('возвращает прокрутку страницы после закрытия', () => {
    const { rerender } = render(
      <Modal onClose={() => {}} open title="Окно">
        Содержимое
      </Modal>
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Modal onClose={() => {}} open={false} title="Окно">
        Содержимое
      </Modal>
    );
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});

describe('подтверждение действия', () => {
  it('подтверждает только кнопкой', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        confirmLabel="Удалить ключи"
        danger
        onCancel={onCancel}
        onConfirm={onConfirm}
        open
        title="Удалить ключи?"
      >
        Переписка перестанет открываться.
      </ConfirmDialog>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Удалить ключи' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('закрытие крестиком — это отказ', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        confirmLabel="Удалить"
        onCancel={onCancel}
        onConfirm={onConfirm}
        open
        title="Удалить?"
      >
        Насовсем.
      </ConfirmDialog>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
