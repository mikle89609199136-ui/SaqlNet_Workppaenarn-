import { testI18n } from '@/test/harness/i18n';
import { act, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { RichTextInput, type IRichTextInputHandle } from './RichTextInput';

/* Вставка на место курсора — эмодзи из панели (#824). */
describe('RichTextInput.insertText', () => {
  it('встаёт туда, где курсор: после записи черновика — в конец', async () => {
    const ref = createRef<IRichTextInputHandle>();
    render(
      <I18nextProvider i18n={testI18n}>
        <RichTextInput ariaLabel="Сообщение" ref={ref} />
      </I18nextProvider>
    );

    act(() => ref.current!.setValue('привет'));
    act(() => ref.current!.insertText('👋'));
    await waitFor(() => expect(ref.current!.getValue().text).toBe('привет👋'));
  });
});
