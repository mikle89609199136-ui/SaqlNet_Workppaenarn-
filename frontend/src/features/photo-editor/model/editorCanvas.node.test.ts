import { describe, expect, it } from 'vitest';
import { normalizeAngle, snapAngle } from './editorCanvas';

describe('normalizeAngle', () => {
  it('приводит угол к промежутку от −180 до 180', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(270)).toBe(-90);
    expect(normalizeAngle(-270)).toBe(90);
    expect(normalizeAngle(540)).toBe(180);
    expect(normalizeAngle(-180)).toBe(180);
  });
});

describe('snapAngle', () => {
  it('притягивает к прямым углам в пределах порога', () => {
    expect(snapAngle(3)).toBe(0);
    expect(snapAngle(-2.5)).toBe(0);
    expect(snapAngle(88)).toBe(90);
    expect(snapAngle(-93)).toBe(-90);
    expect(snapAngle(177)).toBe(180);
  });

  it('за порогом оставляет угол как есть, округляя до градуса', () => {
    expect(snapAngle(12.4)).toBe(12);
    expect(snapAngle(-45.6)).toBe(-46);
    expect(snapAngle(95)).toBe(95);
  });
});
