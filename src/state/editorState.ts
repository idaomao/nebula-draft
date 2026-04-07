import type {
  BoardElement,
  EditorHistoryState,
  EditorPresentState,
  ElementGroup,
  Tool,
  ViewportState,
} from '../types/editor';
import { normalizeRichText, plainTextToRichText } from '../utils/richText';

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

const cloneElement = <T extends BoardElement>(element: T): T => ({
  ...element,
  groupId: element.groupId ?? null,
});

const cloneGroup = (group: ElementGroup): ElementGroup => ({
  ...group,
  childIds: [...group.childIds],
});

export const clonePresent = (present: EditorPresentState): EditorPresentState => ({
  elements: present.elements.map((element) => cloneElement(element)),
  groups: present.groups.map((group) => cloneGroup(group)),
  selectedIds: [...present.selectedIds],
  activeTool: present.activeTool,
  gridSnapEnabled: present.gridSnapEnabled,
  viewport: { ...present.viewport },
});

const defaultViewport: ViewportState = {
  x: 0,
  y: 0,
  scale: 1,
};

const defaultPresentState: EditorPresentState = {
  elements: [],
  groups: [],
  selectedIds: [],
  activeTool: 'select',
  gridSnapEnabled: false,
  viewport: defaultViewport,
};

export const initialHistoryState: EditorHistoryState = {
  past: [],
  present: clonePresent(defaultPresentState),
  future: [],
};

const commit = (state: EditorHistoryState, nextPresent: EditorPresentState): EditorHistoryState => ({
  past: [...state.past, clonePresent(state.present)],
  present: nextPresent,
  future: [],
});

const updatePresentOnly = (
  state: EditorHistoryState,
  updater: (present: EditorPresentState) => EditorPresentState,
): EditorHistoryState => ({
  ...state,
  present: updater(state.present),
});

const mergeElementPatch = (element: BoardElement, patch: Partial<BoardElement>): BoardElement =>
  ({ ...element, ...patch }) as BoardElement;

const toolSet: Tool[] = [
  'select',
  'pan',
  'rect',
  'ellipse',
  'triangle',
  'diamond',
  'note',
];

const isTool = (value: unknown): value is Tool =>
  typeof value === 'string' && toolSet.includes(value as Tool);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isBoardElement = (value: unknown): value is BoardElement => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  const kind = record.kind;

  if (
    typeof record.id !== 'string' ||
    !isFiniteNumber(record.x) ||
    !isFiniteNumber(record.y) ||
    !isFiniteNumber(record.width) ||
    !isFiniteNumber(record.height) ||
    !isFiniteNumber(record.rotation) ||
    typeof record.fill !== 'string' ||
    typeof record.stroke !== 'string' ||
    !isFiniteNumber(record.strokeWidth) ||
    !(
      typeof record.groupId === 'undefined' ||
      record.groupId === null ||
      typeof record.groupId === 'string'
    )
  ) {
    return false;
  }

  if (kind === 'rect' || kind === 'ellipse' || kind === 'triangle' || kind === 'diamond') {
    return true;
  }

  if (kind === 'note') {
    return (
      typeof record.text === 'string' &&
      typeof record.textColor === 'string' &&
      isFiniteNumber(record.fontSize) &&
      (typeof record.richText === 'undefined' || typeof record.richText === 'string')
    );
  }

  if (kind === 'image') {
    return typeof record.src === 'string' && record.src.length > 0;
  }

  return false;
};

const normalizeLoadedElement = (element: BoardElement): BoardElement => {
  const nextElement = {
    ...element,
    groupId: typeof element.groupId === 'string' ? element.groupId : null,
  } as BoardElement;

  if (nextElement.kind !== 'note') {
    return nextElement;
  }

  return {
    ...nextElement,
    richText:
      typeof nextElement.richText === 'string'
        ? normalizeRichText(nextElement.richText)
        : plainTextToRichText(nextElement.text),
  };
};

const isElementGroup = (value: unknown): value is ElementGroup => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    Array.isArray(record.childIds) &&
    record.childIds.every((id) => typeof id === 'string')
  );
};

const sanitizeViewport = (value: unknown): ViewportState => {
  if (!value || typeof value !== 'object') {
    return { ...defaultViewport };
  }

  const record = value as Partial<ViewportState>;

  return {
    x: isFiniteNumber(record.x) ? record.x : 0,
    y: isFiniteNumber(record.y) ? record.y : 0,
    scale: clampScale(isFiniteNumber(record.scale) ? record.scale : 1),
  };
};

const normalizeSelection = (elements: BoardElement[], ids: string[]): string[] => {
  const validIdSet = new Set(elements.map((element) => element.id));
  const uniqueIds: string[] = [];
  const seen = new Set<string>();

  ids.forEach((id) => {
    if (!validIdSet.has(id) || seen.has(id)) {
      return;
    }
    seen.add(id);
    uniqueIds.push(id);
  });

  return uniqueIds;
};

const sanitizeGroups = (value: unknown, elementIds: Set<string>): ElementGroup[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedGroups: ElementGroup[] = [];
  const seenGroupIds = new Set<string>();
  const assignedElementIds = new Set<string>();

  value.forEach((group, index) => {
    if (!isElementGroup(group) || seenGroupIds.has(group.id)) {
      return;
    }

    const childIds = group.childIds.filter((id) => {
      if (!elementIds.has(id) || assignedElementIds.has(id)) {
        return false;
      }
      assignedElementIds.add(id);
      return true;
    });

    if (childIds.length < 2) {
      return;
    }

    seenGroupIds.add(group.id);
    normalizedGroups.push({
      id: group.id,
      childIds,
      name: group.name.trim() || `Group ${index + 1}`,
    });
  });

  return normalizedGroups;
};

const buildGroupMembership = (groups: ElementGroup[]): Map<string, string> => {
  const membership = new Map<string, string>();
  groups.forEach((group) => {
    group.childIds.forEach((childId) => {
      membership.set(childId, group.id);
    });
  });
  return membership;
};

const applyGroupMembership = (elements: BoardElement[], groups: ElementGroup[]): BoardElement[] => {
  const membership = buildGroupMembership(groups);
  return elements.map((element) => ({
    ...element,
    groupId: membership.get(element.id) ?? null,
  }));
};

const removeElementsFromGroups = (groups: ElementGroup[], selectedIds: Set<string>): ElementGroup[] => {
  return groups
    .map((group, index) => ({
      ...group,
      name: group.name || `Group ${index + 1}`,
      childIds: group.childIds.filter((id) => !selectedIds.has(id)),
    }))
    .filter((group) => group.childIds.length >= 2);
};

export type EditorAction =
  | { type: 'set-tool'; tool: Tool }
  | { type: 'set-grid-snap'; enabled: boolean }
  | { type: 'set-selection'; ids: string[] }
  | { type: 'bring-to-front'; ids: string[]; trackHistory?: boolean }
  | { type: 'clear-selection' }
  | { type: 'add-element'; element: BoardElement }
  | { type: 'add-elements'; elements: BoardElement[] }
  | { type: 'add-elements-with-groups'; elements: BoardElement[]; groups: ElementGroup[] }
  | { type: 'patch-element'; id: string; patch: Partial<BoardElement>; trackHistory?: boolean }
  | {
      type: 'patch-elements';
      updates: Array<{ id: string; patch: Partial<BoardElement> }>;
      trackHistory?: boolean;
    }
  | { type: 'patch-selected'; patch: Partial<BoardElement>; trackHistory?: boolean }
  | { type: 'delete-selected' }
  | { type: 'group-selected'; groupId: string }
  | { type: 'ungroup-selected' }
  | { type: 'set-viewport'; viewport: Partial<ViewportState> }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'hydrate'; state: EditorPresentState };

export const editorReducer = (state: EditorHistoryState, action: EditorAction): EditorHistoryState => {
  switch (action.type) {
    case 'set-tool':
      return updatePresentOnly(state, (present) => ({
        ...present,
        activeTool: action.tool,
      }));

    case 'set-grid-snap':
      return updatePresentOnly(state, (present) => ({
        ...present,
        gridSnapEnabled: action.enabled,
      }));

    case 'set-selection':
      return updatePresentOnly(state, (present) => ({
        ...present,
        selectedIds: normalizeSelection(present.elements, action.ids),
      }));

    case 'bring-to-front': {
      if (action.ids.length === 0) {
        return state;
      }

      const nextPresent = clonePresent(state.present);
      const existingIdSet = new Set(nextPresent.elements.map((element) => element.id));
      const targetIds = action.ids.filter((id) => existingIdSet.has(id));

      if (targetIds.length === 0) {
        return state;
      }

      const targetIdSet = new Set(targetIds);
      const keepElements = nextPresent.elements.filter((element) => !targetIdSet.has(element.id));
      const frontElements = nextPresent.elements.filter((element) => targetIdSet.has(element.id));

      const reordered = [...keepElements, ...frontElements];
      const hasChanged = reordered.some((element, index) => element.id !== nextPresent.elements[index]?.id);

      if (!hasChanged) {
        return state;
      }

      nextPresent.elements = reordered;

      if (action.trackHistory === false) {
        return {
          ...state,
          present: nextPresent,
        };
      }

      return commit(state, nextPresent);
    }

    case 'clear-selection':
      return updatePresentOnly(state, (present) => ({
        ...present,
        selectedIds: [],
      }));

    case 'add-element': {
      const nextPresent = clonePresent(state.present);
      nextPresent.elements.push(cloneElement(action.element));
      nextPresent.elements = applyGroupMembership(nextPresent.elements, nextPresent.groups);
      nextPresent.selectedIds = [action.element.id];
      nextPresent.activeTool = 'select';
      return commit(state, nextPresent);
    }

    case 'add-elements': {
      if (action.elements.length === 0) {
        return state;
      }

      const nextPresent = clonePresent(state.present);
      action.elements.forEach((element) => {
        nextPresent.elements.push(cloneElement(element));
      });
      nextPresent.elements = applyGroupMembership(nextPresent.elements, nextPresent.groups);
      nextPresent.selectedIds = action.elements.map((element) => element.id);
      nextPresent.activeTool = 'select';
      return commit(state, nextPresent);
    }

    case 'add-elements-with-groups': {
      if (action.elements.length === 0) {
        return state;
      }

      const nextPresent = clonePresent(state.present);
      action.elements.forEach((element) => {
        nextPresent.elements.push(cloneElement(element));
      });

      const incomingElementIds = new Set(action.elements.map((element) => element.id));
      const incomingGroups = sanitizeGroups(action.groups, incomingElementIds);
      nextPresent.groups.push(...incomingGroups.map((group) => cloneGroup(group)));

      const allElementIds = new Set(nextPresent.elements.map((element) => element.id));
      nextPresent.groups = sanitizeGroups(nextPresent.groups, allElementIds);
      nextPresent.elements = applyGroupMembership(nextPresent.elements, nextPresent.groups);
      nextPresent.selectedIds = action.elements.map((element) => element.id);
      nextPresent.activeTool = 'select';
      return commit(state, nextPresent);
    }

    case 'patch-element': {
      const nextPresent = clonePresent(state.present);
      let hasMatched = false;
      nextPresent.elements = nextPresent.elements.map((element) =>
        element.id === action.id
          ? ((hasMatched = true), mergeElementPatch(element, action.patch))
          : element,
      );

      if (!hasMatched) {
        return state;
      }

      if (action.trackHistory === false) {
        return {
          ...state,
          present: nextPresent,
        };
      }

      return commit(state, nextPresent);
    }

    case 'patch-elements': {
      if (action.updates.length === 0) {
        return state;
      }

      const nextPresent = clonePresent(state.present);
      const updateMap = new Map(action.updates.map((item) => [item.id, item.patch]));
      let hasMatched = false;

      nextPresent.elements = nextPresent.elements.map((element) => {
        const patch = updateMap.get(element.id);
        if (!patch) {
          return element;
        }
        hasMatched = true;
        return mergeElementPatch(element, patch);
      });

      if (!hasMatched) {
        return state;
      }

      if (action.trackHistory === false) {
        return {
          ...state,
          present: nextPresent,
        };
      }

      return commit(state, nextPresent);
    }

    case 'patch-selected': {
      if (state.present.selectedIds.length === 0) {
        return state;
      }

      const selectedIdSet = new Set(state.present.selectedIds);
      const nextPresent = clonePresent(state.present);
      nextPresent.elements = nextPresent.elements.map((element) =>
        selectedIdSet.has(element.id) ? mergeElementPatch(element, action.patch) : element,
      );

      if (action.trackHistory === false) {
        return {
          ...state,
          present: nextPresent,
        };
      }

      return commit(state, nextPresent);
    }

    case 'delete-selected': {
      if (state.present.selectedIds.length === 0) {
        return state;
      }

      const selectedIdSet = new Set(state.present.selectedIds);
      const nextPresent = clonePresent(state.present);
      nextPresent.elements = nextPresent.elements.filter((element) => !selectedIdSet.has(element.id));
      nextPresent.groups = removeElementsFromGroups(nextPresent.groups, selectedIdSet);
      nextPresent.elements = applyGroupMembership(nextPresent.elements, nextPresent.groups);
      nextPresent.selectedIds = [];
      return commit(state, nextPresent);
    }

    case 'group-selected': {
      if (state.present.selectedIds.length < 2) {
        return state;
      }

      const selectedIdSet = new Set(state.present.selectedIds);
      const nextPresent = clonePresent(state.present);

      nextPresent.groups = removeElementsFromGroups(nextPresent.groups, selectedIdSet);

      const childIds = nextPresent.elements
        .map((element) => element.id)
        .filter((id) => selectedIdSet.has(id));

      if (childIds.length < 2) {
        return state;
      }

      nextPresent.groups.push({
        id: action.groupId,
        childIds,
        name: `Group ${nextPresent.groups.length + 1}`,
      });

      nextPresent.elements = applyGroupMembership(nextPresent.elements, nextPresent.groups);
      nextPresent.selectedIds = [...childIds];
      return commit(state, nextPresent);
    }

    case 'ungroup-selected': {
      if (state.present.selectedIds.length === 0) {
        return state;
      }

      const nextPresent = clonePresent(state.present);
      const selectedIdSet = new Set(state.present.selectedIds);

      const selectedGroupIds = new Set(
        nextPresent.elements
          .filter((element) => selectedIdSet.has(element.id) && typeof element.groupId === 'string')
          .map((element) => element.groupId as string),
      );

      if (selectedGroupIds.size === 0) {
        return state;
      }

      const releasedIds: string[] = [];
      nextPresent.groups = nextPresent.groups.filter((group) => {
        if (!selectedGroupIds.has(group.id)) {
          return true;
        }
        releasedIds.push(...group.childIds);
        return false;
      });

      if (releasedIds.length === 0) {
        return state;
      }

      nextPresent.elements = applyGroupMembership(nextPresent.elements, nextPresent.groups);
      nextPresent.selectedIds = normalizeSelection(nextPresent.elements, [...new Set(releasedIds)]);
      return commit(state, nextPresent);
    }

    case 'set-viewport':
      return updatePresentOnly(state, (present) => ({
        ...present,
        viewport: {
          ...present.viewport,
          ...action.viewport,
          scale: clampScale(
            isFiniteNumber(action.viewport.scale) ? action.viewport.scale : present.viewport.scale,
          ),
        },
      }));

    case 'undo': {
      if (state.past.length === 0) {
        return state;
      }

      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: clonePresent(previous),
        future: [clonePresent(state.present), ...state.future],
      };
    }

    case 'redo': {
      if (state.future.length === 0) {
        return state;
      }

      const [next, ...restFuture] = state.future;
      return {
        past: [...state.past, clonePresent(state.present)],
        present: clonePresent(next),
        future: restFuture,
      };
    }

    case 'hydrate':
      {
        const hydrated = clonePresent(action.state);
        const elementIds = new Set(hydrated.elements.map((element) => element.id));
        hydrated.groups = sanitizeGroups(hydrated.groups, elementIds);
        hydrated.elements = applyGroupMembership(hydrated.elements, hydrated.groups);
        hydrated.selectedIds = normalizeSelection(hydrated.elements, hydrated.selectedIds);

        return {
          past: [],
          present: hydrated,
          future: [],
        };
      }

    default:
      return state;
  }
};

export const serializePresentState = (present: EditorPresentState): string =>
  JSON.stringify(clonePresent(present));

export const parsePresentState = (raw: string | null): EditorPresentState | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<EditorPresentState>;
    if (!parsed || !Array.isArray(parsed.elements)) {
      return null;
    }

    const elements = parsed.elements
      .filter((element) => isBoardElement(element))
      .map((element) => normalizeLoadedElement(element));

    const elementIds = new Set(elements.map((element) => element.id));
    const groups = sanitizeGroups(parsed.groups, elementIds);
    const normalizedElements = applyGroupMembership(elements, groups);

    const selectedIds = Array.isArray(parsed.selectedIds)
      ? normalizeSelection(
          normalizedElements,
          parsed.selectedIds.filter((id): id is string => typeof id === 'string'),
        )
      : [];

    return {
      elements: normalizedElements,
      groups,
      selectedIds,
      activeTool: isTool(parsed.activeTool) ? parsed.activeTool : 'select',
      gridSnapEnabled: parsed.gridSnapEnabled === true,
      viewport: sanitizeViewport(parsed.viewport),
    };
  } catch {
    return null;
  }
};
