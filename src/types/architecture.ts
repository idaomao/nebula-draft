import type { BoardElement, EditorPresentState, ViewportState } from './editor';

export type CanvasRenderCommand =
  | { type: 'create-element'; element: BoardElement }
  | { type: 'update-element'; id: string; patch: Partial<BoardElement> }
  | { type: 'delete-element'; id: string }
  | { type: 'replace-selection'; selectedIds: string[] }
  | { type: 'update-viewport'; viewport: ViewportState }
  | { type: 'update-ui'; activeTool: EditorPresentState['activeTool']; gridSnapEnabled: boolean };

export interface CanvasBridgeSnapshot {
  present: EditorPresentState;
  elementById: Map<string, BoardElement>;
  commands: CanvasRenderCommand[];
}

export interface CanvasBridgeMetrics {
  reconcileMs: number;
  averageReconcileMs: number;
  maxReconcileMs: number;
  commandCount: number;
  createCount: number;
  updateCount: number;
  deleteCount: number;
}

export interface CanvasBridgeFrame {
  snapshot: CanvasBridgeSnapshot;
  metrics: CanvasBridgeMetrics;
}
