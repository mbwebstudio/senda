/* Safety while walking: emergency contact, "back by" time with reminders (and an SMS to
   the contact from the server if you don't check in), live location sharing with a link,
   and a warning when the remaining walk won't fit before sunset. */
'use strict';

const Seguridad = (() => {
  const cfg = window.SENDA_CONFIG || {};
  let actual = null;           // { recorrido, vuelvoA, seguimientoId, notifs: [], avisoNoche }
  let ultimaSubida = 0, ultimaPos = null;

  const contacto = () => DB.get('kv', 'contacto').catch(() => null);
  const guardarContacto = (c) => DB.set('kv', 'contacto', c);
  const nombreMio = async () => ((await DB.get('kv', 'perfil').catch(() => null)) || {}).nombre || '';

  Bandeja.registrar('seguimiento-crear', async (d) => {
    const { error } = await Nube.sb.from('seguimientos').insert(d);
    if (error) throw error;
  });
  Bandeja.registrar('seguimiento-pos', async (d) => {
    const { error } = await Nube.sb.from('seguimientos').update({ lat: d.lat, lon: d.lon, actualizado: d.actualizado }).eq('id', d.id);
    if (error) throw error;
  });
  Bandeja.registrar('seguimiento-fin', async (d) => {
    const { error } = await Nube.sb.from('seguimientos').update({ terminado: true }).eq('id', d.id);
    if (error) throw error;
  });

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
  const hhmm = (ms) => new Date(ms).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const linkSeguir = (id) => `${(cfg.appUrl || location.origin + location.pathname.replace(/[^/]*$/, '')).replace(/\/$/, '')}/seguir.html?id=${id}`;

  // Rough walking time left: 4 km/h on flat plus 10 min per 100 m of climb ahead.
  function tiempoRestanteMs(r, desdeIdx) {
    let m = 0;
    for (let i = desdeIdx; i < r.ruta.length - 1; i++) m += dist(r.ruta[i], r.ruta[i + 1]);
    let sube = 0;
    if (r.perfil) {
      const recorrido = r.distanciaKm * 1000 - m;
      for (let i = 1; i < r.perfil.length; i++) if (r.perfil[i][0] > recorrido) { const d = r.perfil[i][1] - r.perfil[i - 1][1]; if (d > 0) sube += d; }
    }
    return ((m / 1000) / 4 + sube / 600) * 3600000;
  }

  // "Before you leave" dialog. Resolves with the options, or null if cancelled.
  function preparar(r) {
    return new Promise(async (ok) => {
      const c = (await contacto()) || {};
      const estimadaMin = Math.max(60, Math.round(((r.distanciaKm / 3) + (r.subidaM || 0) / 500) * 60 * (r.circular ? 1 : 2)));
      const vuelta = new Date(Date.now() + estimadaMin * 60000);
      vuelta.setMinutes(Math.ceil(vuelta.getMinutes() / 15) * 15, 0, 0);
      const valorHora = `${String(vuelta.getHours()).padStart(2, '0')}:${String(vuelta.getMinutes()).padStart(2, '0')}`;
      const conServidor = Nube.activa;
      const sms = conServidor && (await Nube.smsActivo());
      abrirModal(`
        <h2 id="modal-title">Antes de salir</h2>
        <p class="lead">Si algo pasa, que alguien sepa dónde estás.</p>
        <label class="field"><span>¿A qué hora pensás terminar?</span><input type="time" id="seg-hora" value="${valorHora}"></label>
        <p class="aviso-clima" id="seg-noche" hidden></p>
        <div class="field"><span>Contacto de emergencia</span>
          <div class="fila-2"><input id="seg-cnombre" placeholder="Nombre" value="${esc(c.nombre || '')}" autocomplete="name"><input id="seg-ctel" type="tel" placeholder="Celular (09…)" value="${esc(c.tel || '')}" autocomplete="tel"></div>
        </div>
        ${sms ? `<label class="check"><input type="checkbox" id="seg-avisar" ${c.tel ? 'checked' : ''}> <span>Avisarle si no marco que llegué (le llega un SMS 30 minutos después de la hora)</span></label>` : '<p class="fine">🔔 Te avisamos en el teléfono a la hora de vuelta, y otra vez 30 minutos después si no marcaste que llegaste.</p>'}
        <label class="check"><input type="checkbox" id="seg-vivo" ${conServidor ? '' : 'disabled'}> <span>Compartir mi ubicación en vivo con un link${conServidor ? '' : ' <small>(se activa cuando esté configurado el servidor)</small>'}</span></label>
        ${!sms ? '<p class="fine">Por ahora tu contacto no recibe nada automáticamente: mandale tu plan por WhatsApp con el botón de abajo.</p>' : ''}
        <div class="modal-actions">
          <button class="btn btn-ghost" id="seg-cancelar">Cancelar</button>
          <button class="btn btn-ghost" id="seg-plan">Mandar mi plan</button>
          <button class="btn btn-main" id="seg-ok">Empezar</button>
        </div>`);
      const leer = () => {
        const [h, m] = $('#seg-hora').value.split(':').map(Number);
        const t = new Date(); t.setHours(h, m, 0, 0);
        if (t < Date.now()) t.setDate(t.getDate() + 1);
        return { vuelvoA: +t, contacto: { nombre: $('#seg-cnombre').value.trim(), tel: $('#seg-ctel').value.replace(/[^\d+]/g, '') }, avisar: !!($('#seg-avisar') && $('#seg-avisar').checked), vivo: $('#seg-vivo').checked, sms };
      };
      const puesta = await Clima.puestaHoy(r);
      const revisarNoche = () => {
        const { vuelvoA } = leer();
        const el = $('#seg-noche');
        el.hidden = vuelvoA < puesta - 15 * 60000;
        el.textContent = `⚠️ El sol se pone a las ${hhmm(puesta)}. Si pensás terminar después, llevá linterna y avisale a alguien.`;
      };
      $('#seg-hora').onchange = revisarNoche;
      revisarNoche();
      $('#seg-cancelar').onclick = () => { cerrarModal(); ok(null); };
      $('#seg-plan').onclick = () => {
        const o = leer();
        const texto = `Voy a hacer "${r.nombre}" (${r.zona}, ${r.departamento}). Pienso terminar a las ${hhmm(o.vuelvoA)}. Arranco en: https://maps.google.com/?q=${r.inicio.coord.join(',')}`;
        Nativo.compartir({ titulo: 'Mi plan de caminata', texto });
      };
      $('#seg-ok').onclick = async () => {
        const o = leer();
        if (o.contacto.tel) await guardarContacto(o.contacto);
        cerrarModal();
        ok(o);
      };
    });
  }

  async function iniciar(r, o) {
    actual = { recorrido: r, vuelvoA: o.vuelvoA, notifs: [], avisoNoche: false, seguimientoId: null };
    ultimaSubida = 0; ultimaPos = null;
    actual.notifs.push(await Nativo.notificar('¿Ya terminaste?', `Pensabas terminar "${r.nombre}" a las ${hhmm(o.vuelvoA)}. Si ya llegaste, tocá "Terminar recorrido".`, o.vuelvoA));
    actual.notifs.push(await Nativo.notificar('Todavía no marcaste que llegaste', o.sms && o.avisar ? `Vamos a avisarle a ${o.contacto.nombre || 'tu contacto'}. Si estás bien, terminá el recorrido en Senda.` : 'Si estás bien, terminá el recorrido en Senda. Si necesitás ayuda, llamá al 911.', o.vuelvoA + 30 * 60000));
    if (Nube.activa && (o.vivo || (o.avisar && o.contacto.tel))) {
      actual.seguimientoId = uuid();
      await Bandeja.agregar('seguimiento-crear', {
        id: actual.seguimientoId, nombre: await nombreMio() || null, recorrido: r.nombre, vuelvo_a: new Date(o.vuelvoA).toISOString(),
        contacto_nombre: o.avisar ? o.contacto.nombre || null : null, contacto_tel: o.avisar ? aInternacional(o.contacto.tel) : null,
      });
      if (o.vivo) {
        const url = linkSeguir(actual.seguimientoId);
        Nativo.compartir({ titulo: 'Seguí mi recorrido', texto: `Estoy haciendo "${r.nombre}". Pienso terminar a las ${hhmm(o.vuelvoA)}. Podés ver dónde estoy acá:`, url });
      }
    }
  }

  // Uruguay mobile numbers to E.164 for the SMS provider.
  const aInternacional = (t) => (!t ? null : t.startsWith('+') ? t : t.startsWith('09') ? '+598' + t.slice(1) : '+598' + t);

  // Called on every position while walking. Returns a message to show, if any.
  function posicion(p, idx) {
    if (!actual) return null;
    const ahora = Date.now();
    if (actual.seguimientoId && (ahora - ultimaSubida > 60000 || (ultimaPos && dist(ultimaPos, p) > 200))) {
      ultimaSubida = ahora; ultimaPos = p;
      Bandeja.agregar('seguimiento-pos', { id: actual.seguimientoId, lat: p[0], lon: p[1], actualizado: new Date().toISOString() });
    }
    if (!actual.avisoNoche && idx != null) {
      const resta = tiempoRestanteMs(actual.recorrido, idx);
      Clima.puestaHoy(actual.recorrido).then((puesta) => {
        if (!actual || actual.avisoNoche) return;
        if (Date.now() + resta > puesta - 15 * 60000) {
          actual.avisoNoche = true;
          const min = Math.round(resta / 60000);
          mostrarAlerta('🌇', `Te faltan unos ${min} min de caminata y el sol se pone a las ${hhmm(puesta)}. Pensá en volver o apurá el paso; llevá linterna.`);
          Nativo.vibrar();
        }
      });
    }
    return null;
  }

  async function terminar() {
    if (!actual) return;
    for (const n of actual.notifs) await Nativo.cancelar(n);
    if (actual.seguimientoId) await Bandeja.agregar('seguimiento-fin', { id: actual.seguimientoId });
    actual = null;
  }

  // Extra buttons for the SOS dialog.
  async function botonesSOS(p) {
    const c = await contacto();
    const link = p ? `https://maps.google.com/?q=${p[0].toFixed(5)},${p[1].toFixed(5)}` : '';
    const texto = `Necesito ayuda. Estoy acá: ${link}`;
    return [
      c && c.tel && p ? `<a class="btn btn-ghost" href="sms:${c.tel}?&body=${encodeURIComponent(texto)}">SMS a ${esc(c.nombre || c.tel)}</a>` : '',
      p ? `<button class="btn btn-ghost" id="sos-compartir">Compartir ubicación</button>` : '',
    ].join('');
  }

  return { preparar, iniciar, posicion, terminar, botonesSOS, contacto, guardarContacto, activo: () => !!actual };
})();
window.Seguridad = Seguridad;
