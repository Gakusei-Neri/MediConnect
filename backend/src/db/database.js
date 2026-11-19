import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db = null;

export function abrir(archivo = env.dbFile) {
  if (db) return db;
  if (archivo !== ':memory:') fs.mkdirSync(path.dirname(archivo), { recursive: true });
  db = new DatabaseSync(archivo);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  return db;
}

export function getDb() {
  return db ?? abrir();
}

export function cerrar() {
  if (db) db.close();
  db = null;
}

// Helpers cortos
export const q = {
  get: (sql, ...params) => getDb().prepare(sql).get(...params),
  all: (sql, ...params) => getDb().prepare(sql).all(...params),
  run: (sql, ...params) => getDb().prepare(sql).run(...params),
};

/**
 * Ejecuta fn dentro de una transacción (BEGIN IMMEDIATE para serializar escrituras
 * concurrentes: RF-05 / RN-04 "dos solicitudes simultáneas producen una sola cita").
 * Soporta anidamiento con SAVEPOINT.
 */
let profundidad = 0;
export function transaccion(fn) {
  const d = getDb();
  if (profundidad > 0) {
    const sp = `sp_${profundidad}`;
    d.exec(`SAVEPOINT ${sp}`);
    profundidad++;
    try {
      const r = fn();
      d.exec(`RELEASE ${sp}`);
      return r;
    } catch (e) {
      d.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw e;
    } finally {
      profundidad--;
    }
  }
  d.exec('BEGIN IMMEDIATE');
  profundidad++;
  try {
    const r = fn();
    d.exec('COMMIT');
    return r;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  } finally {
    profundidad--;
  }
}
