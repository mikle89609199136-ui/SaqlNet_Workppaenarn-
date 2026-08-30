import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VideoPlayer } from './VideoPlayer';
import * as useIsMobileHook from '@/hooks/useIsMobile';

describe('VideoPlayer', () => {
  let playMock: ReturnType<typeof vi.spyOn>;
  let pauseMock: ReturnType<typeof vi.spyOn>;
  let requestFullscreenMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
      get() { return this._paused ?? true; },
      set(v) { this._paused = v; },
      configurable: true
    });

    playMock = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function(this: HTMLMediaElement) {
      Object.defineProperty(this, '_paused', { value: false, writable: true });
      return Promise.resolve();
    });
    pauseMock = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(function(this: HTMLMediaElement) {
      Object.defineProperty(this, '_paused', { value: true, writable: true });
    });
    
    Object.defineProperty(window.HTMLElement.prototype, 'requestFullscreen', {
      value: vi.fn().mockResolvedValue(undefined),
      writable: true,
      configurable: true
    });
    requestFullscreenMock = vi.spyOn(window.HTMLElement.prototype, 'requestFullscreen');
    // document.exitFullscreen might not exist in jsdom, so we just mock it on document directly if it exists, or define it
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
    
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(useIsMobileHook, 'useIsMobile').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const simulateFullscreen = (el: HTMLElement | null) => {
    Object.defineProperty(document, 'fullscreenElement', {
      value: el,
      configurable: true
    });
    fireEvent(document, new Event('fullscreenchange'));
  };

  it('1. renders video element and basic controls', () => {
    render(<VideoPlayer src="test.mp4" />);
    expect(document.querySelector('video')).toHaveAttribute('src', 'test.mp4');
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mute/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fullscreen/i })).toBeInTheDocument();
  });

  it('2. toggles play state on play button click', async () => {
    const user = userEvent.setup();
    render(<VideoPlayer src="test.mp4" />);
    
    const playBtn = screen.getByRole('button', { name: /play/i });
    await user.click(playBtn);
    expect(playMock).toHaveBeenCalledTimes(1);
    
    const pauseBtn = await screen.findByRole('button', { name: /pause/i });
    expect(pauseBtn).toBeInTheDocument();

    await user.click(pauseBtn);
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
  });

  it('3. toggles mute state and updates volume', async () => {
    const user = userEvent.setup();
    render(<VideoPlayer src="test.mp4" />);
    
    const video = document.querySelector('video')!;
    const muteBtn = screen.getByRole('button', { name: /mute/i });
    
    await user.click(muteBtn);
    expect(video.muted).toBe(true);
    
    // The slider value should become 0 visually
    const volumeSlider = screen.getAllByRole('slider')[0]; // only slider visible when not fullscreen
    expect(volumeSlider).toHaveValue('0');
  });

  it('4. changes volume via slider', async () => {
    render(<VideoPlayer src="test.mp4" />);
    const video = document.querySelector('video')!;
    const volumeSlider = screen.getAllByRole('slider')[0];
    
    fireEvent.change(volumeSlider, { target: { value: '0.5' } });
    expect(video.volume).toBe(0.5);
  });

  it('5. resets play state on ended', async () => {
    const user = userEvent.setup();
    render(<VideoPlayer src="test.mp4" />);
    
    await user.click(screen.getByRole('button', { name: /play/i }));
    expect(await screen.findByRole('button', { name: /pause/i })).toBeInTheDocument();
    
    const video = document.querySelector('video')!;
    fireEvent.ended(video);
    expect(await screen.findByRole('button', { name: /play/i })).toBeInTheDocument();
  });

  it('6. toggles play when clicking the video directly on desktop', async () => {
    const user = userEvent.setup();
    render(<VideoPlayer src="test.mp4" />);
    
    const video = document.querySelector('video')!;
    await user.click(video);
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it('7. requests fullscreen when maximize button is clicked', async () => {
    const user = userEvent.setup();
    render(<VideoPlayer src="test.mp4" />);
    
    const maximizeBtn = screen.getByRole('button', { name: /fullscreen/i });
    await user.click(maximizeBtn);
    expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
  });

  it('8. reveals advanced controls (time slider, quality) in fullscreen', async () => {
    render(<VideoPlayer src="test.mp4" />);
    const videoWrapper = document.querySelector('.bg-ink');
    
    // Simulate entering fullscreen
    simulateFullscreen(videoWrapper as HTMLElement);
    
    // Time slider should now be visible (there are now 2 sliders: time and volume)
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    // Quality button should be visible
    expect(screen.getByText('Auto')).toBeInTheDocument();
  });

  it('9. keyboard shortcuts work strictly in fullscreen mode', async () => {
    render(<VideoPlayer src="test.mp4" />);
    const videoWrapper = document.querySelector('.bg-ink');
    
    // Not in fullscreen, pressing Space should NOT call play
    fireEvent.keyDown(window, { code: 'Space' });
    expect(playMock).not.toHaveBeenCalled();
    
    // Enter fullscreen
    simulateFullscreen(videoWrapper as HTMLElement);
    
    // Now Space should trigger play
    fireEvent.keyDown(window, { code: 'Space' });
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it('10. seek indicator appears when seeking in fullscreen with arrows', async () => {
    render(<VideoPlayer src="test.mp4" />);
    const videoWrapper = document.querySelector('.bg-ink');
    const video = document.querySelector('video')!;
    Object.defineProperty(video, 'duration', { value: 100 });
    Object.defineProperty(video, 'currentTime', { value: 50, writable: true });
    
    simulateFullscreen(videoWrapper as HTMLElement);
    
    fireEvent.keyDown(window, { code: 'ArrowRight' });
    
    // Current time should jump forward
    expect(video.currentTime).toBe(55);
    // Indicator should be rendered
    expect(screen.getByText('+5s')).toBeInTheDocument();
    
    fireEvent.keyDown(window, { code: 'ArrowLeft' });
    expect(video.currentTime).toBe(50);
    expect(screen.getByText('-5s')).toBeInTheDocument();
  });
});
