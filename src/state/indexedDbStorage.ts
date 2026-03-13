import type { EditorPresentState } from '../types/editor';
import { parsePresentState, serializePresentState } from './editorState';

const DB_NAME = 'nebula-draft-db';
const DB_VERSION = 1;
const STORE_NAME = 'scenes';
const SCENE_KEY = 'default';

interface StoredSceneRecord {
  id: string;
  payload: string;
  updatedAt: number;
  schemaVersion: number;
}

let cachedDbPromise: Promise<IDBDatabase> | null = null;

const openDatabase = (): Promise<IDBDatabase> => {
  if (cachedDbPromise) {
    return cachedDbPromise;
  }

  cachedDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported in this environment.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open IndexedDB.'));
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });

  return cachedDbPromise;
};

const loadRawScene = async (): Promise<string | null> => {
  const db = await openDatabase();

  return new Promise<string | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(SCENE_KEY);

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to read scene from IndexedDB.'));
    };

    request.onsuccess = () => {
      const record = request.result as StoredSceneRecord | undefined;
      resolve(typeof record?.payload === 'string' ? record.payload : null);
    };
  });
};

const saveRawScene = async (payload: string): Promise<void> => {
  const db = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('Failed to write scene into IndexedDB.'));
    };

    const record: StoredSceneRecord = {
      id: SCENE_KEY,
      payload,
      updatedAt: Date.now(),
      schemaVersion: 1,
    };

    store.put(record);
  });
};

export const loadPresentStateFromIndexedDB = async (): Promise<EditorPresentState | null> => {
  try {
    const raw = await loadRawScene();
    return parsePresentState(raw);
  } catch (error) {
    console.warn('Failed to load scene from IndexedDB.', error);
    return null;
  }
};

export const savePresentStateToIndexedDB = async (present: EditorPresentState): Promise<void> => {
  const serialized = serializePresentState(present);
  await saveRawScene(serialized);
};