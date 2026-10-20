/* Tiny IndexedDB wrapper used for everything that must survive without signal:
   kv (settings, cached data), tiles (map images), outbox (actions waiting for internet)
   and tracks (recorded walks). Falls back to memory if IndexedDB is unavailable. */
'use strict';

const DB = (() => {
  const STORES = ['kv', 'tiles', 'outbox', 'tracks'];
  const memoria = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  let abrir = null;

  function db() {
    if (!abrir) {
      abrir = new Promise((ok) => {
        try {
          const req = indexedDB.open('senda', 2);
          req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
          req.onsuccess = () => ok(req.result);
          req.onerror = () => ok(null);
        } catch { ok(null); }
      });
    }
    return abrir;
  }

  const req2p = (r) => new Promise((ok, mal) => { r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); });

  return {
    async get(store, key) {
      const d = await db();
      if (!d) return memoria[store].get(key);
      return req2p(d.transaction(store).objectStore(store).get(key));
    },
    async set(store, key, val) {
      const d = await db();
      if (!d) { memoria[store].set(key, val); return; }
      const t = d.transaction(store, 'readwrite'); t.objectStore(store).put(val, key);
      return new Promise((ok, mal) => { t.oncomplete = ok; t.onerror = () => mal(t.error); });
    },
    async del(store, key) {
      const d = await db();
      if (!d) { memoria[store].delete(key); return; }
      const t = d.transaction(store, 'readwrite'); t.objectStore(store).delete(key);
      return new Promise((ok) => { t.oncomplete = ok; t.onerror = ok; });
    },
    async keys(store) {
      const d = await db();
      if (!d) return [...memoria[store].keys()];
      return req2p(d.transaction(store).objectStore(store).getAllKeys());
    },
    async all(store) {
      const d = await db();
      if (!d) return [...memoria[store].entries()];
      const os = d.transaction(store).objectStore(store);
      const [k, v] = await Promise.all([req2p(os.getAllKeys()), req2p(os.getAll())]);
      return k.map((key, i) => [key, v[i]]);
    },
    async count(store) {
      const d = await db();
      if (!d) return memoria[store].size;
      return req2p(d.transaction(store).objectStore(store).count());
    },
  };
})();
window.DB = DB;
