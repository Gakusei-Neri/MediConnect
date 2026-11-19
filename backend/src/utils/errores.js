export class HttpError extends Error {
  constructor(status, mensaje, extra = {}) {
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}

export const malaSolicitud = (m, extra) => new HttpError(400, m, extra);
export const noAutenticado = (m = 'No autenticado', extra) => new HttpError(401, m, extra);
export const prohibido = (m = 'Prohibido', extra) => new HttpError(403, m, extra);
export const noEncontrado = (m = 'No encontrado') => new HttpError(404, m);
export const conflicto = (m, extra) => new HttpError(409, m, extra);
export const noDisponible = (m, extra) => new HttpError(503, m, extra);

/** Envuelve handlers (Express 5 ya propaga promesas, pero se deja explícito). */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Validación mínima de campos obligatorios. */
export function requerir(obj, campos) {
  const faltan = campos.filter((c) => obj?.[c] === undefined || obj[c] === null || obj[c] === '');
  if (faltan.length) throw malaSolicitud(`Campos obligatorios: ${faltan.join(', ')}`, { campos: faltan });
}

export function entero(v, nombre) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw malaSolicitud(`${nombre} inválido`);
  return n;
}
