/* global AudioWorkletProcessor, registerProcessor */
/*
 * Захват звука с микрофона для голосовых (#843): отдаёт в основной поток
 * отсчёты первого канала пачками по ~43 мс (2048 отсчётов при 48 кГц).
 * Пачки, а не каждые 128 отсчётов: иначе сотни сообщений в секунду.
 *
 * Обычный файл, а не строка: модуль AudioWorklet из `blob:` запрещён
 * политикой безопасности (CSP).
 */
const BATCH = 2048;

class CraneappPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BATCH);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    let offset = 0;
    while (offset < channel.length) {
      const take = Math.min(channel.length - offset, BATCH - this.filled);
      this.buffer.set(channel.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === BATCH) {
        this.port.postMessage(this.buffer);
        this.buffer = new Float32Array(BATCH);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('craneapp-pcm-capture', CraneappPcmCapture);
