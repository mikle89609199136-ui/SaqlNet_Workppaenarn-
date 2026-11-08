import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { AvatarCropModal } from './AvatarCropModal';

function setup() {
  const onComplete = vi.fn();
  const onCancel = vi.fn();
  const result = render(
    <I18nextProvider i18n={testI18n}>
      <AvatarCropModal
        file={new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })}
        onCancel={onCancel}
        onComplete={onComplete}
      />
    </I18nextProvider>
  );
  const image = result.container.querySelector('img')!;
  Object.defineProperties(image, { naturalWidth: { value: 1200 }, naturalHeight: { value: 800 } });
  return { ...result, image, onComplete, onCancel };
}

describe('AvatarCropModal', () => {
  it('exports the zoomed and positioned fragment to a new square file', async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(new Blob(['cropped'], { type: 'image/webp' }))
    );
    const { image, onComplete } = setup();
    fireEvent.load(image);
    fireEvent.change(screen.getByRole('slider', { name: 'Масштаб' }), { target: { value: '2' } });
    fireEvent.keyDown(screen.getByRole('group', { name: 'Положение фото' }), { key: 'ArrowRight' });
    await userEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(drawImage).toHaveBeenCalledWith(image, 380, 200, 400, 400, 0, 0, 400, 400);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'photo.webp', type: 'image/webp' })
    );
  });

  it('caps the exported size at 640 and preserves the actual fallback format', async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(new Blob(['cropped'], { type: 'image/png' }))
    );
    const { image, onComplete } = setup();
    fireEvent.load(image);
    await userEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(drawImage).toHaveBeenCalledWith(image, 200, 0, 800, 800, 0, 0, 640, 640);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'photo.png', type: 'image/png' })
    );
  });

  it('does not return the original file when canvas encoding fails', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(null)
    );
    const { image, onComplete } = setup();
    fireEvent.load(image);
    await userEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось обработать фото');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('rejects unreadable images and permits cancellation', async () => {
    const { image, onCancel, onComplete } = setup();
    fireEvent.error(image);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Готово' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('Escape cancels without applying a crop', () => {
    const { onCancel, onComplete } = setup();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
