// D-07: fechas en UTC en la BD y hora local de la sede en la interfaz.
// Reloj sustituible para pruebas.
let desfaseMs = 0;

export const ahora = () => new Date(Date.now() + desfaseMs);
export const ahoraIso = () => ahora().toISOString();
export const iso = (d) => new Date(d).toISOString();
export const sumar = (fecha, ms) => new Date(new Date(fecha).getTime() + ms);
export const sumarIso = (fecha, ms) => sumar(fecha, ms).toISOString();
export const msHasta = (fecha) => new Date(fecha).getTime() - ahora().getTime();

/** Solo para pruebas automatizadas. */
export function _fijarDesfase(ms) {
  desfaseMs = ms;
}

/**
 * Convierte una fecha local (YYYY-MM-DD) + hora (HH:MM) en una zona IANA a Date UTC.
 * Usa Intl para calcular el desfase de la zona en ese instante.
 */
export function localAUtc(fecha, hora, zona) {
  const [y, m, d] = fecha.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  const supuesto = Date.UTC(y, m - 1, d, hh, mm);
  const desfase = desfaseZona(new Date(supuesto), zona);
  let utc = supuesto - desfase;
  // Ajuste por si el desfase cambia en la frontera (horario de verano)
  const desfase2 = desfaseZona(new Date(utc), zona);
  if (desfase2 !== desfase) utc = supuesto - desfase2;
  return new Date(utc);
}

export function desfaseZona(fecha, zona) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(fecha).reduce((a, p) => ((a[p.type] = p.value), a), {});
  const comoUtc = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute, +partes.second);
  return comoUtc - Math.floor(fecha.getTime() / 1000) * 1000;
}

/** Fecha local (YYYY-MM-DD) y día de la semana de un instante en una zona. */
export function fechaLocal(fecha, zona) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha);
  const dia = new Date(`${f}T12:00:00Z`).getUTCDay();
  return { fecha: f, diaSemana: dia };
}

export function formatoLocal(fecha, zona = 'America/Mexico_City') {
  return new Intl.DateTimeFormat('es-MX', { timeZone: zona, dateStyle: 'full', timeStyle: 'short' }).format(new Date(fecha));
}

export function edadEnAnios(fechaNacimiento) {
  const n = new Date(fechaNacimiento);
  const h = ahora();
  let e = h.getUTCFullYear() - n.getUTCFullYear();
  if (h.getUTCMonth() < n.getUTCMonth() || (h.getUTCMonth() === n.getUTCMonth() && h.getUTCDate() < n.getUTCDate())) e--;
  return e;
}
