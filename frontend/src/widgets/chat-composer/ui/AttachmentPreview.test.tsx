import { testI18n } from '@/test/harness/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { AttachmentPreview } from './AttachmentPreview';

describe('доступность растрового редактора', () => {
  it.each(['image/svg+xml', 'image/gif'])(
    'не редактирует %s, но оставляет открытие и удаление',
    (type) => {
      const file = new File(['image'], 'original', { type });
      const onRemove = vi.fn();
      const onEdit = vi.fn();
      const onOpenImage = vi.fn();
      render(
        <I18nextProvider i18n={testI18n}>
          <AttachmentPreview
            attachments={[{ id: 'image', type: 'image', file }]}
            onEdit={onEdit}
            onRemove={onRemove}
            onOpenImage={onOpenImage}
          />
        </I18nextProvider>
      );
      expect(screen.queryByRole('button', { name: /Редактировать/ })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Открыть изображение/ }));
      expect(onOpenImage).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole('button', { name: /Удалить вложение/ }));
      expect(onRemove).toHaveBeenCalledWith('image');
      expect(onEdit).not.toHaveBeenCalled();
    }
  );

  it.each(['image/png', 'image/webp', 'image/jpeg', ''])('передаёт %s в редактор', (type) => {
    const file = new File(['image'], 'photo.png', { type });
    const onEdit = vi.fn();
    render(
      <I18nextProvider i18n={testI18n}>
        <AttachmentPreview
          attachments={[{ id: 'image', type: 'image', file }]}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      </I18nextProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /Редактировать/ }));
    expect(onEdit).toHaveBeenCalledWith(file);
  });
});
