import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Контраст токенов во всех палитрах, темах и акцентах (#816).
 *
 * Комбинаций 36, и глазами их не проверить: правка одного значения в
 * палитре молча роняет текст в другой. Поэтому CSS читается как есть,
 * каскад разрешается так же, как в браузере, — по весу селектора и
 * порядку, — и пары «текст на фоне» из дизайн-системы сверяются с WCAG.
 */

const FILES = ['palette.css', 'accents.css', 'semantic.css', 'themes.css'];

const PALETTES = ['graphite', 'midnight', 'warm'] as const;
const THEMES = ['light', 'dark'] as const;
const ACCENTS = ['violet', 'plum', 'orchid', 'indigo', 'amber', 'teal'] as const;

type Context = Record<'palette' | 'theme' | 'accent', string>;
type Rgba = [number, number, number, number];

interface IDeclaration {
  selectors: string[];
  order: number;
  value: string;
}

/* --- Разбор CSS ------------------------------------------------ */

function parseDeclarations(): Map<string, IDeclaration[]> {
  const declarations = new Map<string, IDeclaration[]>();
  let order = 0;

  for (const file of FILES) {
    const css = readFileSync(resolve(import.meta.dirname, file), 'utf-8').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    );

    for (const [, head, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // Переменные из @theme Tailwind выводит на :root.
      const selectors = head.trim() === '@theme' ? [':root'] : head.split(',').map((s) => s.trim());

      for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        const list = declarations.get(name) ?? [];
        list.push({ selectors, order: order++, value: value.trim() });
        declarations.set(name, list);
      }
    }
  }

  return declarations;
}

/** Вес подходящего селектора или -1, если он к контексту не относится. */
function specificity(selector: string, context: Context): number {
  const attributes = [...selector.matchAll(/\[data-(\w+)='([\w-]+)'\]/g)];
  const matches = attributes.every(([, key, value]) => {
    const current = context[key as keyof Context];
    // Светлая тема — это отсутствие атрибута, как и палитра по умолчанию.
    return current === value;
  });
  if (!matches) return -1;

  const roots = selector.includes(':root') ? 1 : 0;
  return roots + attributes.length;
}

function contextAttributes(palette: string, theme: string, accent: string): Context {
  return {
    palette: palette === 'graphite' ? '' : palette,
    theme: theme === 'light' ? '' : theme,
    accent,
  };
}

function resolver(declarations: Map<string, IDeclaration[]>, context: Context) {
  const winner = (name: string): string => {
    let best: { weight: number; order: number; value: string } | undefined;

    for (const declaration of declarations.get(name) ?? []) {
      const weight = Math.max(...declaration.selectors.map((s) => specificity(s, context)));
      if (weight < 0) continue;
      if (
        !best ||
        weight > best.weight ||
        (weight === best.weight && declaration.order > best.order)
      ) {
        best = { weight, order: declaration.order, value: declaration.value };
      }
    }

    if (!best) throw new Error(`${name} не объявлена для ${JSON.stringify(context)}`);
    return best.value;
  };

  const expand = (value: string): string =>
    value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => expand(winner(name)));

  return (name: string): Rgba => parseColor(expand(winner(name)));
}

/* --- Цвет ------------------------------------------------------ */

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of input) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts;
}

function parseColor(raw: string): Rgba {
  const value = raw.trim();

  if (value === 'white') return [255, 255, 255, 1];
  if (value === 'transparent') return [0, 0, 0, 0];

  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)).concat(1) as Rgba;
  }

  const rgba = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1].split(',').map(Number);
    return [r, g, b, a];
  }

  const mix = value.match(/^color-mix\(in srgb,\s*(.+)\)$/);
  if (mix) {
    const [first, second] = splitTopLevel(mix[1]);
    const [, colorA, share] = first.match(/^(.+?)\s+(\d+(?:\.\d+)?)%$/)!;
    const p = Number(share) / 100;
    const a = parseColor(colorA);
    const b = parseColor(second);
    // Смешение в srgb с учётом прозрачности — как у браузера.
    const alpha = a[3] * p + b[3] * (1 - p);
    if (alpha === 0) return [0, 0, 0, 0];
    const channel = (i: number) => (a[i] * a[3] * p + b[i] * b[3] * (1 - p)) / alpha;
    return [channel(0), channel(1), channel(2), alpha];
  }

  throw new Error(`Не разобрать цвет: ${value}`);
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const linear = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(text: Rgba, background: Rgba): number {
  const solidText = text[3] < 1 ? over(text, background) : text;
  const a = luminance(solidText);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/* --- Проверки -------------------------------------------------- */

const declarations = parseDeclarations();

const contexts = PALETTES.flatMap((palette) =>
  THEMES.flatMap((theme) => ACCENTS.map((accent) => ({ palette, theme, accent })))
);

/** Поверхности, на которых пишется текст. */
const SURFACES = ['sheet', 'chat-bg', 'sheet-2', 'bubble-in', 'composer', 'menu'];

function failures(check: (color: (name: string) => Rgba, scope: string) => string[]): string[] {
  return contexts.flatMap(({ palette, theme, accent }) => {
    const color = resolver(declarations, contextAttributes(palette, theme, accent));
    return check((name) => color(`--color-${name}`), `${palette}/${theme}/${accent}`);
  });
}

function need(scope: string, label: string, value: number, min: number): string[] {
  return value < min ? [`${scope}: ${label} — ${value.toFixed(2)} < ${min}`] : [];
}

describe('токены: контраст во всех палитрах, темах и акцентах', () => {
  it('текст держит 4.5:1 на всех поверхностях', () => {
    const result = failures((color, scope) =>
      SURFACES.flatMap((surface) =>
        ['ink', 'ink-2', 'ink-3', 'brand', 'danger'].flatMap((text) =>
          need(scope, `${text} на ${surface}`, ratio(color(text), color(surface)), 4.5)
        )
      )
    );

    expect(result).toEqual([]);
  });

  it('второстепенный текст читается прямо на фоне окна', () => {
    const result = failures((color, scope) =>
      need(scope, 'ink-2 на ground', ratio(color('ink-2'), color('ground')), 4.5)
    );

    expect(result).toEqual([]);
  });

  it('акцент как текст читается на своей мягкой подложке', () => {
    const result = failures((color, scope) =>
      ['sheet', 'sheet-2'].flatMap((surface) => {
        const soft = over(color('brand-soft'), color(surface));
        return need(
          scope,
          `brand на brand-soft поверх ${surface}`,
          ratio(color('brand'), soft),
          4.5
        );
      })
    );

    expect(result).toEqual([]);
  });

  it('поверх заливки — текст, время и число счётчика', () => {
    const result = failures((color, scope) => [
      ...need(scope, 'on-brand на brand-fill', ratio(color('on-brand'), color('brand-fill')), 4.5),
      ...need(scope, 'out-meta на brand-fill', ratio(color('out-meta'), color('brand-fill')), 4.5),
      ...need(
        scope,
        'on-brand на muted-badge',
        ratio(color('on-brand'), color('muted-badge')),
        4.5
      ),
    ]);

    expect(result).toEqual([]);
  });

  it('галочки своего сообщения видны на заливке любого акцента (#657)', () => {
    const result = failures((color, scope) => [
      ...need(scope, 'out-tick на brand-fill', ratio(color('out-tick'), color('brand-fill')), 3),
      ...need(scope, 'out-read на brand-fill', ratio(color('out-read'), color('brand-fill')), 3),
    ]);

    expect(result).toEqual([]);
  });

  it('ошибка читается на своей подложке', () => {
    const result = failures((color, scope) => {
      const soft = over(color('danger-soft'), color('menu'));
      return need(scope, 'danger на danger-soft', ratio(color('danger'), soft), 4.5);
    });

    expect(result).toEqual([]);
  });

  it('имя автора в группе читается на чужом пузыре', () => {
    const result = failures((color, scope) =>
      [1, 2, 3, 4].flatMap((n) =>
        need(
          scope,
          `author-${n} на bubble-in`,
          ratio(color(`author-${n}`), color('bubble-in')),
          4.5
        )
      )
    );

    expect(result).toEqual([]);
  });

  it('свой пузырь читается', () => {
    const result = failures((color, scope) =>
      need(
        scope,
        'bubble-out-ink на bubble-out',
        ratio(color('bubble-out-ink'), color('bubble-out')),
        4.5
      )
    );

    expect(result).toEqual([]);
  });

  it('очертания и значки держат 3:1', () => {
    const result = failures((color, scope) => [
      ...['ground', ...SURFACES].flatMap((surface) =>
        need(scope, `line на ${surface}`, ratio(color('line'), color(surface)), 3)
      ),
      ...need(scope, 'ok на sheet', ratio(color('ok'), color('sheet')), 3),
      ...need(scope, 'warn на sheet', ratio(color('warn'), color('sheet')), 3),
    ]);

    expect(result).toEqual([]);
  });

  it('заливка счётчика отличается от панели — кроме известного исключения', () => {
    // Сливовый и индиго в тёмной теме дают меньше 3:1 к панели. Число на
    // счётчике белое и читается с запасом, поэтому дизайн-система их
    // оставила — см. раздел «Цвет».
    const exceptions = /\/dark\/(plum|indigo)$/;

    const result = failures((color, scope) =>
      exceptions.test(scope)
        ? []
        : need(scope, 'brand-fill на sheet', ratio(color('brand-fill'), color('sheet')), 3)
    );

    expect(result).toEqual([]);
  });
});

describe('токены: палитра и акцент меняют только своё', () => {
  const NEUTRAL = new Set([
    'ground',
    'sheet',
    'sheet-2',
    'chat-bg',
    'composer',
    'card',
    'menu',
    'line',
    'line-soft',
    'divider',
    'ink',
    'ink-2',
    'ink-3',
    'bubble-in',
    'skeleton',
    'skeleton-sweep',
  ]);
  const ACCENT = new Set([
    'brand',
    'brand-fill',
    'brand-fill-hover',
    'on-brand',
    'brand-soft',
    'row-selected',
    'bubble-out',
    'bubble-out-ink',
  ]);

  const semanticNames = [...declarations.keys()]
    .filter((name) => name.startsWith('--color-'))
    .map((name) => name.slice('--color-'.length));

  const snapshot = (palette: string, theme: string, accent: string) => {
    const color = resolver(declarations, contextAttributes(palette, theme, accent));
    return Object.fromEntries(
      semanticNames.map((name) => [name, color(`--color-${name}`).join(',')])
    );
  };

  const changed = (a: Record<string, string>, b: Record<string, string>) =>
    semanticNames.filter((name) => a[name] !== b[name]);

  it.each(THEMES)('смена палитры в теме %s трогает только нейтральные цвета', (theme) => {
    for (const accent of ACCENTS) {
      const base = snapshot('graphite', theme, accent);
      for (const palette of PALETTES) {
        const diff = changed(base, snapshot(palette, theme, accent));
        expect(diff.filter((name) => !NEUTRAL.has(name))).toEqual([]);
      }
    }
  });

  it.each(THEMES)('смена акцента в теме %s трогает только акцент', (theme) => {
    for (const palette of PALETTES) {
      const base = snapshot(palette, theme, 'violet');
      for (const accent of ACCENTS) {
        const diff = changed(base, snapshot(palette, theme, accent));
        expect(diff.filter((name) => !ACCENT.has(name))).toEqual([]);
      }
    }
  });

  it('палитры действительно различаются', () => {
    const graphite = snapshot('graphite', 'dark', 'violet');
    expect(changed(graphite, snapshot('midnight', 'dark', 'violet'))).toContain('sheet');
    expect(changed(graphite, snapshot('warm', 'light', 'violet'))).toContain('ground');
  });
});
