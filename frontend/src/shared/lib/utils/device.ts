/** A short, human-readable label for the browser receiving a session. */
export function describeDevice(userAgent: string = globalThis.navigator?.userAgent ?? ''): string {
  const browser =
    [
      ['Edge', /Edg\//],
      ['Opera', /OPR\//],
      ['Яндекс Браузер', /YaBrowser\//],
      ['Firefox', /Firefox\//],
      ['Chrome', /Chrome\//],
      ['Safari', /Safari\//],
    ].find(([, pattern]) => (pattern as RegExp).test(userAgent))?.[0] ?? 'Браузер';

  const system =
    [
      ['iPhone', /iPhone/],
      ['iPad', /iPad/],
      ['Android', /Android/],
      ['Windows', /Windows/],
      ['macOS', /Mac OS X/],
      ['Linux', /Linux/],
    ].find(([, pattern]) => (pattern as RegExp).test(userAgent))?.[0] ?? '';

  return system ? `${browser} на ${system}` : (browser as string);
}

export function describeDeviceType(
  userAgent: string = globalThis.navigator?.userAgent ?? ''
): 'desktop' | 'mobile' | 'tablet' {
  if (/iPad|Tablet/.test(userAgent)) return 'tablet';
  if (/Android|iPhone|Mobile/.test(userAgent)) return 'mobile';
  return 'desktop';
}
