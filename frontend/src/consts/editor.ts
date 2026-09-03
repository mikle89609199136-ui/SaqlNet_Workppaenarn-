import type {
  IBrushOption,
  IEditorCrop,
  IEditorFilter,
  IFontOption,
  IRatioOption,
} from '@/types';

export const DEFAULT_FILTERS: IEditorFilter = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  sepia: 0,
  blur: 0,
};

export const DEFAULT_CROP: IEditorCrop = { x: 0, y: 0, width: 1, height: 1 };

export const EDITOR_COLORS: readonly string[] = [
  '#ff4b3e',
  '#ffcc00',
  '#4cd964',
  '#1689ff',
  '#ffffff',
  '#000000',
];

export const EDITOR_BRUSHES: readonly IBrushOption[] = [
  { id: 'pen', label: 'Перо', icon: 'pen' },
  { id: 'marker', label: 'Маркер', icon: 'highlighter' },
  { id: 'neon', label: 'Неон', icon: 'zap' },
  { id: 'arrow', label: 'Стрелка', icon: 'arrowUpRight' },
  { id: 'blur', label: 'Размытие', icon: 'blur' },
  { id: 'eraser', label: 'Ластик', icon: 'eraser' },
];

export const EDITOR_RATIOS: readonly IRatioOption[] = [
  { label: 'Произвольно', value: null },
  { label: 'Оригинал', value: 'original' },
  { label: 'Квадрат', value: 1 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '5:4', value: 5 / 4 },
  { label: '4:5', value: 4 / 5 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
];

export const EDITOR_FONTS: readonly IFontOption[] = [
  { id: 'modern', label: 'Modern', family: 'Geologica, Inter, sans-serif' },
  { id: 'classic', label: 'Классика', family: 'Arial, sans-serif' },
  { id: 'serif', label: 'Serif', family: 'Georgia, serif' },
  { id: 'mono', label: 'Mono', family: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
];
