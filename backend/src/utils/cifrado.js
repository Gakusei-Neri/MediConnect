// RNF-01: cifrado en reposo de datos clínicos e identidad con AES-256-GCM.
// La llave proviene de configuración (DATA_KEY); en producción, del gestor de llaves.
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const llave = () => Buffer.from(env.dataKey, 'hex');

export function cifrar(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', llave(), iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), datos.toString('base64')].join(':');
}

export function descifrar(enc) {
  if (!enc) return null;
  const [v, iv, tag, datos] = enc.split(':');
  if (v !== 'v1') throw new Error('Formato de cifrado desconocido');
  const d = crypto.createDecipheriv('aes-256-gcm', llave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(datos, 'base64')), d.final()]).toString('utf8');
}

export function descifrarJson(enc) {
  const t = descifrar(enc);
  return t ? JSON.parse(t) : null;
}

export const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
export const tokenAleatorio = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
