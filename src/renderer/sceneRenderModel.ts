import { useMemo, useRef } from 'react';
import type { BoardElement } from '../types/editor';
import type { CanvasRenderCommand } from '../types/architecture';

const applyElementPatch = (element: BoardElement, patch: Partial<BoardElement>): BoardElement => {
  return { ...element, ...patch } as BoardElement;
};

class SceneRenderModel {
  private elementOrder: string[] = [];

  private elementById: Map<string, BoardElement> = new Map();

  initialize(elements: BoardElement[]): void {
    this.elementOrder = elements.map((element) => element.id);
    this.elementById = new Map(elements.map((element) => [element.id, element] as const));
  }

  reconcile(elements: BoardElement[], commands: CanvasRenderCommand[]): BoardElement[] {
    if (this.elementOrder.length === 0 && this.elementById.size === 0) {
      this.initialize(elements);
    }

    let nextOrder = this.elementOrder;
    let nextMap = this.elementById;
    let mapMutated = false;
    let orderMutated = false;

    const ensureWritableMap = () => {
      if (mapMutated) {
        return;
      }
      nextMap = new Map(nextMap);
      mapMutated = true;
    };

    const ensureWritableOrder = () => {
      if (orderMutated) {
        return;
      }
      nextOrder = [...nextOrder];
      orderMutated = true;
    };

    commands.forEach((command) => {
      if (command.type === 'create-element') {
        ensureWritableMap();
        ensureWritableOrder();
        nextMap.set(command.element.id, command.element);
        if (!nextOrder.includes(command.element.id)) {
          nextOrder.push(command.element.id);
        }
        return;
      }

      if (command.type === 'update-element') {
        const previousElement = nextMap.get(command.id);
        if (!previousElement) {
          return;
        }

        ensureWritableMap();
        nextMap.set(command.id, applyElementPatch(previousElement, command.patch));
        return;
      }

      if (command.type === 'delete-element') {
        if (!nextMap.has(command.id)) {
          return;
        }

        ensureWritableMap();
        ensureWritableOrder();
        nextMap.delete(command.id);
        nextOrder = nextOrder.filter((id) => id !== command.id);
      }
    });

    const incomingOrder = elements.map((element) => element.id);
    const hasOrderDrift =
      nextOrder.length !== incomingOrder.length ||
      nextOrder.some((id, index) => id !== incomingOrder[index]);

    if (hasOrderDrift) {
      nextOrder = incomingOrder;
      nextMap = new Map(elements.map((element) => [element.id, element] as const));
      mapMutated = true;
      orderMutated = true;
    }

    if (mapMutated || orderMutated) {
      this.elementOrder = nextOrder;
      this.elementById = nextMap;
    }

    return this.elementOrder
      .map((id) => this.elementById.get(id))
      .filter((element): element is BoardElement => Boolean(element));
  }
}

export const useSceneRenderModel = (
  elements: BoardElement[],
  commands: CanvasRenderCommand[],
): BoardElement[] => {
  const modelRef = useRef(new SceneRenderModel());

  return useMemo(() => {
    return modelRef.current.reconcile(elements, commands);
  }, [commands, elements]);
};
