/* Senda — app de trekking colaborativa (Lavalleja y Maldonado).
   Trails come from data/recorridos.js (OpenStreetMap + elevation from Open-Meteo).
   Reports, safety, offline maps, weather and community live in js/*.js. */
'use strict';

// Trail icons (32×32, drawn with currentColor) — one per kind of trail.
const MONTE = 'M3 27 13 9l5 8 3-4 8 14z';
const ICONOS = {
  cumbre: `<path d="${MONTE}" fill="currentColor" opacity=".9"/><path d="m10.6 13 2.4-4 2.6 4.2-1.3-.8-1.3 1-1.2-1z" fill="#fff"/>`,
  'cumbre-cruz': `<path d="${MONTE}" fill="currentColor" opacity=".9"/><path d="M13 2v6M10.8 4h4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  'cascada-cumbre': `<path d="M2 27 12 8l6 10 3-4 9 13z" fill="currentColor" opacity=".9"/><path d="M14 13v12M17 16v9" stroke="#8FD3F4" stroke-width="2" stroke-linecap="round"/><path d="M11 27c2-1.6 6-1.6 9 0" stroke="#8FD3F4" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  canadon: `<path d="M1 29 13 7l5 8 3-4 10 18z" fill="currentColor"/><path d="M13 1.5v5M10.8 3.6h4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10 29 15 16l3 5 2-3 3 11z" fill="#fff"/><path d="M12 28.6c1.6-1.4 3.6-.2 5-1.2s3.4-.3 5 .4" stroke="#3BA7DB" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M16.2 19.5v5.5" stroke="#3BA7DB" stroke-width="1.8" stroke-linecap="round"/>`,
  cascada: `<path d="M3 29V8h11v21z" fill="currentColor"/><path d="M14 8c3 0 4 2 4 5v12M18.5 10.5c2.4.4 3 2.4 3 5v9" stroke="#8FD3F4" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M13 28c3-2 8-2 13 0" stroke="#8FD3F4" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
  cueva: `<path d="M2 28C4 15 10 8 16 8s12 7 14 20z" fill="currentColor" opacity=".9"/><path d="M11 28c0-6 2.2-9 5-9s5 3 5 9z" fill="#fff"/>`,
  rocas: `<path d="M4 28V18l4-3 3 3v10zM12 28V12l4-5 4 5v16zM21 28V16l4-2 3 3v11z" fill="currentColor" opacity=".9"/><path d="M2 28h28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  santuario: `<path d="M2 28c5-9 9-13 14-13s9 4 14 13z" fill="currentColor" opacity=".55"/><path d="M12 22v-6l4-4 4 4v6z" fill="currentColor"/><path d="M16 4v6M13.8 6.2h4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  bosque: `<path d="m9 4-6 11h4l-4 7h12l-4-7h4zM23 8l-5 9h3.4l-3.4 6h10l-3.4-6H28z" fill="currentColor" opacity=".9"/><path d="M9 22v6M23 23v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
};
const iconoSvg = (r, size = 28) => `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">${ICONOS[r.icono] || ICONOS.cumbre}</svg>`;
const ALERTA_METROS = 150;     // warn when walking this close to a report
const CERCA_RUTA_METROS = 250; // a report "belongs" to a trail within this distance
const FUERA_SENDERO_M = 80;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const toRad = (d) => (d * Math.PI) / 180;
function dist(a, b) {
  const R = 6371000, dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtKm = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
function hace(ts) {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d > 1 ? 's' : ''}`;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (t.hidden = true), 3200);
}
function mostrarAlerta(em, texto, ms = 8000) {
  const a = $('#alerta');
  a.innerHTML = `<span class="em">${em}</span><span>${texto}</span>`;
  a.hidden = false;
  clearTimeout(mostrarAlerta.t); mostrarAlerta.t = setTimeout(() => (a.hidden = true), ms);
}
// Distance from p to the segment a–b (local flat projection: fine at trail scale).
function distSeg(p, a, b) {
  const k = Math.cos(toRad(p[0])) * 111320, m = 110540;
  const ax = (a[1] - p[1]) * k, ay = (a[0] - p[0]) * m, bx = (b[1] - p[1]) * k, by = (b[0] - p[0]) * m;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  return { d: Math.hypot(ax + t * dx, ay + t * dy), t };
}
// Closest point of a route: index of the segment start, distance, and position inside the segment.
function masCercano(p, ruta) {
  if (ruta.length < 2) return { idx: 0, d: dist(p, ruta[0]), t: 0 };
  let idx = 0, best = Infinity, tt = 0;
  for (let i = 0; i < ruta.length - 1; i++) {
    const { d, t } = distSeg(p, ruta[i], ruta[i + 1]);
    if (d < best) { best = d; idx = i; tt = t; }
  }
  return { idx, d: best, t: tt };
}
const distARuta = (p, ruta) => masCercano(p, ruta).d;

// ─── State ────────────────────────────────────────────────────────────────────
const recorridos = window.RECORRIDOS || [];
const state = {
  filtro: 'Todos',
  seleccionado: null,
  navegando: false,
  yo: null,          // [lat, lon]
  pararGps: null,
  simulacion: null,
  avisados: new Set(),
  colocando: null,   // pending report while choosing a spot on the map
  idx: null,         // closest route point while walking
  fuera: false,
};

// Demo reports so the map isn't empty when there is no server. They are labeled "ejemplo".
function ejemplos() {
  const ahora = Date.now(), min = 60000;
  const cerca = (id, i, dLat = 0.0004, dLon = 0.0003) => {
    const r = recorridos.find((x) => x.id === id);
    if (!r) return null;
    const p = r.ruta[Math.min(r.ruta.length - 1, Math.floor(r.ruta.length * i))];
    return [p[0] + dLat, p[1] + dLon];
  };
  return [
    { tipo: 'barro', coord: cerca('cerro-animas', 0.55), comentario: 'Después de la lluvia el tramo junto a los pozos está muy resbaloso.', creado: ahora - 50 * min },
    { tipo: 'perros', coord: cerca('pan-de-azucar', 0.2), comentario: 'Dos perros sueltos cerca del inicio, no atacan pero ladran mucho.', creado: ahora - 120 * min },
    { tipo: 'vibora', coord: cerca('canadon-palma', 0.35), comentario: 'Vimos una crucera tomando sol sobre las piedras.', creado: ahora - 25 * min },
    { tipo: 'agua', coord: cerca('arequita', 0.4), comentario: 'Canilla con agua potable en el camping.', creado: ahora - 3 * 24 * 60 * min },
    { tipo: 'bloqueo', coord: cerca('villa-serrana-penitente', 0.92), comentario: 'Árbol caído en el sendero, se puede rodear por la izquierda.', creado: ahora - 5 * 60 * min },
  ].filter((r) => r.coord).map((r, i) => ({
    id: 'demo-' + i, demo: true, si: 0, no: 0, ...r,
    vence: r.creado + 365 * 24 * 3600 * 1000,
  }));
}

function votar(id, sigue) {
  if (Reportes.yaVote(id)) { toast('Ya votaste este aviso'); return; }
  const r = Reportes.votar(id, sigue);
  if (!r) return;
  map.closePopup();
  toast(sigue ? 'Gracias, el aviso sigue activo.' : r.no >= 2 ? 'Aviso quitado del mapa.' : 'Gracias por avisar.');
}
window.votar = votar;

// ─── Map ──────────────────────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([-34.6, -55.1], 9);
const capas = { satelite: Mapas.capa('satelite'), relieve: Mapas.capa('relieve') };
let capaActual = 'relieve';
capas[capaActual].addTo(map);
L.control.zoom({ position: 'topright' }).addTo(map);

const capaRecorridos = L.layerGroup().addTo(map);
const capaDetalle = L.layerGroup().addTo(map);
const capaReportes = L.layerGroup().addTo(map);
const capaGrabacion = L.layerGroup().addTo(map);
let marcadorYo = null;

const icono = (cls, html, size) => L.divIcon({ className: '', html: `<div class="mk ${cls}">${html}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

function dibujarMarcadoresRecorridos() {
  capaRecorridos.clearLayers();
  for (const r of filtrados()) {
    const p = r.paradas[r.paradas.length - 1].coord;
    L.marker(p, { icon: icono('mk-trail', iconoSvg(r, 26), 40), title: r.nombre })
      .on('click', () => seleccionar(r.id)).addTo(capaRecorridos);
  }
}

/* Only the reports that matter here: along the open trail, or around you when no trail
   is open. Your own reports always show, so you can see what you posted. */
const RADIO_AVISOS_M = 5000;
function avisosVisibles() {
  const todos = Reportes.vigentes();
  const cerca = state.seleccionado
    ? (x) => distARuta(x.coord, state.seleccionado.ruta) < CERCA_RUTA_METROS
    : state.yo ? (x) => dist(state.yo, x.coord) < RADIO_AVISOS_M : () => false;
  return todos.filter((x) => x.mio || cerca(x));
}

let yoDibujado = null; // where you were when the reports were last drawn
function dibujarReportes() {
  capaReportes.clearLayers();
  yoDibujado = state.yo;
  for (const r of avisosVisibles()) {
    const t = TIPO[r.tipo];
    const votado = Reportes.yaVote(r.id);
    const html = `<div class="pop"><h4>${t.em} ${t.label}</h4><small>${hace(r.creado)}${r.demo ? ' · ejemplo' : ''}${r.pendiente ? ' · esperando señal para publicarse' : ''}${r.si ? ` · ${r.si} lo confirmaron` : ''}</small>
      ${r.comentario ? `<p style="margin:8px 0 0">${esc(r.comentario)}</p>` : ''}
      ${votado ? '<p class="fine" style="margin:8px 0 0">Ya votaste este aviso.</p>' : r.mio ? '' : `<div class="votes"><button class="si" onclick="votar('${r.id}', true)">Sigue ahí</button><button class="no" onclick="votar('${r.id}', false)">Ya no está</button></div>`}</div>`;
    L.marker(r.coord, { icon: icono('mk-report' + (r.demo ? ' demo' : '') + (r.pendiente ? ' pendiente' : ''), t.em, 34), title: t.label, zIndexOffset: 500 })
      .bindPopup(html).addTo(capaReportes);
  }
}

function dibujarDetalle(r) {
  capaDetalle.clearLayers();
  for (const c of r.caminos) L.polyline(c, { color: '#8A6A3B', weight: 2.5, opacity: 0.75, dashArray: '5 6' }).addTo(capaDetalle);
  L.polyline(r.ruta, { color: '#fff', weight: 9, opacity: 0.9 }).addTo(capaDetalle);
  L.polyline(r.ruta, { color: '#1F4D3A', weight: 5 }).addTo(capaDetalle);
  for (const s of r.sinSendero || []) {
    L.polyline(s, { color: '#fff', weight: 9, opacity: 1 }).addTo(capaDetalle);
    L.polyline(s, { color: '#1F4D3A', weight: 4, dashArray: '2 8', lineCap: 'round' }).addTo(capaDetalle);
  }
  L.marker(r.inicio.coord, { icon: icono('mk-start', 'I', 30), title: r.inicio.nombre }).bindPopup(`<div class="pop"><h4>Inicio</h4><small>${esc(r.inicio.nombre)}</small></div>`).addTo(capaDetalle);
  r.paradas.forEach((p, i) => {
    L.marker(p.coord, { icon: icono('mk-stop', i + 1, 28), title: p.nombre })
      .bindPopup(`<div class="pop"><h4>${esc(p.nombre)}</h4>${p.nota ? `<small>${esc(p.nota)}</small>` : ''}</div>`).addTo(capaDetalle);
  });
}

// Line of the walk being recorded (called from the recorder).
window.trazoGrabacion = (puntos) => {
  capaGrabacion.clearLayers();
  if (puntos.length > 1) L.polyline(puntos.map((p) => [p[0], p[1]]), { color: '#C2255C', weight: 4 }).addTo(capaGrabacion);
};

// ─── Trail status, elevation profile ──────────────────────────────────────────
const filtrados = () => recorridos.filter((r) => state.filtro === 'Todos' || r.departamento === state.filtro || r.dificultad === state.filtro);
const reportesDe = (r) => Reportes.vigentes().filter((x) => distARuta(x.coord, r.ruta) < CERCA_RUTA_METROS);

// Status derived from the reports along the trail.
function estadoDe(r) {
  const tipos = new Set(reportesDe(r).filter((x) => !x.demo).map((x) => x.tipo));
  if (tipos.has('cerrado')) return { clase: 'cerrado', txt: 'Cerrado', det: 'Alguien reportó el paso cerrado. Confirmá antes de ir.' };
  if (tipos.has('incendio')) return { clase: 'peligro', txt: 'Fuego o humo', det: 'Hay un reporte de fuego cerca. No vayas hasta que se confirme que pasó.' };
  const prec = ['crecida', 'bloqueo', 'niebla', 'ayuda'].filter((t) => tipos.has(t));
  if (prec.length) return { clase: 'precaucion', txt: 'Precaución', det: prec.map((t) => TIPO[t].label).join(', ') + '.' };
  return { clase: 'ok', txt: 'Sin problemas reportados', det: '' };
}

function perfilSvg(r, idx) {
  if (!r.perfil || r.perfil.length < 3) return '';
  const W = 340, H = 96, P = 4;
  const total = r.perfil[r.perfil.length - 1][0] || 1;
  const min = r.altMin, max = Math.max(r.altMax, r.altMin + 20);
  const x = (d) => P + (d / total) * (W - 2 * P);
  const y = (a) => H - P - ((a - min) / (max - min)) * (H - 2 * P - 14);
  const linea = r.perfil.map(([d, a], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)} ${y(a).toFixed(1)}`).join('');
  let yo = '';
  if (idx != null) {
    // distance along the route to the closest point → position on the profile
    let d = 0;
    for (let i = 0; i < idx && i < r.ruta.length - 1; i++) d += dist(r.ruta[i], r.ruta[i + 1]);
    const k = r.perfil.reduce((b, p, i) => (Math.abs(p[0] - d) < Math.abs(r.perfil[b][0] - d) ? i : b), 0);
    yo = `<circle cx="${x(r.perfil[k][0]).toFixed(1)}" cy="${y(r.perfil[k][1]).toFixed(1)}" r="5" fill="#1C7ED6" stroke="#fff" stroke-width="2"/>`;
  }
  return `<figure class="perfil"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Perfil de altura: sube ${r.subidaM} metros, máximo ${r.altMax} metros">
    <path d="${linea}L${x(total)} ${H - P}L${P} ${H - P}Z" fill="#7FA35B" opacity=".25"/><path d="${linea}" fill="none" stroke="#1F4D3A" stroke-width="2.2"/>
    <text x="${P + 2}" y="12" font-size="10" fill="#5E6B62">${max} m</text><text x="${P + 2}" y="${H - P - 3}" font-size="10" fill="#5E6B62">${min} m</text>${yo}</svg>
    <figcaption>↗ ${r.subidaM} m de subida · ↘ ${r.bajadaM} m de bajada · altura máxima ${r.altMax} m</figcaption></figure>`;
}

// ─── Trails list / detail ─────────────────────────────────────────────────────
function setSheet(h) { document.documentElement.style.setProperty('--sheet-h', h); document.body.classList.toggle('sheet-alta', h === '85vh'); }
let descargados = new Set();
async function cargarDescargados() {
  const claves = await DB.keys('kv').catch(() => []);
  descargados = new Set(claves.filter((k) => String(k).startsWith('descarga:')).map((k) => k.slice(9)));
}

// Banner only on the list and trail screens: never while walking, placing a report or under a dialog.
const anuncioVisible = () => !state.navegando && !state.colocando && $('#modal').hidden;

function render() {
  const body = $('#sheet-body');
  Anuncios.poner(anuncioVisible());
  if (!state.seleccionado) {
    const filtros = ['Todos', 'Maldonado', 'Lavalleja', 'Fácil', 'Media', 'Difícil'];
    body.innerHTML = `
      <h2>Recorridos</h2>
      <p class="lead">Senderos de Lavalleja y Maldonado, con avisos de otros caminantes.</p>
      <div class="chips" role="group" aria-label="Filtrar">${filtros.map((f) => `<button class="chip" aria-pressed="${f === state.filtro}" data-filtro="${f}">${f}</button>`).join('')}</div>
      <div>${filtrados().map((r) => {
        const n = reportesDe(r).filter((x) => x.tipo !== 'agua').length;
        const e = estadoDe(r);
        return `<button class="trail" data-id="${r.id}">
          <span class="trail-icon">${iconoSvg(r, 38)}</span>
          <span><h3>${esc(r.nombre)}</h3><span class="meta">${esc(r.zona)}, ${r.departamento} · ${fmtKm(r.distanciaKm * 1000)}${r.subidaM ? ` · ↗ ${r.subidaM} m` : ''}${n ? `<span class="reportes-pill">⚠ ${n}</span>` : ''}${e.clase !== 'ok' ? `<span class="estado-pill e-${e.clase}">${e.txt}</span>` : ''}${descargados.has(r.id) ? '<span class="offline-pill" title="Disponible sin señal">⬇ sin señal</span>' : ''}</span></span>
          <span class="badge d-${r.dificultad}">${r.dificultad}</span></button>`;
      }).join('') || '<p class="empty">No hay recorridos con ese filtro.</p>'}</div>
      <p class="fine">Recorridos calculados sobre senderos de OpenStreetMap. Son una guía: verificá siempre las condiciones en el lugar.</p>`;
    body.querySelectorAll('[data-filtro]').forEach((b) => b.onclick = () => { state.filtro = b.dataset.filtro; dibujarMarcadoresRecorridos(); render(); });
    body.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => seleccionar(b.dataset.id));
    return;
  }

  const r = state.seleccionado;
  const avisos = reportesDe(r);
  const e = estadoDe(r);
  body.innerHTML = `
    <button class="back" id="volver">← Todos los recorridos</button>
    <h2>${esc(r.nombre)}</h2>
    <p class="lead">${esc(r.zona)}, ${r.departamento} · <span class="badge d-${r.dificultad}">${r.dificultad}</span></p>
    <div class="estado e-${e.clase}"><b>${e.txt}</b>${e.det ? ` · ${esc(e.det)}` : ''}</div>
    ${state.navegando ? progresoHtml(r) : ''}
    <div class="stats">
      <div class="stat"><b>${fmtKm(r.distanciaKm * 1000)}</b><span>${r.circular ? 'circuito' : 'hasta la última parada'}</span></div>
      <div class="stat"><b>${esc(r.duracion.replace(' ida y vuelta', '').replace(/ a /g, '–'))}</b><span>${r.duracion.includes('ida y vuelta') ? 'ida y vuelta' : 'duración estimada'}</span></div>
      <div class="stat"><b>${r.subidaM != null ? '↗ ' + r.subidaM + ' m' : avisos.length}</b><span>${r.subidaM != null ? 'de subida' : 'avisos activos'}</span></div>
    </div>
    <div class="actions">
      ${state.navegando
        ? `<button class="btn btn-stop" id="terminar">Terminar recorrido</button>`
        : `<button class="btn btn-main" id="empezar">Empezar recorrido</button>`}
      <a class="btn btn-ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${r.inicio.coord.join(',')}">Cómo llegar al inicio</a>
      ${!state.navegando ? `<button class="btn btn-ghost" id="descargar">${descargados.has(r.id) ? '✓ Disponible sin señal' : 'Descargar para usar sin señal'}</button>` : ''}
      ${!state.navegando ? `<button class="btn btn-ghost" id="simular" title="Para probar la app sin salir de casa">Simular caminata</button>` : ''}
      ${r.web ? `<a class="btn btn-ghost" target="_blank" rel="noopener" href="${r.web}">Web del lugar</a>` : ''}
    </div>
    <div id="perfil-cont">${perfilSvg(r, state.navegando ? state.idx : null)}</div>
    <h3 class="sec-title">Clima en la zona</h3>
    <div id="clima"><p class="empty">Cargando pronóstico…</p></div>
    ${r.fotos && r.fotos.length ? `<div class="fotos">${r.fotos.map((f) => `<figure><img data-src="${f.src}" alt="${esc(f.pie)}" loading="lazy"><figcaption>${esc(f.pie)}${f.autor ? `<small>Foto: ${esc(f.autor)}, <a href="${f.pagina}" target="_blank" rel="noopener">${esc(f.licencia)}</a></small>` : ''}</figcaption></figure>`).join('')}</div>` : ''}
    <p>${esc(r.descripcion)}</p>
    <h3 class="sec-title">Lugares del recorrido</h3>
    <ol class="stops">
      <li><span class="num start">I</span><span>${esc(r.inicio.nombre)}<small>Punto de partida</small></span></li>
      ${r.paradas.map((p, i) => `<li><span class="num">${i + 1}</span><span>${esc(p.nombre)}${p.nota ? `<small>${esc(p.nota)}</small>` : ''}</span></li>`).join('')}
    </ol>
    <h3 class="sec-title">Avisos en el camino</h3>
    ${avisos.length ? avisos.map((a) => `<div class="report-row"><span class="em">${TIPO[a.tipo].em}</span><div><b>${TIPO[a.tipo].label}</b><small>${hace(a.creado)}${a.demo ? ' · ejemplo' : ''}${a.pendiente ? ' · esperando señal' : ''}</small>${a.comentario ? `<div>${esc(a.comentario)}</div>` : ''}</div></div>`).join('') : '<p class="empty">Nadie reportó nada en este recorrido. Si ves algo, avisá con el botón Reportar.</p>'}
    <h3 class="sec-title">Antes de salir</h3>
    <ul class="tips">${r.consejos.map((c) => `<li>${esc(c)}</li>`).join('')}<li>Acceso: ${esc(r.acceso)}.</li><li>Avisale a alguien a dónde vas y a qué hora pensás volver: Senda te ayuda al tocar "Empezar recorrido".</li></ul>
    ${Comunidad.destacadosHtml(r)}
    <h3 class="sec-title">Fotos y comentarios de caminantes</h3>
    <div id="comunidad"><button class="btn btn-ghost" id="ver-comunidad">Ver fotos y comentarios</button></div>
    <p class="fine">Las líneas punteadas marrones son otros senderos de la zona: caminos posibles para variar el recorrido.${(r.sinSendero || []).length ? ' Los puntos verdes marcan tramos sin sendero mapeado: se camina a campo o por una senda que todavía no está en el mapa.' : ''}</p>`;
  $('#volver').onclick = deseleccionar;
  if ($('#empezar')) $('#empezar').onclick = () => empezar(false);
  if ($('#simular')) $('#simular').onclick = () => empezar(true);
  if ($('#terminar')) $('#terminar').onclick = () => terminar(true);
  if ($('#descargar')) $('#descargar').onclick = () => gestionarDescarga(r);
  $('#ver-comunidad').onclick = () => { $('#comunidad').innerHTML = '<p class="empty">Cargando…</p>'; Comunidad.cargarSeccion(r, $('#comunidad')); };
  body.querySelectorAll('img[data-src]').forEach(async (img) => { img.src = await Mapas.foto(img.dataset.src); });
  Clima.de(r).then((c) => { if (state.seleccionado === r && $('#clima')) $('#clima').innerHTML = Clima.html(c); });
}

function progresoHtml(r) {
  if (!state.yo) return `<div class="progress">Buscando tu ubicación…</div>`;
  const { idx, d, t } = masCercano(state.yo, r.ruta);
  let resta = 0;
  for (let i = idx; i < r.ruta.length - 1; i++) resta += dist(r.ruta[i], r.ruta[i + 1]);
  if (r.ruta.length > 1) resta -= t * dist(r.ruta[idx], r.ruta[idx + 1]);
  const fuera = d > FUERA_SENDERO_M ? `<div style="color:var(--danger);font-weight:700;margin-top:4px">Estás a ${fmtKm(d)} del sendero</div>` : '';
  return `<div class="progress"><b>${fmtKm(resta)}</b> para terminar${fuera}</div>`;
}

function seleccionar(id) {
  const r = recorridos.find((x) => x.id === id);
  if (!r) return;
  state.seleccionado = r;
  capaRecorridos.clearLayers();
  dibujarDetalle(r);
  dibujarReportes();
  setSheet(window.innerWidth < 900 ? '52vh' : '38vh');
  const bounds = L.latLngBounds(r.ruta.concat(r.paradas.map((p) => p.coord)));
  setTimeout(() => map.fitBounds(bounds, { maxZoom: 16, paddingTopLeft: window.innerWidth >= 900 ? [430, 80] : [30, 80], paddingBottomRight: [30, window.innerWidth >= 900 ? 30 : window.innerHeight * 0.52 + 20] }), 50);
  render();
}

function deseleccionar() {
  if (state.navegando) terminar(false);
  state.seleccionado = null;
  capaDetalle.clearLayers();
  dibujarMarcadoresRecorridos();
  dibujarReportes();
  setSheet('38vh');
  map.flyTo([-34.6, -55.1], 9, { duration: 0.6 });
  render();
}

// ─── Offline download ─────────────────────────────────────────────────────────
async function gestionarDescarga(r) {
  const est = await Mapas.estado(r);
  if (est) {
    abrirModal(`<h2 id="modal-title">Disponible sin señal</h2>
      <p class="lead">Descargado el ${new Date(est.fecha).toLocaleDateString('es-UY')}. ${est.mapa ? `Incluye el mapa de la zona (${est.tiles} partes), el sendero, las fotos y el pronóstico.` : 'Incluye el sendero, las fotos y el pronóstico; del mapa, solo las zonas que ya miraste.'}</p>
      <div class="modal-actions"><button class="btn btn-ghost" id="dl-borrar">Borrar descarga</button><button class="btn btn-main" id="dl-act">Actualizar</button></div>`);
    $('#dl-borrar').onclick = async () => { cerrarModal(); await Mapas.borrar(r); await cargarDescargados(); render(); toast('Descarga borrada'); };
    $('#dl-act').onclick = () => { cerrarModal(); descargar(r); };
    return;
  }
  if (!Mapas.descargable) {
    abrirModal(`<h2 id="modal-title">Descargar para usar sin señal</h2>
      <p class="lead">Se guardan el sendero, las fotos y el pronóstico. Del mapa se guardan las zonas que ya hayas mirado: antes de salir, recorré el sendero en el mapa con buen zoom.</p>
      <p class="fine">La descarga completa del mapa se activa cuando Senda tenga su proveedor de mapas (MapTiler).</p>
      <div class="modal-actions"><button class="btn btn-ghost" id="dl-no">Cancelar</button><button class="btn btn-main" id="dl-si">Descargar</button></div>`);
    $('#dl-no').onclick = cerrarModal;
    $('#dl-si').onclick = () => { cerrarModal(); descargar(r); };
    return;
  }
  descargar(r);
}

async function descargar(r) {
  if (!navigator.onLine) return toast('Necesitás conexión para descargar');
  const btn = $('#descargar');
  if (btn) { btn.disabled = true; btn.textContent = 'Descargando…'; }
  await Clima.de(r);
  const res = await Mapas.descargar(r, (h, t) => { const b = $('#descargar'); if (b) b.textContent = `Descargando ${Math.round((h / t) * 100)}%`; });
  await cargarDescargados();
  if (state.seleccionado === r) render();
  toast(res.fallas ? `Descargado, con ${res.fallas} partes del mapa que fallaron` : 'Listo: este recorrido funciona sin señal');
}

// ─── Walking mode: GPS (or simulation) + hazard alerts ───────────────────────
function moverYo(p, { centrar = true } = {}) {
  state.yo = p;
  if (!marcadorYo) marcadorYo = L.marker(p, { icon: icono('mk-me', '', 20), zIndexOffset: 1000, interactive: false }).addTo(map);
  else marcadorYo.setLatLng(p);
  if (!state.seleccionado && (!yoDibujado || dist(yoDibujado, p) > 300)) dibujarReportes();
  if (state.navegando && state.seleccionado) {
    const r = state.seleccionado;
    const { idx, d } = masCercano(p, r.ruta);
    state.idx = idx;
    if (centrar) map.panTo(p, { animate: true });
    revisarPeligros();
    Seguridad.posicion(p, idx);
    if (d > FUERA_SENDERO_M && !state.fuera) { state.fuera = true; Nativo.vibrar([300]); mostrarAlerta('🧭', `Te alejaste ${fmtKm(d)} del sendero.`, 6000); }
    if (d < FUERA_SENDERO_M * 0.6) state.fuera = false;
    const prog = document.querySelector('.progress');
    if (prog) prog.outerHTML = progresoHtml(r);
    const pc = $('#perfil-cont');
    if (pc) pc.innerHTML = perfilSvg(r, idx);
  }
}
window.moverYo = moverYo;

function revisarPeligros() {
  const cerca = Reportes.vigentes().filter((r) => r.tipo !== 'agua' && dist(state.yo, r.coord) < ALERTA_METROS);
  const nuevo = cerca.find((r) => !state.avisados.has(r.id));
  if (nuevo) {
    state.avisados.add(nuevo.id);
    const t = TIPO[nuevo.tipo];
    mostrarAlerta(t.em, `${t.label} a ${fmtKm(dist(state.yo, nuevo.coord))}${nuevo.comentario ? `: ${esc(nuevo.comentario)}` : ''}`);
    Nativo.vibrar();
    if (document.hidden) Nativo.notificar(`${t.em} ${t.label} cerca`, nuevo.comentario || 'Hay un aviso a menos de 150 m.');
  }
}

async function empezar(simular) {
  if (!state.seleccionado) return;
  const r = state.seleccionado;
  if (!simular) {
    const o = await Seguridad.preparar(r);
    if (!o) return;
    await Seguridad.iniciar(r, o);
  }
  state.navegando = true;
  Anuncios.poner(false);
  state.avisados.clear();
  state.fuera = false;
  setSheet('34vh');
  render();
  if (simular) {
    // Walk along the route in ~40 m steps, fast, so the alerts can be tested from home.
    const pasos = [];
    for (let k = 0; k < r.ruta.length - 1; k++) {
      const a = r.ruta[k], b = r.ruta[k + 1], n = Math.max(1, Math.round(dist(a, b) / 40));
      for (let j = 0; j < n; j++) pasos.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
    }
    pasos.push(r.ruta[r.ruta.length - 1]);
    let i = 0;
    moverYo(pasos[0]);
    state.simulacion = setInterval(() => {
      i++;
      if (i >= pasos.length) { clearInterval(state.simulacion); state.simulacion = null; toast('¡Llegaste! Fin de la simulación.'); return; }
      moverYo(pasos[i]);
    }, 250);
    toast('Simulando la caminata por el sendero…');
    return;
  }
  state.pararGps = await Nativo.seguir((pos) => moverYo([pos.lat, pos.lon]), () => toast('No pudimos acceder a tu ubicación. Revisá los permisos.'), { fondo: true });
}

async function terminar(llegue) {
  const eraReal = !!state.pararGps;
  state.navegando = false;
  if (state.pararGps) state.pararGps();
  if (state.simulacion) clearInterval(state.simulacion);
  state.pararGps = null; state.simulacion = null; state.idx = null;
  $('#alerta').hidden = true;
  if (Seguridad.activo()) await Seguridad.terminar();
  if (llegue && eraReal) toast('¡Bien ahí! Recorrido terminado.');
  if (state.seleccionado) { setSheet(window.innerWidth < 900 ? '52vh' : '38vh'); render(); }
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function abrirModal(html) { Anuncios.poner(false); $('#modal-content').innerHTML = html; $('#modal').hidden = false; const f = $('#modal-content').querySelector('input,textarea,button'); if (f) f.focus({ preventScroll: true }); }
function cerrarModal() { $('#modal').hidden = true; Anuncios.poner(anuncioVisible()); }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !$('#modal').dataset.fijo) cerrarModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').dataset.fijo) { cerrarModal(); cancelarColocacion(); } });

// ─── Report flow ──────────────────────────────────────────────────────────────
function abrirReporte() {
  let elegido = null, lugar = state.yo ? 'gps' : 'mapa';
  abrirModal(`
    <h2 id="modal-title">¿Qué encontraste?</h2>
    <p class="lead">Tu aviso le aparece a quienes pasen por la zona.${!navigator.onLine ? ' Estás sin señal: se publica cuando vuelva la conexión.' : ''}</p>
    <div class="grid-tipos">${TIPOS.map((t) => `<button class="tipo" data-tipo="${t.id}" aria-pressed="false"><span class="em">${t.em}</span>${t.label}</button>`).join('')}</div>
    <label class="field"><span>Detalle (opcional)</span><textarea id="rep-comentario" maxlength="200" placeholder="Ej.: árbol caído, se puede rodear por la izquierda"></textarea></label>
    <div class="field"><span>¿Dónde?</span>
      <div class="seg" role="group"><button data-lugar="gps" aria-pressed="${lugar === 'gps'}">Donde estoy</button><button data-lugar="mapa" aria-pressed="${lugar === 'mapa'}">Elegir en el mapa</button></div>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" id="rep-cancelar">Cancelar</button><button class="btn btn-main" id="rep-ok" disabled style="opacity:.5">Publicar aviso</button></div>`);
  const ok = $('#rep-ok');
  document.querySelectorAll('[data-tipo]').forEach((b) => b.onclick = () => {
    document.querySelectorAll('[data-tipo]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', 'true'); elegido = b.dataset.tipo; ok.disabled = false; ok.style.opacity = 1;
  });
  document.querySelectorAll('[data-lugar]').forEach((b) => b.onclick = () => {
    document.querySelectorAll('[data-lugar]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', 'true'); lugar = b.dataset.lugar;
  });
  $('#rep-cancelar').onclick = cerrarModal;
  ok.onclick = async () => {
    const comentario = $('#rep-comentario').value.trim();
    cerrarModal();
    if (lugar === 'gps') {
      if (state.yo) return publicar(elegido, state.yo, comentario);
      try { const p = await Nativo.posicion(); moverYo(p, { centrar: false }); publicar(elegido, p, comentario); }
      catch { toast('Sin ubicación: elegí el lugar en el mapa.'); colocarEnMapa(elegido, comentario); }
    } else colocarEnMapa(elegido, comentario);
  };
}

function colocarEnMapa(tipo, comentario) {
  state.colocando = { tipo, comentario };
  Anuncios.poner(false);
  $('#crosshair').hidden = false;
  const body = $('#sheet-body');
  body.innerHTML = `<h2>Mové el mapa</h2><p class="lead">Poné la cruz naranja donde está ${TIPO[tipo].em} ${TIPO[tipo].label.toLowerCase()}.</p>
    <div class="actions"><button class="btn btn-main" id="colocar-ok">Confirmar acá</button><button class="btn btn-ghost" id="colocar-cancelar">Cancelar</button></div>`;
  setSheet('24vh');
  $('#colocar-ok').onclick = () => {
    const el = $('#crosshair').getBoundingClientRect();
    const pt = map.containerPointToLatLng([el.left + el.width / 2, el.top + el.height / 2]);
    const { tipo: t, comentario: c } = state.colocando;
    cancelarColocacion();
    publicar(t, [pt.lat, pt.lng], c);
  };
  $('#colocar-cancelar').onclick = cancelarColocacion;
}

function cancelarColocacion() {
  if (!state.colocando) return;
  state.colocando = null;
  $('#crosshair').hidden = true;
  setSheet(state.seleccionado ? (window.innerWidth < 900 ? '52vh' : '38vh') : '38vh');
  render();
}

function publicar(tipo, coord, comentario) {
  Reportes.crear(tipo, coord, comentario);
  toast(navigator.onLine || !Nube.activa ? `Aviso publicado: ${TIPO[tipo].em} ${TIPO[tipo].label}` : 'Aviso guardado: se publica cuando vuelva la señal');
}

// ─── SOS ──────────────────────────────────────────────────────────────────────
function abrirSOS() {
  const pinta = async (p) => {
    const txt = p ? `${p[0].toFixed(5)}, ${p[1].toFixed(5)}` : 'Buscando ubicación…';
    const link = p ? `https://maps.google.com/?q=${p[0].toFixed(5)},${p[1].toFixed(5)}` : '';
    abrirModal(`
      <h2 id="modal-title">Emergencia</h2>
      <p class="lead">En Uruguay, el 911 atiende policía, bomberos y emergencias médicas. Si no tenés datos, la llamada y los SMS a veces igual entran.</p>
      <div class="actions"><a class="btn btn-stop" href="tel:911">Llamar al 911</a></div>
      <div class="progress"><small>Tu ubicación para pasar por teléfono</small><br><b style="font-size:1.1rem">${txt}</b></div>
      <div class="actions">
        ${p ? `<button class="btn btn-ghost" id="sos-copiar">Copiar coordenadas</button>
        <a class="btn btn-ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Necesito ayuda, estoy acá: ' + link)}">Enviar por WhatsApp</a>` : ''}
        ${await Seguridad.botonesSOS(p)}
      </div>
      <div class="modal-actions"><button class="btn btn-ghost" id="sos-cerrar">Cerrar</button></div>`);
    $('#sos-cerrar').onclick = cerrarModal;
    if ($('#sos-copiar')) $('#sos-copiar').onclick = async () => { try { await navigator.clipboard.writeText(`${txt} ${link}`); toast('Coordenadas copiadas'); } catch { toast(txt); } };
    if ($('#sos-compartir')) $('#sos-compartir').onclick = () => Nativo.compartir({ titulo: 'Necesito ayuda', texto: `Necesito ayuda. Estoy acá: ${link}` });
  };
  pinta(state.yo);
  if (!state.yo) Nativo.posicion().then((p) => { moverYo(p, { centrar: false }); if (!$('#modal').hidden) pinta(state.yo); }).catch(() => {});
}

// ─── Menu ─────────────────────────────────────────────────────────────────────
async function abrirMenu() {
  const n = descargados.size;
  abrirModal(`<h2 id="modal-title">Senda</h2>
    <div class="menu">
      <button data-m="cuenta"><span>👤</span>Tu cuenta y puntos</button>
      <button data-m="grabar"><span>📍</span>Grabar un recorrido</button>
      <button data-m="descargas"><span>⬇</span>Recorridos sin señal <small>${n ? `${n} descargado${n > 1 ? 's' : ''}` : 'ninguno'}</small></button>
      <button data-m="contacto"><span>🆘</span>Contacto de emergencia</button>
      <a href="legal/terminos.html" target="_blank"><span>📄</span>Términos y responsabilidad</a>
      <a href="legal/privacidad.html" target="_blank"><span>🔒</span>Privacidad</a>
      <button data-m="acerca"><span>ℹ️</span>Acerca de Senda</button>
    </div>`);
  document.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => ({
    cuenta: Comunidad.abrirCuenta,
    grabar: Comunidad.Grabador.lista,
    descargas: verDescargas,
    contacto: editarContacto,
    acerca: verAcerca,
  })[b.dataset.m]());
}

function verDescargas() {
  const l = recorridos.filter((r) => descargados.has(r.id));
  abrirModal(`<h2 id="modal-title">Recorridos sin señal</h2>
    <p class="lead">Descargalos con buena conexión antes de salir: en las sierras casi no hay señal.</p>
    ${l.length ? l.map((r) => `<button class="trail" data-id="${r.id}"><span class="trail-icon">${iconoSvg(r, 30)}</span><span><h3>${esc(r.nombre)}</h3><span class="meta">${r.departamento}</span></span></button>`).join('') : '<p class="empty">Todavía no descargaste ninguno. Entrá a un recorrido y tocá "Descargar para usar sin señal".</p>'}
    <div class="modal-actions"><button class="btn btn-ghost" id="dl-cerrar">Cerrar</button></div>`);
  $('#dl-cerrar').onclick = cerrarModal;
  document.querySelectorAll('#modal [data-id]').forEach((b) => b.onclick = () => { cerrarModal(); seleccionar(b.dataset.id); });
}

async function editarContacto() {
  const c = (await Seguridad.contacto()) || {};
  abrirModal(`<h2 id="modal-title">Contacto de emergencia</h2>
    <p class="lead">Aparece en el botón SOS y es a quien avisamos si no marcás que llegaste.</p>
    <div class="fila-2"><input id="ct-nombre" placeholder="Nombre" value="${esc(c.nombre || '')}"><input id="ct-tel" type="tel" placeholder="Celular (09…)" value="${esc(c.tel || '')}"></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="ct-cancelar">Cancelar</button><button class="btn btn-main" id="ct-ok">Guardar</button></div>`);
  $('#ct-cancelar').onclick = cerrarModal;
  $('#ct-ok').onclick = async () => { await Seguridad.guardarContacto({ nombre: $('#ct-nombre').value.trim(), tel: $('#ct-tel').value.replace(/[^\d+]/g, '') }); cerrarModal(); toast('Contacto guardado'); };
}

function verAcerca() {
  abrirModal(`<h2 id="modal-title">Acerca de Senda</h2>
    <p class="lead">Versión ${esc((window.SENDA_CONFIG || {}).version || '')}. Hecha en Uruguay por MB Web Studio.</p>
    <p>Mapas y senderos: © colaboradores de OpenStreetMap (ODbL). Relieve: OpenTopoMap (CC-BY-SA). Alturas y clima: Open-Meteo. Fotos de Wikimedia Commons con el crédito de cada autor.</p>
    <p class="fine">¿Encontraste un error en un recorrido? Escribinos a ${esc((window.SENDA_CONFIG || {}).contacto || '')}.</p>
    <div class="modal-actions"><button class="btn btn-main" id="ac-ok">Cerrar</button></div>`);
  $('#ac-ok').onclick = cerrarModal;
}

// ─── First run: welcome + terms ───────────────────────────────────────────────
async function bienvenida() {
  if (await DB.get('kv', 'acepto:v1').catch(() => false)) { Anuncios.iniciar(); return; }
  $('#modal').dataset.fijo = '1';
  abrirModal(`<h2 id="modal-title">Bienvenido a Senda</h2>
    <p class="lead">Senderos de Lavalleja y Maldonado, con avisos de otros caminantes.</p>
    <ul class="tips">
      <li><b>Avisos en el camino:</b> víboras, crecidas, caminos cortados. Si ves algo, avisá.</li>
      <li><b>Sin señal:</b> descargá el recorrido antes de salir.</li>
      <li><b>Seguridad:</b> contale a alguien tu plan y usá el botón SOS si lo necesitás.</li>
    </ul>
    <label class="check"><input type="checkbox" id="bv-ok"> <span>Entiendo que el trekking implica riesgos, que lo hago bajo mi responsabilidad y que la información de Senda es orientativa y puede no estar al día. Acepto los <a href="legal/terminos.html" target="_blank">términos</a> y la <a href="legal/privacidad.html" target="_blank">política de privacidad</a>.</span></label>
    <div class="modal-actions"><button class="btn btn-main" id="bv-entrar" disabled style="opacity:.5">Empezar</button></div>`);
  $('#bv-ok').onchange = (e) => { $('#bv-entrar').disabled = !e.target.checked; $('#bv-entrar').style.opacity = e.target.checked ? 1 : 0.5; };
  $('#bv-entrar').onclick = async () => { await DB.set('kv', 'acepto:v1', Date.now()); delete $('#modal').dataset.fijo; cerrarModal(); Anuncios.iniciar(); };
}

// ─── Connection / pending indicator ───────────────────────────────────────────
let pendientes = 0;
function pintarRed() {
  const el = $('#red');
  if (navigator.onLine && !pendientes) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = !navigator.onLine ? `Sin señal${pendientes ? ` · ${pendientes} por enviar` : ''}` : `Enviando ${pendientes}…`;
}
window.addEventListener('online', pintarRed);
window.addEventListener('offline', pintarRed);
Bandeja.alCambiar((n) => { pendientes = n; pintarRed(); });

// ─── Wiring ───────────────────────────────────────────────────────────────────
$('#btn-reportar').onclick = abrirReporte;
$('#btn-sos').onclick = abrirSOS;
$('#btn-menu').onclick = abrirMenu;
$('#btn-capa').onclick = () => {
  map.removeLayer(capas[capaActual]);
  capaActual = capaActual === 'relieve' ? 'satelite' : 'relieve';
  capas[capaActual].addTo(map);
  toast(capaActual === 'relieve' ? 'Mapa con relieve' : 'Vista satelital');
};
// Your position: the button flies there; after that (or at start, if permission was already
// given) the blue dot keeps following you while the app is open.
let pararPunto = null;
async function seguirPunto() {
  if (pararPunto) return;
  pararPunto = await Nativo.seguir((pos) => { if (!state.navegando) moverYo([pos.lat, pos.lon], { centrar: false }); }, () => {});
}
function sinUbicacion(e) {
  if (e && (e.code === 1 || /denied|permis/i.test(e.message || ''))) {
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    abrirModal(`<h2 id="modal-title">Activá la ubicación</h2>
      <p class="lead">Senda no tiene permiso para usar tu ubicación.</p>
      ${ios && !Nativo.esNativo ? `<ol class="tips"><li>Abrí <b>Ajustes → Privacidad y seguridad → Localización</b> y fijate que esté activada.</li><li>Ahí mismo entrá a <b>Sitios web de Safari</b> y elegí <b>"Al usar la app"</b> y <b>Ubicación exacta</b>.</li><li>Volvé a Senda y tocá otra vez el botón de ubicación. Si te pregunta, tocá <b>Permitir</b>.</li></ol>`
        : ios ? '<p>Abrí <b>Ajustes → Senda → Ubicación</b> y elegí <b>"Al usar la app"</b> con <b>Ubicación exacta</b>.</p>'
        : '<p>Abrí los ajustes del navegador o del teléfono, buscá los permisos de ubicación y permitíselos a Senda.</p>'}
      <div class="modal-actions"><button class="btn btn-main" id="ub-ok">Entendido</button></div>`);
    $('#ub-ok').onclick = cerrarModal;
  } else toast('No encontramos tu ubicación. Probá al aire libre o con el GPS activado.');
}
$('#btn-ubicacion').onclick = async () => {
  toast('Buscando tu ubicación…');
  try { const p = await Nativo.posicion(); moverYo(p, { centrar: false }); map.flyTo(p, 15); seguirPunto(); }
  catch (e) { sinUbicacion(e); }
};
Nativo.permisoUbicacion().then((s) => { if (s === 'granted') seguirPunto(); });
// Bottom sheet: drag it with the finger (from the handle, or from the content when it is
// scrolled to the top) and it snaps to the nearest height; a tap on the handle cycles.
const PASOS_SHEET = ['18vh', '38vh', '52vh', '85vh'];
const vhApx = (v) => (parseFloat(v) * window.innerHeight) / 100;
$('#sheet-handle').onclick = () => {
  const actual = getComputedStyle(document.documentElement).getPropertyValue('--sheet-h').trim() || '38vh';
  setSheet(PASOS_SHEET[(PASOS_SHEET.indexOf(actual) + 1) % PASOS_SHEET.length]);
};
(() => {
  const sheet = $('#sheet'), cuerpo = $('#sheet-body');
  let ini = null; // { y, h, desdeCuerpo, arrastrando }
  const empezar = (y, desdeCuerpo) => { ini = { y, h: sheet.getBoundingClientRect().height, desdeCuerpo, arrastrando: !desdeCuerpo }; };
  const mover = (y, e) => {
    if (!ini) return;
    const dy = y - ini.y;
    if (!ini.arrastrando) {
      if (Math.abs(dy) < 8) return;
      // From the content: pull down only when already at the top, push up only if it can still grow.
      const puede = dy > 0 ? cuerpo.scrollTop <= 0 : ini.h < vhApx('85vh') - 4;
      if (!puede) { ini = null; return; }
      ini.arrastrando = true; ini.y = y;
      return;
    }
    if (e.cancelable) e.preventDefault();
    sheet.classList.add('arrastrando');
    const h = Math.min(vhApx('85vh'), Math.max(vhApx('12vh'), ini.h - (y - ini.y)));
    document.documentElement.style.setProperty('--sheet-h', `${h}px`);
  };
  const soltar = () => {
    if (!ini) return;
    const fue = ini.arrastrando && sheet.classList.contains('arrastrando');
    sheet.classList.remove('arrastrando');
    if (fue) {
      const h = sheet.getBoundingClientRect().height;
      setSheet(PASOS_SHEET.reduce((a, b) => (Math.abs(vhApx(b) - h) < Math.abs(vhApx(a) - h) ? b : a)));
      $('#sheet-handle').dataset.arrastro = '1'; // swallow the click that follows the drag
      setTimeout(() => delete $('#sheet-handle').dataset.arrastro, 50);
    }
    ini = null;
  };
  const tocar = (desdeCuerpo) => (e) => empezar(e.touches[0].clientY, desdeCuerpo);
  $('#sheet-handle').addEventListener('touchstart', tocar(false), { passive: true });
  cuerpo.addEventListener('touchstart', tocar(true), { passive: true });
  sheet.addEventListener('touchmove', (e) => mover(e.touches[0].clientY, e), { passive: false });
  sheet.addEventListener('touchend', soltar);
  sheet.addEventListener('touchcancel', soltar);
  // Mouse (computer): drag from the handle only.
  $('#sheet-handle').addEventListener('mousedown', (e) => { empezar(e.clientY, false); e.preventDefault(); });
  window.addEventListener('mousemove', (e) => mover(e.clientY, e));
  window.addEventListener('mouseup', soltar);
  $('#sheet-handle').addEventListener('click', (e) => { if ($('#sheet-handle').dataset.arrastro) e.stopImmediatePropagation(); }, true);
})();

Reportes.alCambiar(() => {
  dibujarReportes();
  const escribiendo = document.activeElement && document.activeElement.closest('#sheet') && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  if (!state.colocando && !escribiendo) render();
});

(async () => {
  setSheet('38vh');
  dibujarMarcadoresRecorridos();
  await cargarDescargados();
  await Reportes.iniciar(ejemplos);
  render();
  Comunidad.cargarDestacados();
  bienvenida();
  pintarRed();
  setInterval(dibujarReportes, 60000); // let expired reports disappear while the app is open
  // Web version: cache the app itself so it opens without signal (the native app already has it).
  if (!Nativo.esNativo && 'serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
