/**
 * A short, human-readable label for the browser receiving a session.
 *
 * Без языка: название уходит на сервер при входе и хранится как данные —
 * его видно в списке сеансов и на другом устройстве при входе по QR, на
 * каком бы языке ни был их интерфейс. «Chrome на Windows» читался по-русски
 * и в английском интерфейсе.
 */
export function describeDevice(userAgent: string = globalThis.navigator?.userAgent ?? ''): string {
  const browser =
    [
      ['Edge', /Edg\//],
      ['Opera', /OPR\//],
      ['Yandex Browser', /YaBrowser\//],
      ['Firefox', /Firefox\//],
      ['Chrome', /Chrome\//],
      ['Safari', /Safari\//],
    ].find(([, pattern]) => (pattern as RegExp).test(userAgent))?.[0] ?? 'Browser';

  const system =
    [
      ['iPhone', /iPhone/],
      ['iPad', /iPad/],
      ['Android', /Android/],
      ['Windows', /Windows/],
      ['macOS', /Mac OS X/],
      ['Linux', /Linux/],
    ].find(([, pattern]) => (pattern as RegExp).test(userAgent))?.[0] ?? '';

  return system ? `${browser} · ${system}` : (browser as string);
}

export function describeDeviceType(
  userAgent: string = globalThis.navigator?.userAgent ?? ''
): 'desktop' | 'mobile' | 'tablet' {
  if (/iPad|Tablet/.test(userAgent)) return 'tablet';
  if (/Android|iPhone|Mobile/.test(userAgent)) return 'mobile';
  return 'desktop';
}
