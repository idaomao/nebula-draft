import { useEffect } from 'react';
import type { Dispatch } from 'react';
import type { EditorAction } from '../state/editorState';

interface HotkeyOptions {
  dispatch: Dispatch<EditorAction>;
  onCopy?: () => void;
  onPaste?: () => void;
  onSave?: () => void;
  onInsertImage?: () => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  onToggleGridSnap?: () => void;
  onSelectAll?: () => void;
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
};

export const useHotkeys = ({
  dispatch,
  onCopy,
  onPaste,
  onSave,
  onInsertImage,
  onGroup,
  onUngroup,
  onToggleGridSnap,
  onSelectAll,
}: HotkeyOptions) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ctrlOrMeta = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (ctrlOrMeta && key === 's') {
        event.preventDefault();
        onSave?.();
        return;
      }

      if (isTypingTarget(event.target)) {
        return;
      }

      if (ctrlOrMeta && key === 'c') {
        event.preventDefault();
        onCopy?.();
        return;
      }

      if (ctrlOrMeta && key === 'v') {
        event.preventDefault();
        onPaste?.();
        return;
      }

      if (ctrlOrMeta && key === 'g') {
        event.preventDefault();
        if (event.shiftKey) {
          onUngroup?.();
          return;
        }
        onGroup?.();
        return;
      }

      if (ctrlOrMeta && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          dispatch({ type: 'redo' });
          return;
        }
        dispatch({ type: 'undo' });
        return;
      }

      if (ctrlOrMeta && key === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
        return;
      }

      if (ctrlOrMeta && key === 'a') {
        event.preventDefault();
        onSelectAll?.();
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        dispatch({ type: 'delete-selected' });
        return;
      }

      if (!ctrlOrMeta && key === 'g') {
        event.preventDefault();
        onToggleGridSnap?.();
        return;
      }

      switch (key) {
        case 'v':
          dispatch({ type: 'set-tool', tool: 'select' });
          break;
        case 'h':
          dispatch({ type: 'set-tool', tool: 'pan' });
          break;
        case 'r':
          dispatch({ type: 'set-tool', tool: 'rect' });
          break;
        case 'e':
          dispatch({ type: 'set-tool', tool: 'ellipse' });
          break;
        case 'y':
          dispatch({ type: 'set-tool', tool: 'triangle' });
          break;
        case 'd':
          dispatch({ type: 'set-tool', tool: 'diamond' });
          break;
        case 't':
          dispatch({ type: 'set-tool', tool: 'note' });
          break;
        case 'i':
          onInsertImage?.();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [dispatch, onCopy, onGroup, onInsertImage, onPaste, onSave, onSelectAll, onToggleGridSnap, onUngroup]);
};
