/* Social network for hikers: forum, groups, outdoor events and friends. Shown in the bottom
   sheet when the "Comunidad" tab is open. Anyone can read; posting needs a real account
   (not anonymous) so content can be moderated. Every post can be reported and every
   person blocked: the stores require both for apps with user content. */
'use strict';

const Social = (() => {
  let pestana = 'foro';
  let bloqueados = new Set();
  const perfiles = {}; // id -> { nombre, zona, bio }

  const sb = () => Nube.sb;
  const quien = (id) => esc((perfiles[id] && perfiles[id].nombre) || 'Caminante');
  const fecha = (iso) => new Date(iso).toLocaleString('es-UY', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const haceIso = (iso) => hace(Date.parse(iso));
  const nombreRecorrido = (id) => { const r = recorridos.find((x) => x.id === id); return r ? r.nombre : ''; };
  const opcionesRecorrido = (sel = '') => `<option value="">Ninguno</option>${recorridos.map((r) => `<option value="${r.id}"${r.id === sel ? ' selected' : ''}>${esc(r.nombre)}</option>`).join('')}`;
  const visibles = (filas, campo = 'autor') => (filas || []).filter((f) => !bloqueados.has(f[campo]));
  const fallo = (error) => {
    const m = (error && error.message) || '';
    if (error && (error.code === '42501' || /row-level security/.test(m))) return 'No se pudo publicar. Revisá que el texto no tenga insultos.';
    if (/Failed to fetch|NetworkError/.test(m)) return 'Sin conexión. Probá de nuevo cuando tengas señal.';
    return 'No se pudo: ' + m;
  };

  async function usuario() { return Nube.activa ? Nube.usuario() : null; }
  async function cuentaReal() { const u = await usuario(); return u && !u.is_anonymous ? u : null; }

  // Posting needs an account: explain why and offer to create it.
  async function requerirCuenta() {
    const u = await cuentaReal();
    if (u) return u;
    abrirModal(`<h2 id="modal-title">Creá tu cuenta</h2>
      <p class="lead">Para escribir en el foro, armar grupos, proponer eventos o agregar amigos necesitás una cuenta. Así cuidamos la comunidad del spam y de los abusos.</p>
      <p class="fine">Es gratis y no tiene contraseña: te mandamos un link al correo.</p>
      <div class="modal-actions"><button class="btn btn-ghost" id="rc-no">Ahora no</button><button class="btn btn-main" id="rc-si">Crear cuenta</button></div>`);
    $('#rc-no').onclick = cerrarModal;
    $('#rc-si').onclick = () => Comunidad.abrirCuenta();
    return null;
  }

  async function cargarPerfiles(ids) {
    const faltan = [...new Set(ids)].filter((id) => id && !perfiles[id]);
    if (!faltan.length) return;
    const { data } = await sb().from('perfiles').select('id,nombre,zona,bio').in('id', faltan);
    for (const p of data || []) perfiles[p.id] = p;
  }
  async function cargarBloqueos() {
    const u = await usuario();
    if (!u) return;
    const { data } = await sb().from('bloqueos').select('a').eq('de', u.id);
    bloqueados = new Set((data || []).map((b) => b.a));
  }

  // ─── Report and block ─────────────────────────────────────────────────────────
  const accionesHtml = (tipo, id, autor, yo) => `<div class="soc-acciones">
    <button class="link-suave" data-denunciar="${tipo}:${id}">Denunciar</button>
    ${autor && autor !== yo ? `<button class="link-suave" data-bloquear="${autor}">Bloquear a ${quien(autor)}</button>` : ''}</div>`;

  function conectarAcciones(cont, alTerminar) {
    cont.querySelectorAll('[data-denunciar]').forEach((b) => b.onclick = () => { const [t, id] = b.dataset.denunciar.split(':'); denunciar(t, id, alTerminar); });
    cont.querySelectorAll('[data-bloquear]').forEach((b) => b.onclick = () => bloquear(b.dataset.bloquear, alTerminar));
  }

  function denunciar(tipo, id, alTerminar) {
    const motivos = ['Insultos o acoso', 'Spam o publicidad', 'Contenido sexual o violento', 'Información falsa o peligrosa', 'Otro'];
    abrirModal(`<h2 id="modal-title">Denunciar</h2>
      <p class="lead">Lo revisamos. Con varias denuncias se oculta solo mientras tanto.</p>
      <div class="menu">${motivos.map((m) => `<button data-motivo="${esc(m)}">${esc(m)}</button>`).join('')}</div>
      <div class="modal-actions"><button class="btn btn-ghost" id="dn-no">Cancelar</button></div>`);
    $('#dn-no').onclick = cerrarModal;
    document.querySelectorAll('[data-motivo]').forEach((b) => b.onclick = async () => {
      if (!(await usuario())) return toast('Necesitás conexión');
      const { error } = await sb().from('denuncias').insert({ tipo, objeto: id, motivo: b.dataset.motivo });
      cerrarModal();
      toast(error && error.code !== '23505' ? fallo(error) : 'Gracias. Vamos a revisarlo.');
      if (alTerminar) alTerminar();
    });
  }

  function bloquear(id, alTerminar) {
    abrirModal(`<h2 id="modal-title">Bloquear a ${quien(id)}</h2>
      <p class="lead">No vas a ver más lo que publica, y no te va a poder mandar solicitudes de amistad. No se entera de que lo bloqueaste.</p>
      <div class="modal-actions"><button class="btn btn-ghost" id="bl-no">Cancelar</button><button class="btn btn-stop" id="bl-si">Bloquear</button></div>`);
    $('#bl-no').onclick = cerrarModal;
    $('#bl-si').onclick = async () => {
      const u = await usuario();
      if (!u) return toast('Necesitás conexión');
      const { error } = await sb().from('bloqueos').insert({ de: u.id, a: id });
      if (error && error.code !== '23505') return toast(fallo(error));
      await sb().from('amistades').delete().or(`and(de.eq.${u.id},para.eq.${id}),and(de.eq.${id},para.eq.${u.id})`);
      bloqueados.add(id);
      cerrarModal(); toast('Listo, lo bloqueaste');
      if (alTerminar) alTerminar();
    };
  }

  // ─── Main view ────────────────────────────────────────────────────────────────
  let contenedor = null;
  async function render(cont) {
    contenedor = cont || contenedor;
    const c = contenedor;
    const tabs = [['foro', 'Foro'], ['grupos', 'Grupos'], ['eventos', 'Eventos'], ['amigos', 'Amigos']];
    c.innerHTML = `<div class="chips soc-tabs" role="tablist">${tabs.map(([id, t]) => `<button class="chip" role="tab" aria-pressed="${id === pestana}" data-pestana="${id}">${t}</button>`).join('')}</div>
      <div id="soc-cuerpo"><p class="empty">Cargando…</p></div>`;
    c.querySelectorAll('[data-pestana]').forEach((b) => b.onclick = () => { pestana = b.dataset.pestana; render(); });
    const cuerpo = $('#soc-cuerpo');
    if (!Nube.activa) { cuerpo.innerHTML = '<p class="empty">La comunidad se activa cuando esté configurado el servidor de Senda.</p>'; return; }
    if (!navigator.onLine) { cuerpo.innerHTML = '<p class="empty">Sin señal: la comunidad se ve cuando vuelva la conexión. Los recorridos y el mapa siguen funcionando.</p>'; return; }
    await cargarBloqueos();
    try { await ({ foro: verForo, grupos: verGrupos, eventos: verEventos, amigos: verAmigos })[pestana](cuerpo); }
    catch (e) { cuerpo.innerHTML = `<p class="empty">${esc(fallo(e))}</p>`; }
  }

  // ─── Forum ────────────────────────────────────────────────────────────────────
  const filaTema = (t) => `<button class="soc-fila" data-tema="${t.id}">
      <span class="soc-tit">${esc(t.titulo)}</span>
      <small>${quien(t.autor)} · ${haceIso(t.actividad)} · ${t.respuestas} respuesta${t.respuestas === 1 ? '' : 's'}${t.recorrido ? ` · ${esc(nombreRecorrido(t.recorrido))}` : ''}</small></button>`;

  async function verForo(cuerpo) {
    const { data, error } = await sb().from('foro_temas').select('id,titulo,autor,actividad,respuestas,recorrido').is('grupo', null).order('actividad', { ascending: false }).limit(50);
    if (error) throw error;
    const temas = visibles(data);
    await cargarPerfiles(temas.map((t) => t.autor));
    cuerpo.innerHTML = `<p class="lead">Preguntá cómo está un sendero, recomendá lugares o buscá compañía para caminar.</p>
      <div class="actions"><button class="btn btn-main" id="soc-nuevo-tema">Nuevo tema</button></div>
      ${temas.length ? temas.map(filaTema).join('') : '<p class="empty">Todavía no hay temas. ¡Abrí el primero!</p>'}`;
    $('#soc-nuevo-tema').onclick = () => nuevoTema();
    cuerpo.querySelectorAll('[data-tema]').forEach((b) => b.onclick = () => abrirTema(b.dataset.tema));
  }

  async function nuevoTema(grupo = null) {
    if (!(await requerirCuenta())) return;
    abrirModal(`<h2 id="modal-title">Nuevo tema${grupo ? ' en el grupo' : ''}</h2>
      <label class="field"><span>Título</span><input id="nt-titulo" maxlength="100" placeholder="Ej.: ¿Cómo está el sendero al Penitente?"></label>
      <label class="field"><span>Mensaje</span><textarea id="nt-cuerpo" maxlength="2000" rows="5"></textarea></label>
      <label class="field"><span>Recorrido (opcional)</span><select id="nt-rec">${opcionesRecorrido()}</select></label>
      <div class="modal-actions"><button class="btn btn-ghost" id="nt-no">Cancelar</button><button class="btn btn-main" id="nt-si">Publicar</button></div>`);
    $('#nt-no').onclick = cerrarModal;
    $('#nt-si').onclick = async () => {
      const titulo = $('#nt-titulo').value.trim();
      if (titulo.length < 3) return toast('Poné un título');
      $('#nt-si').disabled = true;
      const { data, error } = await sb().from('foro_temas').insert({ titulo, cuerpo: $('#nt-cuerpo').value.trim() || null, recorrido: $('#nt-rec').value || null, grupo }).select('id').single();
      if (error) { $('#nt-si').disabled = false; return toast(fallo(error)); }
      cerrarModal(); toast('Tema publicado');
      grupo ? abrirGrupo(grupo) : render();
      abrirTema(data.id);
    };
  }

  async function abrirTema(id) {
    abrirModal('<p class="empty">Cargando…</p>');
    const [t, r, u] = await Promise.all([
      sb().from('foro_temas').select('id,titulo,cuerpo,autor,creado,recorrido,grupo').eq('id', id).maybeSingle(),
      sb().from('foro_respuestas').select('id,cuerpo,autor,creado').eq('tema', id).order('creado').limit(200),
      usuario(),
    ]);
    if (!t.data) { abrirModal('<p class="empty">Este tema ya no está disponible.</p><div class="modal-actions"><button class="btn btn-main" id="tm-ok">Cerrar</button></div>'); $('#tm-ok').onclick = cerrarModal; return; }
    const tema = t.data, resp = visibles(r.data), yo = u && u.id;
    await cargarPerfiles([tema.autor, ...resp.map((x) => x.autor)]);
    abrirModal(`<h2 id="modal-title">${esc(tema.titulo)}</h2>
      <p class="fine">${quien(tema.autor)} · ${haceIso(tema.creado)}${tema.recorrido ? ` · <button class="link-suave" id="tm-rec">${esc(nombreRecorrido(tema.recorrido))}</button>` : ''}</p>
      ${tema.cuerpo ? `<p class="soc-texto">${esc(tema.cuerpo)}</p>` : ''}
      ${accionesHtml('tema', tema.id, tema.autor, yo)}
      ${tema.autor === yo ? '<button class="link-peligro" id="tm-borrar">Borrar mi tema</button>' : ''}
      <h3 class="sec-title">Respuestas</h3>
      ${resp.length ? resp.map((x) => `<div class="soc-resp"><b>${quien(x.autor)}</b> <small>${haceIso(x.creado)}</small><p class="soc-texto">${esc(x.cuerpo)}</p>
        ${accionesHtml('respuesta', x.id, x.autor, yo)}${x.autor === yo ? `<button class="link-peligro" data-borrar-resp="${x.id}">Borrar</button>` : ''}</div>`).join('') : '<p class="empty">Nadie respondió todavía.</p>'}
      <label class="field"><span>Tu respuesta</span><textarea id="tm-resp" maxlength="1000" rows="3"></textarea></label>
      <div class="modal-actions"><button class="btn btn-ghost" id="tm-cerrar">Cerrar</button><button class="btn btn-main" id="tm-enviar">Responder</button></div>`);
    const recargar = () => abrirTema(id);
    conectarAcciones($('#modal-content'), () => { cerrarModal(); render(); });
    $('#tm-cerrar').onclick = () => { cerrarModal(); render(); };
    if ($('#tm-rec')) $('#tm-rec').onclick = () => irARecorrido(tema.recorrido);
    if ($('#tm-borrar')) $('#tm-borrar').onclick = async () => { await sb().from('foro_temas').delete().eq('id', id); cerrarModal(); toast('Tema borrado'); render(); };
    document.querySelectorAll('[data-borrar-resp]').forEach((b) => b.onclick = async () => { await sb().from('foro_respuestas').delete().eq('id', b.dataset.borrarResp); recargar(); });
    $('#tm-enviar').onclick = async () => {
      const cuerpo = $('#tm-resp').value.trim();
      if (!cuerpo) return;
      if (!(await requerirCuenta())) return;
      $('#tm-enviar').disabled = true;
      const { error } = await sb().from('foro_respuestas').insert({ tema: id, cuerpo });
      if (error) { $('#tm-enviar').disabled = false; return toast(fallo(error)); }
      recargar();
    };
  }

  // ─── Groups ───────────────────────────────────────────────────────────────────
  async function misGrupos() {
    const u = await usuario();
    if (!u) return new Set();
    const { data } = await sb().from('grupo_miembros').select('grupo').eq('usuario', u.id);
    return new Set((data || []).map((m) => m.grupo));
  }

  async function verGrupos(cuerpo) {
    const [g, mios] = await Promise.all([
      sb().from('grupos').select('id,nombre,descripcion,zona,publico,creador').order('creado', { ascending: false }).limit(100),
      misGrupos(),
    ]);
    if (g.error) throw g.error;
    const grupos = visibles(g.data, 'creador');
    const fila = (x) => `<button class="soc-fila" data-grupo="${x.id}"><span class="soc-tit">${x.publico ? '' : '🔒 '}${esc(x.nombre)}</span>
      <small>${x.zona ? esc(x.zona) + ' · ' : ''}${mios.has(x.id) ? 'Sos miembro' : 'Grupo abierto'}</small></button>`;
    const propios = grupos.filter((x) => mios.has(x.id)), otros = grupos.filter((x) => !mios.has(x.id));
    cuerpo.innerHTML = `<p class="lead">Juntate con gente para salir a caminar: grupos abiertos de cada zona, o privados para tu barra.</p>
      <div class="actions"><button class="btn btn-main" id="gr-nuevo">Crear grupo</button><button class="btn btn-ghost" id="gr-codigo">Unirme con código</button></div>
      ${propios.length ? `<h3 class="sec-title">Mis grupos</h3>${propios.map(fila).join('')}` : ''}
      <h3 class="sec-title">Grupos abiertos</h3>${otros.length ? otros.map(fila).join('') : '<p class="empty">Todavía no hay grupos abiertos. ¡Creá el de tu zona!</p>'}`;
    $('#gr-nuevo').onclick = nuevoGrupo;
    $('#gr-codigo').onclick = unirmeConCodigo;
    cuerpo.querySelectorAll('[data-grupo]').forEach((b) => b.onclick = () => abrirGrupo(b.dataset.grupo));
  }

  async function nuevoGrupo() {
    if (!(await requerirCuenta())) return;
    abrirModal(`<h2 id="modal-title">Crear grupo</h2>
      <label class="field"><span>Nombre</span><input id="ng-nombre" maxlength="60" placeholder="Ej.: Caminantes de Minas"></label>
      <label class="field"><span>Zona (opcional)</span><input id="ng-zona" maxlength="40" placeholder="Ej.: Lavalleja"></label>
      <label class="field"><span>De qué se trata</span><textarea id="ng-desc" maxlength="500" rows="3"></textarea></label>
      <label class="check"><input type="checkbox" id="ng-privado"> <span>Privado: solo entra quien tenga el código</span></label>
      <div class="modal-actions"><button class="btn btn-ghost" id="ng-no">Cancelar</button><button class="btn btn-main" id="ng-si">Crear</button></div>`);
    $('#ng-no').onclick = cerrarModal;
    $('#ng-si').onclick = async () => {
      const nombre = $('#ng-nombre').value.trim();
      if (nombre.length < 3) return toast('Poné un nombre');
      $('#ng-si').disabled = true;
      const { data, error } = await sb().from('grupos').insert({ nombre, zona: $('#ng-zona').value.trim() || null, descripcion: $('#ng-desc').value.trim() || null, publico: !$('#ng-privado').checked }).select('id').single();
      if (error) { $('#ng-si').disabled = false; return toast(fallo(error)); }
      toast('Grupo creado'); render(); abrirGrupo(data.id);
    };
  }

  async function unirmeConCodigo() {
    if (!(await requerirCuenta())) return;
    abrirModal(`<h2 id="modal-title">Unirme con código</h2>
      <label class="field"><span>Código del grupo</span><input id="uc-cod" maxlength="6" autocapitalize="characters" placeholder="Ej.: A1B2C3"></label>
      <div class="modal-actions"><button class="btn btn-ghost" id="uc-no">Cancelar</button><button class="btn btn-main" id="uc-si">Unirme</button></div>`);
    $('#uc-no').onclick = cerrarModal;
    $('#uc-si').onclick = async () => {
      const { data, error } = await sb().rpc('unirme_con_codigo', { c: $('#uc-cod').value });
      if (error) return toast(fallo(error).replace('No se pudo: ', ''));
      toast('¡Te uniste al grupo!'); render(); abrirGrupo(data);
    };
  }

  async function abrirGrupo(id) {
    abrirModal('<p class="empty">Cargando…</p>');
    const u = await usuario(), yo = u && u.id;
    const [g, m, t, e] = await Promise.all([
      sb().from('grupos').select('id,nombre,descripcion,zona,publico,creador').eq('id', id).maybeSingle(),
      sb().from('grupo_miembros').select('usuario,rol').eq('grupo', id),
      sb().from('foro_temas').select('id,titulo,autor,actividad,respuestas,recorrido').eq('grupo', id).order('actividad', { ascending: false }).limit(30),
      sb().from('eventos').select('id,titulo,fecha,cancelado').eq('grupo', id).gte('fecha', new Date().toISOString()).order('fecha').limit(20),
    ]);
    if (!g.data) { abrirModal('<p class="empty">Este grupo ya no está disponible.</p><div class="modal-actions"><button class="btn btn-main" id="gg-ok">Cerrar</button></div>'); $('#gg-ok').onclick = cerrarModal; return; }
    const grupo = g.data, miembros = m.data || [], soyMiembro = miembros.some((x) => x.usuario === yo);
    const temas = visibles(t.data);
    await cargarPerfiles([grupo.creador, ...temas.map((x) => x.autor), ...miembros.slice(0, 30).map((x) => x.usuario)]);
    const codigo = soyMiembro && !grupo.publico ? (await sb().rpc('codigo_grupo', { g: id })).data : null;
    abrirModal(`<h2 id="modal-title">${grupo.publico ? '' : '🔒 '}${esc(grupo.nombre)}</h2>
      <p class="fine">${grupo.zona ? esc(grupo.zona) + ' · ' : ''}${miembros.length} miembro${miembros.length === 1 ? '' : 's'} · creado por ${quien(grupo.creador)}</p>
      ${grupo.descripcion ? `<p class="soc-texto">${esc(grupo.descripcion)}</p>` : ''}
      ${codigo ? `<div class="progress">Código para invitar: <b style="font-size:1.2rem;letter-spacing:.1em">${esc(codigo)}</b> <button class="link-suave" id="gg-compartir">Compartir</button></div>` : ''}
      <div class="actions">${soyMiembro
        ? `<button class="btn btn-main" id="gg-tema">Nuevo tema</button><button class="btn btn-ghost" id="gg-evento">Proponer salida</button>`
        : grupo.publico ? '<button class="btn btn-main" id="gg-unirme">Unirme al grupo</button>' : ''}</div>
      ${soyMiembro || grupo.publico ? `
        <h3 class="sec-title">Próximas salidas</h3>${(e.data || []).length ? e.data.map((x) => `<button class="soc-fila" data-evento="${x.id}"><span class="soc-tit">${esc(x.titulo)}</span><small>${x.cancelado ? 'Cancelada · ' : ''}${fecha(x.fecha)}</small></button>`).join('') : '<p class="empty">No hay salidas propuestas.</p>'}
        <h3 class="sec-title">Temas del grupo</h3>${temas.length ? temas.map(filaTema).join('') : '<p class="empty">Todavía no hay temas.</p>'}
        <h3 class="sec-title">Miembros</h3><p class="fine">${miembros.slice(0, 30).map((x) => quien(x.usuario) + (x.rol === 'admin' ? ' (admin)' : '')).join(', ')}${miembros.length > 30 ? '…' : ''}</p>` : ''}
      ${accionesHtml('grupo', grupo.id, grupo.creador, yo)}
      <div class="modal-actions">${soyMiembro && grupo.creador !== yo ? '<button class="btn btn-ghost" id="gg-salir">Salir del grupo</button>' : ''}${grupo.creador === yo ? '<button class="btn btn-ghost" id="gg-borrar">Borrar grupo</button>' : ''}<button class="btn btn-main" id="gg-cerrar">Cerrar</button></div>`);
    conectarAcciones($('#modal-content'), () => { cerrarModal(); render(); });
    $('#gg-cerrar').onclick = () => { cerrarModal(); render(); };
    document.querySelectorAll('#modal [data-tema]').forEach((b) => b.onclick = () => abrirTema(b.dataset.tema));
    document.querySelectorAll('#modal [data-evento]').forEach((b) => b.onclick = () => abrirEvento(b.dataset.evento));
    if ($('#gg-compartir')) $('#gg-compartir').onclick = () => Nativo.compartir({ titulo: grupo.nombre, texto: `Sumate a "${grupo.nombre}" en Senda: en Comunidad → Grupos → Unirme con código, poné ${codigo}` });
    if ($('#gg-tema')) $('#gg-tema').onclick = () => nuevoTema(id);
    if ($('#gg-evento')) $('#gg-evento').onclick = () => nuevoEvento(id);
    if ($('#gg-unirme')) $('#gg-unirme').onclick = async () => {
      const yoReal = await requerirCuenta();
      if (!yoReal) return;
      const { error } = await sb().from('grupo_miembros').insert({ grupo: id, usuario: yoReal.id });
      if (error && error.code !== '23505') return toast(fallo(error));
      toast('¡Te uniste!'); abrirGrupo(id);
    };
    if ($('#gg-salir')) $('#gg-salir').onclick = async () => { await sb().from('grupo_miembros').delete().eq('grupo', id).eq('usuario', yo); cerrarModal(); toast('Saliste del grupo'); render(); };
    if ($('#gg-borrar')) $('#gg-borrar').onclick = async () => {
      if (!confirm('¿Borrar el grupo con todos sus temas y salidas?')) return;
      await sb().from('grupos').delete().eq('id', id); cerrarModal(); toast('Grupo borrado'); render();
    };
  }

  // ─── Events ───────────────────────────────────────────────────────────────────
  async function verEventos(cuerpo) {
    const { data, error } = await sb().from('eventos').select('id,titulo,fecha,encuentro,recorrido,creador,cancelado,grupo')
      .gte('fecha', new Date(Date.now() - 6 * 3600000).toISOString()).order('fecha').limit(60);
    if (error) throw error;
    const eventos = visibles(data, 'creador');
    await cargarPerfiles(eventos.map((x) => x.creador));
    cuerpo.innerHTML = `<p class="lead">Salidas al aire libre que propone la comunidad. Anotate y encontrate con gente para caminar.</p>
      <div class="actions"><button class="btn btn-main" id="ev-nuevo">Proponer una salida</button></div>
      ${eventos.length ? eventos.map((x) => `<button class="soc-fila" data-evento="${x.id}"><span class="soc-tit">${esc(x.titulo)}</span>
        <small>${x.cancelado ? '<b>Cancelada</b> · ' : ''}${fecha(x.fecha)}${x.recorrido ? ' · ' + esc(nombreRecorrido(x.recorrido)) : x.encuentro ? ' · ' + esc(x.encuentro) : ''} · por ${quien(x.creador)}</small></button>`).join('')
        : '<p class="empty">No hay salidas propuestas. ¡Proponé la primera!</p>'}`;
    $('#ev-nuevo').onclick = () => nuevoEvento();
    cuerpo.querySelectorAll('[data-evento]').forEach((b) => b.onclick = () => abrirEvento(b.dataset.evento));
  }

  async function nuevoEvento(grupo = null) {
    if (!(await requerirCuenta())) return;
    const manana = new Date(Date.now() + 86400000); manana.setHours(8, 0, 0, 0);
    const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    abrirModal(`<h2 id="modal-title">Proponer una salida</h2>
      <label class="field"><span>Título</span><input id="ne-titulo" maxlength="100" placeholder="Ej.: Subida al Pan de Azúcar al amanecer"></label>
      <label class="field"><span>Día y hora</span><input id="ne-fecha" type="datetime-local" value="${local(manana)}" min="${local(new Date())}"></label>
      <label class="field"><span>Recorrido (opcional)</span><select id="ne-rec">${opcionesRecorrido()}</select></label>
      <label class="field"><span>Punto de encuentro</span><input id="ne-enc" maxlength="120" placeholder="Ej.: Estacionamiento de la reserva"></label>
      <label class="field"><span>Cupo (opcional)</span><input id="ne-cupo" type="number" min="1" max="500" placeholder="Sin límite"></label>
      <label class="field"><span>Detalles</span><textarea id="ne-desc" maxlength="1000" rows="3" placeholder="Nivel, qué llevar, si se comparte auto…"></textarea></label>
      <p class="fine">Senda no organiza ni se hace responsable de las salidas: cada persona va bajo su responsabilidad.</p>
      <div class="modal-actions"><button class="btn btn-ghost" id="ne-no">Cancelar</button><button class="btn btn-main" id="ne-si">Publicar</button></div>`);
    $('#ne-no').onclick = cerrarModal;
    $('#ne-si').onclick = async () => {
      const titulo = $('#ne-titulo').value.trim(), f = new Date($('#ne-fecha').value);
      if (titulo.length < 3) return toast('Poné un título');
      if (!(f > new Date())) return toast('Elegí un día y hora que no hayan pasado');
      const cupo = parseInt($('#ne-cupo').value, 10);
      $('#ne-si').disabled = true;
      const { data, error } = await sb().from('eventos').insert({ titulo, fecha: f.toISOString(), recorrido: $('#ne-rec').value || null, encuentro: $('#ne-enc').value.trim() || null, cupo: cupo > 0 ? cupo : null, descripcion: $('#ne-desc').value.trim() || null, grupo }).select('id').single();
      if (error) { $('#ne-si').disabled = false; return toast(fallo(error)); }
      const u = await usuario();
      await sb().from('evento_asistentes').insert({ evento: data.id, usuario: u.id });
      await recordar({ id: data.id, titulo, fecha: f.toISOString(), encuentro: $('#ne-enc').value.trim(), recorrido: $('#ne-rec').value || null });
      toast('Salida publicada'); render(); abrirEvento(data.id);
    };
  }

  async function abrirEvento(id) {
    abrirModal('<p class="empty">Cargando…</p>');
    const u = await usuario(), yo = u && u.id;
    const [e, a] = await Promise.all([
      sb().from('eventos').select('*').eq('id', id).maybeSingle(),
      sb().from('evento_asistentes').select('usuario').eq('evento', id),
    ]);
    if (!e.data) { abrirModal('<p class="empty">Esta salida ya no está disponible.</p><div class="modal-actions"><button class="btn btn-main" id="ee-ok">Cerrar</button></div>'); $('#ee-ok').onclick = cerrarModal; return; }
    const ev = e.data, van = (a.data || []).map((x) => x.usuario), voy = van.includes(yo), pasado = Date.parse(ev.fecha) < Date.now();
    await cargarPerfiles([ev.creador, ...van]);
    const lleno = ev.cupo && van.length >= ev.cupo;
    abrirModal(`<h2 id="modal-title">${esc(ev.titulo)}</h2>
      ${ev.cancelado ? '<div class="estado e-cerrado"><b>Cancelada</b></div>' : ''}
      <div class="progress">📅 <b>${fecha(ev.fecha)}</b> · ${van.length}${ev.cupo ? ' de ' + ev.cupo : ''} anotado${van.length === 1 ? '' : 's'}</div>
      ${ev.recorrido ? `<p>Recorrido: <button class="link-suave" id="ee-rec">${esc(nombreRecorrido(ev.recorrido))}</button></p>` : ''}
      ${ev.encuentro ? `<p>Punto de encuentro: <b>${esc(ev.encuentro)}</b></p>` : ''}
      ${ev.descripcion ? `<p class="soc-texto">${esc(ev.descripcion)}</p>` : ''}
      <p class="fine">Propuesta por ${quien(ev.creador)}. Van: ${van.map(quien).join(', ') || 'nadie todavía'}.</p>
      <p class="fine">Senda no organiza ni se hace responsable de las salidas: cada persona va bajo su responsabilidad.</p>
      ${accionesHtml('evento', ev.id, ev.creador, yo)}
      <div class="modal-actions">
        <button class="btn btn-ghost" id="ee-compartir">Compartir</button>
        ${ev.creador === yo && !ev.cancelado && !pasado ? '<button class="btn btn-ghost" id="ee-cancelar">Cancelar salida</button>' : ''}
        ${!ev.cancelado && !pasado ? (voy ? '<button class="btn btn-ghost" id="ee-novoy">No voy</button>' : lleno ? '<button class="btn btn-ghost" disabled>Sin lugar</button>' : '<button class="btn btn-main" id="ee-voy">Voy</button>') : ''}
        <button class="btn btn-main" id="ee-cerrar">Cerrar</button></div>`);
    conectarAcciones($('#modal-content'), () => { cerrarModal(); render(); });
    $('#ee-cerrar').onclick = () => { cerrarModal(); render(); };
    if ($('#ee-rec')) $('#ee-rec').onclick = () => irARecorrido(ev.recorrido);
    $('#ee-compartir').onclick = () => Nativo.compartir({ titulo: ev.titulo, texto: `${ev.titulo} — ${fecha(ev.fecha)}${ev.encuentro ? '. Encuentro: ' + ev.encuentro : ''}. Anotate en Senda (Comunidad → Eventos).` });
    if ($('#ee-voy')) $('#ee-voy').onclick = async () => {
      const yoReal = await requerirCuenta();
      if (!yoReal) return;
      const { error } = await sb().from('evento_asistentes').insert({ evento: id, usuario: yoReal.id });
      if (error && error.code !== '23505') return toast(fallo(error).replace('No se pudo: ', ''));
      const avisa = await recordar(ev);
      toast(avisa ? '¡Anotado! Te avisamos la noche antes y 2 horas antes.' : '¡Anotado!'); abrirEvento(id);
    };
    if ($('#ee-novoy')) $('#ee-novoy').onclick = async () => { await sb().from('evento_asistentes').delete().eq('evento', id).eq('usuario', yo); await olvidar(id); abrirEvento(id); };
    if ($('#ee-cancelar')) $('#ee-cancelar').onclick = async () => {
      if (!confirm('¿Cancelar la salida? Le va a aparecer cancelada a quienes se anotaron.')) return;
      await sb().from('eventos').update({ cancelado: true }).eq('id', id); await olvidar(id); abrirEvento(id);
    };
  }

  // ─── Reminders of the outings I'm going to ──────────────────────────────────────
  // Two notifications per outing, the evening before (20:00) and 2 hours before, with the
  // forecast. Ids are derived from the outing so any later session can replace or cancel them.
  const idAviso = (eventoId, n) => (parseInt(eventoId.replace(/-/g, '').slice(0, 7), 16) * 2 + n) % 2000000000 + 1;
  const leerAvisos = async () => (await DB.get('kv', 'recordatorios').catch(() => null)) || {};

  async function olvidar(eventoId) {
    const todos = await leerAvisos();
    for (const id of todos[eventoId] || []) await Nativo.cancelar(id);
    if (Nativo.esNativo) for (const n of [0, 1]) await Nativo.cancelar(idAviso(eventoId, n));
    delete todos[eventoId];
    await DB.set('kv', 'recordatorios', todos).catch(() => {});
  }

  async function recordar(ev) {
    await olvidar(ev.id);
    const t = Date.parse(ev.fecha);
    const r = ev.recorrido && recorridos.find((x) => x.id === ev.recorrido);
    const pron = await Clima.resumenDia(r ? r.inicio.coord : [-34.6, -55.1], t);
    const hora = new Date(t).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const lugar = ev.encuentro ? ` en ${ev.encuentro}` : r ? ` en ${r.inicio.nombre}` : '';
    const vispera = new Date(t - 86400000); vispera.setHours(20, 0, 0, 0);
    const avisos = [
      [vispera.getTime(), `Mañana: ${ev.titulo}`, `A las ${hora}${lugar}.${pron ? ' ' + pron + '.' : ''} Prepará agua y abrigo, y avisale a alguien a dónde vas.`],
      [t - 2 * 3600000, `En 2 horas: ${ev.titulo}`, `${hora}${lugar}.${pron ? ' ' + pron + '.' : ''}`],
    ];
    const ids = [];
    for (const [i, [cuando, titulo, cuerpo]] of avisos.entries()) {
      if (cuando <= Date.now()) continue;
      const id = await Nativo.notificar(titulo, cuerpo, cuando, idAviso(ev.id, i));
      if (id != null) ids.push(id);
    }
    const todos = await leerAvisos();
    todos[ev.id] = ids.filter((x) => typeof x === 'number'); // web timers do not survive a reload
    await DB.set('kv', 'recordatorios', todos).catch(() => {});
    return ids.length > 0;
  }

  // At start (store app): schedule what is missing, drop outings cancelled or left.
  async function sincronizarRecordatorios() {
    if (!Nube.activa || !navigator.onLine || !Nativo.esNativo) return;
    const u = await cuentaReal();
    if (!u) return;
    const { data } = await sb().from('evento_asistentes').select('eventos(id,titulo,fecha,encuentro,recorrido,cancelado)').eq('usuario', u.id);
    if (!data) return;
    const vigentes = data.map((x) => x.eventos).filter((e) => e && !e.cancelado && Date.parse(e.fecha) > Date.now());
    const todos = await leerAvisos();
    for (const id of Object.keys(todos)) if (!vigentes.some((e) => e.id === id)) await olvidar(id);
    for (const e of vigentes) if (!todos[e.id]) await recordar(e);
  }

  // ─── Friends ──────────────────────────────────────────────────────────────────
  async function verAmigos(cuerpo) {
    const u = await cuentaReal();
    if (!u) {
      cuerpo.innerHTML = `<p class="lead">Agregá a la gente con la que caminás para ver a qué salidas van.</p>
        <div class="actions"><button class="btn btn-main" id="am-cuenta">Crear cuenta para agregar amigos</button></div>`;
      $('#am-cuenta').onclick = () => Comunidad.abrirCuenta();
      return;
    }
    const { data, error } = await sb().from('amistades').select('de,para,estado');
    if (error) throw error;
    const otro = (a) => (a.de === u.id ? a.para : a.de);
    const filas = (data || []).filter((a) => !bloqueados.has(otro(a)));
    const amigos = filas.filter((a) => a.estado === 'aceptada'), recibidas = filas.filter((a) => a.estado === 'pendiente' && a.para === u.id), enviadas = filas.filter((a) => a.estado === 'pendiente' && a.de === u.id);
    await cargarPerfiles(filas.map(otro));
    const persona = (id, extra = '') => `<div class="soc-persona"><button class="link-suave" data-perfil="${id}"><b>${quien(id)}</b>${perfiles[id] && perfiles[id].zona ? ` <small>· ${esc(perfiles[id].zona)}</small>` : ''}</button>${extra}</div>`;
    cuerpo.innerHTML = `<label class="field"><span>Buscar personas por nombre</span><input id="am-buscar" placeholder="Nombre" maxlength="40" autocomplete="off"></label>
      <div id="am-resultados"></div>
      ${recibidas.length ? `<h3 class="sec-title">Solicitudes</h3>${recibidas.map((a) => persona(a.de, `<span><button class="btn btn-main btn-chico" data-aceptar="${a.de}">Aceptar</button><button class="btn btn-ghost btn-chico" data-rechazar="${a.de}">No</button></span>`)).join('')}` : ''}
      <h3 class="sec-title">Mis amigos</h3>${amigos.length ? amigos.map((a) => persona(otro(a))).join('') : '<p class="empty">Todavía no agregaste a nadie. Buscalos por su nombre.</p>'}
      ${enviadas.length ? `<h3 class="sec-title">Esperando respuesta</h3>${enviadas.map((a) => persona(a.para, `<button class="btn btn-ghost btn-chico" data-rechazar="${a.para}">Cancelar</button>`)).join('')}` : ''}`;
    const conectar = (raiz) => {
      raiz.querySelectorAll('[data-perfil]').forEach((b) => b.onclick = () => abrirPerfil(b.dataset.perfil));
      raiz.querySelectorAll('[data-aceptar]').forEach((b) => b.onclick = async () => { const { error: e } = await sb().from('amistades').update({ estado: 'aceptada' }).eq('de', b.dataset.aceptar).eq('para', u.id); if (e) toast(fallo(e)); render(); });
      raiz.querySelectorAll('[data-rechazar]').forEach((b) => b.onclick = async () => { const o = b.dataset.rechazar; await sb().from('amistades').delete().or(`and(de.eq.${u.id},para.eq.${o}),and(de.eq.${o},para.eq.${u.id})`); render(); });
      raiz.querySelectorAll('[data-agregar]').forEach((b) => b.onclick = async () => {
        const { error: e } = await sb().from('amistades').insert({ de: u.id, para: b.dataset.agregar });
        toast(e ? (e.code === '23505' ? 'Ya le mandaste una solicitud' : 'No se pudo mandar la solicitud') : 'Solicitud enviada'); render();
      });
    };
    conectar(cuerpo);
    let espera = null;
    $('#am-buscar').oninput = (ev) => {
      clearTimeout(espera);
      const q = ev.target.value.trim().replace(/[%_,()]/g, '');
      if (q.length < 2) { $('#am-resultados').innerHTML = ''; return; }
      espera = setTimeout(async () => {
        const { data: r } = await sb().from('perfiles').select('id,nombre,zona').ilike('nombre', `%${q}%`).neq('id', u.id).limit(15);
        const conocidos = new Set(filas.map(otro));
        const lista = (r || []).filter((p) => !bloqueados.has(p.id));
        for (const p of lista) perfiles[p.id] = { ...perfiles[p.id], ...p };
        if (!$('#am-resultados')) return;
        $('#am-resultados').innerHTML = lista.length ? lista.map((p) => persona(p.id, conocidos.has(p.id) ? '<small>Ya está en tu lista</small>' : `<button class="btn btn-main btn-chico" data-agregar="${p.id}">Agregar</button>`)).join('') : '<p class="empty">No encontramos a nadie con ese nombre.</p>';
        conectar($('#am-resultados'));
      }, 350);
    };
  }

  async function abrirPerfil(id) {
    const u = await usuario(), yo = u && u.id;
    await cargarPerfiles([id]);
    const p = perfiles[id] || {};
    const { data } = await sb().from('evento_asistentes').select('evento, eventos(id,titulo,fecha,cancelado)').eq('usuario', id).limit(20);
    const proximos = (data || []).map((x) => x.eventos).filter((x) => x && !x.cancelado && Date.parse(x.fecha) > Date.now()).sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha));
    abrirModal(`<h2 id="modal-title">${quien(id)}</h2>
      ${p.zona ? `<p class="fine">${esc(p.zona)}</p>` : ''}${p.bio ? `<p class="soc-texto">${esc(p.bio)}</p>` : ''}
      <h3 class="sec-title">Próximas salidas</h3>${proximos.length ? proximos.map((x) => `<button class="soc-fila" data-evento="${x.id}"><span class="soc-tit">${esc(x.titulo)}</span><small>${fecha(x.fecha)}</small></button>`).join('') : '<p class="empty">No está anotado en ninguna salida.</p>'}
      ${accionesHtml('perfil', id, id, yo)}
      <div class="modal-actions">${id !== yo ? '<button class="btn btn-ghost" id="pf-quitar">Quitar de amigos</button>' : ''}<button class="btn btn-main" id="pf-cerrar">Cerrar</button></div>`);
    conectarAcciones($('#modal-content'), () => { cerrarModal(); render(); });
    document.querySelectorAll('#modal [data-evento]').forEach((b) => b.onclick = () => abrirEvento(b.dataset.evento));
    $('#pf-cerrar').onclick = () => { cerrarModal(); render(); };
    if ($('#pf-quitar')) $('#pf-quitar').onclick = async () => { await sb().from('amistades').delete().or(`and(de.eq.${yo},para.eq.${id}),and(de.eq.${id},para.eq.${yo})`); cerrarModal(); toast('Listo'); render(); };
  }

  function irARecorrido(id) {
    cerrarModal();
    mostrarVista('recorridos');
    seleccionar(id);
  }

  return { render, sincronizarRecordatorios, recordar, olvidar };
})();
