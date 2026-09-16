import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommunitiesPage } from './CommunitiesPage';

describe('CommunitiesPage', () => {
  it('рендерит заглушку раздела сообществ с заголовком и описанием', () => {
    render(<CommunitiesPage />);

    expect(screen.getByRole('heading', { level: 1, name: /сообществ пока нет/i })).toBeInTheDocument();
    expect(screen.getByText(/раздел ещё делается/i)).toBeInTheDocument();
  });
});
