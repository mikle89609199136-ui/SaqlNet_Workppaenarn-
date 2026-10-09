import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translateText } from './translatorApi';

/**
 * Ответ переводчика приходит вложенными массивами: data[0] — куски перевода,
 * по предложению на кусок (у каждого [0] — текст), data[2] — язык, который
 * сервис определил в исходном тексте.
 */
function response(segments: string[], sourceLang = 'en') {
  return JSON.stringify([segments.map((text) => [text, '', null, null]), null, sourceLang]);
}

let requests: string[] = [];
let nextSegments = ['translated'];

class FakeXHR {
  status = 200;
  responseText = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  open(_method: string, url: string) {
    requests.push(url);
  }

  send() {
    this.responseText = response(nextSegments);
    this.onload?.();
  }
}

beforeEach(() => {
  requests = [];
  nextSegments = ['translated'];
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

describe('перевод длинного сообщения', () => {
  it('склеивает все предложения, а не отдаёт только первое', async () => {
    // Google режет текст на предложения: так пришёл настоящий ответ на
    // «Hello, how are you? I will be late today. Let us meet tomorrow at noon.»
    nextSegments = [
      'Привет, как дела? ',
      'Я сегодня опоздаю. ',
      'Давайте встретимся завтра в полдень.',
    ];

    const result = await translateText(
      'Hello, how are you? I will be late today. Let us meet tomorrow at noon.'
    );

    expect(result.translatedText).toBe(
      'Привет, как дела? Я сегодня опоздаю. Давайте встретимся завтра в полдень.'
    );
  });
});
