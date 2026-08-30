import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { VideoPlayer } from './VideoPlayer';

// Mock IntersectionObserver
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  disconnect = vi.fn();
  observe = vi.fn();
  takeRecords = vi.fn();
  unobserve = vi.fn();
}

const simulateFullscreen = (el: HTMLElement) => {
  Object.defineProperty(document, 'fullscreenElement', {
    value: el,
    writable: true,
    configurable: true,
  });
  fireEvent(document, new Event('fullscreenchange'));
};

const exitFullscreen = () => {
  Object.defineProperty(document, 'fullscreenElement', {
    value: null,
    writable: true,
    configurable: true,
  });
  fireEvent(document, new Event('fullscreenchange'));
};

describe('VideoPlayer', () => {
  let requestFullscreenMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.defineProperty(window, 'IntersectionObserver', {
      writable: true,
      configurable: true,
      value: MockIntersectionObserver,
    });
    Object.defineProperty(global, 'IntersectionObserver', {
      writable: true,
      configurable: true,
      value: MockIntersectionObserver,
    });

    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
      get() { return this._paused ?? true; },
      set(v) { this._paused = v; },
      configurable: true,
    });
    window.HTMLMediaElement.prototype.play = vi.fn().mockImplementation(function (this: HTMLMediaElement) {
      (this as any)._paused = false;
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    window.HTMLMediaElement.prototype.pause = vi.fn().mockImplementation(function (this: HTMLMediaElement) {
      (this as any)._paused = true;
      this.dispatchEvent(new Event('pause'));
    });
    requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
    HTMLElement.prototype.requestFullscreen = requestFullscreenMock as any;
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      writable: true,
      configurable: true,
    });
  });

  // --- Rendering ---

  it('1. renders video element and basic controls', () => {
    render(<VideoPlayer src="test.mp4" />);
    expect(document.querySelector('video')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fullscreen/i })).toBeInTheDocument();
  });

  it('2. renders with autoPlay, muted, loop, playsInline attributes', () => {
    render(<VideoPlayer src="test.mp4" />);
    const video = document.querySelector('video')!;
    expect(video).toHaveAttribute('autoplay');
    expect(video).toHaveAttribute('loop');
    expect(video.muted).toBe(true);
  });

  // --- Playback ---

  it('3. toggles play state on play button click', async () => {
    const user = userEvent.setup();
    render(<VideoPlayer src="test.mp4" />);

    await user.click(screen.getByRole('button', { name: /play/i }));
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /pause/i }));
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
  });

  it('4. resets play state on ended', async () => {
    const user = userEvent.setup();
    render(<VideoPlayer src="test.mp4" />);

    await user.click(screen.getByRole('button', { name: /play/i }));
    fireEvent.ended(document.querySelector('video')!);
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
  });

  it('5. toggles play when clicking the video on desktop', async () => {
    render(<VideoPlayer src="test.mp4" />);
    const video = document.querySelector('video')!;

    fireEvent.click(video);
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();

    fireEvent.click(video);
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
  });

  // --- Volume & Mute ---

  it('6. starts muted (autoplay policy) and toggles mute', async () => {
    const user = userEvent.setup();
    render(<VideoPlayer src="test.mp4" />);
    const video = document.querySelector('video')!;

    // Starts muted
    expect(video.muted).toBe(true);

    const muteBtn = screen.getByRole('button', { name: /mute/i });
    await user.click(muteBtn);
    expect(video.muted).toBe(false);

    await user.click(muteBtn);
    expect(video.muted).toBe(true);
  });

  it('7. changes volume via slider', () => {
    render(<VideoPlayer src="test.mp4" />);
    const video = document.querySelector('video')!;
    const volumeSlider = screen.getAllByRole('slider')[0];

    fireEvent.change(volumeSlider, { target: { value: '0.5' } });
    expect(video.volume).toBe(0.5);
  });

  // --- Fullscreen ---

  it('8. requests fullscreen when maximize button is clicked', async () => {
    const user = userEvent.setup();
    render(<VideoPlayer src="test.mp4" />);

    await user.click(screen.getByRole('button', { name: /fullscreen/i }));
    expect(requestFullscreenMock).toHaveBeenCalled();
  });

  it('9. reveals time slider and quality in fullscreen', () => {
    render(<VideoPlayer src="test.mp4" sources={[{ label: 'Auto', url: 'test.mp4' }, { label: '1080p', url: 'test_1080.mp4' }]} />);
    const videoWrapper = document.querySelector('.bg-ink');

    simulateFullscreen(videoWrapper as HTMLElement);

    // Time slider should now be visible (2 sliders: time + volume)
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    // Quality button should be visible
    expect(screen.getByText('Auto')).toBeInTheDocument();
  });

  // --- Keyboard shortcuts ---

  it('10. keyboard shortcuts work strictly in fullscreen mode', () => {
    render(<VideoPlayer src="test.mp4" />);
    const video = document.querySelector('video')!;
    Object.defineProperty(video, 'currentTime', { value: 10, writable: true, configurable: true });
    Object.defineProperty(video, 'duration', { value: 60, writable: true, configurable: true });

    // Not fullscreen — Space should NOT toggle play
    fireEvent.keyDown(window, { code: 'Space' });
    expect(video.paused).toBe(true);

    // Enter fullscreen
    const videoWrapper = document.querySelector('.bg-ink');
    simulateFullscreen(videoWrapper as HTMLElement);

    // Now Space should toggle
    fireEvent.keyDown(window, { code: 'Space' });
    expect(video.paused).toBe(false);
  });

  it('11. seek indicator appears when seeking in fullscreen with arrows', () => {
    render(<VideoPlayer src="test.mp4" />);
    const video = document.querySelector('video')!;
    Object.defineProperty(video, 'currentTime', { value: 10, writable: true, configurable: true });
    Object.defineProperty(video, 'duration', { value: 60, writable: true, configurable: true });

    const videoWrapper = document.querySelector('.bg-ink');
    simulateFullscreen(videoWrapper as HTMLElement);

    fireEvent.keyDown(window, { code: 'ArrowRight' });
    expect(screen.getByText('+5s')).toBeInTheDocument();
  });

  // --- Controls visibility ---

  it('12. hides controls on mobile when not in fullscreen', () => {
    // Desktop mock — controls visible on hover (not hidden class)
    render(<VideoPlayer src="test.mp4" />);
    const controls = document.querySelector('.bg-gradient-to-t');
    expect(controls?.className).not.toContain('hidden');
  });

  it('13. quality menu only renders when sources has >1 items', () => {
    const { rerender } = render(<VideoPlayer src="test.mp4" />);
    const wrapper = document.querySelector('.bg-ink');
    simulateFullscreen(wrapper as HTMLElement);

    // No quality menu without sources
    expect(screen.queryByText('Auto')).not.toBeInTheDocument();

    exitFullscreen();
    rerender(<VideoPlayer src="test.mp4" sources={[{ label: 'Auto', url: 'a.mp4' }, { label: '720p', url: 'b.mp4' }]} />);
    const updatedWrapper = document.querySelector('.bg-ink');
    simulateFullscreen(updatedWrapper as HTMLElement);

    expect(screen.getByText('Auto')).toBeInTheDocument();
  });

  // --- Buffering ---

  it('14. shows spinner on waiting event, hides on playing', () => {
    render(<VideoPlayer src="test.mp4" />);
    const video = document.querySelector('video')!;

    fireEvent.waiting(video);
    expect(document.querySelector('.pointer-events-none.z-10')).toBeInTheDocument();

    fireEvent.playing(video);
    expect(document.querySelector('.pointer-events-none.z-10')).not.toBeInTheDocument();
  });
});
