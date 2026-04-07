import {
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Ellipse, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text as KonvaText, Transformer } from 'react-konva';
import { useStageSize } from '../hooks/useStageSize';
import type { BoardElement, ElementGroup, ImageElement, Tool, ViewportState } from '../types/editor';
import type { CanvasBridgeMetrics, CanvasRenderCommand } from '../types/architecture';
import { useSceneRenderModel } from '../renderer/sceneRenderModel';
import {
  getNoteDisplayText,
  normalizeRichText,
  plainTextToRichText,
  richTextToPlainText,
} from '../utils/richText';
import Minimap from './Minimap';

interface Point {
  x: number;
  y: number;
}

interface SnapGuide {
  orientation: 'vertical' | 'horizontal';
  value: number;
}

interface DragSession {
  ownerId: string;
  basePositions: Map<string, Point>;
  pointerStart: Point;
}

interface ActiveElementDragSession {
  session: DragSession;
  moved: boolean;
  elevated: boolean;
}

interface ElementPatchUpdate {
  id: string;
  patch: Partial<BoardElement>;
}

interface CanvasStageProps {
  elements: BoardElement[];
  groups: ElementGroup[];
  selectedIds: string[];
  tool: Tool;
  gridSnapEnabled: boolean;
  renderCommands: CanvasRenderCommand[];
  bridgeMetrics: CanvasBridgeMetrics;
  imageInsertVersion: number;
  viewport: ViewportState;
  onSelectionChange: (ids: string[]) => void;
  onAddElement: (element: BoardElement) => void;
  onPatchElement: (id: string, patch: Partial<BoardElement>, trackHistory?: boolean) => void;
  onPatchElements: (updates: ElementPatchUpdate[], trackHistory?: boolean) => void;
  onBringToFront: (ids: string[], trackHistory?: boolean) => void;
  onViewportChange: (viewport: Partial<ViewportState>) => void;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
const SNAP_THRESHOLD_PX = 8;
const GUIDE_SPAN = 100000;
const GRID_SIZE = 20;
const IMAGE_MAX_SIZE = 420;
const IMAGE_MIN_SIZE = 48;
const DRAW_TOOLS: Tool[] = ['rect', 'ellipse', 'triangle', 'diamond'];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const snapPointToGrid = (point: Point, gridSize: number): Point => ({
  x: Math.round(point.x / gridSize) * gridSize,
  y: Math.round(point.y / gridSize) * gridSize,
});

const getNormalizedBounds = (start: Point, end: Point) => {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  return { x, y, width, height };
};

const isDrawTool = (tool: Tool): boolean => DRAW_TOOLS.includes(tool);

const normalizeImageSize = (width: number, height: number): { width: number; height: number } => {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);

  let scale = 1;
  if (safeWidth > IMAGE_MAX_SIZE || safeHeight > IMAGE_MAX_SIZE) {
    scale = Math.min(IMAGE_MAX_SIZE / safeWidth, IMAGE_MAX_SIZE / safeHeight);
  }

  const nextWidth = Math.round(safeWidth * scale);
  const nextHeight = Math.round(safeHeight * scale);

  return {
    width: Math.max(IMAGE_MIN_SIZE, nextWidth),
    height: Math.max(IMAGE_MIN_SIZE, nextHeight),
  };
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('图片读取失败'));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('图片读取失败'));
    };
    reader.readAsDataURL(file);
  });

const readImageDimension = (src: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      reject(new Error('图片加载失败'));
    };
    image.src = src;
  });

const CanvasImageNode = ({ element }: { element: ImageElement }) => {
  const [imageNode, setImageNode] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    let disposed = false;
    const image = new window.Image();

    image.onload = () => {
      if (!disposed) {
        setImageNode(image);
      }
    };

    image.onerror = () => {
      if (!disposed) {
        setImageNode(null);
      }
    };

    image.src = element.src;

    return () => {
      disposed = true;
    };
  }, [element.src]);

  return (
    <>
      <KonvaImage
        width={element.width}
        height={element.height}
        image={imageNode ?? undefined}
      />
      {element.strokeWidth > 0 ? (
        <Rect
          width={element.width}
          height={element.height}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
          fillEnabled={false}
          listening={false}
        />
      ) : null}
    </>
  );
};

interface ElementNodeHandlers {
  onPointerDown: (
    event: KonvaEventObject<MouseEvent | TouchEvent>,
    id: string,
    currentTool: Tool,
  ) => void;
  onTransformEnd: (event: KonvaEventObject<Event>, element: BoardElement) => void;
  onDoubleClick: (element: BoardElement) => void;
}

interface ElementNodeProps {
  element: BoardElement;
  tool: Tool;
  setNodeRef: (id: string, node: Konva.Group | null) => void;
  handlersRef: MutableRefObject<ElementNodeHandlers>;
}

const ElementNode = memo(
  ({ element, tool, setNodeRef, handlersRef }: ElementNodeProps) => {
    return (
      <Group
        key={element.id}
        id={element.id}
        x={element.x}
        y={element.y}
        rotation={element.rotation}
        ref={(node) => setNodeRef(element.id, node)}
        draggable={false}
        onMouseDown={(event) => handlersRef.current.onPointerDown(event, element.id, tool)}
        onTouchStart={(event) => handlersRef.current.onPointerDown(event, element.id, tool)}
        onTransformEnd={(event) => handlersRef.current.onTransformEnd(event, element)}
        onDblClick={() => handlersRef.current.onDoubleClick(element)}
        onDblTap={() => handlersRef.current.onDoubleClick(element)}
      >
        {element.kind === 'rect' ? (
          <Rect
            width={element.width}
            height={element.height}
            fill={element.fill}
            stroke={element.stroke}
            strokeWidth={element.strokeWidth}
            cornerRadius={8}
          />
        ) : null}

        {element.kind === 'ellipse' ? (
          <Ellipse
            x={element.width / 2}
            y={element.height / 2}
            radiusX={element.width / 2}
            radiusY={element.height / 2}
            fill={element.fill}
            stroke={element.stroke}
            strokeWidth={element.strokeWidth}
          />
        ) : null}

        {element.kind === 'triangle' ? (
          <Line
            points={[element.width / 2, 0, element.width, element.height, 0, element.height]}
            closed
            fill={element.fill}
            stroke={element.stroke}
            strokeWidth={element.strokeWidth}
            lineJoin="round"
          />
        ) : null}

        {element.kind === 'diamond' ? (
          <Line
            points={[
              element.width / 2,
              0,
              element.width,
              element.height / 2,
              element.width / 2,
              element.height,
              0,
              element.height / 2,
            ]}
            closed
            fill={element.fill}
            stroke={element.stroke}
            strokeWidth={element.strokeWidth}
            lineJoin="round"
          />
        ) : null}

        {element.kind === 'image' ? <CanvasImageNode element={element} /> : null}

        {element.kind === 'note' ? (
          <>
            <Rect
              width={element.width}
              height={element.height}
              fill={element.fill}
              stroke={element.stroke}
              strokeWidth={element.strokeWidth}
              cornerRadius={10}
            />
            <KonvaText
              x={12}
              y={10}
              width={Math.max(0, element.width - 24)}
              height={Math.max(0, element.height - 20)}
              text={getNoteDisplayText(element.text, element.richText)}
              fontSize={element.fontSize}
              fill={element.textColor}
              lineHeight={1.35}
              wrap="word"
              listening={false}
            />
          </>
        ) : null}
      </Group>
    );
  },
  (prev, next) => prev.element === next.element && prev.tool === next.tool,
);

const intersectsBounds = (
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
) =>
  first.x <= second.x + second.width &&
  first.x + first.width >= second.x &&
  first.y <= second.y + second.height &&
  first.y + first.height >= second.y;

const createElementId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `element-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const getElementBounds = (element: BoardElement, position?: Point) => {
  const x = position?.x ?? element.x;
  const y = position?.y ?? element.y;

  return {
    x,
    y,
    width: element.width,
    height: element.height,
  };
};

const getAxisPoints = (start: number, size: number) => [start, start + size / 2, start + size];

const getSnapResult = ({
  movingElement,
  candidate,
  elements,
  ignoreIds,
  viewportScale,
}: {
  movingElement: BoardElement;
  candidate: Point;
  elements: BoardElement[];
  ignoreIds: Set<string>;
  viewportScale: number;
}) => {
  const threshold = SNAP_THRESHOLD_PX / Math.max(0.2, viewportScale);
  const movingBounds = getElementBounds(movingElement, candidate);

  const targetVertical: number[] = [0];
  const targetHorizontal: number[] = [0];

  elements.forEach((element) => {
    if (ignoreIds.has(element.id)) {
      return;
    }

    const bounds = getElementBounds(element);
    targetVertical.push(...getAxisPoints(bounds.x, bounds.width));
    targetHorizontal.push(...getAxisPoints(bounds.y, bounds.height));
  });

  let nextX = candidate.x;
  let nextY = candidate.y;
  const guides: SnapGuide[] = [];

  const movingXPoints = getAxisPoints(movingBounds.x, movingBounds.width);
  let bestXDistance = threshold + 1;
  let bestXDelta = 0;
  let bestXGuide: number | null = null;

  movingXPoints.forEach((movingPoint) => {
    targetVertical.forEach((targetPoint) => {
      const distance = Math.abs(targetPoint - movingPoint);
      if (distance < bestXDistance) {
        bestXDistance = distance;
        bestXDelta = targetPoint - movingPoint;
        bestXGuide = targetPoint;
      }
    });
  });

  if (bestXGuide !== null) {
    nextX += bestXDelta;
    guides.push({ orientation: 'vertical', value: bestXGuide });
  }

  const movingYPoints = getAxisPoints(movingBounds.y, movingBounds.height);
  let bestYDistance = threshold + 1;
  let bestYDelta = 0;
  let bestYGuide: number | null = null;

  movingYPoints.forEach((movingPoint) => {
    targetHorizontal.forEach((targetPoint) => {
      const distance = Math.abs(targetPoint - movingPoint);
      if (distance < bestYDistance) {
        bestYDistance = distance;
        bestYDelta = targetPoint - movingPoint;
        bestYGuide = targetPoint;
      }
    });
  });

  if (bestYGuide !== null) {
    nextY += bestYDelta;
    guides.push({ orientation: 'horizontal', value: bestYGuide });
  }

  return {
    x: nextX,
    y: nextY,
    guides,
  };
};

const toWorldPoint = (stage: Konva.Stage, viewport: ViewportState): Point | null => {
  const pointer = stage.getPointerPosition();
  if (!pointer) {
    return null;
  }

  return {
    x: (pointer.x - viewport.x) / viewport.scale,
    y: (pointer.y - viewport.y) / viewport.scale,
  };
};

export const CanvasStage = ({
  elements,
  groups,
  selectedIds,
  tool,
  gridSnapEnabled,
  renderCommands,
  bridgeMetrics,
  imageInsertVersion,
  viewport,
  onSelectionChange,
  onAddElement,
  onPatchElement,
  onPatchElements,
  onBringToFront,
  onViewportChange,
}: CanvasStageProps) => {
  const { containerRef, size } = useStageSize<HTMLDivElement>();
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const nodeRefs = useRef<Map<string, Konva.Group>>(new Map());
  const activeElementDragRef = useRef<ActiveElementDragSession | null>(null);
  const marqueeAppendRef = useRef(false);
  const latestPointerWorldRef = useRef<Point | null>(null);
  const imageUploadInputRef = useRef<HTMLInputElement | null>(null);
  const lastImageInsertVersionRef = useRef(0);
  const pendingImagePointRef = useRef<Point | null>(null);
  const inlineEditorRootRef = useRef<HTMLDivElement | null>(null);
  const inlineEditorBodyRef = useRef<HTMLDivElement | null>(null);
  const [drawingStart, setDrawingStart] = useState<Point | null>(null);
  const [drawingCurrent, setDrawingCurrent] = useState<Point | null>(null);
  const [marqueeStart, setMarqueeStart] = useState<Point | null>(null);
  const [marqueeCurrent, setMarqueeCurrent] = useState<Point | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const elementNodeHandlersRef = useRef<ElementNodeHandlers>({
    onPointerDown: () => undefined,
    onTransformEnd: () => undefined,
    onDoubleClick: () => undefined,
  });
  const renderElements = useSceneRenderModel(elements, renderCommands);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const elementsById = useMemo(
    () => new Map(renderElements.map((element) => [element.id, element] as const)),
    [renderElements],
  );
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group] as const)), [groups]);
  const editingNote = useMemo(() => {
    if (!editingNoteId) {
      return null;
    }

    const target = elementsById.get(editingNoteId);
    return target && target.kind === 'note' ? target : null;
  }, [editingNoteId, elementsById]);

  const editingNoteStyle = useMemo(() => {
    if (!editingNote) {
      return null;
    }

    return {
      left: editingNote.x * viewport.scale + viewport.x,
      top: editingNote.y * viewport.scale + viewport.y,
      width: Math.max(180, editingNote.width * viewport.scale),
      minHeight: Math.max(120, editingNote.height * viewport.scale),
    };
  }, [editingNote, viewport.scale, viewport.x, viewport.y]);

  const draftBounds = useMemo(() => {
    if (!drawingStart || !drawingCurrent) {
      return null;
    }
    return getNormalizedBounds(drawingStart, drawingCurrent);
  }, [drawingCurrent, drawingStart]);

  const marqueeBounds = useMemo(() => {
    if (!marqueeStart || !marqueeCurrent) {
      return null;
    }
    return getNormalizedBounds(marqueeStart, marqueeCurrent);
  }, [marqueeCurrent, marqueeStart]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    if (selectedIds.length === 1) {
      const node = nodeRefs.current.get(selectedIds[0]);
      transformer.nodes(node ? [node] : []);
    } else {
      transformer.nodes([]);
    }

    transformer.getLayer()?.batchDraw();
  }, [renderElements, selectedIds]);

  useEffect(() => {
    if (imageInsertVersion <= 0 || imageInsertVersion === lastImageInsertVersionRef.current) {
      return;
    }

    lastImageInsertVersionRef.current = imageInsertVersion;

    const centerPoint = {
      x: (-viewport.x + Math.max(1, size.width) / 2) / viewport.scale,
      y: (-viewport.y + Math.max(1, size.height) / 2) / viewport.scale,
    };

    pendingImagePointRef.current = gridSnapEnabled ? snapPointToGrid(centerPoint, GRID_SIZE) : centerPoint;
    imageUploadInputRef.current?.click();
  }, [gridSnapEnabled, imageInsertVersion, size.height, size.width, viewport.scale, viewport.x, viewport.y]);

  useEffect(() => {
    if (!editingNoteId || !inlineEditorBodyRef.current) {
      return;
    }

    const target = elementsById.get(editingNoteId);
    if (!target || target.kind !== 'note') {
      return;
    }

    const editor = inlineEditorBodyRef.current;
    editor.innerHTML = normalizeRichText(target.richText);

    requestAnimationFrame(() => {
      editor.focus();

      const selection = window.getSelection();
      if (!selection) {
        return;
      }

      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    });
  }, [editingNoteId, elementsById]);

  const setNodeRef = (id: string, node: Konva.Group | null) => {
    if (node) {
      nodeRefs.current.set(id, node);
      return;
    }
    nodeRefs.current.delete(id);
  };

  const getSelectionForElement = (id: string): string[] => {
    const element = elementsById.get(id);
    if (element?.groupId) {
      const group = groupsById.get(element.groupId);
      if (group && group.childIds.length > 0) {
        return group.childIds;
      }
    }

    return [id];
  };

  const createDragSession = (
    ownerId: string,
    memberIds: string[],
    pointerStart: Point,
  ): DragSession | null => {
    const basePositions = new Map<string, Point>();

    memberIds.forEach((memberId) => {
      const element = elementsById.get(memberId);
      if (!element) {
        return;
      }

      basePositions.set(memberId, { x: element.x, y: element.y });
    });

    if (!basePositions.has(ownerId)) {
      const owner = elementsById.get(ownerId);
      if (owner) {
        basePositions.set(ownerId, { x: owner.x, y: owner.y });
      }
    }

    if (basePositions.size === 0) {
      return null;
    }

    return {
      ownerId,
      basePositions,
      pointerStart,
    };
  };

  const runDragSession = (session: DragSession, pointerWorld: Point, trackHistory: boolean) => {
    const ownerBase = session.basePositions.get(session.ownerId);
    if (!ownerBase) {
      return;
    }

    const ownerElement = elementsById.get(session.ownerId);
    if (!ownerElement) {
      return;
    }

    const delta = {
      x: pointerWorld.x - session.pointerStart.x,
      y: pointerWorld.y - session.pointerStart.y,
    };

    const ownerCandidate = {
      x: ownerBase.x + delta.x,
      y: ownerBase.y + delta.y,
    };

    if (session.basePositions.size === 1) {
      if (gridSnapEnabled) {
        const snapped = snapPointToGrid(ownerCandidate, GRID_SIZE);
        onPatchElement(session.ownerId, { x: snapped.x, y: snapped.y }, trackHistory);
        setSnapGuides([]);
        return;
      }

      const snapped = getSnapResult({
        movingElement: ownerElement,
        candidate: ownerCandidate,
        elements,
        ignoreIds: new Set([session.ownerId]),
        viewportScale: viewport.scale,
      });

      onPatchElement(session.ownerId, { x: snapped.x, y: snapped.y }, trackHistory);
      setSnapGuides(snapped.guides);
      return;
    }

    let nextDx = delta.x;
    let nextDy = delta.y;

    if (gridSnapEnabled) {
      const snappedOwner = snapPointToGrid(ownerCandidate, GRID_SIZE);
      nextDx = snappedOwner.x - ownerBase.x;
      nextDy = snappedOwner.y - ownerBase.y;
    }

    const updates: ElementPatchUpdate[] = [];
    session.basePositions.forEach((position, id) => {
      updates.push({
        id,
        patch: {
          x: position.x + nextDx,
          y: position.y + nextDy,
        },
      });
    });

    setSnapGuides([]);
    onPatchElements(updates, trackHistory);
  };

  const handleElementPointerDown = (
    event: KonvaEventObject<MouseEvent | TouchEvent>,
    id: string,
    currentTool: Tool,
  ) => {
    if (currentTool !== 'select') {
      return;
    }

    event.cancelBubble = true;

    const stage = event.target.getStage();
    const pointerWorld = stage ? toWorldPoint(stage, viewport) : null;
    if (!pointerWorld) {
      return;
    }
    latestPointerWorldRef.current = pointerWorld;

    const shiftKey = 'shiftKey' in event.evt ? event.evt.shiftKey : false;
    if (shiftKey) {
      activeElementDragRef.current = null;
      if (selectedIdSet.has(id)) {
        onSelectionChange(selectedIds.filter((item) => item !== id));
      } else {
        onSelectionChange([...selectedIds, id]);
      }
      return;
    }

    const nextSelection = getSelectionForElement(id);
    if (nextSelection.length !== selectedIds.length || nextSelection.some((item) => !selectedIdSet.has(item))) {
      onSelectionChange(nextSelection);
    }

    const session = createDragSession(id, nextSelection, pointerWorld);
    if (!session) {
      return;
    }

    activeElementDragRef.current = {
      session,
      moved: false,
      elevated: false,
    };
  };

  const syncInlineEditor = (trackHistory: boolean) => {
    if (!editingNote || !inlineEditorBodyRef.current) {
      return;
    }

    const richText = normalizeRichText(inlineEditorBodyRef.current.innerHTML);
    const plainText = richTextToPlainText(richText);

    onPatchElement(
      editingNote.id,
      {
        richText,
        text: plainText,
      },
      trackHistory,
    );
  };

  const commitInlineEditor = (trackHistory: boolean) => {
    if (!editingNote) {
      setEditingNoteId(null);
      return;
    }

    syncInlineEditor(trackHistory);
    setEditingNoteId(null);
  };

  const runInlineCommand = (command: string, value?: string) => {
    if (!editingNote || !inlineEditorBodyRef.current) {
      return;
    }

    inlineEditorBodyRef.current.focus();
    document.execCommand(command, false, value);
    syncInlineEditor(false);
  };

  const handleInlineEditorBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && inlineEditorRootRef.current?.contains(nextTarget)) {
      return;
    }

    commitInlineEditor(true);
  };

  const handleInlineEditorKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      commitInlineEditor(true);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setEditingNoteId(null);
    }
  };

  const handleImageUploadChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      pendingImagePointRef.current = null;
      return;
    }

    const targetPoint =
      pendingImagePointRef.current ?? {
        x: (-viewport.x + Math.max(1, size.width) / 2) / viewport.scale,
        y: (-viewport.y + Math.max(1, size.height) / 2) / viewport.scale,
      };
    pendingImagePointRef.current = null;

    try {
      const src = await readFileAsDataUrl(file);
      const imageSize = await readImageDimension(src);
      const normalizedSize = normalizeImageSize(imageSize.width, imageSize.height);

      onAddElement({
        id: createElementId(),
        kind: 'image',
        x: targetPoint.x,
        y: targetPoint.y,
        width: normalizedSize.width,
        height: normalizedSize.height,
        rotation: 0,
        fill: '#ffffff',
        stroke: '#0b7285',
        strokeWidth: 1.5,
        src,
      });
    } catch {
      window.alert('图片读取失败，请重试。');
    }
  };

  const handleStagePointerDown = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = event.target.getStage();
    if (!stage) {
      return;
    }

    const clickedEmptySpace = event.target === stage;
    const worldPoint = toWorldPoint(stage, viewport);
    if (!worldPoint) {
      return;
    }
    latestPointerWorldRef.current = worldPoint;

    const snappedPoint = gridSnapEnabled ? snapPointToGrid(worldPoint, GRID_SIZE) : worldPoint;

    if (editingNoteId && clickedEmptySpace) {
      commitInlineEditor(true);
    }

    if (tool === 'note' && clickedEmptySpace) {
      onAddElement({
        id: createElementId(),
        kind: 'note',
        x: snappedPoint.x,
        y: snappedPoint.y,
        width: 220,
        height: 140,
        rotation: 0,
        fill: '#fef4d6',
        stroke: '#9b8a35',
        strokeWidth: 1.5,
        text: '在属性面板中编辑富文本',
        richText: plainTextToRichText('在属性面板中编辑富文本'),
        fontSize: 18,
        textColor: '#3a3416',
      });
      return;
    }

    if (isDrawTool(tool) && clickedEmptySpace) {
      setDrawingStart(snappedPoint);
      setDrawingCurrent(snappedPoint);
      setMarqueeStart(null);
      setMarqueeCurrent(null);
      return;
    }

    if (tool === 'select' && clickedEmptySpace) {
      activeElementDragRef.current = null;
      const appendSelection = 'shiftKey' in event.evt ? event.evt.shiftKey : false;
      marqueeAppendRef.current = appendSelection;
      setMarqueeStart(worldPoint);
      setMarqueeCurrent(worldPoint);
      if (!appendSelection) {
        onSelectionChange([]);
      }
    }
  };

  const handleStagePointerMove = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = event.target.getStage();
    if (!stage) {
      return;
    }

    const worldPoint = toWorldPoint(stage, viewport);
    if (!worldPoint) {
      return;
    }
    latestPointerWorldRef.current = worldPoint;

    const activeDrag = activeElementDragRef.current;
    if (activeDrag) {
      const threshold = 3 / Math.max(0.2, viewport.scale);
      const distance = Math.hypot(
        worldPoint.x - activeDrag.session.pointerStart.x,
        worldPoint.y - activeDrag.session.pointerStart.y,
      );

      if (!activeDrag.moved && distance < threshold) {
        return;
      }

      activeDrag.moved = true;
      if (!activeDrag.elevated) {
        onBringToFront(Array.from(activeDrag.session.basePositions.keys()), false);
        activeDrag.elevated = true;
      }
      runDragSession(activeDrag.session, worldPoint, false);
      return;
    }

    if (tool === 'select' && marqueeStart) {
      setMarqueeCurrent(worldPoint);
      return;
    }

    if (!drawingStart || !isDrawTool(tool)) {
      return;
    }

    setDrawingCurrent(gridSnapEnabled ? snapPointToGrid(worldPoint, GRID_SIZE) : worldPoint);
  };

  const handleStagePointerUp = () => {
    const activeDrag = activeElementDragRef.current;
    if (activeDrag) {
      if (activeDrag.moved) {
        const pointerWorld = latestPointerWorldRef.current ?? activeDrag.session.pointerStart;
        runDragSession(activeDrag.session, pointerWorld, true);
      }

      activeElementDragRef.current = null;
      setSnapGuides([]);
      return;
    }

    if (tool === 'select' && marqueeStart && marqueeCurrent) {
      const bounds = getNormalizedBounds(marqueeStart, marqueeCurrent);
      const shouldAppend = marqueeAppendRef.current;
      marqueeAppendRef.current = false;
      setMarqueeStart(null);
      setMarqueeCurrent(null);

      if (bounds.width < 4 && bounds.height < 4) {
        return;
      }

      const hits = renderElements
        .filter((element) => intersectsBounds(bounds, getElementBounds(element)))
        .flatMap((element) => {
          if (!element.groupId) {
            return [element.id];
          }

          const group = groupsById.get(element.groupId);
          if (!group || group.childIds.length === 0) {
            return [element.id];
          }

          return group.childIds;
        });

      const nextSelected = Array.from(new Set(hits));

      if (shouldAppend) {
        onSelectionChange(Array.from(new Set([...selectedIds, ...nextSelected])));
      } else {
        onSelectionChange(nextSelected);
      }

      return;
    }

    if (!drawingStart || !drawingCurrent || !isDrawTool(tool)) {
      setDrawingStart(null);
      setDrawingCurrent(null);
      return;
    }

    const bounds = getNormalizedBounds(drawingStart, drawingCurrent);
    setDrawingStart(null);
    setDrawingCurrent(null);

    if (bounds.width < 8 || bounds.height < 8) {
      return;
    }

    if (tool === 'rect') {
      onAddElement({
        id: createElementId(),
        kind: 'rect',
        ...bounds,
        rotation: 0,
        fill: '#99e9f2',
        stroke: '#0b7285',
        strokeWidth: 2,
      });
      return;
    }

    if (tool === 'ellipse') {
      onAddElement({
        id: createElementId(),
        kind: 'ellipse',
        ...bounds,
        rotation: 0,
        fill: '#ffc9c9',
        stroke: '#c92a2a',
        strokeWidth: 2,
      });
      return;
    }

    if (tool === 'triangle') {
      onAddElement({
        id: createElementId(),
        kind: 'triangle',
        ...bounds,
        rotation: 0,
        fill: '#ffe8cc',
        stroke: '#e67700',
        strokeWidth: 2,
      });
      return;
    }

    onAddElement({
      id: createElementId(),
      kind: 'diamond',
      ...bounds,
      rotation: 0,
      fill: '#d3f9d8',
      stroke: '#2b8a3e',
      strokeWidth: 2,
    });
  };

  const handleElementTransformEnd = (event: KonvaEventObject<Event>, element: BoardElement) => {
    if (selectedIds.length !== 1 || selectedIds[0] !== element.id) {
      return;
    }

    const node = event.target as Konva.Group;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    node.scaleX(1);
    node.scaleY(1);

    const minWidth = element.kind === 'note' ? 80 : 20;
    const minHeight = element.kind === 'note' ? 60 : 20;

    onPatchElement(
      element.id,
      {
        x: node.x(),
        y: node.y(),
        width: Math.max(minWidth, element.width * scaleX),
        height: Math.max(minHeight, element.height * scaleY),
        rotation: node.rotation(),
      },
      true,
    );
  };

  const handleElementDoubleClick = (element: BoardElement) => {
    if (element.kind !== 'note') {
      return;
    }

    onSelectionChange([element.id]);
    setEditingNoteId(element.id);
  };

  elementNodeHandlersRef.current = {
    onPointerDown: handleElementPointerDown,
    onTransformEnd: handleElementTransformEnd,
    onDoubleClick: handleElementDoubleClick,
  };

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();

    if (!(event.evt.ctrlKey || event.evt.metaKey)) {
      onViewportChange({
        x: viewport.x - event.evt.deltaX,
        y: viewport.y - event.evt.deltaY,
      });
      return;
    }

    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return;
    }

    const oldScale = viewport.scale;
    const zoomFactor = event.evt.deltaY > 0 ? 0.92 : 1.08;
    const nextScale = clamp(oldScale * zoomFactor, MIN_SCALE, MAX_SCALE);

    const worldPos = {
      x: (pointer.x - viewport.x) / oldScale,
      y: (pointer.y - viewport.y) / oldScale,
    };

    onViewportChange({
      scale: nextScale,
      x: pointer.x - worldPos.x * nextScale,
      y: pointer.y - worldPos.y * nextScale,
    });
  };

  const handleStageDragEnd = (event: KonvaEventObject<DragEvent>) => {
    const stage = event.target as Konva.Stage;
    onViewportChange({ x: stage.x(), y: stage.y() });
  };

  const handleStageDragMove = (event: KonvaEventObject<DragEvent>) => {
    const stage = event.target as Konva.Stage;
    onViewportChange({ x: stage.x(), y: stage.y() });
  };

  return (
    <div className="stage-shell" ref={containerRef}>
      <Stage
        ref={stageRef}
        width={Math.max(1, size.width)}
        height={Math.max(1, size.height)}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable={tool === 'pan'}
        onDragMove={handleStageDragMove}
        onDragEnd={handleStageDragEnd}
        onMouseDown={handleStagePointerDown}
        onMouseMove={handleStagePointerMove}
        onMouseUp={handleStagePointerUp}
        onTouchStart={handleStagePointerDown}
        onTouchMove={handleStagePointerMove}
        onTouchEnd={handleStagePointerUp}
        onWheel={handleWheel}
      >
        <Layer>
          {renderElements.map((element) => {
            return (
              <ElementNode
                key={element.id}
                element={element}
                tool={tool}
                setNodeRef={setNodeRef}
                handlersRef={elementNodeHandlersRef}
              />
            );
          })}

          {draftBounds && tool === 'rect' ? (
            <Rect
              x={draftBounds.x}
              y={draftBounds.y}
              width={draftBounds.width}
              height={draftBounds.height}
              stroke="#1864ab"
              dash={[8, 4]}
              fill="rgba(28,126,214,0.15)"
            />
          ) : null}

          {draftBounds && tool === 'ellipse' ? (
            <Ellipse
              x={draftBounds.x + draftBounds.width / 2}
              y={draftBounds.y + draftBounds.height / 2}
              radiusX={draftBounds.width / 2}
              radiusY={draftBounds.height / 2}
              stroke="#f76707"
              dash={[8, 4]}
              fill="rgba(247,103,7,0.16)"
            />
          ) : null}

          {draftBounds && tool === 'triangle' ? (
            <Line
              points={[
                draftBounds.x + draftBounds.width / 2,
                draftBounds.y,
                draftBounds.x + draftBounds.width,
                draftBounds.y + draftBounds.height,
                draftBounds.x,
                draftBounds.y + draftBounds.height,
              ]}
              closed
              stroke="#e67700"
              dash={[8, 4]}
              fill="rgba(230,119,0,0.16)"
            />
          ) : null}

          {draftBounds && tool === 'diamond' ? (
            <Line
              points={[
                draftBounds.x + draftBounds.width / 2,
                draftBounds.y,
                draftBounds.x + draftBounds.width,
                draftBounds.y + draftBounds.height / 2,
                draftBounds.x + draftBounds.width / 2,
                draftBounds.y + draftBounds.height,
                draftBounds.x,
                draftBounds.y + draftBounds.height / 2,
              ]}
              closed
              stroke="#2b8a3e"
              dash={[8, 4]}
              fill="rgba(43,138,62,0.18)"
            />
          ) : null}

          {marqueeBounds && tool === 'select' ? (
            <Rect
              x={marqueeBounds.x}
              y={marqueeBounds.y}
              width={marqueeBounds.width}
              height={marqueeBounds.height}
              stroke="rgba(12, 133, 153, 0.95)"
              dash={[8, 4]}
              fill="rgba(12, 133, 153, 0.14)"
              listening={false}
            />
          ) : null}

          {snapGuides.map((guide, index) => {
            const guideThickness = 1.2 / viewport.scale;

            if (guide.orientation === 'vertical') {
              return (
                <Rect
                  key={`guide-v-${index}`}
                  x={guide.value - guideThickness / 2}
                  y={-GUIDE_SPAN / 2}
                  width={guideThickness}
                  height={GUIDE_SPAN}
                  fill="rgba(12, 133, 153, 0.72)"
                  listening={false}
                />
              );
            }

            return (
              <Rect
                key={`guide-h-${index}`}
                x={-GUIDE_SPAN / 2}
                y={guide.value - guideThickness / 2}
                width={GUIDE_SPAN}
                height={guideThickness}
                fill="rgba(12, 133, 153, 0.72)"
                listening={false}
              />
            );
          })}

          <Transformer
            ref={transformerRef}
            rotateEnabled={selectedIds.length === 1}
            enabledAnchors={[
              'top-left',
              'top-center',
              'top-right',
              'middle-left',
              'middle-right',
              'bottom-left',
              'bottom-center',
              'bottom-right',
            ]}
            borderStroke="#0c8599"
            anchorStroke="#0c8599"
            anchorFill="#e3fafc"
            anchorSize={10}
            borderDash={[5, 4]}
            boundBoxFunc={(oldBox, newBox) => {
              if (newBox.width < 20 || newBox.height < 20) {
                return oldBox;
              }
              return newBox;
            }}
          />
        </Layer>
      </Stage>

      <input
        ref={imageUploadInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/*"
        onChange={handleImageUploadChange}
      />

      {editingNote && editingNoteStyle ? (
        <div className="note-inline-editor" ref={inlineEditorRootRef} style={editingNoteStyle}>
          <div className="note-inline-toolbar">
            <button
              type="button"
              className="tool-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runInlineCommand('bold')}
            >
              B
            </button>
            <button
              type="button"
              className="tool-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runInlineCommand('italic')}
            >
              I
            </button>
            <button
              type="button"
              className="tool-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runInlineCommand('underline')}
            >
              U
            </button>
            <button
              type="button"
              className="tool-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runInlineCommand('insertUnorderedList')}
            >
              列表
            </button>
            <button
              type="button"
              className="tool-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runInlineCommand('justifyLeft')}
            >
              左
            </button>
            <button
              type="button"
              className="tool-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runInlineCommand('justifyCenter')}
            >
              中
            </button>
            <button
              type="button"
              className="tool-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runInlineCommand('justifyRight')}
            >
              右
            </button>
            <button
              type="button"
              className="tool-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (!inlineEditorBodyRef.current) {
                  return;
                }
                const plain = richTextToPlainText(inlineEditorBodyRef.current.innerHTML);
                const normalized = plainTextToRichText(plain);
                inlineEditorBodyRef.current.innerHTML = normalized;
                syncInlineEditor(true);
              }}
            >
              清除格式
            </button>
            <button
              type="button"
              className="tool-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitInlineEditor(true)}
            >
              完成
            </button>
            <button
              type="button"
              className="tool-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setEditingNoteId(null);
              }}
            >
              取消
            </button>
          </div>
          <div
            ref={inlineEditorBodyRef}
            className="note-inline-content"
            contentEditable
            suppressContentEditableWarning
            onInput={() => {
              syncInlineEditor(false);
            }}
            onBlur={handleInlineEditorBlur}
            onKeyDown={handleInlineEditorKeyDown}
          />
        </div>
      ) : null}

      <div className="stage-overlay">
        <span>
          工具: {tool} | 选择模式拖动对象，平移工具拖动画布，Ctrl/Meta + 滚轮缩放，滚轮平移，拖拽吸附（网格 {gridSnapEnabled ? '开' : '关'}，G 切换），I 或图片按钮直接插图
        </span>
        <span>
          Bridge: {bridgeMetrics.commandCount} cmds（+{bridgeMetrics.createCount} / ~{bridgeMetrics.updateCount} / -{bridgeMetrics.deleteCount}） | reconcile {bridgeMetrics.reconcileMs.toFixed(2)}ms / avg {bridgeMetrics.averageReconcileMs.toFixed(2)}ms / max {bridgeMetrics.maxReconcileMs.toFixed(2)}ms
        </span>
      </div>

      <Minimap
        elements={renderElements}
        selectedIds={selectedIds}
        renderCommands={renderCommands}
        viewport={viewport}
        stageSize={size}
        onViewportChange={onViewportChange}
      />
    </div>
  );
};
