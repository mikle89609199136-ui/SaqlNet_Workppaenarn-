import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MeetingsPage } from './MeetingsPage';

describe('MeetingsPage', () => {
  it('рендерит заглушку раздела встреч с заголовком и описанием', () => {
    render(<MeetingsPage />);

    expect(screen.getByRole('heading', { level: 1, name: /встреч пока нет/i })).toBeInTheDocument();
    expect(screen.getByText(/раздел ещё делается/i)).toBeInTheDocument();
  });
});
