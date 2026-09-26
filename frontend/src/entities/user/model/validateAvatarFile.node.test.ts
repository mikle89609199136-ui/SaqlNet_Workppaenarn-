import { describe, expect, it } from 'vitest';
import { MAX_AVATAR_SIZE_BYTES, validateAvatarFile } from './validateAvatarFile';

describe('validateAvatarFile', () => {
  it('should accept valid jpeg file under 5 MB', () => {
    const file = new File(['content'], 'avatar.jpg', { type: 'image/jpeg' });
    const result = validateAvatarFile(file);
    expect(result.valid).toBe(true);
    expect(result.errorCode).toBeUndefined();
  });

  it('should accept valid png, webp, and gif files', () => {
    for (const type of ['image/png', 'image/webp', 'image/gif']) {
      const file = new File(['content'], 'avatar.img', { type });
      const result = validateAvatarFile(file);
      expect(result.valid).toBe(true);
      expect(result.errorCode).toBeUndefined();
    }
  });

  it('should reject non-image file types with invalidType error code', () => {
    const textFile = new File(['content'], 'notes.txt', { type: 'text/plain' });
    const textResult = validateAvatarFile(textFile);
    expect(textResult.valid).toBe(false);
    expect(textResult.errorCode).toBe('invalidType');

    const pdfFile = new File(['content'], 'doc.pdf', { type: 'application/pdf' });
    const pdfResult = validateAvatarFile(pdfFile);
    expect(pdfResult.valid).toBe(false);
    expect(pdfResult.errorCode).toBe('invalidType');

    const svgFile = new File(['<svg></svg>'], 'image.svg', { type: 'image/svg+xml' });
    const svgResult = validateAvatarFile(svgFile);
    expect(svgResult.valid).toBe(false);
    expect(svgResult.errorCode).toBe('invalidType');

    const bmpFile = new File(['content'], 'image.bmp', { type: 'image/bmp' });
    const bmpResult = validateAvatarFile(bmpFile);
    expect(bmpResult.valid).toBe(false);
    expect(bmpResult.errorCode).toBe('invalidType');

    const tiffFile = new File(['content'], 'image.tiff', { type: 'image/tiff' });
    const tiffResult = validateAvatarFile(tiffFile);
    expect(tiffResult.valid).toBe(false);
    expect(tiffResult.errorCode).toBe('invalidType');
  });

  it('should reject file larger than 5 MB with tooLarge error code', () => {
    const largeBlob = new Uint8Array(MAX_AVATAR_SIZE_BYTES + 1);
    const file = new File([largeBlob], 'huge.png', { type: 'image/png' });
    const result = validateAvatarFile(file);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('tooLarge');
  });
});
