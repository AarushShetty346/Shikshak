// Uploaded files, kept in this browser (IndexedDB) per session, so book pages can be shown on the
// board and re-sent to the server after it restarts. Never shared between sessions.

const DB = "shikshak";
const STORE = "docs";

export interface StoredDoc {
  key: string; // `${sessionId}:${docId}`
  sessionId: string;
  docId: string;
  name: string;
  mediaType: string;
  data: string; // base64
  pages: number | null;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("session", "sessionId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putDoc(doc: Omit<StoredDoc, "key">) {
  await tx("readwrite", (s) => s.put({ ...doc, key: `${doc.sessionId}:${doc.docId}` }));
}

export async function getDoc(sessionId: string, docId: string): Promise<StoredDoc | undefined> {
  return tx("readonly", (s) => s.get(`${sessionId}:${docId}`) as IDBRequest<StoredDoc | undefined>);
}

export async function sessionDocs(sessionId: string): Promise<StoredDoc[]> {
  return tx("readonly", (s) => s.index("session").getAll(sessionId) as IDBRequest<StoredDoc[]>);
}

export async function deleteDocs(sessionId: string) {
  for (const d of await sessionDocs(sessionId)) await tx("readwrite", (s) => s.delete(d.key));
}
