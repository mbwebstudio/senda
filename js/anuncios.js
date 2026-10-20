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

  return {
    disponible,
    iniciar,
    poner(visible) {
      quiere = !!visible;
      if (!quiere) reservar(0); // free the space at once, even before the banner hides
      if (listo) cola = cola.then(aplicar);
    },
  };
})();
