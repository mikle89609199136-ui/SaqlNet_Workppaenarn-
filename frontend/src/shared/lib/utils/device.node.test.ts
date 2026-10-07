import { describe, expect, it } from 'vitest';
import { describeDevice, describeDeviceType } from './device';

describe('session device metadata', () => {
  it('describes a desktop browser', () => {
    const userAgent =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36';

    expect(describeDevice(userAgent)).toBe('Chrome на Linux');
    expect(describeDeviceType(userAgent)).toBe('desktop');
  });

  it('recognises mobile and tablet clients', () => {
    expect(describeDeviceType('Mozilla/5.0 (iPhone) Mobile Safari/604.1')).toBe('mobile');
    expect(describeDeviceType('Mozilla/5.0 (iPad) Safari/604.1')).toBe('tablet');
  });
});
