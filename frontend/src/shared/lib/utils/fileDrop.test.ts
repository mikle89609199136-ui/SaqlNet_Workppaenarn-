import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { preventStrayFileDrop } from './fileDrop';

const withFiles = { dataTransfer: { types: ['Files'], files: [], dropEffect: 'copy' } };
const withText = { dataTransfer: { types: ['text/plain'], files: [], dropEffect: 'copy' } };

describe('preventStrayFileDrop', () => {
  let stop: () => void;

  beforeEach(() => {
    stop = preventStrayFileDrop();
  });

  afterEach(() => {
    stop();
    document.body.innerHTML = '';
  });

  it('файл, брошенный мимо зоны сброса, браузер не открывает', () => {
    const list = document.body.appendChild(document.createElement('nav'));

    expect(fireEvent.dragOver(list, withFiles)).toBe(false);
    expect(fireEvent.drop(list, withFiles)).toBe(false);
  });

  it('перетаскивание текста не трогает', () => {
    const field = document.body.appendChild(document.createElement('textarea'));

    expect(fireEvent.drop(field, withText)).toBe(true);
  });

  it('сброс на поле выбора файла остаётся браузеру', () => {
    const input = document.body.appendChild(document.createElement('input'));
    input.type = 'file';

    expect(fireEvent.drop(input, withFiles)).toBe(true);
  });

  it('после отписки браузер снова решает сам', () => {
    stop();
    const list = document.body.appendChild(document.createElement('nav'));

    expect(fireEvent.drop(list, withFiles)).toBe(true);
    stop = () => {};
  });
});
