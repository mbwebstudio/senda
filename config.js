/* Senda — configuración. Completar cuando estén creadas las cuentas (ver LEEME.md).
   Con los campos vacíos la app funciona igual, pero los avisos, cuentas, fotos y el
   seguimiento en vivo quedan solo en este dispositivo. */
window.SENDA_CONFIG = {
  version: '0.2.0',

  // Supabase (Project Settings → API). La "anon key" es pública por diseño: la seguridad
  // la dan las reglas (RLS) de supabase/schema.sql.
  supabaseUrl: 'https://djiuijkqeovtqjyddfjr.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqaXVpamtxZW92dHFqeWRkZmpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1Mjc2OTksImV4cCI6MjEwODEwMzY5OX0.qiRuRmwimJi2zCzj_rnnwQgbb76lxZn5OLvRpLnVD80',

  // MapTiler (cloud.maptiler.com → Account → Keys). Con clave, los mapas se pueden
  // descargar para usar sin señal. Sin clave se usan los servidores gratuitos de
  // OpenStreetMap, que no permiten descargas masivas.
  maptilerKey: '',

  // Dirección pública donde queda publicada la carpeta app/ (para el link de
  // "Seguir mi recorrido"). Ej.: https://senda.uy
  appUrl: 'https://mbwebstudio.github.io/senda',

  // Correo de contacto que aparece en términos, privacidad y en las tiendas.
  contacto: 'mbwebstudio.uy@gmail.com',
};
