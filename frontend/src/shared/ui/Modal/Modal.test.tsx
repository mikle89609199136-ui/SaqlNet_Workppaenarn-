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

  it('возвращает прокрутку, когда окно поверх окна закрываются разом', () => {
    // Так бывает при уходе со страницы: подтверждение открыли поверх
    // сведений о группе, и оба снимаются одним переходом (#90). Снимая
    // дерево, React очищает внешнее окно раньше внутреннего, и внутреннее
    // возвращало «hidden», запомненный при своём открытии, — страница
    // переставала прокручиваться.
    const nested = (innerOpen: boolean) => (
      <Modal onClose={() => {}} open title="Снаружи">
        <Modal onClose={() => {}} open={innerOpen} title="Внутри">
          Содержимое
        </Modal>
      </Modal>
    );
    const { rerender, unmount } = render(nested(false));
    rerender(nested(true));
    expect(document.body.style.overflow).toBe('hidden');

    unmount();

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

  it('should announce a dangerous confirmation as an alert dialog', () => {
    /* Дизайн-система: подтверждение опасного действия — alertdialog,
       действие на подложке ошибки, «Отмена» без фона. */
    render(
      <ConfirmDialog
        confirmLabel="Удалить"
        danger
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        open
        title="Удалить чат?"
      >
        История пропадёт у вас.
      </ConfirmDialog>
    );

    expect(screen.getByRole('alertdialog', { name: 'Удалить чат?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить' })).toHaveClass('bg-danger-soft');
    expect(screen.getByRole('button', { name: 'Отмена' })).toHaveClass('bg-transparent');
  });

  it('should keep an ordinary confirmation an ordinary dialog', () => {
    render(
      <ConfirmDialog
        confirmLabel="Выйти"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        open
        title="Выйти?"
      >
        Вернуться можно в любой момент.
      </ConfirmDialog>
    );

    expect(screen.getByRole('dialog', { name: 'Выйти?' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
