import { testI18n } from '@/test/harness/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { ScrollToBottomButton } from './ScrollToBottomButton';

describe('ScrollToBottomButton', () => {
  it('does not render when visible is false', () => {
    const { container } = render(
      <I18nextProvider i18n={testI18n}>
        <ScrollToBottomButton onClick={vi.fn()} visible={false} />
      </I18nextProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders button and responds to click when visible is true', () => {
    const onClick = vi.fn();
    render(
      <I18nextProvider i18n={testI18n}>
        <ScrollToBottomButton onClick={onClick} visible={true} />
      </I18nextProvider>
    );

    const btn = screen.getByRole('button', { name: /Перейти к последним сообщениям/i });
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
