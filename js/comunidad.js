/* Community: account and points, photos and comments on each trail, recording a new
   trail with the GPS (GPX export or proposal to Senda), and featured places nearby. */
'use strict';

const Comunidad = (() => {
  const MEDALLAS = [[0, '🥾', 'Caminante'], [20, '🧭', 'Baqueano'], [60, '🌿', 'Guardasenda'], [150, '⛰️', 'Guía de la sierra']];
  const medalla = (p) => MEDALLAS.filter(([min]) => p >= min).pop();

  // ─── Account ────────────────────────────────────────────────────────────────
  async function cuentaReal() {
    const u = await Nube.usuario();
    return u && !u.is_anonymous ? u : null;
  }

  async function abrirCuenta() {
    const perfil = (await DB.get('kv', 'perfil').catch(() => null)) || {};
    if (!Nube.activa) {
      abrirModal(`<h2 id="modal-title">Tu cuenta</h2>
        <p class="lead">Las cuentas, los puntos y la parte de comunidad se activan cuando esté configurado el servidor de Senda.</p>
        <label class="field"><span>Tu nombre (para tus avisos y tu plan de caminata)</span><input id="cta-nombre" maxlength="40" value="${esc(perfil.nombre || '')}"></label>
        <div class="modal-actions"><button class="btn btn-main" id="cta-ok">Guardar</button></div>`);
      $('#cta-ok').onclick = async () => { await DB.set('kv', 'perfil', { nombre: $('#cta-nombre').value.trim() }); cerrarModal(); toast('Guardado'); };
      return;
    }
    const u = await Nube.usuario();
    const real = u && !u.is_anonymous;
    let puntos = 0;
    if (u && navigator.onLine) { const r = await Nube.sb.rpc('mis_puntos'); if (!r.error) puntos = r.data || 0; }
    const [, em, titulo] = medalla(puntos);
    const sig = MEDALLAS.find(([min]) => min > puntos);
    abrirModal(`<h2 id="modal-title">Tu cuenta</h2>
      <div class="medalla"><span class="medalla-em">${em}</span><div><b>${titulo}</b><small>${puntos} puntos${sig ? ` · te faltan ${sig[0] - puntos} para ${sig[2]}` : ''}</small></div></div>
      <p class="fine">Sumás puntos cuando publicás avisos, cuando otros los confirman, con fotos aprobadas, comentarios y recorridos propuestos.</p>
      <label class="field"><span>Tu nombre</span><input id="cta-nombre" maxlength="40" value="${esc(perfil.nombre || '')}"></label>
      ${real ? `<p class="lead">Entraste como <b>${esc(u.email || 'usuario')}</b>.</p>` : `
        <p class="lead">Ahora usás Senda sin cuenta. Creá una para guardar tus puntos y subir fotos, comentarios o recorridos.</p>
        <div class="actions"><button class="btn btn-ghost" id="cta-google">Continuar con Google</button>${Nativo.plataforma === 'ios' ? '<button class="btn btn-ghost" id="cta-apple">Continuar con Apple</button>' : ''}</div>
        <label class="field"><span>O con tu correo</span><input id="cta-mail" type="email" placeholder="tu@correo.com" autocomplete="email"></label>`}
      <div class="modal-actions">${real ? '<button class="btn btn-ghost" id="cta-salir">Cerrar sesión</button>' : '<button class="btn btn-ghost" id="cta-mail-ok">Mandarme el link</button>'}<button class="btn btn-main" id="cta-ok">Guardar</button></div>`);
    $('#cta-ok').onclick = async () => {
      const nombre = $('#cta-nombre').value.trim();
      await DB.set('kv', 'perfil', { nombre });
      if (u) await Nube.sb.from('perfiles').upsert({ id: u.id, nombre });
      cerrarModal(); toast('Guardado');
    };
    const redirect = Nativo.esNativo ? 'uy.mbwebstudio.senda://login' : location.href.split('#')[0];
    // linkIdentity / updateUser keep the same user id, so points earned anonymously are kept.
    const vincular = (p) => Nube.vincular(p).catch((e) => toast('No se pudo: ' + e.message));
    if ($('#cta-google')) $('#cta-google').onclick = () => vincular('google');
    if ($('#cta-apple')) $('#cta-apple').onclick = () => vincular('apple');
    if ($('#cta-mail-ok')) $('#cta-mail-ok').onclick = async () => {
      const email = $('#cta-mail').value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Revisá el correo');
      const { error } = await Nube.sb.auth.updateUser({ email }, { emailRedirectTo: redirect });
      toast(error ? 'No se pudo: ' + error.message : 'Te mandamos un link para confirmar');
    };
    if ($('#cta-salir')) $('#cta-salir').onclick = async () => { await Nube.sb.auth.signOut(); cerrarModal(); toast('Sesión cerrada'); };
  }

  // ─── Photos and comments on a trail ───────────────────────────────────────────
  async function cargarSeccion(r, cont) {
    if (!Nube.activa) {
      cont.innerHTML = '<p class="empty">Las fotos y comentarios de otros caminantes aparecen cuando esté configurado el servidor de Senda.</p>';
      return;
    }
    if (!navigator.onLine) { cont.innerHTML = '<p class="empty">Sin señal: las fotos y comentarios se ven cuando vuelva la conexión.</p>'; return; }
    await Nube.sesion();
    const [fotos, coms] = await Promise.all([
      Nube.sb.from('fotos').select('id,ruta,pie,aprobada').eq('recorrido', r.id).order('creado', { ascending: false }).limit(24),
      Nube.sb.from('comentarios').select('id,texto,creado,autor').eq('recorrido', r.id).order('creado', { ascending: false }).limit(30),
    ]);
    const urlFoto = (ruta) => Nube.sb.storage.from('fotos').getPublicUrl(ruta).data.publicUrl;
    const lf = fotos.data || [], lc = coms.data || [];
    const autores = [...new Set(lc.map((c) => c.autor).filter(Boolean))];
    const nombres = {};
    if (autores.length) {
      const p = await Nube.sb.from('perfiles').select('id,nombre').in('id', autores);
      for (const x of p.data || []) nombres[x.id] = x.nombre;
    }
    lc.forEach((c) => (c.perfiles = { nombre: nombres[c.autor] }));
    cont.innerHTML = `
      ${lf.length ? `<div class="fotos">${lf.map((f) => `<figure><img src="${urlFoto(f.ruta)}" alt="${esc(f.pie || r.nombre)}" loading="lazy"><figcaption>${esc(f.pie || '')}${f.aprobada ? '' : '<small>Pendiente de aprobación (solo la ves vos)</small>'}</figcaption></figure>`).join('')}</div>` : '<p class="empty">Todavía nadie subió fotos de este recorrido.</p>'}
      <div class="actions"><label class="btn btn-ghost" for="foto-input">Subir una foto</label><input type="file" id="foto-input" accept="image/*" hidden></div>
      <div class="comentarios">${lc.map((c) => `<div class="comentario"><b>${esc((c.perfiles && c.perfiles.nombre) || 'Caminante')}</b><small>${hace(Date.parse(c.creado))}</small><p>${esc(c.texto)}</p></div>`).join('') || '<p class="empty">Sin comentarios todavía. ¿Cómo estaba el sendero?</p>'}</div>
      <label class="field"><span>Dejá un comentario</span><textarea id="com-texto" maxlength="400" placeholder="Ej.: el arroyo se cruzaba bien, mucho barro después de la cascada"></textarea></label>
      <div class="actions"><button class="btn btn-main" id="com-ok">Publicar comentario</button></div>`;
    $('#foto-input').onchange = (e) => subirFoto(r, e.target.files[0], cont);
    $('#com-ok').onclick = async () => {
      const texto = $('#com-texto').value.trim();
      if (texto.length < 2) return;
      if (!(await cuentaReal())) { toast('Creá tu cuenta para comentar'); return abrirCuenta(); }
      const { error } = await Nube.sb.from('comentarios').insert({ recorrido: r.id, texto });
      if (error) return toast('No se pudo publicar: ' + error.message);
      toast('¡Gracias por contar!');
      cargarSeccion(r, cont);
    };
  }

  // Shrink to 1600 px JPEG before uploading (saves data on the hill).
  function achicar(file) {
    return new Promise((ok, mal) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => (b ? ok(b) : mal(new Error('foto'))), 'image/jpeg', 0.82);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = mal;
      img.src = URL.createObjectURL(file);
    });
  }

  async function subirFoto(r, file, cont) {
    if (!file) return;
    const u = await cuentaReal();
    if (!u) { toast('Creá tu cuenta para subir fotos'); return abrirCuenta(); }
    const pie = prompt('Contanos qué se ve en la foto (opcional)') || '';
    toast('Subiendo foto…');
    try {
      const blob = await achicar(file);
      const ruta = `${u.id}/${r.id}/${Date.now()}.jpg`;
      const up = await Nube.sb.storage.from('fotos').upload(ruta, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const ins = await Nube.sb.from('fotos').insert({ recorrido: r.id, ruta, pie: pie.slice(0, 120) || null });
      if (ins.error) throw ins.error;
      toast('Foto subida: aparece para todos cuando la aprobemos');
      cargarSeccion(r, cont);
    } catch (e) { toast('No se pudo subir: ' + (e.message || e)); }
  }

  // ─── Recording a new trail ────────────────────────────────────────────────────
  const Grabador = (() => {
    let g = null;   // { id, puntos: [[lat, lon, alt, t]], parar, inicio }
    const largo = (pts) => pts.reduce((m, p, i) => (i ? m + dist(pts[i - 1], p) : 0), 0);

    async function empezar() {
      g = { id: 'g' + Date.now().toString(36), puntos: [], inicio: Date.now() };
      g.parar = await Nativo.seguir((pos) => {
        if (pos.precision && pos.precision > 40) return;      // ignore poor fixes
        const ult = g.puntos[g.puntos.length - 1];
        const p = [pos.lat, pos.lon, pos.alt != null ? Math.round(pos.alt) : null, pos.t];
        if (ult && dist(ult, p) < 8) return;
        g.puntos.push(p);
        moverYo([pos.lat, pos.lon], { centrar: false });
        if (g.puntos.length % 10 === 0) DB.set('tracks', g.id, { id: g.id, inicio: g.inicio, puntos: g.puntos, enCurso: true });
        pintar();
      }, () => toast('No pudimos acceder a tu ubicación. Revisá los permisos.'), { fondo: true });
      pintar();
      toast('Grabando: caminá el recorrido y tocá "Parar" al terminar');
    }

    function pintar() {
      const b = $('#grabando');
      if (!g) { b.hidden = true; return; }
      const min = Math.round((Date.now() - g.inicio) / 60000);
      b.hidden = false;
      b.innerHTML = `<span class="rec"></span> Grabando · ${fmtKm(largo(g.puntos))} · ${min} min <button id="grab-parar">Parar</button>`;
      $('#grab-parar').onclick = parar;
      if (window.trazoGrabacion) trazoGrabacion(g.puntos);
    }

    async function parar() {
      if (!g) return;
      g.parar && g.parar();
      const t = { id: g.id, inicio: g.inicio, fin: Date.now(), puntos: g.puntos, distancia: Math.round(largo(g.puntos)) };
      g = null;
      pintar();
      if (t.puntos.length < 5) { await DB.del('tracks', t.id); toast('La grabación quedó muy corta y no se guardó'); return; }
      await DB.set('tracks', t.id, t);
      verGrabacion(t.id);
    }

    function gpx(t) {
      const pts = t.puntos.map((p) => `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}">${p[2] != null ? `<ele>${p[2]}</ele>` : ''}<time>${new Date(p[3]).toISOString()}</time></trkpt>`).join('');
      return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Senda" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(t.nombre || 'Recorrido grabado con Senda')}</name><trkseg>${pts}</trkseg></trk></gpx>`;
    }

    async function verGrabacion(id) {
      const t = await DB.get('tracks', id);
      if (!t) return;
      abrirModal(`<h2 id="modal-title">Recorrido grabado</h2>
        <p class="lead">${fmtKm(t.distancia || largo(t.puntos))} · ${Math.round(((t.fin || Date.now()) - t.inicio) / 60000)} min · ${new Date(t.inicio).toLocaleDateString('es-UY')}</p>
        <label class="field"><span>Nombre</span><input id="grab-nombre" maxlength="80" value="${esc(t.nombre || '')}" placeholder="Ej.: Cerro Arequita por el lado del río"></label>
        <label class="field"><span>Descripción para otros caminantes</span><textarea id="grab-desc" maxlength="1000" placeholder="Por dónde se entra, dificultad, si hay que pedir permiso…">${esc(t.descripcion || '')}</textarea></label>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="grab-borrar">Borrar</button>
          <button class="btn btn-ghost" id="grab-gpx">Exportar GPX</button>
          <button class="btn btn-main" id="grab-proponer">Proponer a Senda</button>
        </div>`);
      const leer = async () => { t.nombre = $('#grab-nombre').value.trim(); t.descripcion = $('#grab-desc').value.trim(); await DB.set('tracks', t.id, t); };
      $('#grab-borrar').onclick = async () => { if (!confirm('¿Borrar esta grabación?')) return; await DB.del('tracks', t.id); cerrarModal(); toast('Grabación borrada'); };
      $('#grab-gpx').onclick = async () => {
        await leer();
        const blob = new Blob([gpx(t)], { type: 'application/gpx+xml' });
        const nombre = (t.nombre || 'recorrido-senda').replace(/[^\w-]+/g, '-').toLowerCase() + '.gpx';
        const archivo = new File([blob], nombre, { type: 'application/gpx+xml' });
        if (navigator.canShare && navigator.canShare({ files: [archivo] })) { try { await navigator.share({ files: [archivo], title: t.nombre }); return; } catch { /* fall back to download */ } }
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      };
      $('#grab-proponer').onclick = async () => {
        await leer();
        if (!t.nombre) return toast('Ponele un nombre al recorrido');
        if (!Nube.activa) return toast('Las propuestas se activan cuando esté configurado el servidor. Mientras, exportá el GPX y mandánoslo.');
        if (!(await cuentaReal())) { toast('Creá tu cuenta para proponer recorridos'); return abrirCuenta(); }
        await Bandeja.agregar('propuesta', { nombre: t.nombre, descripcion: t.descripcion || null, puntos: t.puntos, distancia_m: Math.round(t.distancia || largo(t.puntos)) });
        t.propuesta = true; await DB.set('tracks', t.id, t);
        cerrarModal();
        toast('¡Gracias! Lo revisamos y, si está bien, lo sumamos a Senda');
      };
    }

    async function lista() {
      const todas = (await DB.all('tracks')).map(([, t]) => t).sort((a, b) => b.inicio - a.inicio);
      abrirModal(`<h2 id="modal-title">Grabar un recorrido</h2>
        <p class="lead">Caminá un sendero con la app abierta y se guarda tu traza. Podés exportarla o proponerla para que la sumemos a Senda.</p>
        <div class="actions"><button class="btn btn-main" id="grab-empezar" ${g ? 'disabled' : ''}>${g ? 'Ya estás grabando' : 'Empezar a grabar'}</button></div>
        <h3 class="sec-title">Tus grabaciones</h3>
        ${todas.length ? todas.map((t) => `<button class="trail" data-track="${t.id}"><span class="trail-icon">📍</span><span><h3>${esc(t.nombre || 'Sin nombre')}</h3><span class="meta">${new Date(t.inicio).toLocaleDateString('es-UY')} · ${fmtKm(t.distancia || largo(t.puntos))}${t.propuesta ? ' · propuesto' : ''}</span></span></button>`).join('') : '<p class="empty">Todavía no grabaste ninguno.</p>'}
        <div class="modal-actions"><button class="btn btn-ghost" id="grab-cerrar">Cerrar</button></div>`);
      $('#grab-cerrar').onclick = cerrarModal;
      $('#grab-empezar').onclick = () => { cerrarModal(); empezar(); };
      document.querySelectorAll('[data-track]').forEach((b) => (b.onclick = () => verGrabacion(b.dataset.track)));
    }

    return { empezar, parar, lista, activo: () => !!g };
  })();

  Bandeja.registrar('propuesta', async (d) => {
    const { error } = await Nube.sb.from('propuestas').insert(d);
    if (error) throw error;
  });

  // ─── Featured places (paid partners) ──────────────────────────────────────────
  let destacados = window.DESTACADOS || [];
  async function cargarDestacados() {
    const guardados = await DB.get('kv', 'destacados').catch(() => null);
    if (guardados) destacados = guardados;
    if (!Nube.activa || !navigator.onLine) return;
    const { data, error } = await Nube.sb.from('destacados').select('*');
    if (!error && data) { destacados = data.map((d) => ({ ...d, coord: [d.lat, d.lon] })); DB.set('kv', 'destacados', destacados).catch(() => {}); }
  }
  const ICONO_DEST = { reserva: '🌳', camping: '⛺', alojamiento: '🏡', comida: '🍽️', guia: '🧭', otro: '📍' };
  function destacadosCerca(r, km = 15) {
    return destacados.filter((d) => dist(d.coord, r.inicio.coord) < km * 1000)
      .map((d) => ({ ...d, km: dist(d.coord, r.inicio.coord) / 1000 })).sort((a, b) => a.km - b.km);
  }
  function destacadosHtml(r) {
    const l = destacadosCerca(r);
    if (!l.length) return '';
    return `<h3 class="sec-title">Cerca del recorrido</h3>${l.map((d) => `<div class="destacado"><span class="em">${ICONO_DEST[d.categoria] || '📍'}</span><div><b>${esc(d.nombre)}</b><small>${esc(d.descripcion || '')} · a ${d.km.toFixed(1).replace('.', ',')} km</small>
      <div class="actions" style="margin:6px 0 0">${d.telefono ? `<a class="btn btn-ghost btn-sm" href="tel:${esc(d.telefono)}">Llamar</a>` : ''}${d.web ? `<a class="btn btn-ghost btn-sm" href="${esc(d.web)}" target="_blank" rel="noopener">Web</a>` : ''}</div></div></div>`).join('')}<p class="fine">Lugares destacados: aparecen porque colaboran con Senda.</p>`;
  }

  return { abrirCuenta, cargarSeccion, Grabador, cargarDestacados, destacadosHtml };
})();
window.Comunidad = Comunidad;
