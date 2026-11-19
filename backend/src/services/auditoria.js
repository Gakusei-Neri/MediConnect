// RN-02 / D-03: auditoría de solo inserción, escritura síncrona y hashes encadenados.
// Si la auditoría no se puede escribir, la operación clínica se niega (salvo emergencia RF-23,
// que se guarda en una cola local y se escribe después).
import fs from 'node:fs';
import path from 'node:path';
import { q, getDb } from '../db/database.js';
import { sha256 } from '../utils/cifrado.js';
import { ahoraIso } from '../utils/tiempo.js';
import { env } from '../config/env.js';
import { noDisponible } from '../utils/errores.js';

const GENESIS = '0'.repeat(64);
let simularCaida = false;

export const auditoriaDisponible = () => !simularCaida;
export function simularCaidaAuditoria(valor) {
  simularCaida = Boolean(valor);
}

function hashDe(e) {
  return sha256(
    [e.hash_anterior, e.fecha_utc, e.usuario_id ?? '', e.rol ?? '', e.accion, e.recurso ?? '', e.id_registro ?? '',
      e.paciente_id ?? '', e.resultado, e.es_emergencia, e.detalle ?? '', e.ip ?? ''].join('|'),
  );
}

function insertar(entrada) {
  const ultimo = q.get('SELECT hash FROM auditoria ORDER BY id DESC LIMIT 1');
  const e = {
    fecha_utc: entrada.fecha_utc ?? ahoraIso(),
    usuario_id: entrada.usuarioId ?? null,
    rol: entrada.rol ?? null,
    accion: entrada.accion,
    recurso: entrada.recurso ?? null,
    id_registro: entrada.idRegistro != null ? String(entrada.idRegistro) : null,
    paciente_id: entrada.pacienteId ?? null,
    resultado: entrada.resultado ?? 'EXITO',
    es_emergencia: entrada.esEmergencia ? 1 : 0,
    detalle: entrada.detalle ? (typeof entrada.detalle === 'string' ? entrada.detalle : JSON.stringify(entrada.detalle)) : null,
    ip: entrada.ip ?? null,
    hash_anterior: ultimo?.hash ?? GENESIS,
  };
  e.hash = hashDe(e);
  q.run(
    `INSERT INTO auditoria (fecha_utc, usuario_id, rol, accion, recurso, id_registro, paciente_id, resultado, es_emergencia, detalle, ip, hash_anterior, hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    e.fecha_utc, e.usuario_id, e.rol, e.accion, e.recurso, e.id_registro, e.paciente_id, e.resultado, e.es_emergencia, e.detalle, e.ip, e.hash_anterior, e.hash,
  );
  return e;
}

/**
 * Registra un evento. Lanza 503 si la auditoría no está disponible (la operación debe negarse).
 * Con { emergencia: true } y la auditoría caída, encola el evento en disco y no falla.
 */
export function registrar(entrada, { emergencia = false } = {}) {
  if (simularCaida) {
    if (emergencia) {
      encolar({ ...entrada, esEmergencia: true, fecha_utc: ahoraIso() });
      return { encolado: true };
    }
    throw noDisponible('Auditoría no disponible: operación denegada (RN-02)');
  }
  return insertar(entrada);
}

/** Registro "best effort" para eventos no clínicos (intentos denegados, etc.). */
export function registrarSiPuede(entrada) {
  try {
    return registrar(entrada);
  } catch {
    encolar({ ...entrada, fecha_utc: ahoraIso() });
    return { encolado: true };
  }
}

/** Helper desde una petición Express. */
export function desdeReq(req, entrada, opciones) {
  return registrar({ usuarioId: req.usuario?.id, rol: req.usuario?.rol, ip: req.ip, ...entrada }, opciones);
}

export function desdeReqSiPuede(req, entrada) {
  return registrarSiPuede({ usuarioId: req.usuario?.id, rol: req.usuario?.rol, ip: req.ip, ...entrada });
}

function encolar(entrada) {
  fs.mkdirSync(path.dirname(env.colaAuditoriaFile), { recursive: true });
  fs.appendFileSync(env.colaAuditoriaFile, JSON.stringify(entrada) + '\n');
}

/** El planificador vacía la cola local cuando la auditoría vuelve a estar disponible. */
export function vaciarCola() {
  if (simularCaida || !fs.existsSync(env.colaAuditoriaFile)) return 0;
  const lineas = fs.readFileSync(env.colaAuditoriaFile, 'utf8').split('\n').filter(Boolean);
  if (!lineas.length) return 0;
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try {
    for (const l of lineas) insertar({ ...JSON.parse(l), detalle: { ...(safeJson(JSON.parse(l).detalle)), diferido: true } });
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  fs.writeFileSync(env.colaAuditoriaFile, '');
  return lineas.length;
}

function safeJson(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return { texto: v }; }
}

/** Verifica la integridad de la cadena de hashes. Devuelve el primer registro alterado, si lo hay. */
export function verificarCadena() {
  let anterior = GENESIS;
  let total = 0;
  for (const e of getDb().prepare('SELECT * FROM auditoria ORDER BY id').iterate()) {
    total++;
    if (e.hash_anterior !== anterior || hashDe(e) !== e.hash) {
      return { integra: false, total, registroAlterado: e.id };
    }
    anterior = e.hash;
  }
  return { integra: true, total };
}
