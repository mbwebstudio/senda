/* Lugares destacados (comercios aliados que pagan por aparecer cerca de los recorridos).
   Cuando el servidor esté configurado se cargan desde la tabla "destacados" de Supabase;
   esta lista sirve para cargarlos a mano mientras tanto. Formato:
   { nombre, categoria: 'reserva'|'camping'|'alojamiento'|'comida'|'guia'|'otro',
     descripcion, coord: [lat, lon], telefono, web } */
window.DESTACADOS = [];
