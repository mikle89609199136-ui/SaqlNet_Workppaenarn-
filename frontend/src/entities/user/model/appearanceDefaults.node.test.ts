import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE_SETTINGS } from './defaultProfileSettings';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const script = read('../../../../index.html').match(/<script>([\s\S]*?)<\/script>/)![1];
function boot(settings: unknown, user: unknown = { id: 'alice' }, dark = false) {
  const attributes: Record<string, string> = { 'data-theme': 'dark' };
  runInNewContext(script, {
    localStorage: {
      getItem: (key: string) => JSON.stringify(key === 'craneapp_settings' ? settings : user),
    },
    document: {
      documentElement: {
        setAttribute: (key: string, value: string) => {
          attributes[key] = value;
        },
      },
    },
    matchMedia: () => ({ matches: dark }),
  });
  return attributes;
}
describe('раннее оформление и defaults #728', () => {
  it('совпадает с единым серверным источником defaults', () => {
    const shared = JSON.parse(
      read('../../../../../backend-v2/internal/platform/settingsdefaults/defaults.json')
    );
    expect(DEFAULT_PROFILE_SETTINGS).toEqual(shared.settings);
  });
  it.each([false, true])('разрешает system до запуска React (dark=%s)', (dark) => {
    expect(
      boot(
        {
          ownerId: 'alice',
          theme: 'system',
          palette: 'warm',
          accentPreset: 'teal',
          textSize: 'large',
          chatDensity: 'compact',
        },
        { id: 'alice' },
        dark
      )
    ).toEqual({
      'data-theme': dark ? 'dark' : 'light',
      'data-theme-preference': 'system',
      'data-palette': 'warm',
      'data-accent': 'teal',
      'data-text-size': 'large',
      'data-chat-density': 'compact',
    });
  });
  it.each([
    null,
    {},
    { theme: 'light' },
    { ownerId: 'bob', theme: 'light', palette: 'warm' },
    { ownerId: 'alice', theme: 'invalid', palette: 'invalid' },
  ])('игнорирует чужую/старую/некорректную проекцию %j', (settings) => {
    expect(boot(settings)).toEqual({ 'data-theme': 'dark' });
  });
  it('без аккаунта не применяет даже корректную проекцию', () => {
    expect(boot({ ownerId: 'alice', theme: 'light' }, null)).toEqual({ 'data-theme': 'dark' });
  });
});
