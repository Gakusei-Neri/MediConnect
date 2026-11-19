import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { env } from './config/env.js';
import { abrir } from './db/database.js';
import { crearApp } from './app.js';
import { adjuntarSenalizacion } from './ws/senalizacion.js';
import { iniciar as iniciarPlanificador } from './services/planificador.js';
import { crearSimuladorFarmacia } from './simuladores/farmacia.js';

abrir();
const app = crearApp();

let servidor;
if (env.tlsCert && env.tlsKey) {
  // RNF-01: exclusivamente TLS 1.3. Con TLS_CA se solicita certificado de cliente (TLS mutuo, RES-03).
  servidor = https.createServer({
    cert: fs.readFileSync(env.tlsCert),
    key: fs.readFileSync(env.tlsKey),
    ...(env.tlsCa ? { ca: fs.readFileSync(env.tlsCa), requestCert: true, rejectUnauthorized: false } : {}),
    minVersion: 'TLSv1.3',
    maxVersion: 'TLSv1.3',
  }, app);
} else {
  if (env.esProduccion) throw new Error('En producción se requieren TLS_CERT y TLS_KEY (RNF-01)');
  servidor = http.createServer(app);
  console.warn('⚠  Modo desarrollo: HTTP sin TLS. En producción defina TLS_CERT y TLS_KEY (TLS 1.3).');
}

adjuntarSenalizacion(servidor);

servidor.listen(env.puerto, () => {
  console.log(`MediConnect Plus API en ${env.tlsCert ? 'https' : 'http'}://localhost:${env.puerto}  (docs: /api/docs)`);
  iniciarPlanificador();
});

if (env.farmaciaEmbebida && !env.esProduccion) {
  const puerto = Number(new URL(env.farmaciaUrl).port || 4100);
  crearSimuladorFarmacia({ urlMediConnect: `http://localhost:${env.puerto}` })
    .listen(puerto, () => console.log(`Simulador de Farmacia en ${env.farmaciaUrl}  (estado: /sim/estado)`));
}
