// RNF-08 (OWASP): limitación de tasa simple en memoria para endpoints sensibles.
const ventanas = new Map();

export function limitarIntentos(maxPorMinuto = 30) {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    const clave = `${req.ip}:${req.baseUrl}${req.path}`;
    const ahora = Date.now();
    const v = ventanas.get(clave) || { inicio: ahora, n: 0 };
    if (ahora - v.inicio > 60_000) { v.inicio = ahora; v.n = 0; }
    v.n++;
    ventanas.set(clave, v);
    if (v.n > maxPorMinuto) return res.status(429).json({ error: 'Demasiadas solicitudes; intente en un minuto' });
    next();
  };
}

setInterval(() => {
  const limite = Date.now() - 120_000;
  for (const [k, v] of ventanas) if (v.inicio < limite) ventanas.delete(k);
}, 60_000).unref();
