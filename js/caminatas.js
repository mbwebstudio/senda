/* "Mis caminatas": every trail walked with the real GPS is saved on the phone (distance
   walked, time, estimated climb, the track) and can be shared as an image the size of an
   Instagram story. Simulated walks are not saved. */
'use strict';

const Caminatas = (() => {
  const CLAVE = 'caminatas';
  let actual = null; // walk in progress

  const leer = async () => (await DB.get('kv', CLAVE).catch(() => null)) || [];
  const duracion = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);
  const km = (m) => (m / 1000).toLocaleString('es-UY', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function empezar(r) { actual = { r, inicio: Date.now(), puntos: [], maxIdx: 0 }; }

  function punto(p, idx) {
    if (!actual) return;
    const u = actual.puntos[actual.puntos.length - 1];
    if (!u || dist(u, p) > 8) actual.puntos.push(p);
    if (idx != null) actual.maxIdx = Math.max(actual.maxIdx, idx);
  }

  // Ends the walk in progress and saves it if it was more than a short test.
  async function terminar() {
    if (!actual) return null;
    const { r, inicio, puntos, maxIdx } = actual;
    actual = null;
    let metros = 0;
    for (let i = 1; i < puntos.length; i++) metros += dist(puntos[i - 1], puntos[i]);
    if (metros < 200) return null;
    const avance = Math.min(1, maxIdx / Math.max(1, r.ruta.length - 1));
    const paso = Math.max(1, Math.ceil(puntos.length / 300)); // keep at most ~300 points
    const c = {
      id: Date.now(), recorrido: r.id, nombre: r.nombre, zona: `${r.zona}, ${r.departamento}`,
      fecha: inicio, metros: Math.round(metros), min: Math.max(1, Math.round((Date.now() - inicio) / 60000)),
      subida: Math.round((r.subidaM || 0) * avance), avance: Math.round(avance * 100),
      traza: puntos.filter((_, i) => i % paso === 0).map(([la, lo]) => [+la.toFixed(5), +lo.toFixed(5)]),
    };
    const lista = await leer();
    lista.unshift(c);
    await DB.set('kv', CLAVE, lista.slice(0, 200)).catch(() => {});
    return c;
  }

  // ─── The image to share ─────────────────────────────────────────────────────────
  function lineas(ctx, texto, ancho) {
    const palabras = texto.split(' '), res = [];
    let linea = '';
    for (const p of palabras) {
      const prueba = linea ? linea + ' ' + p : p;
      if (ctx.measureText(prueba).width > ancho && linea) { res.push(linea); linea = p; } else linea = prueba;
    }
    if (linea) res.push(linea);
    return res;
  }

  async function tarjeta(c) {
    const W = 1080, H = 1920;
    await Promise.all(['800 80px "Bricolage Grotesque"', '600 36px Manrope', '800 36px Manrope'].map((f) => document.fonts.load(f).catch(() => {})));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const fondo = ctx.createLinearGradient(0, 0, 0, H);
    fondo.addColorStop(0, '#24573F'); fondo.addColorStop(1, '#10291F');
    ctx.fillStyle = fondo; ctx.fillRect(0, 0, W, H);

    // Brand
    const logo = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = 'icons/icon-192.png'; });
    if (logo) { ctx.save(); ctx.beginPath(); ctx.roundRect(80, 96, 104, 104, 26); ctx.clip(); ctx.drawImage(logo, 80, 96, 104, 104); ctx.restore(); }
    ctx.fillStyle = '#fff'; ctx.font = '800 72px "Bricolage Grotesque", sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText('Senda', 210, 150);

    // Track on a panel, fitted keeping proportions (longitude shrinks with latitude)
    const px = 80, py = 270, pw = 920, ph = 860, pad = 70;
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 44); ctx.fill();
    const r = recorridos.find((x) => x.id === c.recorrido);
    const ruta = r ? r.ruta : [];
    const todo = ruta.concat(c.traza || []);
    if (todo.length > 1) {
      const k = Math.cos((todo[0][0] * Math.PI) / 180);
      const xs = todo.map((p) => p[1] * k), ys = todo.map((p) => -p[0]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const esc = Math.min((pw - 2 * pad) / (x1 - x0 || 1e-6), (ph - 2 * pad) / (y1 - y0 || 1e-6));
      const ox = px + (pw - (x1 - x0) * esc) / 2, oy = py + (ph - (y1 - y0) * esc) / 2;
      const aXY = (p) => [ox + (p[1] * k - x0) * esc, oy + (-p[0] - y0) * esc];
      const trazo = (pts, color, ancho, sombra) => {
        if (pts.length < 2) return;
        ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = ancho; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        if (sombra) { ctx.shadowColor = sombra; ctx.shadowBlur = 24; }
        ctx.beginPath(); pts.map(aXY).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore();
      };
      trazo(ruta, 'rgba(255,255,255,0.35)', 10);
      trazo(c.traza && c.traza.length > 1 ? c.traza : ruta, '#FF8A3D', 14, 'rgba(255,138,61,0.7)');
      const marca = (p, color) => { const [x, y] = aXY(p); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 20, 0, 7); ctx.fill(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 12, 0, 7); ctx.fill(); };
      const tr = c.traza && c.traza.length > 1 ? c.traza : ruta;
      marca(tr[0], '#2F9E44'); marca(tr[tr.length - 1], '#E8590C');
    }

    // Name, place and date
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#fff'; ctx.font = '800 80px "Bricolage Grotesque", sans-serif';
    let y = 1250;
    for (const l of lineas(ctx, c.nombre, W - 160).slice(0, 2)) { ctx.fillText(l, 80, y); y += 92; }
    ctx.fillStyle = '#E9E2D0'; ctx.font = '600 38px Manrope, sans-serif';
    ctx.fillText(`${c.zona} · ${new Date(c.fecha).toLocaleDateString('es-UY', { day: 'numeric', month: 'long', year: 'numeric' })}`, 80, y + 4);

    // Stats
    const datos = [[km(c.metros), 'km'], [duracion(c.min), 'de caminata'], [c.subida ? `${c.subida} m` : '—', 'de subida']];
    const bw = (W - 160 - 40) / 3;
    datos.forEach(([v, et], i) => {
      const bx = 80 + i * (bw + 20), by = 1500;
      ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.beginPath(); ctx.roundRect(bx, by, bw, 210, 32); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `800 ${v.length > 7 ? 54 : 68}px "Bricolage Grotesque", sans-serif`; ctx.fillText(v, bx + 30, by + 110);
      ctx.fillStyle = '#C9D6CC'; ctx.font = '600 32px Manrope, sans-serif'; ctx.fillText(et, bx + 30, by + 166);
    });

    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '600 34px Manrope, sans-serif';
    ctx.fillText('Trekking en Uruguay · Senda', 80, 1830);
    return new Promise((ok) => cv.toBlob(ok, 'image/png'));
  }

  async function compartir(c) {
    toast('Preparando la imagen…');
    const blob = await tarjeta(c);
    const r = await Nativo.compartirImagen(blob, `senda-${c.recorrido}.png`, `Hice ${c.nombre} con Senda 🥾`).catch(() => 'error');
    if (r === 'descargado') toast('Imagen descargada: subila a tus historias');
    else if (r === 'error') toast('No se pudo compartir la imagen');
  }

  // ─── Screens ────────────────────────────────────────────────────────────────────
  async function abrirResumen(c) {
    abrirModal(`<h2 id="modal-title">¡Bien ahí! 🥾</h2>
      <p class="lead">Terminaste ${esc(c.nombre)}.</p>
      <div class="stats"><div class="stat"><b>${km(c.metros)} km</b><span>caminados</span></div><div class="stat"><b>${duracion(c.min)}</b><span>de caminata</span></div><div class="stat"><b>${c.subida} m</b><span>de subida</span></div></div>
      <div class="tarjeta-prev"><img id="cm-prev" alt="Imagen para compartir"></div>
      <div class="modal-actions"><button class="btn btn-ghost" id="cm-lista">Mis caminatas</button><button class="btn btn-main" id="cm-comp">Compartir</button></div>`);
    $('#cm-comp').onclick = () => compartir(c);
    $('#cm-lista').onclick = abrirLista;
    const blob = await tarjeta(c);
    if ($('#cm-prev')) $('#cm-prev').src = URL.createObjectURL(blob);
  }

  async function abrirLista() {
    const lista = await leer();
    const tot = lista.reduce((a, c) => ({ m: a.m + c.metros, min: a.min + c.min, sub: a.sub + c.subida }), { m: 0, min: 0, sub: 0 });
    abrirModal(`<h2 id="modal-title">Mis caminatas</h2>
      ${lista.length ? `<div class="stats"><div class="stat"><b>${lista.length}</b><span>caminata${lista.length === 1 ? '' : 's'}</span></div><div class="stat"><b>${km(tot.m)} km</b><span>en total</span></div><div class="stat"><b>${tot.sub.toLocaleString('es-UY')} m</b><span>de subida</span></div></div>
        ${lista.map((c) => `<div class="soc-persona"><span><b>${esc(c.nombre)}</b><small style="display:block;color:var(--muted)">${new Date(c.fecha).toLocaleDateString('es-UY', { day: 'numeric', month: 'short', year: 'numeric' })} · ${km(c.metros)} km · ${duracion(c.min)}</small></span><button class="btn btn-ghost btn-chico" data-comp="${c.id}">Compartir</button></div>`).join('')}`
        : '<p class="empty">Todavía no terminaste ningún recorrido. Entrá a uno y tocá "Empezar recorrido": cuando lo termines queda guardado acá, con una imagen para compartir.</p>'}
      <p class="fine">Se guardan solo en este teléfono.</p>
      <div class="modal-actions"><button class="btn btn-main" id="cm-cerrar">Cerrar</button></div>`);
    $('#cm-cerrar').onclick = cerrarModal;
    document.querySelectorAll('[data-comp]').forEach((b) => b.onclick = () => compartir(lista.find((c) => String(c.id) === b.dataset.comp)));
  }

  return { empezar, punto, terminar, abrirResumen, abrirLista, tarjeta };
})();
