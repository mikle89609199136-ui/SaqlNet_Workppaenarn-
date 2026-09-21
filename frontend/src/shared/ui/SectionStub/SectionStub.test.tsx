import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionStub } from './SectionStub';

describe('SectionStub', () => {
  it('рендерит заголовок, иконку и дочернее описание', () => {
    render(
      <SectionStub icon="channel" title="Тестовый заголовок">
        Тестовое описание заглушки
      </SectionStub>
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Тестовый заголовок' })
    ).toBeInTheDocument();
    expect(screen.getByText('Тестовое описание заглушки')).toBeInTheDocument();
  });
});
