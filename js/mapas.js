/* Map layers that keep working without signal. Every tile goes through IndexedDB:
   tiles you already saw are kept (up to a limit), and with a MapTiler key a whole trail
   can be downloaded before leaving. The free OpenStreetMap servers don't allow bulk
   downloads, so without a key only the tiles you already viewed stay available. */
'use strict';

const Mapas = (() => {
  const key = (window.SENDA_CONFIG || {}).maptilerKey;
  const FUENTES = key ? {
    relieve: { url: `https://api.maptiler.com/maps/outdoor-v2/256/{z}/{x}/{y}.png?key=${key}`, max: 18, attr: '<a href="https://www.maptiler.com/copyright/">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>' },
    satelite: { url: `https://api.maptiler.com/maps/satellite/256/{z}/{x}/{y}.jpg?key=${key}`, max: 19, attr: '<a href="https://www.maptiler.com/copyright/">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>' },
  } : {
    relieve: { url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', max: 17, attr: '© OpenStreetMap, SRTM · © OpenTopoMap (CC-BY-SA)' },
    // Second layer: satellite. OpenStreetMap's and CARTO's free street maps block apps without a key.
    satelite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 18, attr: 'Imágenes © Esri, Maxar, Earthstar Geographics' },
  };
  // Tiles saved by earlier versions under "mapa/" may be "API key required" placeholders.
  DB.keys('tiles').then((ks) => ks.filter((k) => String(k).startsWith('mapa/')).forEach((k) => DB.del('tiles', k))).catch(() => {});
  const descargable = !!key;
  const MAX_VISTAS = 4000;   // tiles kept from normal browsing
  const ZOOMS = [11, 12, 13, 14, 15, 16];
  const MAX_DESCARGA = 3500;
  let guardadas = 0;
  DB.count('tiles').then((n) => (guardadas = n)).catch(() => {});

  const urlDe = (id, z, x, y) => FUENTES[id].url.replace('{z}', z).replace('{x}', x).replace('{y}', y);

  const CapaOffline = L.TileLayer.extend({
    createTile(coords, done) {
      const img = document.createElement('img');
      img.alt = '';
      img.setAttribute('role', 'presentation');
      const id = this.options.capaId;
      const clave = `${id}/${coords.z}/${coords.x}/${coords.y}`;
      const url = urlDe(id, coords.z, coords.x, coords.y);
      img.onload = () => { if (img.src.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(img.src), 1000); done(null, img); };
      img.onerror = () => done(new Error('tile'), img);
      DB.get('tiles', clave).then(async (blob) => {
        if (blob) { img.src = URL.createObjectURL(blob); return; }
        if (!navigator.onLine) { img.onerror(); return; }
        try {
          const r = await fetch(url, { mode: 'cors' });
          if (!r.ok) throw new Error(r.status);
          const b = await r.blob();
          img.src = URL.createObjectURL(b);
          if (guardadas < MAX_VISTAS) { guardadas++; DB.set('tiles', clave, b).catch(() => {}); }
        } catch {
          img.src = url;   // the server doesn't allow reading it from code: show it anyway
        }
      }).catch(() => { img.src = url; });
      return img;
    },
  });

  const capa = (id) => new CapaOffline('', { capaId: id, maxZoom: FUENTES[id].max, maxNativeZoom: Math.min(FUENTES[id].max, 17), attribution: FUENTES[id].attr });

  // Tile numbers covering a box, for the given zooms.
  const tileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const tileY = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
  function tilesDe(r) {
    const pts = r.ruta.concat(r.paradas.map((p) => p.coord), [r.inicio.coord]);
    const m = 0.008;   // ~800 m around the trail
    const s = Math.min(...pts.map((p) => p[0])) - m, n = Math.max(...pts.map((p) => p[0])) + m;
    const w = Math.min(...pts.map((p) => p[1])) - m, e = Math.max(...pts.map((p) => p[1])) + m;
    const out = [];
    for (const z of ZOOMS) {
      for (let x = tileX(w, z); x <= tileX(e, z); x++) for (let y = tileY(n, z); y <= tileY(s, z); y++) out.push([z, x, y]);
    }
    return out;
  }

  async function guardarFotos(r) {
    for (const f of r.fotos || []) {
      if (f.src.startsWith('http') && !(await DB.get('kv', 'foto:' + f.src))) {
        try { const b = await (await fetch(f.src)).blob(); await DB.set('kv', 'foto:' + f.src, b); } catch { /* not critical */ }
      }
    }
  }

  return {
    capa,
    descargable,
    tilesDe,
    // Downloads both map styles for the trail. onProgreso(hechos, total).
    async descargar(r, onProgreso) {
      const lista = tilesDe(r);
      if (lista.length > MAX_DESCARGA) lista.length = MAX_DESCARGA;
      const capas = descargable ? ['relieve', 'satelite'] : [];
      const tareas = capas.flatMap((id) => lista.map(([z, x, y]) => [id, z, x, y]));
      let hechos = 0, fallas = 0;
      const cola = tareas.slice();
      async function trabajador() {
        while (cola.length) {
          const [id, z, x, y] = cola.shift();
          const clave = `${id}/${z}/${x}/${y}`;
          try {
            if (!(await DB.get('tiles', clave))) {
              const res = await fetch(urlDe(id, z, x, y));
              if (!res.ok) throw new Error(res.status);
              await DB.set('tiles', clave, await res.blob());
            }
          } catch { fallas++; }
          hechos++;
          if (hechos % 20 === 0 || hechos === tareas.length) onProgreso && onProgreso(hechos, tareas.length);
        }
      }
      await Promise.all([1, 2, 3, 4].map(trabajador));
      await guardarFotos(r);
      await DB.set('kv', 'descarga:' + r.id, { fecha: Date.now(), tiles: tareas.length - fallas, mapa: descargable });
      return { tiles: tareas.length - fallas, fallas };
    },
    async estado(r) { return DB.get('kv', 'descarga:' + r.id); },
    async borrar(r) {
      for (const [z, x, y] of tilesDe(r)) for (const id of ['relieve', 'satelite']) await DB.del('tiles', `${id}/${z}/${x}/${y}`);
      for (const f of r.fotos || []) await DB.del('kv', 'foto:' + f.src);
      await DB.del('kv', 'descarga:' + r.id);
    },
    // Local copy of a photo if it was downloaded, otherwise its normal address.
    async foto(src) {
      const b = await DB.get('kv', 'foto:' + src).catch(() => null);
      return b ? URL.createObjectURL(b) : src;
    },
  };
})();
window.Mapas = Mapas;
