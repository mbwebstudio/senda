/* "Senda sin anuncios": monthly subscription (about USD 2) sold through Apple and Google's
   own payment systems, managed with RevenueCat. Only in the store app and only once the
   keys are in config.js; until then the option does not appear (a button that does not
   work gets the app rejected). Safety features never depend on paying. */
'use strict';

const Suscripcion = (() => {
  const cfg = (window.SENDA_CONFIG || {}).suscripcion || {};
  const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Purchases;
  const clave = cfg[Nativo.plataforma];
  const disponible = !!(Nativo.esNativo && P && clave);
  const derecho = cfg.derecho || 'sin_anuncios';
  let activa = false, iniciada = null;
  const oyentes = [];

  const leer = (info) => {
    const antes = activa;
    activa = !!(info && info.entitlements && info.entitlements.active && info.entitlements.active[derecho]);
    if (activa !== antes) oyentes.forEach((f) => f(activa));
  };

  function iniciar() {
    if (!disponible) return Promise.resolve();
    if (!iniciada) {
      iniciada = (async () => {
        try {
          await P.configure({ apiKey: clave });
          P.addCustomerInfoUpdateListener(leer);
          leer((await P.getCustomerInfo()).customerInfo);
        } catch (e) { console.warn('Suscripción', e); }
      })();
    }
    return iniciada;
  }

  async function ofrecer() {
    await iniciar();
    if (activa) {
      abrirModal(`<h2 id="modal-title">Senda sin anuncios</h2>
        <p class="lead">¡Gracias por apoyar Senda! Tu suscripción está activa.</p>
        <p class="fine">Para cancelarla: ${Nativo.plataforma === 'ios' ? 'Ajustes → tu nombre → Suscripciones' : 'Google Play → tu perfil → Pagos y suscripciones'}.</p>
        <div class="modal-actions"><button class="btn btn-main" id="sus-ok">Cerrar</button></div>`);
      $('#sus-ok').onclick = cerrarModal;
      return;
    }
    abrirModal('<p class="empty">Cargando…</p>');
    let paquete = null;
    try {
      const ofertas = await P.getOfferings();
      const actual = ofertas && ofertas.current;
      paquete = actual && (actual.monthly || (actual.availablePackages || [])[0]);
    } catch (e) { console.warn(e); }
    if (!paquete) {
      abrirModal('<h2 id="modal-title">Senda sin anuncios</h2><p class="lead">No pudimos cargar la suscripción. Probá de nuevo con conexión.</p><div class="modal-actions"><button class="btn btn-main" id="sus-ok">Cerrar</button></div>');
      $('#sus-ok').onclick = cerrarModal;
      return;
    }
    const precio = paquete.product.priceString;
    abrirModal(`<h2 id="modal-title">Senda sin anuncios</h2>
      <p class="lead">Sacá los anuncios y ayudanos a mantener Senda gratis para todos.</p>
      <ul class="tips"><li>Sin anuncios en toda la app.</li><li>Todo lo demás sigue igual: Senda es gratis, y el SOS y los avisos de peligro nunca se cobran.</li></ul>
      <div class="progress"><b style="font-size:1.3rem">${esc(precio)}</b> por mes</div>
      <p class="fine">Se renueva sola cada mes. Se cobra a tu cuenta de ${Nativo.plataforma === 'ios' ? 'Apple' : 'Google Play'} y la podés cancelar cuando quieras desde ${Nativo.plataforma === 'ios' ? 'Ajustes → tu nombre → Suscripciones' : 'Google Play → Pagos y suscripciones'}, hasta 24 horas antes de que se renueve. <a href="legal/terminos.html" target="_blank">Términos</a> · <a href="legal/privacidad.html" target="_blank">Privacidad</a></p>
      <div class="modal-actions"><button class="btn btn-ghost" id="sus-restaurar">Restaurar compra</button><button class="btn btn-main" id="sus-comprar">Suscribirme</button></div>
      <p class="fine"><button class="link-suave" id="sus-no">Ahora no</button></p>`);
    $('#sus-no').onclick = cerrarModal;
    $('#sus-comprar').onclick = async () => {
      $('#sus-comprar').disabled = true;
      try {
        const r = await P.purchasePackage({ aPackage: paquete });
        leer(r.customerInfo);
        cerrarModal(); toast(activa ? '¡Gracias! Ya no vas a ver anuncios.' : 'La compra quedó pendiente.');
      } catch (e) {
        $('#sus-comprar').disabled = false;
        if (!(e && (e.userCancelled || e.code === '1' || /cancel/i.test(e.message || '')))) toast('No se pudo completar la compra.');
      }
    };
    $('#sus-restaurar').onclick = async () => {
      try {
        const r = await P.restorePurchases();
        leer(r.customerInfo);
        toast(activa ? 'Listo, recuperamos tu suscripción.' : 'No encontramos una suscripción activa en esta cuenta.');
        if (activa) cerrarModal();
      } catch { toast('No se pudo restaurar. Probá con conexión.'); }
    };
  }

  return {
    disponible,
    iniciar,
    ofrecer,
    activa: () => activa,
    alCambiar(f) { oyentes.push(f); },
  };
})();
