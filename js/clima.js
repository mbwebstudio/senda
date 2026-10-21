/* Weather for the trailhead (Open-Meteo: free, no key) and sunset time.
   The last forecast is kept so it can still be read without signal. */
'use strict';

const Clima = (() => {
  const VIGENCIA = 3 * 3600000;
  const CODIGOS = [
    [[0], '☀️', 'Despejado'], [[1, 2], '🌤️', 'Algo nublado'], [[3], '☁️', 'Nublado'], [[45, 48], '🌫️', 'Niebla'],
    [[51, 53, 55, 56, 57], '🌦️', 'Llovizna'], [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', 'Lluvia'],
    [[71, 73, 75, 77, 85, 86], '🌨️', 'Nieve'], [[95, 96, 99], '⛈️', 'Tormenta'],
  ];
  const describir = (c) => (CODIGOS.find(([cs]) => cs.includes(c)) || [0, '🌡️', '—']).slice(1);
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

  async function de(r) {
    const clave = 'clima:' + r.id;
    const guardado = await DB.get('kv', clave).catch(() => null);
    if (guardado && Date.now() - guardado.t < VIGENCIA) return guardado;
    if (!navigator.onLine) return guardado || null;
    const [lat, lon] = r.inicio.coord;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_gusts_10m_max,sunrise,sunset'
      + '&timezone=America%2FMontevideo&forecast_days=3';
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      const j = await res.json();
      const d = j.daily;
      const dias = d.time.map((fecha, i) => ({
        fecha, codigo: d.weather_code[i], max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]),
        lluvia: d.precipitation_probability_max[i], rafagas: Math.round(d.wind_gusts_10m_max[i]),
        sale: d.sunrise[i], pone: d.sunset[i],
      }));
      const dato = { t: Date.now(), dias };
      DB.set('kv', clave, dato).catch(() => {});
      return dato;
    } catch {
      return guardado || null;
    }
  }

  // Warnings for walking that day.
  function alertas(dia) {
    const a = [];
    if ([95, 96, 99].includes(dia.codigo)) a.push('Hay pronóstico de tormenta: en los cerros los rayos son un riesgo serio. Mejor dejarlo para otro día.');
    if (dia.rafagas >= 50) a.push(`Ráfagas de hasta ${dia.rafagas} km/h: cuidado en cumbres y zonas expuestas.`);
    if (dia.lluvia >= 60) a.push(`${dia.lluvia}% de probabilidad de lluvia: senderos con barro y arroyos que pueden crecer.`);
    if (dia.max >= 32) a.push(`Hasta ${dia.max} °C: llevá mucha agua y evitá las horas del mediodía.`);
    return a;
  }

  function html(dato) {
    if (!dato) return '<p class="empty">No pudimos cargar el pronóstico. Revisalo antes de salir.</p>';
    const hoy = new Date().toISOString().slice(0, 10);
    const dias = dato.dias.filter((d) => d.fecha >= hoy).slice(0, 3);
    if (!dias.length) return '<p class="empty">El pronóstico guardado es viejo. Conectate para actualizarlo.</p>';
    const al = alertas(dias[0]);
    const viejo = Date.now() - dato.t > VIGENCIA ? `<p class="fine" style="margin-top:6px">Pronóstico guardado ${hace(dato.t)}; conectate para actualizarlo.</p>` : '';
    return `<div class="clima">${dias.map((d, i) => {
      const [em, txt] = describir(d.codigo);
      const nombre = i === 0 && d.fecha === hoy ? 'Hoy' : DIAS[new Date(d.fecha + 'T12:00').getDay()];
      return `<div class="clima-dia"><b>${nombre}</b><span class="clima-em" title="${txt}">${em}</span><span>${d.max}° / ${d.min}°</span><small>💧 ${d.lluvia}% · 💨 ${d.rafagas} km/h</small><small>🌇 ${d.pone.slice(11, 16)}</small></div>`;
    }).join('')}</div>${al.length ? `<div class="aviso-clima">${al.map((x) => `<p>⚠️ ${x}</p>`).join('')}</div>` : ''}${viejo}`;
  }

  // Sunset for a date at a point (NOAA approximation) — used when there is no forecast saved.
  function puestaDeSol(fecha, lat, lon) {
    const rad = Math.PI / 180;
    const inicioAnio = Date.UTC(fecha.getUTCFullYear(), 0, 0);
    const n = Math.floor((fecha - inicioAnio) / 86400000);
    const g = (2 * Math.PI / 365) * (n - 1);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl)) / rad;
    const minutosUTC = 720 - 4 * (lon - ha) - eqt;
    return Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()) + minutosUTC * 60000;
  }

  // Sunset (ms) for today at the trail: forecast if saved, otherwise the calculation.
  async function puestaHoy(r) {
    const dato = await DB.get('kv', 'clima:' + r.id).catch(() => null);
    const hoy = new Date().toISOString().slice(0, 10);
    const d = dato && dato.dias.find((x) => x.fecha === hoy);
    if (d) return Date.parse(d.pone + ':00-03:00');
    return puestaDeSol(new Date(), r.inicio.coord[0], r.inicio.coord[1]);
  }

  /* One-line forecast for a given day at a point, for reminders of outings ("☀️ Despejado,
     12–22 °C, 10% de lluvia"). Open-Meteo forecasts up to 16 days ahead; null beyond that
     or without signal. */
  async function resumenDia([lat, lon], fechaMs) {
    const dia = new Date(fechaMs - 3 * 3600000).toISOString().slice(0, 10); // date in Uruguay
    if (fechaMs - Date.now() > 15 * 86400000 || !navigator.onLine) return null;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
        + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_gusts_10m_max&timezone=America%2FMontevideo&start_date=${dia}&end_date=${dia}`;
      const j = await (await fetch(url)).json();
      const d = j.daily;
      const x = { codigo: d.weather_code[0], max: Math.round(d.temperature_2m_max[0]), min: Math.round(d.temperature_2m_min[0]), lluvia: d.precipitation_probability_max[0], rafagas: Math.round(d.wind_gusts_10m_max[0]) };
      const [em, txt] = describir(x.codigo);
      const al = alertas(x);
      return `${em} ${txt}, ${x.min}–${x.max} °C, ${x.lluvia}% de lluvia${al.length ? '. ⚠️ ' + al[0] : ''}`;
    } catch { return null; }
  }

  return { de, html, alertas, puestaHoy, puestaDeSol, resumenDia };
})();
window.Clima = Clima;
