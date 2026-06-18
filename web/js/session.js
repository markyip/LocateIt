/**
 * Persist directory handle in IndexedDB for session restore.
 */

const DB_NAME = "locate-it";
const DB_VERSION = 1;
const STORE = "session";
const KEY_DIR = "directory";
const KEY_HANDLES = "handles"; // legacy — cleared on read

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGet(key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

function dbPut(key, value) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

function dbDelete(key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

/** @returns {Promise<FileSystemDirectoryHandle | null>} */
export async function loadSessionDirectory() {
  try {
    const dir = await dbGet(KEY_DIR);
    if (dir?.kind === "directory") return dir;

    const legacy = await dbGet(KEY_HANDLES);
    if (legacy?.length) await clearSession();
    return null;
  } catch {
    return null;
  }
}

/** @param {FileSystemDirectoryHandle} dirHandle */
export async function saveSessionDirectory(dirHandle) {
  if (!dirHandle || dirHandle.kind !== "directory") return;
  await dbPut(KEY_DIR, dirHandle);
  await dbDelete(KEY_HANDLES);
}

export async function clearSession() {
  try {
    await dbDelete(KEY_DIR);
    await dbDelete(KEY_HANDLES);
  } catch {
    /* ignore */
  }
}
