import { useEffect, useRef } from 'react';
import type { PointerEventHandler } from 'react';
import type { BoardElement, ViewportState } from '../types/editor';
import type { CanvasRenderCommand } from '../types/architecture';

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface MinimapGeometry {
  bounds: Bounds;
  scale: number;
  offsetX: number;
  offsetY: number;
  viewBounds: Bounds;
}

interface MinimapRenderCache {
  width: number;
  height: number;
  dpr: number;
  worldBounds: Bounds | null;
  mapScale: number;
  offsetX: number;
  offsetY: number;
  version: number;
  elementIndex: Map<string, BoardElement>;
}

interface MinimapProps {
  elements: BoardElement[];
  selectedIds: string[];
  renderCommands: CanvasRenderCommand[];
  viewport: ViewportState;
  stageSize: { width: number; height: number };
  onViewportChange: (viewport: Partial<ViewportState>) => void;
  width?: number;
  height?: number;
}

const BACKGROUND_TOP = '#152f3f';
const BACKGROUND_BOTTOM = '#0b1c27';
const GRID_LINE = 'rgba(130, 188, 203, 0.14)';
const BORDER = '#2f5d65';
const WORLD_BORDER = 'rgba(140, 233, 247, 0.35)';
const SELECTED_STROKE = '#8ce9f7';
const VIEWPORT_STROKE = '#9af5ff';
const VIEWPORT_FILL = 'rgba(140, 233, 247, 0.16)';
const VIEWPORT_HANDLE = '#d7fbff';
const DIRTY_PADDING = 3;

const getVisibleBounds = (
  viewport: ViewportState,
  stageSize: { width: number; height: number },
): Bounds => {
  const width = stageSize.width / viewport.scale;
  const height = stageSize.height / viewport.scale;

  return {
    x: -viewport.x / viewport.scale,
    y: -viewport.y / viewport.scale,
    width,
    height,
  };
};

const getWorldBounds = (elements: BoardElement[], visibleBounds: Bounds): Bounds => {
  if (elements.length === 0) {
    return {
      x: visibleBounds.x - 300,
      y: visibleBounds.y - 220,
      width: Math.max(600, visibleBounds.width + 600),
      height: Math.max(440, visibleBounds.height + 440),
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  elements.forEach((element) => {
    minX = Math.min(minX, element.x);
    minY = Math.min(minY, element.y);
    maxX = Math.max(maxX, element.x + element.width);
    maxY = Math.max(maxY, element.y + element.height);
  });

  minX = Math.min(minX, visibleBounds.x);
  minY = Math.min(minY, visibleBounds.y);
  maxX = Math.max(maxX, visibleBounds.x + visibleBounds.width);
  maxY = Math.max(maxY, visibleBounds.y + visibleBounds.height);

  const rawWidth = Math.max(1, maxX - minX);
  const rawHeight = Math.max(1, maxY - minY);
  const padX = Math.max(100, rawWidth * 0.15);
  const padY = Math.max(80, rawHeight * 0.15);

  return {
    x: minX - padX,
    y: minY - padY,
    width: rawWidth + padX * 2,
    height: rawHeight + padY * 2,
  };
};

const areBoundsEqual = (first: Bounds | null, second: Bounds): boolean => {
  if (!first) {
    return false;
  }

  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
};

const intersectsBounds = (first: Bounds, second: Bounds): boolean => {
  return (
    first.x <= second.x + second.width &&
    first.x + first.width >= second.x &&
    first.y <= second.y + second.height &&
    first.y + first.height >= second.y
  );
};

const getElementScreenBounds = (
  element: BoardElement,
  worldBounds: Bounds,
  mapScale: number,
  offsetX: number,
  offsetY: number,
): Bounds => {
  const width = Math.max(1, element.width * mapScale);
  const height = Math.max(1, element.height * mapScale);
  const centerX = offsetX + (element.x - worldBounds.x) * mapScale + width / 2;
  const centerY = offsetY + (element.y - worldBounds.y) * mapScale + height / 2;

  const rad = (element.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const rotatedWidth = width * cos + height * sin;
  const rotatedHeight = width * sin + height * cos;

  return {
    x: centerX - rotatedWidth / 2 - DIRTY_PADDING,
    y: centerY - rotatedHeight / 2 - DIRTY_PADDING,
    width: rotatedWidth + DIRTY_PADDING * 2,
    height: rotatedHeight + DIRTY_PADDING * 2,
  };
};

const drawStaticLayer = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  worldBounds: Bounds,
  mapScale: number,
  offsetX: number,
  offsetY: number,
) => {
  context.clearRect(0, 0, width, height);

  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, BACKGROUND_TOP);
  gradient.addColorStop(1, BACKGROUND_BOTTOM);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const gridStep = 120;
  const worldRight = worldBounds.x + worldBounds.width;
  const worldBottom = worldBounds.y + worldBounds.height;
  const gridStartX = Math.floor(worldBounds.x / gridStep) * gridStep;
  const gridStartY = Math.floor(worldBounds.y / gridStep) * gridStep;

  context.strokeStyle = GRID_LINE;
  context.lineWidth = 1;
  context.beginPath();
  for (let x = gridStartX; x <= worldRight; x += gridStep) {
    const mx = offsetX + (x - worldBounds.x) * mapScale;
    context.moveTo(mx, 0);
    context.lineTo(mx, height);
  }

  for (let y = gridStartY; y <= worldBottom; y += gridStep) {
    const my = offsetY + (y - worldBounds.y) * mapScale;
    context.moveTo(0, my);
    context.lineTo(width, my);
  }
  context.stroke();

  context.strokeStyle = BORDER;
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, width - 1, height - 1);

  context.strokeStyle = WORLD_BORDER;
  context.lineWidth = 1;
  context.strokeRect(
    offsetX + 0.5,
    offsetY + 0.5,
    Math.max(1, worldBounds.width * mapScale - 1),
    Math.max(1, worldBounds.height * mapScale - 1),
  );
};

const drawElement = (
  context: CanvasRenderingContext2D,
  element: BoardElement,
  worldBounds: Bounds,
  mapScale: number,
  offsetX: number,
  offsetY: number,
) => {
  const x = offsetX + (element.x - worldBounds.x) * mapScale;
  const y = offsetY + (element.y - worldBounds.y) * mapScale;
  const elementWidth = Math.max(1, element.width * mapScale);
  const elementHeight = Math.max(1, element.height * mapScale);

  context.save();
  context.translate(x + elementWidth / 2, y + elementHeight / 2);
  context.rotate((element.rotation * Math.PI) / 180);
  context.translate(-elementWidth / 2, -elementHeight / 2);

  context.fillStyle = element.fill;
  context.globalAlpha = 0.78;

  if (element.kind === 'ellipse') {
    context.beginPath();
    context.ellipse(
      elementWidth / 2,
      elementHeight / 2,
      elementWidth / 2,
      elementHeight / 2,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
  } else {
    const radius = element.kind === 'note' ? 4 : 2;
    context.beginPath();
    context.roundRect(0, 0, elementWidth, elementHeight, radius);
    context.fill();
  }

  context.globalAlpha = 1;
  context.strokeStyle = element.stroke;
  context.lineWidth = 0.9;
  context.stroke();
  context.restore();
};

const drawDynamicOverlay = (
  context: CanvasRenderingContext2D,
  elements: BoardElement[],
  selectedIds: string[],
  worldBounds: Bounds,
  mapScale: number,
  offsetX: number,
  offsetY: number,
  visibleBounds: Bounds,
) => {
  const selectedIdSet = new Set(selectedIds);

  elements.forEach((element) => {
    if (!selectedIdSet.has(element.id)) {
      return;
    }

    const x = offsetX + (element.x - worldBounds.x) * mapScale;
    const y = offsetY + (element.y - worldBounds.y) * mapScale;
    const elementWidth = Math.max(1, element.width * mapScale);
    const elementHeight = Math.max(1, element.height * mapScale);

    context.save();
    context.translate(x + elementWidth / 2, y + elementHeight / 2);
    context.rotate((element.rotation * Math.PI) / 180);
    context.translate(-elementWidth / 2, -elementHeight / 2);

    context.strokeStyle = SELECTED_STROKE;
    context.lineWidth = 1.8;
    context.strokeRect(0, 0, elementWidth, elementHeight);

    context.strokeStyle = 'rgba(215, 251, 255, 0.85)';
    context.lineWidth = 1;
    context.strokeRect(-1, -1, elementWidth + 2, elementHeight + 2);
    context.restore();
  });

  const viewX = offsetX + (visibleBounds.x - worldBounds.x) * mapScale;
  const viewY = offsetY + (visibleBounds.y - worldBounds.y) * mapScale;
  const viewWidth = Math.max(8, visibleBounds.width * mapScale);
  const viewHeight = Math.max(8, visibleBounds.height * mapScale);

  context.fillStyle = VIEWPORT_FILL;
  context.beginPath();
  context.roundRect(viewX, viewY, viewWidth, viewHeight, 4);
  context.fill();

  context.strokeStyle = VIEWPORT_STROKE;
  context.lineWidth = 1.4;
  context.stroke();

  const handleSize = 3;
  const handles: Array<Point> = [
    { x: viewX, y: viewY },
    { x: viewX + viewWidth, y: viewY },
    { x: viewX + viewWidth, y: viewY + viewHeight },
    { x: viewX, y: viewY + viewHeight },
  ];

  context.fillStyle = VIEWPORT_HANDLE;
  handles.forEach((handle) => {
    context.fillRect(
      handle.x - handleSize / 2,
      handle.y - handleSize / 2,
      handleSize,
      handleSize,
    );
  });
};

const Minimap = ({
  elements,
  selectedIds,
  renderCommands,
  viewport,
  stageSize,
  onViewportChange,
  width = 190,
  height = 130,
}: MinimapProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const geometryRef = useRef<MinimapGeometry | null>(null);
  const staticLayerRef = useRef<HTMLCanvasElement | null>(null);
  const elementLayerRef = useRef<HTMLCanvasElement | null>(null);
  const renderCacheRef = useRef<MinimapRenderCache>({
    width: 0,
    height: 0,
    dpr: 0,
    worldBounds: null,
    mapScale: 1,
    offsetX: 0,
    offsetY: 0,
    version: 0,
    elementIndex: new Map(),
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || stageSize.width <= 0 || stageSize.height <= 0) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!staticLayerRef.current) {
      staticLayerRef.current = document.createElement('canvas');
    }

    if (!elementLayerRef.current) {
      elementLayerRef.current = document.createElement('canvas');
    }

    const staticLayer = staticLayerRef.current;
    const elementLayer = elementLayerRef.current;
    staticLayer.width = canvas.width;
    staticLayer.height = canvas.height;
    elementLayer.width = canvas.width;
    elementLayer.height = canvas.height;

    const staticContext = staticLayer.getContext('2d');
    const elementContext = elementLayer.getContext('2d');
    if (!staticContext || !elementContext) {
      return;
    }

    staticContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    elementContext.setTransform(dpr, 0, 0, dpr, 0, 0);

    const visibleBounds = getVisibleBounds(viewport, stageSize);
    const worldBounds = getWorldBounds(elements, visibleBounds);
    const mapScale = Math.min(width / worldBounds.width, height / worldBounds.height);
    const offsetX = (width - worldBounds.width * mapScale) / 2;
    const offsetY = (height - worldBounds.height * mapScale) / 2;

    const hasElementMutation = renderCommands.some(
      (command) =>
        command.type === 'create-element' ||
        command.type === 'update-element' ||
        command.type === 'delete-element',
    );

    const renderCache = renderCacheRef.current;
    const worldBoundsChanged = !areBoundsEqual(renderCache.worldBounds, worldBounds);
    const sizeChanged = renderCache.width !== width || renderCache.height !== height;
    const dprChanged = renderCache.dpr !== dpr;
    const fullRebuild = sizeChanged || dprChanged || worldBoundsChanged || renderCache.version === 0;

    const elementById = new Map(elements.map((element) => [element.id, element] as const));

    if (fullRebuild) {
      drawStaticLayer(staticContext, width, height, worldBounds, mapScale, offsetX, offsetY);

      elementContext.clearRect(0, 0, width, height);
      elements.forEach((element) => {
        drawElement(elementContext, element, worldBounds, mapScale, offsetX, offsetY);
      });

      renderCacheRef.current = {
        width,
        height,
        dpr,
        worldBounds,
        mapScale,
        offsetX,
        offsetY,
        version: renderCache.version + 1,
        elementIndex: new Map(elements.map((element) => [element.id, element] as const)),
      };
    } else if (hasElementMutation) {
      const nextElementIndex = new Map(renderCache.elementIndex);
      const dirtyRects: Bounds[] = [];

      renderCommands.forEach((command) => {
        if (command.type === 'create-element') {
          const next = elementById.get(command.element.id);
          if (!next) {
            return;
          }
          nextElementIndex.set(next.id, next);
          dirtyRects.push(getElementScreenBounds(next, worldBounds, mapScale, offsetX, offsetY));
          return;
        }

        if (command.type === 'update-element') {
          const previous = nextElementIndex.get(command.id);
          const next = elementById.get(command.id);

          if (previous) {
            dirtyRects.push(getElementScreenBounds(previous, worldBounds, mapScale, offsetX, offsetY));
          }

          if (next) {
            nextElementIndex.set(next.id, next);
            dirtyRects.push(getElementScreenBounds(next, worldBounds, mapScale, offsetX, offsetY));
          } else {
            nextElementIndex.delete(command.id);
          }
          return;
        }

        if (command.type === 'delete-element') {
          const previous = nextElementIndex.get(command.id);
          if (!previous) {
            return;
          }
          dirtyRects.push(getElementScreenBounds(previous, worldBounds, mapScale, offsetX, offsetY));
          nextElementIndex.delete(command.id);
        }
      });

      const shouldFallbackFullRedraw = dirtyRects.length > 24;

      if (shouldFallbackFullRedraw) {
        elementContext.clearRect(0, 0, width, height);
        nextElementIndex.forEach((element) => {
          drawElement(elementContext, element, worldBounds, mapScale, offsetX, offsetY);
        });
      } else if (dirtyRects.length > 0) {
        dirtyRects.forEach((rect) => {
          elementContext.clearRect(rect.x, rect.y, rect.width, rect.height);
        });

        const nextElements = Array.from(nextElementIndex.values());
        nextElements.forEach((element) => {
          const elementRect = getElementScreenBounds(element, worldBounds, mapScale, offsetX, offsetY);
          if (dirtyRects.some((dirtyRect) => intersectsBounds(elementRect, dirtyRect))) {
            drawElement(elementContext, element, worldBounds, mapScale, offsetX, offsetY);
          }
        });
      }

      renderCacheRef.current = {
        ...renderCache,
        mapScale,
        offsetX,
        offsetY,
        elementIndex: nextElementIndex,
      };
    }

    geometryRef.current = {
      bounds: worldBounds,
      scale: mapScale,
      offsetX,
      offsetY,
      viewBounds: visibleBounds,
    };

    context.clearRect(0, 0, width, height);

    context.drawImage(staticLayer, 0, 0, width, height);
    context.drawImage(elementLayer, 0, 0, width, height);
    drawDynamicOverlay(context, elements, selectedIds, worldBounds, mapScale, offsetX, offsetY, visibleBounds);
  }, [elements, height, renderCommands, selectedIds, stageSize, viewport, width]);

  const updateViewportFromPointer = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const geometry = geometryRef.current;

    if (!canvas || !geometry) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const worldX = geometry.bounds.x + (x - geometry.offsetX) / geometry.scale;
    const worldY = geometry.bounds.y + (y - geometry.offsetY) / geometry.scale;

    const targetViewX = worldX - geometry.viewBounds.width / 2;
    const targetViewY = worldY - geometry.viewBounds.height / 2;

    onViewportChange({
      x: -targetViewX * viewport.scale,
      y: -targetViewY * viewport.scale,
    });
  };

  const handlePointerDown: PointerEventHandler<HTMLCanvasElement> = (event) => {
    event.preventDefault();
    updateViewportFromPointer(event.clientX, event.clientY);

    const onMove = (moveEvent: PointerEvent) => {
      if ((moveEvent.buttons & 1) === 0) {
        return;
      }
      updateViewportFromPointer(moveEvent.clientX, moveEvent.clientY);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="minimap" aria-label="minimap">
      <div className="minimap-title">小地图</div>
      <canvas ref={canvasRef} className="minimap-canvas" onPointerDown={handlePointerDown} />
    </div>
  );
};

export default Minimap;
