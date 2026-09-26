/**
 * Как назвать это устройство на экране подтверждения входа.
 *
 * Имя видит человек на уже вошедшем устройстве: «Chrome на Windows» ему
 * понятнее строки User-Agent. Точность не нужна — нужно узнать своё.
 */
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
