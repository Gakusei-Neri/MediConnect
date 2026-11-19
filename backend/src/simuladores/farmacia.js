// Simulador del Sistema de Farmacia externo (D-08, sección 3.4).
// Inventario en memoria. Operaciones idempotentes por folio. Rechaza campos fuera del contrato (RES-03).
// Puede ejecutarse solo (`npm run farmacia`) o embebido en el servidor principal.
import express from 'express';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const CAMPOS_RESERVA = ['folio', 'items', 'vigenciaHasta'];
const CAMPOS_ITEM = ['codigoMedicamento', 'cantidad'];

export function crearSimuladorFarmacia({
  apiKey = process.env.FARMACIA_API_KEY || 'farmacia-dev-key',
  urlMediConnect = process.env.MEDICONNECT_URL || `http://localhost:${process.env.PORT || 3000}`,
} = {}) {
  const app = express();
  app.use(express.json());

  // Inventario de prueba: MED-010 sin stock para poder probar RF-19
  const stock = new Map([
    ['MED-001', 500], ['MED-002', 300], ['MED-003', 200], ['MED-004', 150], ['MED-005', 100],
    ['MED-006', 80], ['MED-007', 60], ['MED-008', 40], ['MED-009', 20], ['MED-010', 0],
  ]);
  const reservas = new Map(); // folio -> reserva
  const estado = { modo: 'normal', latenciaMs: 0, registro: [] };

  app.use('/api', (req, res, next) => {
    // Sustituto local de la autenticación mutua TLS: llave compartida
    if (req.headers['x-api-key'] !== apiKey) return res.status(401).json({ error: 'Cliente no autenticado' });
    if (estado.modo === 'caida') return res.status(503).json({ error: 'Farmacia no disponible (simulado)' });
    estado.registro.push({ fecha: new Date().toISOString(), metodo: req.method, ruta: req.path, cuerpo: req.body });
    if (estado.registro.length > 200) estado.registro.shift();
    setTimeout(next, estado.latenciaMs);
  });

  app.post('/api/stock', (req, res) => {
    const items = req.body?.items || [];
    res.json({ items: items.map((i) => ({ codigoMedicamento: i.codigoMedicamento, disponible: (stock.get(i.codigoMedicamento) ?? 0) >= i.cantidad })) });
  });

  app.post('/api/reservas', (req, res) => {
    const extras = Object.keys(req.body || {}).filter((k) => !CAMPOS_RESERVA.includes(k));
    const extrasItem = (req.body?.items || []).flatMap((i) => Object.keys(i).filter((k) => !CAMPOS_ITEM.includes(k)));
    if (extras.length || extrasItem.length) return res.status(400).json({ error: `Campos fuera del contrato: ${[...extras, ...extrasItem].join(', ')}` });
    const { folio, items, vigenciaHasta } = req.body;
    if (!folio || !Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Solicitud inválida' });
    const previa = reservas.get(folio);
    if (previa && previa.estado !== 'CANCELADA') return res.json(previa); // idempotente
    const sinStock = items.filter((i) => (stock.get(i.codigoMedicamento) ?? 0) < i.cantidad).map((i) => i.codigoMedicamento);
    const reserva = {
      reservaId: `RES-${crypto.randomUUID().slice(0, 8)}`,
      folio, items, vigenciaHasta,
      estado: sinStock.length ? 'SIN_STOCK' : 'CONFIRMADA',
      sinStock,
    };
    if (!sinStock.length) for (const i of items) stock.set(i.codigoMedicamento, stock.get(i.codigoMedicamento) - i.cantidad);
    reservas.set(folio, reserva);
    res.status(201).json(reserva);
  });

  app.delete('/api/reservas/:id', (req, res) => {
    const r = [...reservas.values()].find((x) => x.reservaId === req.params.id);
    if (!r) return res.status(404).json({ error: 'Reserva inexistente' });
    if (r.estado === 'CONFIRMADA') for (const i of r.items) stock.set(i.codigoMedicamento, stock.get(i.codigoMedicamento) + i.cantidad);
    r.estado = 'CANCELADA';
    res.json({ ok: true });
  });

  // ---- Controles del simulador (no forman parte del contrato) ----
  app.get('/sim/estado', (_req, res) => res.json({ modo: estado.modo, latenciaMs: estado.latenciaMs, stock: Object.fromEntries(stock), reservas: [...reservas.values()], ultimasLlamadas: estado.registro.slice(-20) }));
  app.post('/sim/modo', (req, res) => {
    if (req.body?.modo) estado.modo = req.body.modo === 'caida' ? 'caida' : 'normal';
    if (req.body?.latenciaMs !== undefined) estado.latenciaMs = Number(req.body.latenciaMs) || 0;
    res.json({ modo: estado.modo, latenciaMs: estado.latenciaMs });
  });
  app.post('/sim/stock', (req, res) => {
    for (const [codigo, cantidad] of Object.entries(req.body || {})) stock.set(codigo, Number(cantidad));
    res.json(Object.fromEntries(stock));
  });
  // Notificar surtido: Farmacia → MediConnect
  app.post('/sim/surtir/:folio', async (req, res) => {
    const r = reservas.get(req.params.folio);
    if (!r || r.estado !== 'CONFIRMADA') return res.status(409).json({ error: 'No hay reserva confirmada para ese folio' });
    try {
      const resp = await fetch(`${urlMediConnect}/api/farmacia/surtido`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ folio: r.folio, fechaSurtido: new Date().toISOString() }),
      });
      const datos = await resp.json();
      if (resp.ok) r.estado = 'SURTIDA';
      res.status(resp.status).json(datos);
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  return app;
}

// Ejecución independiente
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const puerto = Number(process.env.FARMACIA_PORT || 4100);
  crearSimuladorFarmacia().listen(puerto, () => console.log(`Simulador de Farmacia en http://localhost:${puerto}`));
}
