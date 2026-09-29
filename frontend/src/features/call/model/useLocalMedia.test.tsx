import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalMedia } from './useLocalMedia';

class FakeTrack {
  kind: 'audio' | 'video';
  enabled = true;
  readyState: 'live' | 'ended' = 'live';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });

  constructor(kind: 'audio' | 'video') {
    this.kind = kind;
  }
}

class FakeStream {
  private tracks: FakeTrack[] = [];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = tracks;
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
  removeTrack(t: FakeTrack) {
    this.tracks = this.tracks.filter((track) => track !== t);
  }
}

describe('useLocalMedia', () => {
  let mockGetUserMedia: ReturnType<typeof vi.fn>;
  let mockEnumerateDevices: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetUserMedia = vi.fn();
    mockEnumerateDevices = vi.fn().mockResolvedValue([
      { deviceId: 'mic-1', kind: 'audioinput', label: 'Microphone 1' },
      { deviceId: 'cam-1', kind: 'videoinput', label: 'Camera 1' },
    ]);

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: mockGetUserMedia,
        enumerateDevices: mockEnumerateDevices,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('инициализируется с исходным состоянием', () => {
    const { result } = renderHook(() => useLocalMedia());

    expect(result.current.stream).toBeNull();
    expect(result.current.audioTrack).toBeNull();
    expect(result.current.videoTrack).toBeNull();
    expect(result.current.isAudioMuted).toBe(false);
    expect(result.current.isVideoMuted).toBe(false);
    expect(result.current.facingMode).toBe('user');
  });

  it('запускает медиа, обновляет состояние и списки устройств', async () => {
    const aTrack = new FakeTrack('audio');
    const vTrack = new FakeTrack('video');
    const stream = new FakeStream([aTrack, vTrack]);
    mockGetUserMedia.mockResolvedValueOnce(stream);

    const { result } = renderHook(() => useLocalMedia());

    await act(async () => {
      await result.current.startMedia();
    });

    expect(result.current.stream).toBe(stream as unknown as MediaStream);
    expect(result.current.audioTrack).toBe(aTrack as unknown as MediaStreamTrack);
    expect(result.current.videoTrack).toBe(vTrack as unknown as MediaStreamTrack);
    expect(result.current.audioInputs.length).toBe(1);
    expect(result.current.videoInputs.length).toBe(1);
  });

  it('переключает микрофон и камеру через toggleAudio и toggleVideo', async () => {
    const aTrack = new FakeTrack('audio');
    const vTrack = new FakeTrack('video');
    const stream = new FakeStream([aTrack, vTrack]);
    mockGetUserMedia.mockResolvedValueOnce(stream);

    const { result } = renderHook(() => useLocalMedia());

    await act(async () => {
      await result.current.startMedia();
    });

    act(() => {
      result.current.toggleAudio();
    });
    expect(result.current.isAudioMuted).toBe(true);
    expect(aTrack.enabled).toBe(false);

    act(() => {
      result.current.toggleVideo();
    });
    expect(result.current.isVideoMuted).toBe(true);
    expect(vTrack.enabled).toBe(false);
  });

  it('stopMedia останавливает треки и сбрасывает стрим', async () => {
    const aTrack = new FakeTrack('audio');
    const vTrack = new FakeTrack('video');
    const stream = new FakeStream([aTrack, vTrack]);
    mockGetUserMedia.mockResolvedValueOnce(stream);

    const { result } = renderHook(() => useLocalMedia());

    await act(async () => {
      await result.current.startMedia();
    });

    act(() => {
      result.current.stopMedia();
    });

    expect(aTrack.stop).toHaveBeenCalled();
    expect(vTrack.stop).toHaveBeenCalled();
    expect(result.current.stream).toBeNull();
    expect(result.current.audioTrack).toBeNull();
    expect(result.current.videoTrack).toBeNull();
  });

  it('останавливает треки при размонтировании компонента, если менеджер создан хуком', async () => {
    const aTrack = new FakeTrack('audio');
    const vTrack = new FakeTrack('video');
    const stream = new FakeStream([aTrack, vTrack]);
    mockGetUserMedia.mockResolvedValueOnce(stream);

    const { result, unmount } = renderHook(() => useLocalMedia());

    await act(async () => {
      await result.current.startMedia();
    });

    expect(aTrack.stop).not.toHaveBeenCalled();
    expect(vTrack.stop).not.toHaveBeenCalled();

    // Размонтируем компонент
    unmount();

    // Треки должны быть остановлены, чтобы индикатор камеры не горел
    expect(aTrack.stop).toHaveBeenCalled();
    expect(vTrack.stop).toHaveBeenCalled();
  });
});
