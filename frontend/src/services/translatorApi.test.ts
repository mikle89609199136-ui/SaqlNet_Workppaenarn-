import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translateText } from './translatorApi';

/**
 * Ответ переводчика приходит вложенными массивами: data[0][0][0] — сам перевод,
 * data[2] — язык, который сервис определил в исходном тексте.
 */
function ответ(перевод: string, исходныйЯзык = 'en') {
  return JSON.stringify([[[перевод, '', '', '']], null, исходныйЯзык]);
}

let запросов: string[] = [];

class ПоддельныйXHR {
  status = 200;
  responseText = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  open(_метод: string, url: string) {
    запросов.push(url);
  }

  send() {
    this.responseText = ответ('translated');
    this.onload?.();
  }
}

beforeEach(() => {
  запросов = [];
  vi.stubGlobal('XMLHttpRequest', ПоддельныйXHR);
  localStorage.setItem('craneapp_settings', JSON.stringify({ language: 'ru' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('перевод сообщения', () => {
  it('should not keep translated text between calls', async () => {
    // Перевод — мгновенное действие, а не хранилище. Кеш держал бы пары
    // «исходный текст → перевод» открытым текстом на всё время работы вкладки
    // и достался бы следующему, кто здесь войдёт.
    await translateText('секретное сообщение');
    await translateText('секретное сообщение');

    expect(запросов).toHaveLength(2);
  });

  it('should return the translation and the detected language', async () => {
    const итог = await translateText('hello');

    expect(итог.translatedText).toBe('translated');
    expect(итог.detectedSourceLang).toBe('en');
    expect(итог.targetLanguage).toBe('ru');
  });
});
