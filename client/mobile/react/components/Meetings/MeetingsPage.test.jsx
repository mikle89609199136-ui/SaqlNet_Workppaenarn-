import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { MeetingsPage } from './MeetingsPage.jsx';

describe('MeetingsPage', () => {
  it('renders the placeholder screen for the meetings section', () => {
    render(
      <MemoryRouter>
        <MeetingsPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: /встречи/i })).toBeInTheDocument();
    expect(screen.getByText(/раздел в разработке/i)).toBeInTheDocument();
  });
});
