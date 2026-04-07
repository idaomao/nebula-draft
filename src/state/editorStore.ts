import { create } from 'zustand';
import type { EditorHistoryState } from '../types/editor';
import { editorReducer, initialHistoryState } from './editorState';
import type { EditorAction } from './editorState';

interface EditorStoreState {
  history: EditorHistoryState;
  dispatch: (action: EditorAction) => void;
}

export const useEditorStore = create<EditorStoreState>((set) => ({
  history: initialHistoryState,
  dispatch: (action) => {
    set((state) => ({
      history: editorReducer(state.history, action),
    }));
  },
}));
