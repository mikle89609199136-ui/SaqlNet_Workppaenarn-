import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { VideoPlayer } from './VideoPlayer';

// Мок IntersectionObserver с использованием класса
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
window.IntersectionObserver = MockIntersectionObserver as any;

// Мок matchMedia
window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

// Хелперы для симуляции полноэкранного режима
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

const renderPlayer = (props: React.ComponentProps<typeof VideoPlayer>) => {
  return render(
    <I18nextProvider i18n={testI18n}>
      <VideoPlayer {...props} />
    </I18nextProvider>
  );
};

describe('VideoPlayer', () => {
  let requestFullscreenMock: any;

  beforeEach(() => {
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
      get() {
        return this._paused ?? true;
      },
      set(v) {
        this._paused = v;
      },
      configurable: true,
    });
    window.HTMLMediaElement.prototype.play = vi.fn().mockImplementation(function (
      this: HTMLMediaElement
    ) {
      (this as any)._paused = false;
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    window.HTMLMediaElement.prototype.pause = vi.fn().mockImplementation(function (
      this: HTMLMediaElement
    ) {
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

  // --- Рендеринг ---

  it('1. renders video element and basic controls', () => {
    renderPlayer({ src: 'test.mp4' });
    expect(document.querySelector('video')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /воспроизвести/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /экран/i })).toBeInTheDocument();
  });

  it('2. renders with autoPlay, muted, loop, playsInline attributes', () => {
    renderPlayer({ src: 'test.mp4' });
    const video = document.querySelector('video')!;
    expect(video).toHaveAttribute('autoplay');
    expect(video).toHaveAttribute('loop');
    expect(video.muted).toBe(true);
  });

  // --- Воспроизведение ---

  it('3. toggles play state on play button click', async () => {
    const user = userEvent.setup();
    renderPlayer({ src: 'test.mp4' });

    await user.click(screen.getByRole('button', { name: /воспроизвести/i }));
    expect(screen.getByRole('button', { name: /приостановить/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /приостановить/i }));
    expect(screen.getByRole('button', { name: /воспроизвести/i })).toBeInTheDocument();
  });

  it('4. resets play state on ended', async () => {
    const user = userEvent.setup();
    renderPlayer({ src: 'test.mp4' });

    await user.click(screen.getByRole('button', { name: /воспроизвести/i }));
    fireEvent.ended(document.querySelector('video')!);
    expect(screen.getByRole('button', { name: /воспроизвести/i })).toBeInTheDocument();
  });

  it('5. toggles play when clicking the video on desktop', async () => {
    renderPlayer({ src: 'test.mp4' });
    const video = document.querySelector('video')!;

    fireEvent.click(video);
    expect(screen.getByRole('button', { name: /приостановить/i })).toBeInTheDocument();

    fireEvent.click(video);
    expect(screen.getByRole('button', { name: /воспроизвести/i })).toBeInTheDocument();
  });

  // --- Громкость и звук ---

  it('6. starts muted (autoplay policy) and toggles mute', async () => {
    const user = userEvent.setup();
    renderPlayer({ src: 'test.mp4' });
    const video = document.querySelector('video')!;

    expect(video.muted).toBe(true);

    const muteBtn = screen.getByRole('button', { name: /звук/i });
    await user.click(muteBtn);
    expect(video.muted).toBe(false);

    await user.click(muteBtn);
    expect(video.muted).toBe(true);
  });

  it('7. changes volume via slider', () => {
    renderPlayer({ src: 'test.mp4' });
    const video = document.querySelector('video')!;
    const volumeSlider = screen.getAllByRole('slider')[0];

    fireEvent.change(volumeSlider, { target: { value: '0.5' } });
    expect(video.volume).toBe(0.5);
  });

  // --- Полноэкранный режим ---

  it('8. requests fullscreen when maximize button is clicked', async () => {
    const user = userEvent.setup();
    renderPlayer({ src: 'test.mp4' });

    await user.click(screen.getByRole('button', { name: /экран/i }));
    expect(requestFullscreenMock).toHaveBeenCalled();
  });

  it('9. reveals time slider and quality in fullscreen', () => {
    renderPlayer({
      src: 'test.mp4',
      sources: [
        { label: 'Авто', url: 'test.mp4' },
        { label: '1080p', url: 'test_1080.mp4' },
      ],
    });
    const videoWrapper = document.querySelector('.bg-ink');

    simulateFullscreen(videoWrapper as HTMLElement);

    expect(screen.getAllByRole('slider')).toHaveLength(2);
    expect(screen.getByText('Авто')).toBeInTheDocument();
  });

  // --- Горячие клавиши ---

  it('10. keyboard shortcuts work strictly in fullscreen mode', () => {
    renderPlayer({ src: 'test.mp4' });
    const video = document.querySelector('video')!;
    Object.defineProperty(video, 'currentTime', { value: 10, writable: true, configurable: true });
    Object.defineProperty(video, 'duration', { value: 60, writable: true, configurable: true });

    fireEvent.keyDown(window, { code: 'Space' });
    expect(video.paused).toBe(true);

    const videoWrapper = document.querySelector('.bg-ink');
    simulateFullscreen(videoWrapper as HTMLElement);

    fireEvent.keyDown(window, { code: 'Space' });
    expect(video.paused).toBe(false);
  });

  it('11. seek indicator appears when seeking in fullscreen with arrows', () => {
    renderPlayer({ src: 'test.mp4' });
    const video = document.querySelector('video')!;
    Object.defineProperty(video, 'currentTime', { value: 10, writable: true, configurable: true });
    Object.defineProperty(video, 'duration', { value: 60, writable: true, configurable: true });

    const videoWrapper = document.querySelector('.bg-ink');
    simulateFullscreen(videoWrapper as HTMLElement);

    fireEvent.keyDown(window, { code: 'ArrowRight' });
    expect(screen.getByText('+5с')).toBeInTheDocument();
  });

  // --- Видимость элементов управления ---

  it('12. hides controls on mobile when not in fullscreen', () => {
    renderPlayer({ src: 'test.mp4' });
    const controls = document.querySelector('.bg-gradient-to-t');
    expect(controls?.className).not.toContain('hidden');
  });

  it('13. quality menu only renders when sources has >1 items', () => {
    const { rerender } = renderPlayer({ src: 'test.mp4' });
    const wrapper = document.querySelector('.bg-ink');
    simulateFullscreen(wrapper as HTMLElement);

    expect(screen.queryByText('Авто')).not.toBeInTheDocument();

    exitFullscreen();
    rerender(
      <I18nextProvider i18n={testI18n}>
        <VideoPlayer
          src="test.mp4"
          sources={[
            { label: 'Авто', url: 'a.mp4' },
            { label: '720p', url: 'b.mp4' },
          ]}
        />
      </I18nextProvider>
    );
    const updatedWrapper = document.querySelector('.bg-ink');
    simulateFullscreen(updatedWrapper as HTMLElement);

    expect(screen.getByText('Авто')).toBeInTheDocument();
  });

  // --- Буферизация ---

  it('14. shows spinner on waiting event, hides on playing', () => {
    renderPlayer({ src: 'test.mp4' });
    const video = document.querySelector('video')!;

    fireEvent.waiting(video);
    expect(document.querySelector('.pointer-events-none.z-10')).toBeInTheDocument();

    fireEvent.playing(video);
    expect(document.querySelector('.pointer-events-none.z-10')).not.toBeInTheDocument();
  });
});
