import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CROP, DEFAULT_FILTERS } from './config';
import { usePhotoEditorCanvas } from './usePhotoEditorCanvas';

describe('usePhotoEditorCanvas saveImage', () => {
  let mockCtx: {
    drawImage: ReturnType<typeof vi.fn>;
    clearRect: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    translate: ReturnType<typeof vi.fn>;
    rotate: ReturnType<typeof vi.fn>;
    scale: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
    globalCompositeOperation?: string;
    fillStyle?: string;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockCtx = {
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      fillRect: vi.fn(),
      globalCompositeOperation: 'source-over',
      fillStyle: '#000000',
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mockCtx as unknown as CanvasRenderingContext2D
    );
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

  it('сохраняет PNG в WebP с качеством 0.92 и расширением .webp (основной формат с сохранением прозрачности)', async () => {
    const onSave = vi.fn();
    const file = new File(['png-data'], 'avatar.png', { type: 'image/png' });

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

    expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.92);
    expect(onSave).toHaveBeenCalledTimes(1);

    const savedFile: File = onSave.mock.calls[0][0];
    expect(savedFile.name).toBe('avatar-edited.webp');
    expect(savedFile.type).toBe('image/webp');
    expect(savedFile.lastModified).toBeGreaterThan(0);
  });

  it('сохраняет JPEG в WebP с качеством 0.92 и расширением .webp', async () => {
    const onSave = vi.fn();
    const file = new File(['jpeg-data'], 'camera.jpeg', { type: 'image/jpeg' });

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

    expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.92);
    expect(onSave).toHaveBeenCalledTimes(1);

    const savedFile: File = onSave.mock.calls[0][0];
    expect(savedFile.name).toBe('camera-edited.webp');
    expect(savedFile.type).toBe('image/webp');
  });

  it('для PNG-исходника при Safari < 17 (возврат PNG на запрос WebP) сохраняет в PNG для сохранения прозрачности', async () => {
    const onSave = vi.fn();
    const file = new File(['png-data'], 'avatar.png', { type: 'image/png' });

    const toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string
    ) {
      if (type === 'image/webp') {
        // По спецификации W3C Safari < 17 возвращает PNG blob при отсутствии поддержки WebP
        callback(new Blob(['safari-png-blob'], { type: 'image/png' }));
      } else {
        callback(new Blob(['fallback'], { type: type || 'image/png' }));
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

    // Safari уже вернул PNG, второй вызов toBlob не требуется
    expect(toBlobSpy).toHaveBeenCalledTimes(1);
    expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.92);

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedFile: File = onSave.mock.calls[0][0];
    expect(savedFile.name).toBe('avatar-edited.png');
    expect(savedFile.type).toBe('image/png');
  });

  it('для PNG-исходника при сбое WebP в null повторно кодирует в PNG', async () => {
    const onSave = vi.fn();
    const file = new File(['png-data'], 'avatar.png', { type: 'image/png' });

    let callCount = 0;
    const toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string
    ) {
      callCount++;
      if (type === 'image/webp') {
        callback(null);
      } else {
        callback(new Blob(['png-fallback'], { type: 'image/png' }));
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
    expect(toBlobSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 'image/webp', 0.92);
    expect(toBlobSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 'image/png', undefined);

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedFile: File = onSave.mock.calls[0][0];
    expect(savedFile.name).toBe('avatar-edited.png');
    expect(savedFile.type).toBe('image/png');
  });

  it('для не-PNG исходника (JPEG) при отсутствии поддержки WebP откатывается на JPEG 0.94 с белой подложкой', async () => {
    const onSave = vi.fn();
    const file = new File(['jpeg-data'], 'camera.jpeg', { type: 'image/jpeg' });

    let callCount = 0;
    const toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string
    ) {
      callCount++;
      if (type === 'image/webp') {
        // Safari < 17 возвращает PNG на запрос WebP
        callback(new Blob(['safari-png-blob'], { type: 'image/png' }));
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
    expect(toBlobSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 'image/webp', 0.92);
    expect(toBlobSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 'image/jpeg', 0.94);

    expect(mockCtx.globalCompositeOperation).toBe('destination-over');
    expect(mockCtx.fillStyle).toBe('#ffffff');
    expect(mockCtx.fillRect).toHaveBeenCalled();

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedFile: File = onSave.mock.calls[0][0];
    expect(savedFile.name).toBe('camera-edited.jpg');
    expect(savedFile.type).toBe('image/jpeg');
  });

  it('для не-PNG исходника при сбое WebP в null откатывается на JPEG 0.94 с белой подложкой', async () => {
    const onSave = vi.fn();
    const file = new File(['bmp-data'], 'photo.bmp', { type: 'image/bmp' });

    let callCount = 0;
    const toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string
    ) {
      callCount++;
      if (type === 'image/webp') {
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
    expect(toBlobSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 'image/webp', 0.92);
    expect(toBlobSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 'image/jpeg', 0.94);

    expect(mockCtx.globalCompositeOperation).toBe('destination-over');
    expect(mockCtx.fillStyle).toBe('#ffffff');
    expect(mockCtx.fillRect).toHaveBeenCalled();

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedFile: File = onSave.mock.calls[0][0];
    expect(savedFile.name).toBe('photo-edited.jpg');
    expect(savedFile.type).toBe('image/jpeg');
  });
});
