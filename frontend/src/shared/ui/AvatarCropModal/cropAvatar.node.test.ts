import { describe, expect, it } from 'vitest';
import { avatarCropRect } from './cropAvatar';

describe('avatar crop geometry', () => {
  it.each([
    [1200, 800, 1, { x: 0, y: 0 }, { x: 200, y: 0, side: 800 }],
    [800, 1200, 1, { x: 0, y: -1 }, { x: 0, y: 400, side: 800 }],
    [1200, 800, 2, { x: 1, y: -1 }, { x: 0, y: 400, side: 400 }],
    [800, 800, 4, { x: -1, y: 1 }, { x: 600, y: 0, side: 200 }],
  ])('selects the visible square in %s×%s at zoom %s', (w, h, zoom, position, expected) => {
    expect(avatarCropRect(w, h, zoom, position)).toEqual(expected);
  });

  it('keeps every crop inside the image at extreme drag positions', () => {
    for (const [width, height] of [
      [1, 10000],
      [1200, 800],
      [800, 1200],
      [800, 800],
    ]) {
      for (const zoom of [1, 1.01, 2, 4]) {
        for (const x of [-20, -1, 0, 1, 20]) {
          for (const y of [-20, -1, 0, 1, 20]) {
            const crop = avatarCropRect(width, height, zoom, { x, y });
            expect(crop.x).toBeGreaterThanOrEqual(0);
            expect(crop.y).toBeGreaterThanOrEqual(0);
            expect(crop.x + crop.side).toBeLessThanOrEqual(width + 1e-9);
            expect(crop.y + crop.side).toBeLessThanOrEqual(height + 1e-9);
          }
        }
      }
    }
  });
});
