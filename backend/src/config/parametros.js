// RNF-09: todos los parámetros P-xx se leen de configuración y pueden cambiarse sin recompilar
// ni redesplegar. El archivo se relee cuando cambia su fecha de modificación.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVO = process.env.PARAMETROS_FILE || path.join(__dirname, 'parametros.json');

let cache = null;
let mtime = 0;

function cargar() {
  const stat = fs.statSync(ARCHIVO);
  if (!cache || stat.mtimeMs !== mtime) {
    cache = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
    mtime = stat.mtimeMs;
  }
  return cache;
}

export function todos() {
  return structuredClone(cargar());
}

export function p(id) {
  const params = cargar();
  if (!(id in params)) throw new Error(`Parámetro desconocido: ${id}`);
  return params[id].valor;
}

export function actualizar(id, valor) {
  const params = cargar();
  if (!(id in params)) throw new Error(`Parámetro desconocido: ${id}`);
  const actual = params[id].valor;
  if (typeof actual !== typeof valor) throw new Error(`Tipo inválido para ${id}`);
  if (typeof actual === 'object') {
    for (const k of Object.keys(actual)) {
      if (typeof valor[k] !== 'number' || valor[k] < 0) throw new Error(`Valor inválido para ${id}.${k}`);
    }
  } else if (typeof valor !== 'number' || valor < 0) {
    throw new Error(`Valor inválido para ${id}`);
  }
  params[id].valor = valor;
  fs.writeFileSync(ARCHIVO, JSON.stringify(params, null, 2) + '\n');
  cache = null;
  return params[id];
}

// Atajos expresados en milisegundos
export const MIN = 60_000;
export const HORA = 60 * MIN;
export const DIA = 24 * HORA;
