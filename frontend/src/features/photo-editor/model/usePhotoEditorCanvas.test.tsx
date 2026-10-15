import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CROP, DEFAULT_FILTERS } from './config';
import { usePhotoEditorCanvas } from './usePhotoEditorCanvas';

describe('usePhotoEditorCanvas saveImage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  const baseParams = {
    filters: DEFAULT_FILTERS,
    rotation: 0,
    flipX: 1,
    flipY: 1,
    crop: DEFAULT_CROP,
    objects: [],
    selectedObject: null,
    editingTextId: null,
    tool: null,
    onCancel: vi.fn(),
  };

  it('сохраняет PNG без сжатия качества и с расширением .png', async () => {
    const onSave = vi.fn();
    const file = new File(['png-data'], 'avatar.png', { type: 'image/png' });

    const toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string
    ) {
      callback(new Blob(['edited-png-data'], { type: type || 'image/png' }));
    });

    const { result } = renderHook(() =>
      usePhotoEditorCanvas({
        ...baseParams,
        file,
        onSave,
      })
    );

    // Подставляем mock canvas element
    const mockCanvas = document.createElement('canvas');
    mockCanvas.width = 200;
    mockCanvas.height = 200;
    result.current.canvasRef.current = mockCanvas;

    await act(async () => {
      await result.current.saveImage();
    });

    expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined);
    expect(onSave).toHaveBeenCalledTimes(1);

    const savedFile: File = onSave.mock.calls[0][0];
    expect(savedFile.name).toBe('avatar-edited.png');
    expect(savedFile.type).toBe('image/png');
    expect(savedFile.lastModified).toBeGreaterThan(0);
  });

  it('сохраняет WebP с качеством 0.94 и расширением .webp', async () => {
    const onSave = vi.fn();
    const file = new File(['webp-data'], 'photo.webp', { type: 'image/webp' });

    const toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string
    ) {
      callback(new Blob(['edited-webp-data'], { type: type || 'image/webp' }));
    });

    const { result } = renderHook(() =>
      usePhotoEditorCanvas({
        ...baseParams,
        file,
        onSave,
      })
    );

    const mockCanvas = document.createElement('canvas');
    mockCanvas.width = 200;
    mockCanvas.height = 200;
    result.current.canvasRef.current = mockCanvas;

    await act(async () => {
      await result.current.saveImage();
    });

    expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.94);
    expect(onSave).toHaveBeenCalledTimes(1);

    const savedFile: File = onSave.mock.calls[0][0];
    expect(savedFile.name).toBe('photo-edited.webp');
    expect(savedFile.type).toBe('image/webp');
  });

  it('сохраняет JPEG с качеством 0.94 и расширением .jpg', async () => {
    const onSave = vi.fn();
    const file = new File(['jpeg-data'], 'camera.jpeg', { type: 'image/jpeg' });

    const toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
      quality?: unknown
    ) {
      callback(new Blob(['edited-jpeg-data'], { type: type || 'image/jpeg' }));
    });

    const { result } = renderHook(() =>
      usePhotoEditorCanvas({
        ...baseParams,
        file,
        onSave,
      })
    );

    const mockCanvas = document.createElement('canvas');
    mockCanvas.width = 200;
    mockCanvas.height = 200;
    result.current.canvasRef.current = mockCanvas;

    await act(async () => {
      await result.current.saveImage();
    });

    expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.94);
    expect(onSave).toHaveBeenCalledTimes(1);

    const savedFile: File = onSave.mock.calls[0][0];
    expect(savedFile.name).toBe('camera-edited.jpg');
    expect(savedFile.type).toBe('image/jpeg');
  });

  it('при сбое экспорта в WebP откатывается на JPEG', async () => {
    const onSave = vi.fn();
    const file = new File(['webp-data'], 'fallback.webp', { type: 'image/webp' });

    let callCount = 0;
    const toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string
    ) {
      callCount++;
      if (type === 'image/webp') {
        // Имитируем сбой поддержки WebP браузером
        callback(null);
      } else {
        callback(new Blob(['fallback-jpeg'], { type: 'image/jpeg' }));
      }
    });

    const { result } = renderHook(() =>
      usePhotoEditorCanvas({
        ...baseParams,
        file,
        onSave,
      })
    );

    const mockCanvas = document.createElement('canvas');
    mockCanvas.width = 200;
    mockCanvas.height = 200;
    result.current.canvasRef.current = mockCanvas;

    await act(async () => {
      await result.current.saveImage();
    });

    expect(callCount).toBe(2);
    expect(toBlobSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 'image/webp', 0.94);
    expect(toBlobSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 'image/jpeg', 0.94);

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedFile: File = onSave.mock.calls[0][0];
    expect(savedFile.name).toBe('fallback-edited.jpg');
    expect(savedFile.type).toBe('image/jpeg');
  });
});
