// Persistencia por fotograma en IndexedDB.
// Claves: v0.1.0 usaba «sid:seed»; v0.2.0 usa «sid.K.S.L:seed» (una entrada por variante).
// La app migra las claves antiguas al arrancar.
//
// v0.0.1a reescribía TODO el lote en localStorage (base64, ~33 % más grande) en cada
// escaneo. Aquí cada fotograma es una fila; las escrituras se agrupan en una transacción
// por ráfaga, y solo se toca lo que cambió.
const NAME = 'shumzu';
const VERSION = 1;
const STORE = 'frames';

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) return reject(new Error('sin IndexedDB'));
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('base de datos bloqueada'));
  });
}

export class FrameDB {
  constructor() {
    this.db = null;
    this.ok = false;
    this.pending = new Map(); // clave -> bytes (escritura) | null (borrado)
    this.timer = null;
    this.onError = null;
  }

  async init() {
    try {
      this.db = await openDB();
      this.ok = true;
    } catch {
      this.ok = false;
    }
    return this.ok;
  }

  put(key, bytes) {
    if (!this.ok) return;
    this.pending.set(key, bytes);
    this._arm();
  }

  del(key) {
    if (!this.ok) return;
    this.pending.set(key, null);
    this._arm();
  }

  _arm() {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch((e) => this.onError?.(e));
    }, 120);
  }

  flush() {
    if (!this.ok || this.pending.size === 0) return Promise.resolve();
    const ops = [...this.pending];
    this.pending.clear();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      for (const [k, v] of ops) {
        if (v) os.put(v, k);
        else os.delete(k);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transacción abortada'));
    });
  }

  loadAll() {
    return this.loadEntries().then((list) => list.map((e) => e.bytes));
  }

  // [{ key, bytes }] en una sola transacción (getAllKeys + getAll, mismo orden).
  loadEntries() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readonly');
      const os = tx.objectStore(STORE);
      const rk = os.getAllKeys();
      const rv = os.getAll();
      tx.oncomplete = () => resolve(rk.result.map((key, i) => ({ key, bytes: new Uint8Array(rv.result[i]) })));
      tx.onerror = () => reject(tx.error);
    });
  }
}
