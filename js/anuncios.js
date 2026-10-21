/* Ads (native app only, AdMob). A single banner at the bottom of the trail list and the
   trail page. Never while walking a trail, placing a report, or over a dialog (SOS
   included): app.js decides when it may show and calls Anuncios.poner(). */
'use strict';

const Anuncios = (() => {
  const cfg = (window.SENDA_CONFIG || {}).anuncios || {};
  const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob;
  const adId = cfg[Nativo.plataforma];
  const disponible = !!(Nativo.esNativo && P && cfg.activos && adId);
  let listo = false, quiere = false, puesto = false, cargado = false, alto = 0;
  let cola = Promise.resolve();

  // The sheet leaves room for the banner so it never covers buttons.
  const reservar = (h) => document.documentElement.style.setProperty('--anuncio-h', `${h}px`);

  /* After the welcome screen: privacy consent (shown by Google only where the law asks
     for it), then on iPhone the "allow tracking" question. Saying no still shows ads,
     just not personalized ones. */
  async function iniciar() {
    if (!disponible || listo) return;
    await Suscripcion.iniciar();
    if (Suscripcion.activa()) return; // paid to remove ads: no consent forms either
    try {
      await P.initialize({ initializeForTesting: !!cfg.prueba });
      const c = await P.requestConsentInfo();
      if (c.isConsentFormAvailable && c.status === 'REQUIRED') await P.showConsentForm();
      if (Nativo.plataforma === 'ios') {
        const t = await P.trackingAuthorizationStatus();
        if (t.status === 'notDetermined') await P.requestTrackingAuthorization();
      }
      P.addListener('bannerAdSizeChanged', (s) => { alto = Math.round(s.height || 0); if (puesto) reservar(alto); });
      P.addListener('bannerAdFailedToLoad', () => { alto = 0; reservar(0); });
      listo = true;
      cola = cola.then(aplicar);
    } catch (e) { console.warn('Anuncios: no se pudieron iniciar', e); }
  }

  async function aplicar() {
    try {
      if (quiere && !puesto) {
        if (!cargado) {
          await P.showBanner({ adId, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: 0, isTesting: !!cfg.prueba });
          cargado = true;
        } else await P.resumeBanner();
        puesto = true;
      } else if (!quiere && puesto) {
        await P.hideBanner();
        puesto = false;
      }
    } catch (e) { console.warn('Anuncios', e); }
    reservar(puesto ? alto : 0);
  }

  /* Rewarded video before downloading a trail for use without signal. Resolves true when
     the download may go ahead: after watching it, and also whenever the video cannot be
     shown (no ad available, no connection for ads, any error), so nobody is ever left
     without the offline map because of an ad. Only false if the person closes it early. */
  const premioId = cfg.premio && cfg.premio[Nativo.plataforma];
  const conPremio = () => !!(disponible && premioId && !Suscripcion.activa());
  async function premio() {
    if (!conPremio()) return true;
    if (!listo) await iniciar();
    if (!listo || Suscripcion.activa()) return true;
    let gano = false, mostro = false;
    const oyentes = [];
    let tope = null;
    const oir = async (ev, f) => oyentes.push(await P.addListener(ev, f));
    const fin = new Promise((ok) => {
      oir('onRewardedVideoAdReward', () => { gano = true; });
      oir('onRewardedVideoAdShowed', () => { mostro = true; });
      oir('onRewardedVideoAdDismissed', ok);
      oir('onRewardedVideoAdFailedToShow', ok);
      tope = setTimeout(ok, 180000); // never wait forever
    });
    try {
      await Promise.race([P.prepareRewardVideoAd({ adId: premioId, isTesting: !!cfg.prueba }), new Promise((_, mal) => setTimeout(() => mal(new Error('tardó')), 10000))]);
      P.showRewardVideoAd().then((item) => { if (item && (item.amount || item.type)) gano = true; }).catch(() => {});
      await fin;
    } catch (e) { console.warn('Video con premio no disponible', e); }
    clearTimeout(tope);
    oyentes.forEach((h) => h && h.remove && h.remove());
    return !mostro || gano;
  }

  // Subscribing hides the banner right away.
  Suscripcion.alCambiar((sin) => { if (sin) { quiere = false; reservar(0); if (listo) cola = cola.then(aplicar); } });

  return {
    disponible,
    iniciar,
    premio,
    conPremio,
    poner(visible) {
      quiere = !!visible && !Suscripcion.activa();
      if (!quiere) reservar(0); // free the space at once, even before the banner hides
      if (listo) cola = cola.then(aplicar);
    },
  };
})();
