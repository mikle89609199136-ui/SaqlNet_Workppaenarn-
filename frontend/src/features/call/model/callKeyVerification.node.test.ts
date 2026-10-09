import { describe, expect, it } from 'vitest';
import {
  CALL_VERIFICATION_EMOJIS,
  computeCallVerificationEmojis,
  parseDtlsFingerprint,
} from './callKeyVerification';

describe('callKeyVerification', () => {
  const sampleSdpA = `v=0
o=- 123456 2 IN IP4 127.0.0.1
s=-
t=0 0
a=fingerprint:sha-256 4A:AD:B9:B1:3F:82:18:3B:54:02:12:DF:3E:5D:49:6B:19:E5:7C:AB:29:A7:F7:61:94:10:97:54:19:D4:53:C2
m=audio 9 UDP/TLS/RTP/SAVPF 111
c=IN IP4 0.0.0.0`;

  const sampleSdpB = `v=0
o=- 987654 2 IN IP4 127.0.0.1
s=-
t=0 0
a=fingerprint:sha-256 B2:88:C1:F0:77:24:D1:66:35:88:7A:B4:44:09:A6:12:5E:21:49:B0:9C:1D:33:67:8B:7F:11:54:33:20:AA:15
m=audio 9 UDP/TLS/RTP/SAVPF 111
c=IN IP4 0.0.0.0`;

  describe('parseDtlsFingerprint', () => {
    it('извлекает и нормализует sha-256 отпечаток с двоеточиями', () => {
      const fp = parseDtlsFingerprint(sampleSdpA);
      expect(fp).toBe('sha-256 4AADB9B13F82183B540212DF3E5D496B19E57CAB29A7F7619410975419D453C2');
    });

    it('корректно нормализует строчные буквы и алгоритм', () => {
      const sdp = 'a=fingerprint:SHA-256 aa:bb:cc:dd:ee:ff';
      expect(parseDtlsFingerprint(sdp)).toBe('sha-256 AABBCCDDEEFF');
    });

    it('возвращает null при отсутствии строки a=fingerprint', () => {
      const sdpNoFp = `v=0
o=- 123 2 IN IP4 127.0.0.1
m=audio 9 UDP/TLS/RTP/SAVPF 111`;
      expect(parseDtlsFingerprint(sdpNoFp)).toBeNull();
      expect(parseDtlsFingerprint('')).toBeNull();
      expect(parseDtlsFingerprint(undefined as unknown as string)).toBeNull();
    });

    it('при наличии нескольких a=fingerprint предпочитает sha-256 (RFC 8122)', () => {
      const multiFpSdp = `v=0
o=- 123 2 IN IP4 127.0.0.1
a=fingerprint:sha-512 11:22:33:44:55:66
a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF
a=fingerprint:sha-1 00:11:22:33:44:55`;
      expect(parseDtlsFingerprint(multiFpSdp)).toBe('sha-256 AABBCCDDEEFF');
    });
  });

  describe('computeCallVerificationEmojis', () => {
    it('словарь содержит ровно 64 уникальных эмодзи', () => {
      expect(CALL_VERIFICATION_EMOJIS).toHaveLength(64);
      const unique = new Set(CALL_VERIFICATION_EMOJIS);
      expect(unique.size).toBe(64);
    });

    it('вычисляет 4 эмодзи для валидной пары SDP', async () => {
      const emojis = await computeCallVerificationEmojis(sampleSdpA, sampleSdpB);
      expect(emojis).toHaveLength(4);
      emojis?.forEach((emoji) => {
        expect(CALL_VERIFICATION_EMOJIS).toContain(emoji);
      });
    });

    it('возвращает идентичные эмодзи независимо от порядка абонентов (caller / callee symmetry)', async () => {
      const emojisAlice = await computeCallVerificationEmojis(sampleSdpA, sampleSdpB);
      const emojisBob = await computeCallVerificationEmojis(sampleSdpB, sampleSdpA);

      expect(emojisAlice).not.toBeNull();
      expect(emojisBob).not.toBeNull();
      expect(emojisAlice).toEqual(emojisBob);
    });

    it('изменение хотя бы одного символа в отпечатке даёт другой набор эмодзи', async () => {
      const original = await computeCallVerificationEmojis(sampleSdpA, sampleSdpB);

      // Изменяем последний байт в отпечатке B
      const tamperedSdpB = sampleSdpB.replace('AA:15', 'AA:16');
      const tampered = await computeCallVerificationEmojis(sampleSdpA, tamperedSdpB);

      expect(tampered).not.toBeNull();
      expect(tampered).not.toEqual(original);
    });

    it('возвращает null, если один из SDP отсутствует или не содержит отпечатка', async () => {
      expect(await computeCallVerificationEmojis(null, sampleSdpB)).toBeNull();
      expect(await computeCallVerificationEmojis(sampleSdpA, undefined)).toBeNull();
      expect(await computeCallVerificationEmojis('no-fingerprint', sampleSdpB)).toBeNull();
    });

    it('возвращает null, если crypto.subtle недоступен (небезопасный контекст)', async () => {
      const originalSubtle = globalThis.crypto.subtle;
      try {
        Object.defineProperty(globalThis.crypto, 'subtle', {
          value: undefined,
          configurable: true,
        });
        const emojis = await computeCallVerificationEmojis(sampleSdpA, sampleSdpB);
        expect(emojis).toBeNull();
      } finally {
        Object.defineProperty(globalThis.crypto, 'subtle', {
          value: originalSubtle,
          configurable: true,
        });
      }
    });
  });
});
