export function getPreferredLanguage(fallback = 'ru') {
  try {
    const raw = localStorage.getItem('craneapp_settings');
    if (!raw) return fallback;
    const settings = JSON.parse(raw);
    return settings?.language || fallback;
  } catch (_err) {
    return fallback;
  }
}

function rawGet(url: string) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(new Error('Invalid JSON response'));
        }
      } else {
        reject(new Error(`Translation request failed: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during translation request'));
    xhr.send();
  });
}

export async function translateText(text: string) {
  const preferredLanguage = getPreferredLanguage();
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'auto');
  url.searchParams.set('tl', preferredLanguage);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);

  const data = await rawGet(url.toString());

  // Google режет текст на предложения и возвращает каждое отдельным куском:
  // data[0] — список кусков, у каждого [0] — перевод. Раньше брался только
  // первый, и длинное сообщение переводилось до первой точки.
  const translatedText = Array.isArray(data?.[0])
    ? data[0]
        .map((segment: unknown[]) => (typeof segment?.[0] === 'string' ? segment[0] : ''))
        .join('')
    : '';
  const detectedSourceLang = data?.[2] || null; // язык, который Google определил в исходном тексте

  if (!translatedText) {
    throw new Error('Translation provider returned no result');
  }

  return { translatedText, targetLanguage: preferredLanguage, detectedSourceLang };
}
