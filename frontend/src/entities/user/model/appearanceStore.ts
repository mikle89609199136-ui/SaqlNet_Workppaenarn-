import { create } from 'zustand';
import { STORAGE_KEYS } from '@/shared/config';

/*
 * Палитра фона и цвет акцента (#828).
 *
 * Сервер поддерживает palette/accentPreset (#1040), но клиент подключит их
 * в #728. Пока выбор живёт в браузере: запоминается
 * в localStorage и применяется атрибутами на <html> — `data-palette` и
 * `data-accent`, см. tokens/palette.css и tokens/accents.css. До первой
 * отрисовки тот же ключ читает скрипт в index.html, поэтому и экран входа
 * открывается в выбранной палитре, без мигания.
 *
 * В #728 источником станет сервер, как у темы, а здесь
 * останется проекция на диск.
 */

export const PALETTES = ['graphite', 'midnight', 'warm'] as const;
export const ACCENTS = ['violet', 'plum', 'orchid', 'indigo', 'amber', 'teal'] as const;

export type TPalette = (typeof PALETTES)[number];
export type TAccent = (typeof ACCENTS)[number];

/* Значения по умолчанию заданы в CSS без атрибута — атрибут для них
   снимается, а не ставится. */
const DEFAULT_PALETTE: TPalette = 'graphite';
const DEFAULT_ACCENT: TAccent = 'violet';

interface IAppearance {
  palette: TPalette;
  accent: TAccent;
}

interface IAppearanceState extends IAppearance {
  setPalette: (palette: TPalette) => void;
  setAccent: (accent: TAccent) => void;
}

const isPalette = (value: unknown): value is TPalette => PALETTES.includes(value as TPalette);
const isAccent = (value: unknown): value is TAccent => ACCENTS.includes(value as TAccent);

function readStored(): IAppearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.APPEARANCE);
    const stored = raw ? (JSON.parse(raw) as Partial<IAppearance>) : {};
    return {
      palette: isPalette(stored.palette) ? stored.palette : DEFAULT_PALETTE,
      accent: isAccent(stored.accent) ? stored.accent : DEFAULT_ACCENT,
    };
  } catch {
    return { palette: DEFAULT_PALETTE, accent: DEFAULT_ACCENT };
  }
}

function apply({ palette, accent }: IAppearance): void {
  const root = document.documentElement;
  if (palette === DEFAULT_PALETTE) root.removeAttribute('data-palette');
  else root.setAttribute('data-palette', palette);
  if (accent === DEFAULT_ACCENT) root.removeAttribute('data-accent');
  else root.setAttribute('data-accent', accent);

  try {
    localStorage.setItem(STORAGE_KEYS.APPEARANCE, JSON.stringify({ palette, accent }));
  } catch {
    // Приватный режим или переполненное хранилище: выбор уже применён,
    // просто не переживёт перезагрузку.
  }
}

export const useAppearanceStore = create<IAppearanceState>((set, get) => ({
  ...readStored(),
  setPalette: (palette) => {
    set({ palette });
    apply({ palette, accent: get().accent });
  },
  setAccent: (accent) => {
    set({ accent });
    apply({ palette: get().palette, accent });
  },
}));
