import type { ViewportState } from '../../types/editor';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

interface StagePointerProvider {
  getPointerPosition(): { x: number; y: number } | null;
}

export class CoordinateTransformer {
  screenToWorld(point: ScreenPoint, viewport: ViewportState): WorldPoint {
    const scale = viewport.scale || 1;
    return {
      x: (point.x - viewport.x) / scale,
      y: (point.y - viewport.y) / scale,
    };
  }

  worldToScreen(point: WorldPoint, viewport: ViewportState): ScreenPoint {
    const scale = viewport.scale || 1;
    return {
      x: point.x * scale + viewport.x,
      y: point.y * scale + viewport.y,
    };
  }

  stagePointerToScreen(stage: StagePointerProvider): ScreenPoint | null {
    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return null;
    }

    return {
      x: pointer.x,
      y: pointer.y,
    };
  }
}
