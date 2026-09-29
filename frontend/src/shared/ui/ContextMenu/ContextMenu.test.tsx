import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu, ContextMenuBack, ContextMenuItem, useContextMenu } from './ContextMenu';

describe('контекстное меню', () => {
  it('не рисуется, пока закрыто', () => {
    render(
      <ContextMenu open={false} onClose={vi.fn()}>
        <ContextMenuItem>Пункт 1</ContextMenuItem>
      </ContextMenu>
    );

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('показывает пункты и разделители', () => {
    render(
      <ContextMenu open={true} onClose={vi.fn()} x={100} y={100}>
        <ContextMenu.ContextMenuItem>Закрепить</ContextMenu.ContextMenuItem>
        <ContextMenu.ContextMenuSeparator />
        <ContextMenu.ContextMenuItem variant="danger">Удалить чат</ContextMenu.ContextMenuItem>
      </ContextMenu>
    );

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(screen.getByText('Закрепить')).toBeInTheDocument();
    expect(screen.getByText('Удалить чат')).toBeInTheDocument();
  });

  it('вызывает действие пункта по нажатию', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(
      <ContextMenu open={true} onClose={vi.fn()}>
        <ContextMenuItem onClick={handleClick}>Действие</ContextMenuItem>
      </ContextMenu>
    );

    await user.click(screen.getByRole('menuitem', { name: /действие/i }));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('не вызывает действие у недоступного пункта', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(
      <ContextMenu open={true} onClose={vi.fn()}>
        <ContextMenuItem disabled onClick={handleClick}>
          Недоступно
        </ContextMenuItem>
      </ContextMenu>
    );

    const item = screen.getByRole('menuitem', { name: /недоступно/i });
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute('aria-disabled', 'true');

    await user.click(item);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('закрывается по Escape', () => {
    const handleClose = vi.fn();

    render(
      <ContextMenu open={true} onClose={handleClose}>
        <ContextMenuItem>Пункт</ContextMenuItem>
      </ContextMenu>
    );

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('закрывается по нажатию мимо', () => {
    const handleClose = vi.fn();

    render(
      <div>
        <div data-testid="outside">Снаружи</div>
        <ContextMenu open={true} onClose={handleClose}>
          <ContextMenuItem>Пункт</ContextMenuItem>
        </ContextMenu>
      </div>
    );

    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('ходит по пунктам стрелками', () => {
    render(
      <ContextMenu open={true} onClose={vi.fn()}>
        <ContextMenuItem>Первый</ContextMenuItem>
        <ContextMenuItem>Второй</ContextMenuItem>
        <ContextMenuItem>Третий</ContextMenuItem>
      </ContextMenu>
    );

    const menu = screen.getByRole('menu');
    const items = screen.getAllByRole('menuitem');

    items[0].focus();
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[2]);

    // Wrap around to first
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);

    // ArrowUp back to last
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]);
  });

  it('прыгает к первому и последнему по Home и End', () => {
    render(
      <ContextMenu open={true} onClose={vi.fn()}>
        <ContextMenuItem>Первый</ContextMenuItem>
        <ContextMenuItem>Второй</ContextMenuItem>
        <ContextMenuItem>Третий</ContextMenuItem>
      </ContextMenu>
    );

    const menu = screen.getByRole('menu');
    const items = screen.getAllByRole('menuitem');

    items[1].focus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
  });

  it('опасное действие выделяется цветом', () => {
    render(
      <ContextMenu open={true} onClose={vi.fn()}>
        <ContextMenuItem variant="danger">Удалить</ContextMenuItem>
      </ContextMenu>
    );

    const item = screen.getByRole('menuitem', { name: /удалить/i });
    expect(item.className).toContain('text-danger');
  });

  it('хук хранит состояние и координаты вызова', () => {
    const TestComponent = () => {
      const { contextMenu, handleContextMenu, closeContextMenu } = useContextMenu();

      return (
        <div>
          <div data-testid="target" onContextMenu={handleContextMenu}>
            Кликни правой кнопкой
          </div>
          {contextMenu && (
            <ContextMenu
              open={contextMenu.open}
              x={contextMenu.x}
              y={contextMenu.y}
              onClose={closeContextMenu}
            >
              <ContextMenuItem>Действие</ContextMenuItem>
            </ContextMenu>
          )}
        </div>
      );
    };

    render(<TestComponent />);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    const target = screen.getByTestId('target');
    fireEvent.contextMenu(target, { clientX: 150, clientY: 250 });

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /действие/i })).toBeInTheDocument();
  });
  it('возвращает фокус на строку, из которой меню вызвали', async () => {
    /* Ни правый клик, ни долгое нажатие фокус не переводят, поэтому
       компонент запоминает сам элемент вызова. Прежде фокус после
       закрытия оставался на body, и обход списка с клавиатуры начинался
       заново. */
    function Harness() {
      const { contextMenu, handleContextMenu, closeContextMenu, openerRef } = useContextMenu();

      return (
        <>
          <button onContextMenu={handleContextMenu} type="button">
            Строка чата
          </button>
          {contextMenu?.open && (
            <ContextMenu
              onClose={closeContextMenu}
              open
              returnFocusRef={openerRef}
              x={contextMenu.x}
              y={contextMenu.y}
            >
              <ContextMenuItem>Закрепить</ContextMenuItem>
            </ContextMenu>
          )}
        </>
      );
    }

    render(<Harness />);
    const row = screen.getByRole('button', { name: 'Строка чата' });
    fireEvent.contextMenu(row);

    await waitFor(() => expect(screen.getByRole('menuitem')).toHaveFocus());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    await waitFor(() => expect(row).toHaveFocus());
  });

  it('ограничивает высоту, чтобы длинное меню не уходило за экран', () => {
    render(
      <ContextMenu onClose={vi.fn()} open x={0} y={0}>
        {Array.from({ length: 15 }, (_, index) => (
          <ContextMenuItem key={index}>Пункт {index + 1}</ContextMenuItem>
        ))}
      </ContextMenu>
    );

    const menu = screen.getByRole('menu');
    expect(menu.className).toContain('max-h-');
    expect(menu.className).toContain('overflow-y-auto');
  });

  it('отмеченный пункт объявляет своё состояние и остаётся в обходе стрелками', () => {
    render(
      <ContextMenu open={true} onClose={vi.fn()}>
        <ContextMenuItem checked={true}>Жирный</ContextMenuItem>
        <ContextMenuItem checked={false}>Курсив</ContextMenuItem>
        <ContextMenuItem>Обычный текст</ContextMenuItem>
      </ContextMenu>
    );

    const bold = screen.getByRole('menuitemcheckbox', { name: 'Жирный' });
    expect(bold).toHaveAttribute('aria-checked', 'true');
    expect(bold).toHaveClass('bg-brand-soft', 'text-brand');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Курсив' })).toHaveAttribute(
      'aria-checked',
      'false'
    );

    const menu = screen.getByRole('menu');
    bold.focus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemcheckbox', { name: 'Курсив' }));
  });

  it('наведение ложится слоем и не стирает отметку', () => {
    render(
      <ContextMenu open={true} onClose={vi.fn()}>
        <ContextMenuItem checked={true}>Жирный</ContextMenuItem>
      </ContextMenu>
    );

    const item = screen.getByRole('menuitemcheckbox', { name: 'Жирный' });
    expect(item).toHaveClass('enabled:hover:layer-hover', 'bg-brand-soft');
  });

  it('пункт с подменю говорит, что откроет меню', () => {
    render(
      <ContextMenu open={true} onClose={vi.fn()}>
        <ContextMenuItem submenu>Форматирование</ContextMenuItem>
      </ContextMenu>
    );

    expect(screen.getByRole('menuitem', { name: 'Форматирование' })).toHaveAttribute(
      'aria-haspopup',
      'menu'
    );
  });

  it('строка «Назад» возвращает из подменю', async () => {
    const onBack = vi.fn();

    render(
      <ContextMenu open={true} onClose={vi.fn()}>
        <ContextMenuBack onClick={onBack} />
      </ContextMenu>
    );

    await userEvent.click(screen.getByRole('menuitem', { name: 'Назад' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
