const translationCache = new Map();

export function getPreferredLanguage(fallback = "ru") {
  try {
    const raw = localStorage.getItem("craneapp_settings");
    if (!raw) return fallback;
    const settings = JSON.parse(raw);
    return settings?.language || fallback;
  } catch (_err) {
    return fallback;
  }
}

function rawGet(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(new Error("Invalid JSON response"));
        }
      } else {
        reject(new Error(`Translation request failed: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during translation request"));
    xhr.send();
  });
}

export async function translateText(text) {
	const preferredLanguage = getPreferredLanguage();
  const cacheKey = `${text}|${preferredLanguage}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", preferredLanguage);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const data = await rawGet(url.toString());

  const translatedText = data[0][0][0];
  const detectedSourceLang = data?.[2] || null; // язык, который Google определил в исходном тексте

  if (!translatedText) {
    throw new Error("Translation provider returned no result");
  }

  const result = { translatedText, targetLanguage: preferredLanguage, detectedSourceLang };
  translationCache.set(cacheKey, result);

  return result;
}
