/**
 * Голосовое, которое этот браузер может проиграть (#843).
 *
 * Голосовые пишутся в Ogg/Opus. Его проигрывают все, кроме Safari до 18.4:
 * там запись перекодируется на месте — ленивым WASM-декодером
 * (`ogg-opus-decoder`, MIT) в WAV. Декодер грузится отдельным чанком и
 * только там, где он нужен.
 *
 * Перекодирование — при расшифровке, из исходного `Blob`, а не по адресу
 * `blob:`: скачивание таких адресов запрещено политикой безопасности (CSP).
 * Готовый WAV попадает в общий реестр адресов, поэтому второй раз не
 * декодируется.
 */

export const VOICE_MIME_TYPE = 'audio/ogg; codecs=opus';

/** Для WAV-замены хватит 16 кГц: речь, а файл втрое меньше. */
const WAV_SAMPLE_RATE = 16000;

let nativeSupport: boolean | null = null;

export function canPlayOggOpus(): boolean {
  if (nativeSupport !== null) return nativeSupport;
  try {
    nativeSupport =
      typeof document !== 'undefined' &&
      document.createElement('audio').canPlayType(VOICE_MIME_TYPE) !== '';
  } catch {
    nativeSupport = false;
  }
  return nativeSupport;
}

/** Только для тестов: забыть, что узнали о браузере. */
export function resetPlaybackSupport(value: boolean | null = null): void {
  nativeSupport = value;
}

/**
 * Проигрываемая версия голосового. Не вышло перекодировать — исходный файл:
 * плеер покажет «формат не поддерживается» и предложит скачать.
 */
export async function toPlayableVoiceBlob(blob: Blob): Promise<Blob> {
  if (canPlayOggOpus()) return blob;
  try {
    const { OggOpusDecoder } = await import('ogg-opus-decoder');
    const decoder = new OggOpusDecoder();
    await decoder.ready;
    try {
      const { channelData, sampleRate } = await decoder.decodeFile(
        new Uint8Array(await blob.arrayBuffer())
      );
      if (!channelData[0]?.length) return blob;
      return encodeWav(channelData[0], sampleRate, WAV_SAMPLE_RATE);
    } finally {
      decoder.free();
    }
  } catch (error) {
    console.warn('Голосовое не перекодировано', error);
    return blob;
  }
}

/** Моно WAV 16 бит с понижением частоты усреднением. */
export function encodeWav(samples: Float32Array, inputRate: number, outputRate: number): Blob {
  const ratio = Math.max(1, Math.round(inputRate / outputRate));
  const rate = Math.round(inputRate / ratio);
  const length = Math.floor(samples.length / ratio);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);

  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // моно
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, length * 2, true);

  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let j = 0; j < ratio; j++) sum += samples[i * ratio + j];
    const value = Math.max(-1, Math.min(1, sum / ratio));
    view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
