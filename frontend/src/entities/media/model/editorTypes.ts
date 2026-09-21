import type { TIconTypes } from '@/types/icons';

export type TEditorTool = 'draw' | 'text' | 'transform' | 'adjust';
export type TBrushType = 'pen' | 'marker' | 'neon' | 'arrow' | 'blur' | 'eraser';
export type TTextFontId = 'modern' | 'classic' | 'serif' | 'mono';
export type TCropRatioValue = number | 'original' | null;

export interface IEditorFilter {
  brightness: number;
  contrast: number;
  saturate: number;
  sepia: number;
  blur: number;
}

export interface IEditorCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IEditorPoint {
  x: number;
  y: number;
}

export interface IEditorPathObject {
  id: string;
  type: 'path';
  brush: TBrushType;
  color: string;
  size: number;
  points: IEditorPoint[];
}

export interface IEditorTextObject {
  id: string;
  type: 'text';
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  font: TTextFontId;
  rotation: number;
}

export type TEditorObject = IEditorPathObject | IEditorTextObject;

export interface IEditorState {
  filters: IEditorFilter;
  rotation: number;
  flipX: number;
  flipY: number;
  crop: IEditorCrop;
  cropRatio: TCropRatioValue;
  objects: TEditorObject[];
}

export interface IBrushOption {
  id: TBrushType;
  label: string;
  icon: TIconTypes;
}

export interface IRatioOption {
  label: string;
  value: TCropRatioValue;
}

export interface IFontOption {
  id: TTextFontId;
  label: string;
  family: string;
}

export interface IPhotoEditorModalProps {
  file: File;
  onCancel: () => void;
  onSave: (file: File) => void;
}
