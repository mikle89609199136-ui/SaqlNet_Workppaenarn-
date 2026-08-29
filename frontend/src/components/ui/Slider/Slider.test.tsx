import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Slider } from './Slider';

describe('ползунок', () => {
  it('should take its name from the label', () => {
    render(<Slider aria-label="Громкость" onChange={vi.fn()} value={50} />);

    expect(screen.getByRole('slider', { name: 'Громкость' })).toHaveValue('50');
  });

  it('should say the time instead of the number', () => {
    /* Значение проигрывателя — секунды. «Семьдесят два» человеку ничего
       не говорит, ему нужно «одна минута двенадцать секунд». */
    render(
      <Slider
        aria-label="Позиция"
        max={188}
        onChange={vi.fn()}
        value={72}
        valueText="одна минута двенадцать секунд"
      />
    );

    expect(screen.getByRole('slider')).toHaveAttribute(
      'aria-valuetext',
      'одна минута двенадцать секунд'
    );
  });

  it('should show the caption next to the track', () => {
    render(<Slider aria-label="Позиция" caption="01:12 / 03:08" onChange={vi.fn()} value={72} />);

    expect(screen.getByText('01:12 / 03:08')).toBeInTheDocument();
  });

  it('should reach the focus with the keyboard', async () => {
    /* Стрелки и Home с End водит сам браузер, пока под разметкой лежит
       настоящий input, — но jsdom этого не умеет и честно предупреждает,
       что результат ненадёжен. Поэтому здесь проверяется то, от чего
       браузерное поведение зависит: ползунок доступен с клавиатуры и не
       перекрыт своей же обёрткой. Сами стрелки — за e2e (#277). */
    const user = userEvent.setup();

    render(<Slider aria-label="Громкость" onChange={vi.fn()} value={50} />);
    await user.tab();

    expect(screen.getByRole('slider')).toHaveFocus();
  });

  it('should report a new value upwards', async () => {
    const user = userEvent.setup();

    function Player() {
      const [value, setValue] = useState(50);
      return (
        <Slider
          aria-label="Громкость"
          onChange={(event) => setValue(Number(event.target.value))}
          value={value}
        />
      );
    }

    render(<Player />);
    /* Тянем за ползунок так, как это делает браузер при перетаскивании:
       меняем значение самого input. */
    await user.click(screen.getByRole('slider'));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '73' } });

    expect(screen.getByRole('slider')).toHaveValue('73');
  });

  it('should stay put when disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<Slider aria-label="Громкость" disabled onChange={onChange} value={50} />);

    const slider = screen.getByRole('slider');

    expect(slider).toBeDisabled();

    await user.click(slider);
    await user.keyboard('{ArrowRight}');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should fill the track to the share of the range', () => {
    /* Половина отрезка от 20 до 80 — это 50, а не 50 процентов шкалы:
       доля считается от min и max, а не от нуля. */
    const { container } = render(
      <Slider aria-label="Громкость" max={80} min={20} onChange={vi.fn()} value={50} />
    );

    const fill = container.querySelector('.bg-brand-fill');

    expect(fill).toHaveStyle({ width: 'calc((100% - 16px) * 0.5 + 8px)' });
  });

  it('should survive an empty range', () => {
    /* max равен min — делить не на что. Раньше выражение давало NaN и
       заполнение уезжало в никуда. */
    const { container } = render(
      <Slider aria-label="Громкость" max={10} min={10} onChange={vi.fn()} value={10} />
    );

    expect(container.querySelector('.bg-brand-fill')).toHaveStyle({
      width: 'calc((100% - 16px) * 0 + 8px)',
    });
  });
});
