/* Service worker for the web version: keeps the app itself (HTML, code, data, fonts)
   so it opens without signal. Map tiles are handled by js/mapas.js through IndexedDB.
   Bump VERSION whenever app files change. */
const VERSION = 'senda-0.4.1';
const ARCHIVOS = [
  './', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'data/recorridos.js', 'data/destacados.js',
  'js/db.js', 'js/nativo.js', 'js/nube.js', 'js/mapas.js', 'js/clima.js', 'js/seguridad.js', 'js/comunidad.js', 'js/anuncios.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/supabase.js', 'vendor/fonts/fonts.css',
  'icons/icon-192.png', 'icons/icon-512.png',
  'fotos/canadon-palma/puerta.jpg', 'fotos/canadon-palma/cruz.jpg', 'fotos/canadon-palma/canadon.jpg',
  'legal/terminos.html', 'legal/privacidad.html',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// App files: network first (to get updates), cache when there is no signal.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copia = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copia)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
