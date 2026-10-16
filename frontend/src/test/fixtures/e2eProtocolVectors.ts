// Frozen v2/v3 compatibility vectors. PUBLIC TEST KEYS ONLY.
// Generated independently by scripts/generate-e2e-protocol-vectors.cjs.
// Keep these bytes when changing implementation; new protocols need new vectors.
export const protocolVectors = {
  chatId: '70700000-0000-4000-8000-000000000070',
  epoch: 7,
  chatKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
  sender: {
    accountId: '70700000-0000-4000-8000-000000000001',
    bundle:
      'eyJ2IjoyLCJlY2RoIjoiTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFYXhmUjh1RXNRa2Y0dk9ibFk2UkE4bmNEZllFdDZ6T2c5S0U1UmRpWXdwWlA0MExpL2hwL200N242MHA4RDU0V0s4NHpWMnN4WHM3THRrQm9ONzlSOVE9PSIsImVjZHNhIjoiTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFWHN2azBhWXpDa1RJOSsrVkhVdnhaZWJHdHlIdnJhbUYrMEZtRzhibi9XeUhOR1FNU1pqL2ZqZExCczRhWktMczJDcXdOamhQdUQyYWViRW5vbjFRTWc9PSJ9',
    fingerprint: 'aj-S1Jln3Q8syeD83l-vbGiEg6JKuSV9bXVXLzBKOlw',
    ecdhPkcs8:
      'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGhRANCAARrF9Hy4SxCR/i85uVjpEDydwN9gS3rM6D0oTlF2JjClk/jQuL+Gn+bjufrSnwPnhYrzjNXazFezsu2QGg3v1H1',
    ecdsaPkcs8:
      'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOhRANCAARey+TRpjMKRMj375UdS/Fl5sa3Ie+tqYX7QWYbxuf9bIc0ZAxJmP9+N0sGzhpkouzYKrA2OE+4PZp5sSeifVAy',
  },
  recipient: {
    accountId: '70700000-0000-4000-8000-000000000002',
    bundle:
      'eyJ2IjoyLCJlY2RoIjoiTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFZlBKN0dJMERUMzZLVWpnREJMVWF3OENKYWVKMzhoczFwZ3RJL0VkbW1YZ0hkMVVRMjQ3UVFDazltc2FmZEREYnVuMnQ1anpwZ2ltZUJMZWRJbmh6MFE9PSIsImVjZHNhIjoiTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFNGxOS05UTFFqN3VnTGQ1bG51WXIwQU1mNHR0NFZaYnZVSk1DUkdzRENGTGc4VmRhVEdNOHh4bmY3bC9haGkxMlR2eVd3L01PNEFWY1FzSS9HRTdZeGc9PSJ9',
    fingerprint: 'N0Y7oryyk5Lo6guMq94DyAOKrkW-sHUcJ6VBgg3OY78',
    ecdhPkcs8:
      'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKhRANCAAR88nsYjQNPfopSOAMEtRrDwIlp4nfyGzWmC0j8R2aZeAd3VRDbjtBAKT2axp90MNu6fa3mPOmCKZ4Et50ieHPR',
    ecdsaPkcs8:
      'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAShRANCAATiU0o1MtCPu6At3mWe5ivQAx/i23hVlu9QkwJEawMIUuDxV1pMYzzHGd/uX9qGLXZO/JbD8w7gBVxCwj8YTtjG',
  },
  v2: {
    text: 'История v2 🔒',
    envelope: {
      v: 2,
      e2e: true,
      epoch: 7,
      iv: 'AAECAwQFBgcICQoL',
      data: 'bLqVgC2huv1eb/zCi+ExxhZ6w0Q5/yFn6KRhWe8KIZpP1xUjdqU=',
      kid: 'aj-S1Jln3Q8syeD83l-vbGiEg6JKuSV9bXVXLzBKOlw',
      sig: 'nyhkOM6vDFSF5v727uuaFj271qqOUZHBmYcXF1FzQCv4nhdPDbikflZkL+tcUNqktWBxJKIcNdKcbaOkKHWrTA==',
    },
    signingInput:
      '70700000-0000-4000-8000-000000000070|7|70700000-0000-4000-8000-000000000001|AAECAwQFBgcICQoL|bLqVgC2huv1eb/zCi+ExxhZ6w0Q5/yFn6KRhWe8KIZpP1xUjdqU=',
  },
  v3: {
    content: {
      text: 'Привет 👋',
      entities: [
        {
          type: 'bold',
          offset: 0,
          length: 6,
        },
      ],
      voice: {
        d: 1200,
        w: [1, 20, 31],
        g: 3.5,
      },
    },
    envelope: {
      v: 3,
      e2e: true,
      epoch: 7,
      iv: 'EBESExQVFhcYGRob',
      data: 'fNTmwM0JNf4LPIUSNDiYK2Km+No1K0n0NxuKnV+oXaJV4XTqF/KKuL7m9Mh15seNzJZB6+Yt8aRCt7TMfTfODq/Aes1KeNUnAOjHwzUptxIeldn9KeCEi9Imt4yyIYVTq98y+GLfva1tUnPQUX3fCGgKiQ3zFHT7eRmbIEuhqMFNl8EO9GfyXg==',
      kid: 'aj-S1Jln3Q8syeD83l-vbGiEg6JKuSV9bXVXLzBKOlw',
      sig: '2OCb+bu+DrIoda1PMmtTVflmTusYDRkke51iSO+o3ARTRLvLxZIrQfWmepB6yYkF+wdSpdoPG0Jxuqr5WreWGQ==',
    },
    signingInput:
      '70700000-0000-4000-8000-000000000070|7|70700000-0000-4000-8000-000000000001|EBESExQVFhcYGRob|fNTmwM0JNf4LPIUSNDiYK2Km+No1K0n0NxuKnV+oXaJV4XTqF/KKuL7m9Mh15seNzJZB6+Yt8aRCt7TMfTfODq/Aes1KeNUnAOjHwzUptxIeldn9KeCEi9Imt4yyIYVTq98y+GLfva1tUnPQUX3fCGgKiQ3zFHT7eRmbIEuhqMFNl8EO9GfyXg==',
  },
  media: {
    plaintext: [0, 1, 2, 127, 128, 254, 255],
    payload: {
      version: 2,
      encrypted: true,
      algorithm: 'AES-GCM',
      iv: 'ICEiIyQlJicoKSor',
      ciphertext: 'eY198z43AwpWD+27/cwJ9JT0VQqNU3I=',
      mimeType: 'application/octet-stream',
      sizeBytes: 7,
      keyEpoch: 7,
    },
  },
  wrappedKey: {
    userId: '70700000-0000-4000-8000-000000000002',
    encryptedKey:
      'eyJ2IjoyLCJpdiI6Ik1ERXlNelExTmpjNE9UbzciLCJjdCI6IkZIcFJFTlBxRGNwL1IvbzN6VHhTdjhCcEg4QW9CVGxFSmpnWHJyU0pWeldPVFFQR21SRXRSUlFYdHF1UjNaeUQiLCJzZW5kZXJJZCI6IjcwNzAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSIsInJlY2lwaWVudEZwIjoiTjBZN29yeXlrNUxvNmd1TXE5NER5QU9LcmtXLXNIVWNKNlZCZ2czT1k3OCJ9',
    senderKeyId: 'aj-S1Jln3Q8syeD83l-vbGiEg6JKuSV9bXVXLzBKOlw',
    keyEpoch: 7,
  },
  wrapIv: 'MDEyMzQ1Njc4OTo7',
};
