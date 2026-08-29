import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translateText } from './translatorApi';

/**
 * Ответ переводчика приходит вложенными массивами: data[0][0][0] — сам перевод,
 * data[2] — язык, который сервис определил в исходном тексте.
 */
function response(translation: string, sourceLang = 'en') {
  return JSON.stringify([[[translation, '', '', '']], null, sourceLang]);
}

let requests: string[] = [];

class FakeXHR {
  status = 200;
  responseText = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  open(_method: string, url: string) {
    requests.push(url);
  }

  send() {
    this.responseText = response('translated');
    this.onload?.();
  }
}

beforeEach(() => {
  requests = [];
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
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

    expect(requests).toHaveLength(2);
  });

  it('should return the translation and the detected language', async () => {
    const result = await translateText('hello');

    expect(result.translatedText).toBe('translated');
    expect(result.detectedSourceLang).toBe('en');
    expect(result.targetLanguage).toBe('ru');
  });
});
