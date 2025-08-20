// Simple IndexedDB key-value helper with graceful fallbacks.
// Used to persist large client-side datasets beyond localStorage limits.

const DB_NAME = 'em-db';
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined' || !('indexedDB' in window)) {
            return reject(new Error('IndexedDB unavailable'));
        }
        const req = window.indexedDB.open(DB_NAME, 1);
        req.onerror = () => reject(req.error || new Error('IndexedDB open error'));
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
    });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
    const db = await openDb();
    return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        Promise.resolve(fn(store)).then((val) => {
            tx.oncomplete = () => resolve(val);
            tx.onerror = () => reject(tx.error || new Error('IndexedDB tx error'));
            // If fn completed synchronously, commit completes async
        }).catch(reject);
    });
}

export async function idbSet<T = any>(key: string, value: T): Promise<void> {
    await withStore('readwrite', (store) => {
        store.put(value as any, key);
        return undefined;
    });
}

export async function idbGet<T = any>(key: string): Promise<T | undefined> {
    return await withStore('readonly', (store) => new Promise<T | undefined>((resolve, reject) => {
        const req = store.get(key);
        req.onerror = () => reject(req.error || new Error('IndexedDB get error'));
        req.onsuccess = () => resolve(req.result as T | undefined);
    }));
}

export async function idbDelete(key: string): Promise<void> {
    await withStore('readwrite', (store) => {
        store.delete(key);
        return undefined;
    });
}
