/* Platform adapter: inside the Capacitor app it uses the native plugins (GPS that keeps
   working with the screen off, local notifications, share sheet, vibration); in a browser
   it falls back to the web APIs. The rest of the app only talks to `Nativo`. */
'use strict';

const Nativo = (() => {
  const cap = window.Capacitor;
  const esNativo = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const P = (cap && cap.Plugins) || {};
  // Notifications scheduled in an earlier session must not be overwritten: start the ids from
  // the clock instead of 1 (Android needs them under 2^31).
  let idNotif = Math.floor(Date.now() / 1000) % 1000000000;

  return {
    esNativo,
    plataforma: esNativo ? cap.getPlatform() : 'web',

    /* Continuous position. With `fondo` the native app keeps tracking with the screen off
       (shows a persistent notification on Android, as the stores require). Returns a stop fn. */
    async seguir(cb, err, { fondo = false } = {}) {
      if (esNativo && fondo && P.BackgroundGeolocation) {
        const id = await P.BackgroundGeolocation.addWatcher({
          backgroundMessage: 'Senda está siguiendo tu recorrido para avisarte de peligros cerca.',
          backgroundTitle: 'Recorrido en curso',
          requestPermissions: true,
          stale: false,
          distanceFilter: 5,
        }, (pos, e) => {
          if (e) { err && err(e); return; }
          if (pos) cb({ lat: pos.latitude, lon: pos.longitude, precision: pos.accuracy, alt: pos.altitude, t: pos.time || Date.now() });
        });
        return () => P.BackgroundGeolocation.removeWatcher({ id });
      }
      if (esNativo && P.Geolocation) {
        const id = await P.Geolocation.watchPosition({ enableHighAccuracy: true }, (pos, e) => {
          if (e || !pos) { err && err(e); return; }
          cb({ lat: pos.coords.latitude, lon: pos.coords.longitude, precision: pos.coords.accuracy, alt: pos.coords.altitude, t: pos.timestamp });
        });
        return () => P.Geolocation.clearWatch({ id });
      }
      if (!navigator.geolocation) { err && err(new Error('sin gps')); return () => {}; }
      const id = navigator.geolocation.watchPosition(
        (pos) => cb({ lat: pos.coords.latitude, lon: pos.coords.longitude, precision: pos.coords.accuracy, alt: pos.coords.altitude, t: pos.timestamp }),
        (e) => err && err(e),
        { enableHighAccuracy: true, maximumAge: 5000 },
      );
      return () => navigator.geolocation.clearWatch(id);
    },

    async posicion() {
      if (esNativo && P.Geolocation) {
        const pos = await P.Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000 });
        return [pos.coords.latitude, pos.coords.longitude];
      }
      // Indoors the precise fix can take long: fall back to a quick approximate one.
      const pedir = (opts) => new Promise((ok, mal) => navigator.geolocation.getCurrentPosition((p) => ok([p.coords.latitude, p.coords.longitude]), mal, opts));
      if (!navigator.geolocation) throw Object.assign(new Error('sin gps'), { code: 2 });
      try { return await pedir({ enableHighAccuracy: true, timeout: 10000 }); }
      catch (e) {
        if (e && e.code === 1) throw e; // permission denied: retrying will not help
        return pedir({ enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
      }
    },

    /* Compass: which way the phone points, in degrees (0 = north, clockwise). iPhone only
       gives it after asking, and the question must come from a tap: call pedirBrujula()
       inside a click handler, before any await. */
    pedirBrujula() {
      const D = window.DeviceOrientationEvent;
      if (!D) return Promise.resolve(false);
      if (typeof D.requestPermission !== 'function') return Promise.resolve(true);
      return D.requestPermission().then((r) => r === 'granted').catch(() => false);
    },
    brujula(cb) {
      const giro = () => (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      const iphone = (e) => { if (e.webkitCompassHeading != null) cb((e.webkitCompassHeading + giro() + 360) % 360); };
      const android = (e) => { if (e.alpha != null) cb((360 - e.alpha + giro()) % 360); };
      window.addEventListener('deviceorientation', iphone);
      window.addEventListener('deviceorientationabsolute', android);
      return () => { window.removeEventListener('deviceorientation', iphone); window.removeEventListener('deviceorientationabsolute', android); };
    },

    // 'granted' | 'denied' | 'prompt' | 'unknown', without asking the user.
    async permisoUbicacion() {
      try {
        if (esNativo && P.Geolocation) return (await P.Geolocation.checkPermissions()).location;
        if (navigator.permissions) return (await navigator.permissions.query({ name: 'geolocation' })).state;
      } catch { /* not supported */ }
      return 'unknown';
    },

    vibrar(patron = [200, 100, 200]) {
      if (esNativo && P.Haptics) { P.Haptics.vibrate({ duration: 400 }); return; }
      if (navigator.vibrate) navigator.vibrate(patron);
    },

    /* Notification now or at a given time (ms). Returns an id usable with cancelar().
       idFijo: a stable id, to replace or cancel it later from another session. */
    async notificar(titulo, cuerpo, cuando, idFijo) {
      const id = idFijo || idNotif++;
      if (esNativo && P.LocalNotifications) {
        try {
          const perm = await P.LocalNotifications.requestPermissions();
          if (perm.display !== 'granted') return null;
          await P.LocalNotifications.schedule({ notifications: [{ id, title: titulo, body: cuerpo, schedule: cuando ? { at: new Date(cuando), allowWhileIdle: true } : undefined }] });
          return id;
        } catch { return null; }
      }
      if (!('Notification' in window)) return null;
      if (Notification.permission === 'default') await Notification.requestPermission();
      if (Notification.permission !== 'granted') return null;
      const lanzar = () => { try { new Notification(titulo, { body: cuerpo, icon: 'icons/icon-192.png' }); } catch { /* some browsers need a service worker */ } };
      const t = cuando ? setTimeout(lanzar, Math.max(0, cuando - Date.now())) : (lanzar(), null);
      return { web: t };
    },
    async cancelar(id) {
      if (id == null) return;
      if (typeof id === 'object' && id.web) { clearTimeout(id.web); return; }
      if (esNativo && P.LocalNotifications) await P.LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => {});
    },

    /* Share an image (PNG blob) to Instagram, WhatsApp, etc. The app saves it to its cache
       folder first because the share sheet needs a file; browsers share it directly or,
       if they cannot, download it. */
    async compartirImagen(blob, nombre, texto) {
      if (esNativo && P.Share && P.Filesystem) {
        const base64 = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
        const { uri } = await P.Filesystem.writeFile({ path: nombre, data: base64, directory: 'CACHE' });
        await P.Share.share({ title: 'Senda', text: texto, files: [uri], dialogTitle: 'Compartir' });
        return 'compartido';
      }
      const archivo = new File([blob], nombre, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
        try { await navigator.share({ files: [archivo], text: texto }); return 'compartido'; } catch (e) { if (e.name === 'AbortError') return 'cancelado'; }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return 'descargado';
    },

    /* Share sheet; falls back to copying the text. Returns how it was shared. */
    async compartir({ titulo, texto, url }) {
      if (esNativo && P.Share) { await P.Share.share({ title: titulo, text: texto, url, dialogTitle: titulo }); return 'compartido'; }
      if (navigator.share) { try { await navigator.share({ title: titulo, text: texto, url }); return 'compartido'; } catch (e) { if (e.name === 'AbortError') return 'cancelado'; } }
      try { await navigator.clipboard.writeText([texto, url].filter(Boolean).join(' ')); return 'copiado'; } catch { return 'error'; }
    },

    // Opens a page outside the app (system browser), e.g. for Google sign-in, which
    // doesn't allow logging in from inside an app's web view.
    abrir(url) {
      if (esNativo && P.Browser) { P.Browser.open({ url }); return; }
      window.open(url, '_blank', 'noopener');
    },
    cerrarNavegador() { if (esNativo && P.Browser) P.Browser.close().catch(() => {}); },

    // Called when the app is opened from a link (uy.mbwebstudio.senda://login…).
    alAbrirLink(fn) { if (esNativo && P.App) P.App.addListener('appUrlOpen', (e) => fn(e.url)); },
  };
})();
window.Nativo = Nativo;
