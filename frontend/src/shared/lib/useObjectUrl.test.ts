import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useObjectUrl } from './useObjectUrl';

describe('useObjectUrl', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn().mockImplementation((blob: Blob) => `blob:mock-url-${blob.size}`);
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('returns null when no object is provided', () => {
    const { result } = renderHook(() => useObjectUrl(null));
    expect(result.current).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('creates an object URL for a File/Blob', () => {
    const file = new File(['test content'], 'test.png', { type: 'image/png' });
    const { result } = renderHook(() => useObjectUrl(file));

    expect(result.current).toBe(`blob:mock-url-${file.size}`);
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
  });

  it('revokes previous URL when file changes', () => {
    const file1 = new File(['first'], 'first.png', { type: 'image/png' });
    const file2 = new File(['second-longer'], 'second.png', { type: 'image/png' });

    let currentFile = file1;
    const { rerender } = renderHook(() => useObjectUrl(currentFile));

    expect(URL.createObjectURL).toHaveBeenCalledWith(file1);

    currentFile = file2;
    rerender();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(`blob:mock-url-${file1.size}`);
    expect(URL.createObjectURL).toHaveBeenCalledWith(file2);
  });

  it('revokes object URL on unmount', () => {
    const file = new File(['hello'], 'hello.png', { type: 'image/png' });
    const { unmount } = renderHook(() => useObjectUrl(file));

    expect(URL.createObjectURL).toHaveBeenCalledWith(file);

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(`blob:mock-url-${file.size}`);
  });
});
