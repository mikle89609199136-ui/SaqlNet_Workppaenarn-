import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ContextMenu,
  ContextMenuItem,
  useContextMenu
} from './ContextMenu';

describe('ContextMenu', () => {
  it('1. does not render when open is false', () => {
    render(
      <ContextMenu open={false} onClose={vi.fn()}>
        <ContextMenuItem>Пункт 1</ContextMenuItem>
      </ContextMenu>
    );

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('2. renders items and separators when open is true', () => {
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

  it('3. triggers item onClick when clicked', async () => {
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

  it('4. does not trigger onClick on disabled item', async () => {
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

  it('5. calls onClose on Escape key press', () => {
    const handleClose = vi.fn();

    render(
      <ContextMenu open={true} onClose={handleClose}>
        <ContextMenuItem>Пункт</ContextMenuItem>
      </ContextMenu>
    );

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('6. calls onClose on pointerdown outside menu', () => {
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

  it('7. navigates menu items with ArrowDown and ArrowUp', () => {
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

  it('8. navigates to first and last item with Home and End', () => {
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

  it('9. danger variant applies text-danger style', () => {
    render(
      <ContextMenu open={true} onClose={vi.fn()}>
        <ContextMenuItem variant="danger">Удалить</ContextMenuItem>
      </ContextMenu>
    );

    const item = screen.getByRole('menuitem', { name: /удалить/i });
    expect(item.className).toContain('text-danger');
  });

  it('10. useContextMenu helper hook manages open state and coordinates', () => {
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
});
