import type { BoardElement, ElementGroup } from '../../types/editor';
import type {
  CanvasEventPhase,
  CanvasEventTarget,
  CanvasEventType,
  CanvasStageEvent,
} from '../../lib/EventBridge';

interface ListenerEntry {
  target: CanvasEventTarget;
  phase: CanvasEventPhase;
  priority: number;
  handler: (event: CanvasStageEvent) => void;
}

interface SceneSnapshot {
  elements: BoardElement[];
  groups: ElementGroup[];
}

const STAGE_TARGET: CanvasEventTarget = { type: 'stage', id: 'stage' };

const getBounds = (element: BoardElement) => ({
  x: element.x,
  y: element.y,
  width: element.width,
  height: element.height,
});

const containsPoint = (
  point: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
): boolean => {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
};

const targetKey = (target: CanvasEventTarget): string => `${target.type}:${target.id}`;

const cloneForTarget = (
  source: CanvasStageEvent,
  currentTarget: CanvasEventTarget,
  phase: CanvasEventPhase,
): CanvasStageEvent => ({
  ...source,
  phase,
  currentTarget,
});

export class CanvasEventSystem {
  private listeners = new Map<CanvasEventType, ListenerEntry[]>();

  private scene: SceneSnapshot = { elements: [], groups: [] };

  updateScene(elements: BoardElement[], groups: ElementGroup[]): void {
    this.scene = { elements, groups };
  }

  on(
    type: CanvasEventType,
    target: CanvasEventTarget,
    phase: CanvasEventPhase,
    handler: (event: CanvasStageEvent) => void,
    priority = 0,
  ): () => void {
    const list = this.listeners.get(type) ?? [];
    const entry: ListenerEntry = { target, phase, priority, handler };
    list.push(entry);
    this.listeners.set(type, list);

    return () => {
      const current = this.listeners.get(type) ?? [];
      const next = current.filter((item) => item !== entry);
      this.listeners.set(type, next);
    };
  }

  hitTest(world: { x: number; y: number }): CanvasEventTarget {
    const hit = this.scene.elements.reduce<BoardElement | null>((candidate, element) => {
      if (!containsPoint(world, getBounds(element))) {
        return candidate;
      }

      // renderElements 已按显示层级排序，后面的元素在视觉上更靠上。
      return element;
    }, null);

    if (!hit) {
      return STAGE_TARGET;
    }

    return {
      type: 'element',
      id: hit.id,
    };
  }

  dispatch(event: CanvasStageEvent): void {
    const path = event.type.startsWith('pointer') ? this.buildPath(event.target) : [STAGE_TARGET];
    const listeners = this.listeners.get(event.type) ?? [];
    const listenerMap = new Map<string, ListenerEntry[]>();

    listeners.forEach((entry) => {
      const key = `${entry.phase}:${targetKey(entry.target)}`;
      const list = listenerMap.get(key) ?? [];
      list.push(entry);
      listenerMap.set(key, list);
    });

    const callListeners = (phase: CanvasEventPhase, currentTarget: CanvasEventTarget) => {
      const key = `${phase}:${targetKey(currentTarget)}`;
      const targetListeners = (listenerMap.get(key) ?? []).sort(
        (first, second) => second.priority - first.priority,
      );

      for (const entry of targetListeners) {
        if (event.stopped) {
          return;
        }
        const phaseEvent = cloneForTarget(event, currentTarget, phase);
        entry.handler(phaseEvent);
      }
    };

    for (let index = 0; index < path.length - 1; index += 1) {
      callListeners('capture', path[index]);
      if (event.stopped) {
        return;
      }
    }

    const target = path[path.length - 1] ?? STAGE_TARGET;
    callListeners('target', target);
    if (event.stopped) {
      return;
    }

    for (let index = path.length - 2; index >= 0; index -= 1) {
      callListeners('bubble', path[index]);
      if (event.stopped) {
        return;
      }
    }
  }

  private buildPath(target: CanvasEventTarget): CanvasEventTarget[] {
    if (target.type !== 'element') {
      return [STAGE_TARGET];
    }

    const element = this.scene.elements.find((item) => item.id === target.id);
    if (!element) {
      return [STAGE_TARGET];
    }

    const path: CanvasEventTarget[] = [STAGE_TARGET];

    if (element.groupId) {
      const chain = this.collectGroupChain(element.groupId);
      chain.forEach((groupId) => {
        path.push({ type: 'group', id: groupId });
      });
    }

    path.push(target);
    return path;
  }

  private collectGroupChain(groupId: string): string[] {
    const byId = new Map(this.scene.groups.map((group) => [group.id, group] as const));
    const chain: string[] = [];
    let currentId: string | null = groupId;

    while (currentId) {
      chain.unshift(currentId);
      const parent = this.scene.groups.find((group) => group.childIds.includes(currentId as string));
      currentId = parent ? parent.id : null;
      if (currentId && !byId.has(currentId)) {
        currentId = null;
      }
    }

    return chain;
  }
}
