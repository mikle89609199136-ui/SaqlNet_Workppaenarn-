import { renderHook, act, waitFor } from '@testing-library/react';
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
    strokeRect: ReturnType<typeof vi.fn>;
    strokeText: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
    measureText: ReturnType<typeof vi.fn>;
    setLineDash: ReturnType<typeof vi.fn>;
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
      strokeRect: vi.fn(),
      strokeText: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 80 })),
      setLineDash: vi.fn(),
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

  it.each(['png', 'webp'])(
    'для .%s при Safari fallback сохраняет PNG без заливки альфы',
    async (extension) => {
      const onSave = vi.fn();
      const file = new File(['image-data'], `avatar.${extension}`, { type: `image/${extension}` });

      const toBlobSpy = vi
        .spyOn(HTMLCanvasElement.prototype, 'toBlob')
        .mockImplementation(function (
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
      expect(mockCtx.fillRect).not.toHaveBeenCalled();
      expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.92);

      expect(onSave).toHaveBeenCalledTimes(1);
      const savedFile: File = onSave.mock.calls[0][0];
      expect(savedFile.name).toBe('avatar-edited.png');
      expect(savedFile.type).toBe('image/png');
    }
  );

  it.each(['png', 'webp'])(
    'для .%s с пустым MIME при сбое WebP сохраняет PNG',
    async (extension) => {
      const onSave = vi.fn();
      const file = new File(['image-data'], `avatar.${extension}`);

      let callCount = 0;
      const toBlobSpy = vi
        .spyOn(HTMLCanvasElement.prototype, 'toBlob')
        .mockImplementation(function (
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
    }
  );

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

  it('копирует фото и текст без выделения и возвращает рамку в предпросмотр', async () => {
    let overlay = false;
    mockCtx.strokeRect.mockImplementation(() => {
      overlay = true;
    });
    mockCtx.clearRect.mockImplementation(() => {
      overlay = false;
    });
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    const onSave = vi.fn();
    const text = {
      id: 'text',
      type: 'text' as const,
      text: 'Привет',
      x: 0.5,
      y: 0.5,
      size: 48,
      font: 'modern' as const,
      rotation: 0,
      color: '#ffffff',
    };
    const imageSpy = vi.spyOn(window, 'Image').mockImplementation(function () {
      const image = document.createElement('img');
      Object.defineProperties(image, {
        naturalWidth: { value: 400 },
        naturalHeight: { value: 400 },
        src: { set: () => queueMicrotask(() => image.onload?.(new Event('load'))) },
      });
      return image;
    } as unknown as typeof Image);
    const { result } = renderHook(() =>
      usePhotoEditorCanvas({
        ...baseParams,
        file,
        onSave,
        objects: [text],
        selectedObject: text,
        tool: 'text',
      })
    );
    const canvas = document.createElement('canvas');
    result.current.canvasRef.current = canvas;
    await waitFor(() => expect(result.current.isReady).toBe(true));
    act(() => result.current.renderCanvas());
    expect(overlay).toBe(true);
    const copiedOverlays: boolean[] = [];
    mockCtx.drawImage.mockImplementation((source) => {
      if (source === canvas) copiedOverlays.push(overlay);
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['webp'], { type: 'image/webp' }));
    });
    await act(() => result.current.saveImage());
    expect(copiedOverlays).toEqual([false]);
    expect(overlay).toBe(true);
    expect(mockCtx.fillText).toHaveBeenCalledWith('Привет', 0, 0);
    expect(onSave).toHaveBeenCalledOnce();
    imageSpy.mockRestore();
  });

  it('уменьшает тяжёлый PNG fallback до ориентира размера без перекодирования в JPEG', async () => {
    const onSave = vi.fn();
    const { result } = renderHook(() =>
      usePhotoEditorCanvas({
        ...baseParams,
        file: new File(['webp'], 'photo.webp', { type: 'image/webp' }),
        onSave,
      })
    );
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1800;
    result.current.canvasRef.current = canvas;
    const sizes: number[] = [];
    const encode = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(function (callback) {
        sizes.push(this.width);
        callback(new Blob([new Uint8Array(this.width * this.height * 2)], { type: 'image/png' }));
      });
    await act(() => result.current.saveImage());
    const saved: File = onSave.mock.calls[0][0];
    expect(sizes).toEqual([1800, 1440, 1152, 922]);
    expect(saved.size).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(saved.type).toBe('image/png');
    expect(saved.name).toBe('photo-edited.png');
    expect(mockCtx.fillRect).not.toHaveBeenCalled();
    expect(encode.mock.calls.slice(1).every((call) => call[1] === 'image/png')).toBe(true);
  });
});
