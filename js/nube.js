/* Server side of Senda (Supabase), the outbox that holds actions made without signal,
   and the shared hazard reports. Without a configured server everything stays on the
   device and the app keeps working (with a few example reports). */
'use strict';

// ─── Report types (Waze-style) ────────────────────────────────────────────────
// `horas`: how long a report stays visible unless someone confirms it again.
// Must match horas_aviso() in supabase/schema.sql.
const TIPOS = [
  { id: 'animal', em: '🐗', label: 'Animal peligroso', horas: 6 },
  { id: 'vibora', em: '🐍', label: 'Víbora', horas: 6 },
  { id: 'perros', em: '🐕', label: 'Perros sueltos', horas: 24 },
  { id: 'ganado', em: '🐂', label: 'Ganado o toro', horas: 12 },
  { id: 'pozo', em: '🕳️', label: 'Pozo o desnivel', horas: 24 * 30 },
  { id: 'bloqueo', em: '🌳', label: 'Camino bloqueado', horas: 24 * 7 },
  { id: 'crecida', em: '🌊', label: 'Arroyo crecido', horas: 24 },
  { id: 'barro', em: '🥾', label: 'Barro o resbaloso', horas: 48 },
  { id: 'niebla', em: '🌫️', label: 'Niebla o tormenta', horas: 6 },
  { id: 'incendio', em: '🔥', label: 'Fuego o humo', horas: 12 },
  { id: 'ayuda', em: '🆘', label: 'Alguien necesita ayuda', horas: 6 },
  { id: 'senal', em: '🪧', label: 'Señal rota o confusa', horas: 24 * 30 },
  { id: 'cerrado', em: '🚧', label: 'Paso cerrado', horas: 24 * 30 },
  { id: 'agua', em: '💧', label: 'Agua para cargar', horas: 24 * 30 },
  { id: 'basura', em: '🗑️', label: 'Basura', horas: 24 * 14 },
];
const TIPO = Object.fromEntries(TIPOS.map((t) => [t.id, t]));

// ─── Supabase connection ──────────────────────────────────────────────────────
const Nube = (() => {
  const cfg = window.SENDA_CONFIG || {};
  const activa = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const sb = activa ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }) : null;
  let pidiendo = null;

  // Every device gets an anonymous session, so reports work without creating an account.
  async function sesion() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    if (data.session) return data.session;
    if (!navigator.onLine) return null;
    if (!pidiendo) pidiendo = sb.auth.signInAnonymously().then((r) => r.data.session).finally(() => (pidiendo = null));
    return pidiendo;
  }
  async function usuario() {
    const s = await sesion();
    return s ? s.user : null;
  }

  // Native app: the sign-in page comes back to uy.mbwebstudio.senda://login with the
  // session in the address (#access_token=… or ?code=…).
  if (sb) {
    Nativo.alAbrirLink(async (url) => {
      if (!url.startsWith('uy.mbwebstudio.senda://login')) return;
      Nativo.cerrarNavegador();
      const u = new URL(url.replace('uy.mbwebstudio.senda://', 'https://x/'));
      const frag = new URLSearchParams(u.hash.slice(1));
      const r = u.searchParams.get('code')
        ? await sb.auth.exchangeCodeForSession(u.searchParams.get('code'))
        : frag.get('access_token') ? await sb.auth.setSession({ access_token: frag.get('access_token'), refresh_token: frag.get('refresh_token') }) : null;
      if (r && !r.error && window.toast) toast('¡Listo! Ya tenés tu cuenta en Senda');
    });
  }

  // Sign in with Google/Apple keeping the same user (points earned anonymously are kept).
  async function vincular(provider) {
    const redirectTo = Nativo.esNativo ? 'uy.mbwebstudio.senda://login' : location.href.split('#')[0];
    const { data, error } = await sb.auth.linkIdentity({ provider, options: { redirectTo, skipBrowserRedirect: Nativo.esNativo } });
    if (error) throw error;
    if (Nativo.esNativo && data && data.url) Nativo.abrir(data.url);
  }
  return { activa, sb, sesion, usuario, vincular };
})();

// ─── Outbox: actions made without signal, sent when it comes back ─────────────
const Bandeja = (() => {
  const handlers = {};
  let ocupada = false;
  const oyentes = [];
  const avisar = async () => { const n = await DB.count('outbox'); oyentes.forEach((f) => f(n)); };

  // Errors that will never succeed (bad data, rule violations): drop the item.
  const permanente = (e) => e && (e.code === '23505' || e.code === '42501' || e.code === 'P0001' || e.code === '23514' || /Ya votaste/.test(e.message || ''));

  async function vaciar() {
    if (!Nube.activa || !navigator.onLine || ocupada) return;
    ocupada = true;
    try {
      if (!(await Nube.sesion())) return;
      const items = (await DB.all('outbox')).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      for (const [k, it] of items) {
        try {
          await handlers[it.op](it.datos);
          await DB.del('outbox', k);
        } catch (e) {
          if (permanente(e) || !handlers[it.op]) await DB.del('outbox', k);
          else { console.warn('Bandeja: queda para después', it.op, e); break; }
        }
      }
    } finally {
      ocupada = false;
      avisar();
    }
  }

  window.addEventListener('online', vaciar);
  setInterval(vaciar, 60000);
  return {
    registrar(op, fn) { handlers[op] = fn; },
    async agregar(op, datos) {
      await DB.set('outbox', Date.now().toString(36).padStart(10, '0') + Math.random().toString(36).slice(2, 6), { op, datos });
      avisar();
      vaciar();
    },
    vaciar,
    alCambiar(fn) { oyentes.push(fn); avisar(); },
  };
})();

// ─── Shared hazard reports ────────────────────────────────────────────────────
const Reportes = (() => {
  let lista = [];
  const oyentes = [];
  let votados = new Set();
  const emitir = () => oyentes.forEach((f) => f());
  const guardar = () => DB.set('kv', 'reportes', lista).catch(() => {});
  const desdeFila = (f) => ({ id: f.id, tipo: f.tipo, coord: [f.lat, f.lon], comentario: f.comentario || '', foto: f.foto_url, creado: Date.parse(f.creado), vence: Date.parse(f.vence), si: f.si, no: f.no });

  async function refrescar() {
    if (!Nube.activa || !navigator.onLine || !(await Nube.sesion())) return;
    const { data, error } = await Nube.sb.from('reportes')
      .select('id,tipo,lat,lon,comentario,foto_url,creado,vence,si,no')
      .gt('vence', new Date().toISOString()).limit(2000);
    if (error) { console.warn(error); return; }
    lista = data.map(desdeFila).concat(lista.filter((r) => r.pendiente));
    guardar();
    emitir();
  }

  Bandeja.registrar('reporte', async (d) => {
    const { error } = await Nube.sb.from('reportes').insert({ tipo: d.tipo, lat: d.coord[0], lon: d.coord[1], comentario: d.comentario || null, vence: new Date().toISOString() });
    if (error) throw error;
    lista = lista.filter((r) => r.id !== d.idLocal);
    await refrescar();
  });
  Bandeja.registrar('voto', async (d) => {
    const { error } = await Nube.sb.rpc('votar_reporte', { reporte_id: d.id, sigue: d.sigue });
    if (error) throw error;
  });

  return {
    async iniciar(ejemplos) {
      lista = (await DB.get('kv', 'reportes')) || null;
      votados = new Set((await DB.get('kv', 'votados')) || []);
      if (!lista) { lista = Nube.activa ? [] : ejemplos(); guardar(); }
      if (Nube.activa) lista = lista.filter((r) => !r.demo);
      emitir();
      if (Nube.activa) {
        refrescar();
        Nube.sesion().then((s) => {
          if (!s) return;
          Nube.sb.channel('reportes').on('postgres_changes', { event: '*', schema: 'public', table: 'reportes' }, () => refrescar()).subscribe();
        });
        window.addEventListener('online', refrescar);
      }
    },
    alCambiar(fn) { oyentes.push(fn); },
    vigentes() {
      const ahora = Date.now();
      const vivos = lista.filter((r) => r.vence > ahora && r.no < 2);
      if (vivos.length !== lista.length) { lista = vivos; guardar(); }
      return vivos;
    },
    yaVote: (id) => votados.has(id),
    crear(tipo, coord, comentario) {
      const ahora = Date.now();
      const r = { id: 'local-' + ahora.toString(36), tipo, coord, comentario, creado: ahora, vence: ahora + TIPO[tipo].horas * 3600000, si: 0, no: 0, mio: true, pendiente: Nube.activa };
      lista.push(r);
      guardar();
      emitir();
      if (Nube.activa) Bandeja.agregar('reporte', { tipo, coord, comentario, idLocal: r.id });
      return r;
    },
    votar(id, sigue) {
      const r = lista.find((x) => x.id === id);
      if (!r || votados.has(id)) return null;
      votados.add(id);
      DB.set('kv', 'votados', [...votados]).catch(() => {});
      if (sigue) { r.si++; r.vence = Date.now() + TIPO[r.tipo].horas * 3600000; } else r.no++;
      guardar();
      emitir();
      if (Nube.activa && !r.demo && !r.pendiente) Bandeja.agregar('voto', { id, sigue });
      return r;
    },
    refrescar,
  };
})();

window.TIPOS = TIPOS; window.TIPO = TIPO; window.Nube = Nube; window.Bandeja = Bandeja; window.Reportes = Reportes;
