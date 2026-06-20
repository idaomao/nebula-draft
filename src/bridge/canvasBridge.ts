import type { BoardElement, EditorPresentState, ElementGroup, ViewportState } from '../types/editor';
import type { CanvasBridgeSnapshot, CanvasRenderCommand } from '../types/architecture';

const BASE_DIFF_KEYS = ['x', 'y', 'width', 'height', 'rotation', 'fill', 'stroke', 'strokeWidth'] as const;
const NO_COMMANDS: CanvasRenderCommand[] = [];

const COMMAND_PRIORITY: Record<CanvasRenderCommand['type'], number> = {
  'replace-selection': 0,
  'create-element': 1,
  'update-element': 1,
  'delete-element': 1,
  'update-viewport': 2,
  'update-ui': 3,
};

const areStringArraysEqual = (first: string[], second: string[]): boolean => {
  if (first.length !== second.length) {
    return false;
  }

  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) {
      return false;
    }
  }

  return true;
};

const areViewportsEqual = (first: ViewportState, second: ViewportState): boolean => {
  return first.x === second.x && first.y === second.y && first.scale === second.scale;
};

const areGroupsEqual = (first: ElementGroup, second: ElementGroup): boolean => {
  return (
    first.id === second.id &&
    first.name === second.name &&
    areStringArraysEqual(first.childIds, second.childIds)
  );
};

const areElementsEqual = (first: BoardElement, second: BoardElement): boolean => {
  if (first.id !== second.id || first.kind !== second.kind) {
    return false;
  }

  const firstRecord = first as unknown as Record<string, unknown>;
  const secondRecord = second as unknown as Record<string, unknown>;

  for (const key of BASE_DIFF_KEYS) {
    if (firstRecord[key] !== secondRecord[key]) {
      return false;
    }
  }

  if ((first.groupId ?? null) !== (second.groupId ?? null)) {
    return false;
  }

  if (first.kind === 'note' && second.kind === 'note') {
    return (
      first.text === second.text &&
      first.richText === second.richText &&
      first.fontSize === second.fontSize &&
      first.textColor === second.textColor
    );
  }

  if (first.kind === 'image' && second.kind === 'image') {
    return first.src === second.src;
  }

  return true;
};

const createElementPatch = (previous: BoardElement, next: BoardElement): Partial<BoardElement> => {
  if (previous.kind !== next.kind) {
    return { ...next };
  }

  const patchRecord: Record<string, unknown> = {};
  const previousRecord = previous as unknown as Record<string, unknown>;
  const nextRecord = next as unknown as Record<string, unknown>;

  for (const key of BASE_DIFF_KEYS) {
    if (previousRecord[key] !== nextRecord[key]) {
      patchRecord[key] = nextRecord[key];
    }
  }

  if ((previous.groupId ?? null) !== (next.groupId ?? null)) {
    patchRecord.groupId = next.groupId ?? null;
  }

  if (next.kind === 'note' && previous.kind === 'note') {
    if (previous.text !== next.text) {
      patchRecord.text = next.text;
    }
    if (previous.richText !== next.richText) {
      patchRecord.richText = next.richText;
    }
    if (previous.fontSize !== next.fontSize) {
      patchRecord.fontSize = next.fontSize;
    }
    if (previous.textColor !== next.textColor) {
      patchRecord.textColor = next.textColor;
    }
  }

  if (next.kind === 'image' && previous.kind === 'image' && previous.src !== next.src) {
    patchRecord.src = next.src;
  }

  return patchRecord as Partial<BoardElement>;
};

const createInitialCommands = (present: EditorPresentState): CanvasRenderCommand[] => {
  const commands: CanvasRenderCommand[] = [];

  present.elements.forEach((element) => {
    commands.push({ type: 'create-element', element });
  });

  if (present.selectedIds.length > 0) {
    commands.push({
      type: 'replace-selection',
      selectedIds: [...present.selectedIds],
    });
  }

  commands.push({
    type: 'update-viewport',
    viewport: { ...present.viewport },
  });

  commands.push({
    type: 'update-ui',
    activeTool: present.activeTool,
    gridSnapEnabled: present.gridSnapEnabled,
  });

  return commands;
};

const diffPresentState = (
  previous: EditorPresentState,
  next: EditorPresentState,
): CanvasRenderCommand[] => {
  const commands: CanvasRenderCommand[] = [];

  const previousElements = new Map(previous.elements.map((element) => [element.id, element] as const));
  const nextElements = new Map(next.elements.map((element) => [element.id, element] as const));

  next.elements.forEach((element) => {
    const previousElement = previousElements.get(element.id);
    if (!previousElement) {
      commands.push({ type: 'create-element', element });
      return;
    }

    if (!areElementsEqual(previousElement, element)) {
      commands.push({
        type: 'update-element',
        id: element.id,
        patch: createElementPatch(previousElement, element),
      });
    }
  });

  previous.elements.forEach((element) => {
    if (!nextElements.has(element.id)) {
      commands.push({ type: 'delete-element', id: element.id });
    }
  });

  if (!areStringArraysEqual(previous.selectedIds, next.selectedIds)) {
    commands.push({
      type: 'replace-selection',
      selectedIds: [...next.selectedIds],
    });
  }

  if (!areViewportsEqual(previous.viewport, next.viewport)) {
    commands.push({
      type: 'update-viewport',
      viewport: { ...next.viewport },
    });
  }

  if (
    previous.activeTool !== next.activeTool ||
    previous.gridSnapEnabled !== next.gridSnapEnabled
  ) {
    commands.push({
      type: 'update-ui',
      activeTool: next.activeTool,
      gridSnapEnabled: next.gridSnapEnabled,
    });
  }

  return commands;
};

const mergeCommand = (
  mergedCommands: Array<CanvasRenderCommand | null>,
  elementCommandIndex: Map<string, number>,
  stateCommandIndex: Map<CanvasRenderCommand['type'], number>,
  command: CanvasRenderCommand,
) => {
  if (command.type === 'replace-selection' || command.type === 'update-viewport' || command.type === 'update-ui') {
    const existingIndex = stateCommandIndex.get(command.type);
    if (existingIndex === undefined) {
      mergedCommands.push(command);
      stateCommandIndex.set(command.type, mergedCommands.length - 1);
      return;
    }

    mergedCommands[existingIndex] = command;
    return;
  }

  if (command.type === 'create-element') {
    const existingIndex = elementCommandIndex.get(command.element.id);
    if (existingIndex === undefined) {
      mergedCommands.push(command);
      elementCommandIndex.set(command.element.id, mergedCommands.length - 1);
      return;
    }

    mergedCommands[existingIndex] = command;
    return;
  }

  if (command.type === 'update-element') {
    const existingIndex = elementCommandIndex.get(command.id);
    if (existingIndex === undefined) {
      mergedCommands.push(command);
      elementCommandIndex.set(command.id, mergedCommands.length - 1);
      return;
    }

    const existing = mergedCommands[existingIndex];
    if (!existing) {
      mergedCommands[existingIndex] = command;
      return;
    }

    if (existing.type === 'create-element') {
      mergedCommands[existingIndex] = {
        type: 'create-element',
        element: { ...existing.element, ...command.patch } as BoardElement,
      };
      return;
    }

    if (existing.type === 'update-element') {
      mergedCommands[existingIndex] = {
        type: 'update-element',
        id: command.id,
        patch: {
          ...existing.patch,
          ...command.patch,
        },
      };
      return;
    }

    if (existing.type === 'delete-element') {
      return;
    }

    mergedCommands[existingIndex] = command;
    return;
  }

  const existingIndex = elementCommandIndex.get(command.id);
  if (existingIndex === undefined) {
    mergedCommands.push(command);
    elementCommandIndex.set(command.id, mergedCommands.length - 1);
    return;
  }

  const existing = mergedCommands[existingIndex];
  if (!existing) {
    mergedCommands[existingIndex] = command;
    return;
  }

  if (existing.type === 'create-element') {
    mergedCommands[existingIndex] = null;
    elementCommandIndex.delete(command.id);
    return;
  }

  if (existing.type === 'update-element') {
    mergedCommands[existingIndex] = command;
    return;
  }

  if (existing.type === 'delete-element') {
    return;
  }

  mergedCommands[existingIndex] = command;
};

const optimizeCommands = (commands: CanvasRenderCommand[]): CanvasRenderCommand[] => {
  if (commands.length <= 1) {
    return commands;
  }

  const mergedCommands: Array<CanvasRenderCommand | null> = [];
  const elementCommandIndex = new Map<string, number>();
  const stateCommandIndex = new Map<CanvasRenderCommand['type'], number>();

  commands.forEach((command) => {
    mergeCommand(mergedCommands, elementCommandIndex, stateCommandIndex, command);
  });

  const compacted = mergedCommands.filter((command): command is CanvasRenderCommand => Boolean(command));
  if (compacted.length <= 1) {
    return compacted;
  }

  return compacted
    .map((command, index) => ({ command, index }))
    .sort((first, second) => {
      const priorityGap = COMMAND_PRIORITY[first.command.type] - COMMAND_PRIORITY[second.command.type];
      if (priorityGap !== 0) {
        return priorityGap;
      }

      return first.index - second.index;
    })
    .map((item) => item.command);
};

export class CanvasBridge {
  private previousSnapshot: CanvasBridgeSnapshot | null = null;

  private elementCache = new Map<string, BoardElement>();

  private groupCache = new Map<string, ElementGroup>();

  reconcile(nextRawPresent: EditorPresentState): CanvasBridgeSnapshot {
    const stableElements: BoardElement[] = [];

    nextRawPresent.elements.forEach((element) => {
      const cached = this.elementCache.get(element.id);
      if (cached && areElementsEqual(cached, element)) {
        stableElements.push(cached);
        return;
      }

      const normalizedElement = {
        ...element,
        groupId: element.groupId ?? null,
      } as BoardElement;

      this.elementCache.set(element.id, normalizedElement);
      stableElements.push(normalizedElement);
    });

    const nextElementIdSet = new Set(nextRawPresent.elements.map((element) => element.id));
    Array.from(this.elementCache.keys()).forEach((elementId) => {
      if (!nextElementIdSet.has(elementId)) {
        this.elementCache.delete(elementId);
      }
    });

    const stableGroups: ElementGroup[] = [];
    nextRawPresent.groups.forEach((group) => {
      const cached = this.groupCache.get(group.id);
      if (cached && areGroupsEqual(cached, group)) {
        stableGroups.push(cached);
        return;
      }

      const normalizedGroup: ElementGroup = {
        id: group.id,
        name: group.name,
        childIds: [...group.childIds],
      };

      this.groupCache.set(group.id, normalizedGroup);
      stableGroups.push(normalizedGroup);
    });

    const nextGroupIdSet = new Set(nextRawPresent.groups.map((group) => group.id));
    Array.from(this.groupCache.keys()).forEach((groupId) => {
      if (!nextGroupIdSet.has(groupId)) {
        this.groupCache.delete(groupId);
      }
    });

    const previousPresent = this.previousSnapshot?.present;

    const stableSelectedIds =
      previousPresent && areStringArraysEqual(previousPresent.selectedIds, nextRawPresent.selectedIds)
        ? previousPresent.selectedIds
        : [...nextRawPresent.selectedIds];

    const stableViewport =
      previousPresent && areViewportsEqual(previousPresent.viewport, nextRawPresent.viewport)
        ? previousPresent.viewport
        : { ...nextRawPresent.viewport };

    const nextPresent: EditorPresentState = {
      elements: stableElements,
      groups: stableGroups,
      selectedIds: stableSelectedIds,
      activeTool: nextRawPresent.activeTool,
      gridSnapEnabled: nextRawPresent.gridSnapEnabled,
      viewport: stableViewport,
    };

    const rawCommands = previousPresent
      ? diffPresentState(previousPresent, nextPresent)
      : createInitialCommands(nextPresent);
    const commands = optimizeCommands(rawCommands);

    const hasElementMutation = commands.some(
      (command) =>
        command.type === 'create-element' ||
        command.type === 'update-element' ||
        command.type === 'delete-element',
    );

    const elementById =
      !hasElementMutation && this.previousSnapshot
        ? this.previousSnapshot.elementById
        : new Map(nextPresent.elements.map((element) => [element.id, element] as const));

    const nextSnapshot: CanvasBridgeSnapshot = {
      present: nextPresent,
      elementById,
      commands: commands.length === 0 ? NO_COMMANDS : commands,
    };

    this.previousSnapshot = nextSnapshot;
    return nextSnapshot;
  }
}
