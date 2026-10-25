import { useChatUiStore } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { makeMessage, makeUser } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachmentControl } from './AttachmentControl';
import { ComposerContextBanner } from './ComposerContextBanner';

function renderPart(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>);
}

/* Части поля ввода по макету (#821). */
describe('меню вложений', () => {
  it('скрепка открывает меню из трёх источников', async () => {
    renderPart(<AttachmentControl inputRef={createRef()} isSending={false} onChange={vi.fn()} />);

    const clip = screen.getByRole('button', { name: 'Прикрепить файл' });
    expect(clip).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(clip);

    expect(clip).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual([
      'Фото или видеоИз галереи',
      'Сделать фотоКамера устройства',
      'ФайлДокументы, архивы, любые файлы',
    ]);
  });

  it('«Сделать фото» просит камеру, «Файл» — любые файлы без камеры', async () => {
    const inputRef = createRef<HTMLInputElement>();
    renderPart(<AttachmentControl inputRef={inputRef} isSending={false} onChange={vi.fn()} />);
    const input = () => inputRef.current!;
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});

    await userEvent.click(screen.getByRole('button', { name: 'Прикрепить файл' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Сделать фото/ }));

    expect(input().accept).toBe('image/*');
    expect(input().getAttribute('capture')).toBe('environment');
    expect(click).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Прикрепить файл' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /^Файл/ }));

    expect(input().accept).toContain('.pdf');
    expect(input().hasAttribute('capture')).toBe(false);
    click.mockRestore();
  });

  it('при правке сообщения вложение недоступно', () => {
    useChatUiStore.setState({ editingMessage: makeMessage({ content: 'правлю' }) });
    renderPart(<AttachmentControl inputRef={createRef()} isSending={false} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Прикрепить файл' })).toBeDisabled();
    useChatUiStore.setState({ editingMessage: null });
  });
});

describe('полоска ответа и правки', () => {
  afterEach(() => useChatUiStore.setState({ replyToMessage: null, editingMessage: null }));

  it('ответ — имя автора и текст, отмена называет, что отменяет', async () => {
    const onCancel = vi.fn();
    useChatUiStore.setState({
      replyToMessage: makeMessage({ senderId: 'u-2', senderName: 'Вася', content: 'во сколько?' }),
    });

    renderPart(<ComposerContextBanner onCancel={onCancel} />);

    expect(screen.getByText('Вася')).toBeInTheDocument();
    expect(screen.getByText('во сколько?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Отменить ответ' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // В content звонка служебный JSON — в полосе вид звонка (#1073).
  it('ответ на звонок — «Звонок», без JSON', () => {
    useChatUiStore.setState({
      replyToMessage: makeMessage({
        senderId: 'u-2',
        type: 'call',
        content: JSON.stringify({ callKind: 'audio', status: 'missed' }),
      }),
    });

    renderPart(<ComposerContextBanner onCancel={vi.fn()} />);

    expect(screen.getByText('Звонок')).toBeInTheDocument();
    expect(screen.queryByText(/\{/)).toBeNull();
  });

  it('ответ на своё — «Вы»', () => {
    useProfileStore.setState({ user: makeUser({ id: 'me' }) });
    useChatUiStore.setState({ replyToMessage: makeMessage({ senderId: 'me', content: 'моё' }) });

    renderPart(<ComposerContextBanner onCancel={vi.fn()} />);

    expect(screen.getByText('Вы')).toBeInTheDocument();
  });

  it('правка — «Редактирование» и отмена правки', () => {
    useChatUiStore.setState({ editingMessage: makeMessage({ content: 'старый текст' }) });

    renderPart(<ComposerContextBanner onCancel={vi.fn()} />);

    expect(screen.getByText('Редактирование')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отменить редактирование' })).toBeInTheDocument();
  });
});
