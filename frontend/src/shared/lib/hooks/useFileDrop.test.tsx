import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useFileDrop } from './useFileDrop';

function Zone({ enabled = true, onDrop }: { enabled?: boolean; onDrop: (files: File[]) => void }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const isDragging = useFileDrop(element, { enabled, onDrop });

  return (
    <div data-dragging={isDragging} data-testid="zone" ref={setElement}>
      <textarea aria-label="поле" />
    </div>
  );
}

const withFiles = (files: File[] = []) => ({ dataTransfer: { types: ['Files'], files } });
const withText = { dataTransfer: { types: ['text/plain'], files: [] } };

function setup(enabled = true) {
  const onDrop = vi.fn();
  render(<Zone enabled={enabled} onDrop={onDrop} />);
  return { onDrop, zone: screen.getByTestId('zone'), field: screen.getByLabelText('поле') };
}

describe('useFileDrop', () => {
  it('файл над зоной включает перетаскивание, уход из зоны выключает', () => {
    const { zone } = setup();

    fireEvent.dragEnter(zone, withFiles());
    expect(zone).toHaveAttribute('data-dragging', 'true');

    fireEvent.dragLeave(zone, withFiles());
    expect(zone).toHaveAttribute('data-dragging', 'false');
  });

  it('переход на вложенный элемент не гасит перетаскивание', () => {
    const { zone, field } = setup();

    fireEvent.dragEnter(zone, withFiles());
    fireEvent.dragEnter(field, withFiles());
    fireEvent.dragLeave(zone, withFiles());
    expect(zone).toHaveAttribute('data-dragging', 'true');

    fireEvent.dragLeave(field, withFiles());
    expect(zone).toHaveAttribute('data-dragging', 'false');
  });

  it('сброс отдаёт файлы и отменяет поведение браузера', () => {
    const { zone, field, onDrop } = setup();
    const file = new File(['x'], 'photo.png', { type: 'image/png' });

    fireEvent.dragEnter(zone, withFiles());
    const notPrevented = fireEvent.drop(field, withFiles([file]));

    expect(notPrevented).toBe(false);
    expect(onDrop).toHaveBeenCalledWith([file]);
    expect(zone).toHaveAttribute('data-dragging', 'false');
  });

  it('текст не перехватывается', () => {
    const { zone, onDrop } = setup();

    fireEvent.dragEnter(zone, withText);
    const notPrevented = fireEvent.drop(zone, withText);

    expect(notPrevented).toBe(true);
    expect(zone).toHaveAttribute('data-dragging', 'false');
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('выключенный приём не показывает зону и не берёт файлы, но и браузеру их не отдаёт', () => {
    const { zone, onDrop } = setup(false);
    const file = new File(['x'], 'photo.png', { type: 'image/png' });

    fireEvent.dragEnter(zone, withFiles());
    expect(zone).toHaveAttribute('data-dragging', 'false');

    expect(fireEvent.drop(zone, withFiles([file]))).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });
});
