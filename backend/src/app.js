import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { HttpError } from './utils/errores.js';
import { openapi } from './openapi.js';
import authRoutes from './routes/auth.js';
import catalogosRoutes from './routes/catalogos.js';
import citasRoutes from './routes/citas.js';
import agendaRoutes from './routes/agenda.js';
import clinicoRoutes from './routes/clinico.js';
import telemedicinaRoutes from './routes/telemedicina.js';
import portalRoutes from './routes/portal.js';
import auditoriaRoutes from './routes/auditoria.js';
import adminRoutes from './routes/admin.js';
import farmaciaRoutes from './routes/farmacia.js';

export function crearApp() {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');

  // RNF-08: cabeceras de seguridad (OWASP)
  app.use(helmet({
    contentSecurityPolicy: false, // la API no sirve HTML salvo Swagger
    strictTransportSecurity: env.tlsCert ? { maxAge: 31536000, includeSubDomains: true } : false,
  }));
  app.use(cors({ origin: env.corsOrigen.split(','), credentials: false }));
  app.use(express.json({ limit: '200kb' }));
  // Sin caché para datos clínicos
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  app.get('/api/salud', (_req, res) => res.json({ estado: 'ok', fecha: new Date().toISOString() }));
  app.get('/api/openapi.json', (_req, res) => res.json(openapi));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'MediConnect Plus API' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/catalogos', catalogosRoutes);
  app.use('/api/agenda', agendaRoutes);
  app.use('/api/clinico', clinicoRoutes);
  app.use('/api/telemedicina', telemedicinaRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/farmacia', farmaciaRoutes);
  app.use('/api', auditoriaRoutes);
  app.use('/api', portalRoutes);
  app.use('/api', citasRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta inexistente' }));

  // Manejo de errores: nunca se filtra la pila ni datos internos (RNF-08)
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    if (String(err?.message).match(/^(RN-|WORM)/)) return res.status(409).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  });

  return app;
}
