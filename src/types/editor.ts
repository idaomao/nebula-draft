export type Tool = 'select' | 'pan' | 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'note';

interface ElementBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  groupId?: string | null;
}

export interface RectElement extends ElementBase {
  kind: 'rect';
}

export interface EllipseElement extends ElementBase {
  kind: 'ellipse';
}

export interface TriangleElement extends ElementBase {
  kind: 'triangle';
}

export interface DiamondElement extends ElementBase {
  kind: 'diamond';
}

export interface NoteElement extends ElementBase {
  kind: 'note';
  text: string;
  richText: string;
  fontSize: number;
  textColor: string;
}

export interface ImageElement extends ElementBase {
  kind: 'image';
  src: string;
}

export type BoardElement =
  | RectElement
  | EllipseElement
  | TriangleElement
  | DiamondElement
  | NoteElement
  | ImageElement;

export interface ElementGroup {
  id: string;
  childIds: string[];
  name: string;
}

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

export interface EditorPresentState {
  elements: BoardElement[];
  groups: ElementGroup[];
  selectedIds: string[];
  activeTool: Tool;
  gridSnapEnabled: boolean;
  viewport: ViewportState;
}

export interface EditorHistoryState {
  past: EditorPresentState[];
  present: EditorPresentState;
  future: EditorPresentState[];
}
