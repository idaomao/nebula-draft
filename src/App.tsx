import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { useCanvasBridge } from './bridge/useCanvasBridge';
import { useHotkeys } from './hooks/useHotkeys';
import { parsePresentState } from './state/editorState';
import { useEditorStore } from './state/editorStore';
import {
  loadPresentStateFromIndexedDB,
  savePresentStateToIndexedDB,
} from './state/indexedDbStorage';
import type { BoardElement, ElementGroup } from './types/editor';
import './App.css';

const CanvasStage = lazy(() =>
  import('./components/CanvasStage').then((module) => ({ default: module.CanvasStage })),
);

const PropertiesPanel = lazy(() =>
  import('./components/PropertiesPanel').then((module) => ({ default: module.PropertiesPanel })),
);

const LEGACY_STORAGE_KEY = 'nebula-draft.scene.v1';
const PASTE_OFFSET = 26;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type SaveMessageType = 'info' | 'success' | 'error';

interface SaveMessage {
  id: number;
  type: SaveMessageType;
  text: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const createId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const cloneElement = (element: BoardElement): BoardElement => ({ ...element });

interface ClipboardSnapshot {
  elements: BoardElement[];
  groups: ElementGroup[];
}

function App() {
  const history = useEditorStore((state) => state.history);
  const dispatch = useEditorStore((state) => state.dispatch);
  const [canPaste, setCanPaste] = useState(false);
  const [imageInsertVersion, setImageInsertVersion] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveMessage, setSaveMessage] = useState<SaveMessage | null>(null);
  const clipboardRef = useRef<ClipboardSnapshot | null>(null);
  const pasteCountRef = useRef(0);
  const { past, present, future } = history;
  const bridgeFrame = useCanvasBridge(present);
  const bridgeSnapshot = bridgeFrame.snapshot;
  const view = bridgeSnapshot.present;
  const latestPresentRef = useRef(present);
  const saveStatusTimerRef = useRef<number | null>(null);
  const saveMessageTimerRef = useRef<number | null>(null);
  const isSavingRef = useRef(false);

  const elementById = bridgeSnapshot.elementById;

  const selectedElements = useMemo(
    () =>
      view.selectedIds
        .map((id) => elementById.get(id))
        .filter((element): element is BoardElement => Boolean(element)),
    [elementById, view.selectedIds],
  );

  const handleCopy = useCallback(() => {
    if (selectedElements.length === 0) {
      return;
    }

    const selectedIdSet = new Set(selectedElements.map((element) => element.id));

    clipboardRef.current = {
      elements: selectedElements.map((element) => ({
        ...cloneElement(element),
        groupId: null,
      })),
      groups: view.groups
        .map((group) => ({
          ...group,
          childIds: group.childIds.filter((id) => selectedIdSet.has(id)),
        }))
        .filter((group) => group.childIds.length >= 2)
        .map((group) => ({
          id: group.id,
          name: group.name,
          childIds: [...group.childIds],
        })),
    };

    pasteCountRef.current = 0;
    setCanPaste(true);
  }, [selectedElements, view.groups]);

  const handlePaste = useCallback(() => {
    const snapshot = clipboardRef.current;
    if (!snapshot || snapshot.elements.length === 0) {
      return;
    }

    pasteCountRef.current += 1;
    const offset = PASTE_OFFSET * pasteCountRef.current;
    const idMap = new Map<string, string>();

    const duplicated = snapshot.elements.map((element) => {
      const duplicatedId = createId('element');
      idMap.set(element.id, duplicatedId);

      return {
        ...cloneElement(element),
        id: duplicatedId,
        x: element.x + offset,
        y: element.y + offset,
        groupId: null,
      };
    });

    const duplicatedGroups: ElementGroup[] = snapshot.groups
      .map((group) => ({
        id: createId('group'),
        name: group.name,
        childIds: group.childIds
          .map((sourceId) => idMap.get(sourceId))
          .filter((id): id is string => Boolean(id)),
      }))
      .filter((group) => group.childIds.length >= 2);

    dispatch({ type: 'add-elements-with-groups', elements: duplicated, groups: duplicatedGroups });
  }, []);

  const handleGroup = useCallback(() => {
    if (view.selectedIds.length < 2) {
      return;
    }

    dispatch({
      type: 'group-selected',
      groupId: createId('group'),
    });
  }, [view.selectedIds.length]);

  const handleUngroup = useCallback(() => {
    dispatch({ type: 'ungroup-selected' });
  }, []);

  const handleToggleGridSnap = useCallback(() => {
    dispatch({ type: 'set-grid-snap', enabled: !view.gridSnapEnabled });
  }, [view.gridSnapEnabled]);

  const handleSelectAll = useCallback(() => {
    dispatch({ type: 'set-selection', ids: view.elements.map((element) => element.id) });
  }, [view.elements]);

  const handleInsertImage = useCallback(() => {
    setImageInsertVersion((value) => value + 1);
  }, []);

  const showSaveMessage = useCallback(
    (text: string, type: SaveMessageType, duration = 1800) => {
      if (saveMessageTimerRef.current !== null) {
        window.clearTimeout(saveMessageTimerRef.current);
        saveMessageTimerRef.current = null;
      }

      const id = Date.now();
      setSaveMessage({ id, type, text });

      if (duration <= 0) {
        return;
      }

      saveMessageTimerRef.current = window.setTimeout(() => {
        setSaveMessage((current) => (current?.id === id ? null : current));
        saveMessageTimerRef.current = null;
      }, duration);
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (isSavingRef.current) {
      showSaveMessage('正在保存中，请稍候...', 'info', 1200);
      return;
    }

    isSavingRef.current = true;

    if (saveStatusTimerRef.current !== null) {
      window.clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = null;
    }

    setSaveStatus('saving');
    showSaveMessage('正在保存...', 'info', 0);

    try {
      await savePresentStateToIndexedDB(latestPresentRef.current);
      setSaveStatus('saved');
      showSaveMessage('已保存到 IndexedDB', 'success', 1800);

      saveStatusTimerRef.current = window.setTimeout(() => {
        setSaveStatus('idle');
        saveStatusTimerRef.current = null;
      }, 1800);
    } catch (error) {
      console.error('Failed to save scene to IndexedDB.', error);
      setSaveStatus('error');
      showSaveMessage('保存失败，请重试', 'error', 2200);
    } finally {
      isSavingRef.current = false;
    }
  }, [showSaveMessage]);

  useHotkeys({
    dispatch,
    onCopy: handleCopy,
    onPaste: handlePaste,
    onSave: handleSave,
    onInsertImage: handleInsertImage,
    onGroup: handleGroup,
    onUngroup: handleUngroup,
    onToggleGridSnap: handleToggleGridSnap,
    onSelectAll: handleSelectAll,
  });

  useEffect(() => {
    latestPresentRef.current = view;
  }, [view]);

  useEffect(() => {
    let disposed = false;

    const restore = async () => {
      const restored = await loadPresentStateFromIndexedDB();
      if (disposed) {
        return;
      }

      if (restored) {
        dispatch({ type: 'hydrate', state: restored });
        return;
      }

      const legacy = parsePresentState(localStorage.getItem(LEGACY_STORAGE_KEY));
      if (!legacy) {
        return;
      }

      dispatch({ type: 'hydrate', state: legacy });

      try {
        await savePresentStateToIndexedDB(legacy);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch (error) {
        console.warn('Failed to migrate localStorage scene into IndexedDB.', error);
      }
    };

    void restore();

    return () => {
      disposed = true;
    };
  }, [dispatch]);

  useEffect(() => {
    return () => {
      if (saveStatusTimerRef.current !== null) {
        window.clearTimeout(saveStatusTimerRef.current);
      }

      if (saveMessageTimerRef.current !== null) {
        window.clearTimeout(saveMessageTimerRef.current);
      }
    };
  }, []);

  const selectedElement = useMemo<BoardElement | null>(() => {
    if (selectedElements.length === 0) {
      return null;
    }

    return selectedElements[0];
  }, [selectedElements]);

  const canGroup = view.selectedIds.length >= 2;
  const canUngroup = selectedElements.some((element) => typeof element.groupId === 'string');
  const canCopy = selectedElements.length > 0;

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="title-group">
          <h1>Nebula Draft</h1>
          <p>轻量图形编辑器</p>
        </div>

        <Toolbar
          activeTool={view.activeTool}
          canUndo={past.length > 0}
          canRedo={future.length > 0}
          isSaving={saveStatus === 'saving'}
          canCopy={canCopy}
          canPaste={canPaste}
          canGroup={canGroup}
          canUngroup={canUngroup}
          gridSnapEnabled={view.gridSnapEnabled}
          scale={view.viewport.scale}
          onToolChange={(tool) => dispatch({ type: 'set-tool', tool })}
          onUndo={() => dispatch({ type: 'undo' })}
          onRedo={() => dispatch({ type: 'redo' })}
          onSave={handleSave}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onInsertImage={handleInsertImage}
          onGroup={handleGroup}
          onUngroup={handleUngroup}
          onToggleGridSnap={handleToggleGridSnap}
          onDelete={() => dispatch({ type: 'delete-selected' })}
          onZoomIn={() =>
            dispatch({
              type: 'set-viewport',
              viewport: {
                scale: clamp(view.viewport.scale * 1.1, 0.2, 4),
              },
            })
          }
          onZoomOut={() =>
            dispatch({
              type: 'set-viewport',
              viewport: {
                scale: clamp(view.viewport.scale / 1.1, 0.2, 4),
              },
            })
          }
          onResetView={() => dispatch({ type: 'set-viewport', viewport: { x: 0, y: 0, scale: 1 } })}
        />
      </header>

      <main className="workspace-grid">
        <Suspense fallback={<section className="stage-shell" aria-label="加载画布中" />}>
          <CanvasStage
            elements={view.elements}
            groups={view.groups}
            selectedIds={view.selectedIds}
            tool={view.activeTool}
            gridSnapEnabled={view.gridSnapEnabled}
            renderCommands={bridgeSnapshot.commands}
            bridgeMetrics={bridgeFrame.metrics}
            imageInsertVersion={imageInsertVersion}
            viewport={view.viewport}
            onSelectionChange={(ids) => dispatch({ type: 'set-selection', ids })}
            onAddElement={(element) => dispatch({ type: 'add-element', element })}
            onPatchElement={(id, patch, trackHistory = true) =>
              dispatch({ type: 'patch-element', id, patch, trackHistory })
            }
            onPatchElements={(updates, trackHistory = true) =>
              dispatch({ type: 'patch-elements', updates, trackHistory })
            }
            onBringToFront={(ids, trackHistory = true) =>
              dispatch({ type: 'bring-to-front', ids, trackHistory })
            }
            onViewportChange={(viewport) => dispatch({ type: 'set-viewport', viewport })}
          />
        </Suspense>

        <Suspense
          fallback={
            <aside className="property-panel">
              <p className="panel-muted">属性面板加载中...</p>
            </aside>
          }
        >
          <PropertiesPanel
            selectedElement={selectedElement}
            selectionCount={view.selectedIds.length}
            onPatchElement={(id, patch, trackHistory = true) =>
              dispatch({ type: 'patch-element', id, patch, trackHistory })
            }
            onPatchSelected={(patch, trackHistory = true) =>
              dispatch({ type: 'patch-selected', patch, trackHistory })
            }
            onDelete={() => dispatch({ type: 'delete-selected' })}
          />
        </Suspense>
      </main>

      {saveMessage ? (
        <div className={`save-toast ${saveMessage.type}`} role="status" aria-live="polite">
          {saveMessage.text}
        </div>
      ) : null}
    </div>
  );
}

export default App;
