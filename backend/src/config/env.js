import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, '../..');

// Carga simple de backend/.env (sin dependencias)
const archivoEnv = path.join(raiz, '.env');
if (fs.existsSync(archivoEnv)) {
  for (const linea of fs.readFileSync(archivoEnv, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const esProduccion = process.env.NODE_ENV === 'production';

function secreto(nombre, bytes) {
  const v = process.env[nombre];
  if (v) return v;
  if (esProduccion) throw new Error(`Falta la variable de entorno ${nombre} (RNF-01: 0 llaves en el código)`);
  // En desarrollo se genera una llave por proceso; los datos cifrados no sobreviven reinicios
  // salvo que se defina en .env (el script de seed escribe una en .env automáticamente).
  return crypto.randomBytes(bytes).toString('hex');
}

export const env = {
  esProduccion,
  esPrueba: process.env.NODE_ENV === 'test',
  raiz,
  puerto: Number(process.env.PORT || 3000),
  dbFile: process.env.DB_FILE || path.join(raiz, 'data', 'mediconnect.db'),
  jwtSecret: secreto('JWT_SECRET', 32),
  // RNF-01: llave AES-256 (32 bytes en hex). En producción provendría del gestor de llaves (KMS).
  dataKey: secreto('DATA_KEY', 32),
  tlsCert: process.env.TLS_CERT,
  tlsKey: process.env.TLS_KEY,
  tlsCa: process.env.TLS_CA,
  corsOrigen: process.env.CORS_ORIGIN || 'http://localhost:4200',
  urlPortal: process.env.PORTAL_URL || 'http://localhost:4200',
  farmaciaUrl: process.env.FARMACIA_URL || 'http://localhost:4100',
  farmaciaApiKey: process.env.FARMACIA_API_KEY || 'farmacia-dev-key',
  farmaciaEmbebida: (process.env.FARMACIA_SIMULADA ?? 'true') === 'true',
  planificadorSeg: Number(process.env.PLANIFICADOR_SEG || 30),
  // Probabilidad (0-1) de que falle el canal principal en el simulador de notificaciones
  simFallaCanal: Number(process.env.SIM_FALLA_CANAL || 0),
  colaAuditoriaFile: process.env.COLA_AUDITORIA_FILE || path.join(raiz, 'data', 'cola-auditoria.jsonl'),
};
