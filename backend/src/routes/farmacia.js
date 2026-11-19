// Entrada desde el Sistema de Farmacia: notificar surtido (sección 3.4). Autenticación del cliente
// por llave compartida (sustituto local de TLS mutuo; en producción se exige certificado de cliente).
import { Router } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { registrarSurtido } from '../services/recetas.js';
import { registrarSiPuede } from '../services/auditoria.js';
import { noAutenticado, requerir } from '../utils/errores.js';

const r = Router();

r.use((req, _res, next) => {
  const llave = String(req.headers['x-api-key'] || '');
  const esperado = env.farmaciaApiKey;
  const ok = llave.length === esperado.length && crypto.timingSafeEqual(Buffer.from(llave), Buffer.from(esperado));
  const certOk = !env.tlsCa || req.socket.authorized === true; // con TLS_CA se exige certificado de cliente válido
  if (!ok || !certOk) {
    registrarSiPuede({ accion: 'FARMACIA_NO_AUTENTICADA', recurso: 'farmacia', resultado: 'RECHAZADO', ip: req.ip });
    return next(noAutenticado('Cliente de farmacia no autenticado'));
  }
  next();
});

r.post('/surtido', (req, res) => {
  requerir(req.body, ['folio']);
  res.json(registrarSurtido({ folio: String(req.body.folio), fechaSurtido: req.body.fechaSurtido }));
});

export default r;
