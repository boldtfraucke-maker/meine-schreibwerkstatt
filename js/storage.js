// Lokaler Speicher (IndexedDB). Austauschbar gegen andere Storage-Provider,
// solange sie dieselbe Schnittstelle (getAll/save/remove) anbieten.
const DB_NAME = "schreibwerkstatt-db";
const DB_VERSION = 2;
const STORE_NAMES = ["stories", "ideas", "books"];
let dbPromise = null;

function openDBOnce() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      STORE_NAMES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "id" });
        }
      });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

// Chrome meldet beim Öffnen manchmal kurz einen Fehler (z. B. "full disk"),
// obwohl der Speicher in Ordnung ist - meist direkt nach einem Seitenwechsel.
// Deshalb ein paar Versuche mit kurzer Pause. Ein endgültiges Scheitern wird
// NICHT gemerkt, sonst bliebe die App bis zum Neustart blockiert.
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await openDBOnce();
      } catch (err) {
        lastError = err;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw lastError;
  })();
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function makeStore(storeName) {
  return {
    async getAll() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },
    async save(item) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put(item);
        tx.oncomplete = () => resolve(item);
        tx.onerror = () => reject(tx.error);
      });
    },
    async remove(id) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  };
}

const Storage = makeStore("stories");
const IdeaStorage = makeStore("ideas");
const BookStorage = makeStore("books");
