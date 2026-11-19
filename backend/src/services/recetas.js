// Recetas: RF-17 (emisión con folio y QR), RF-18 (validación de alergias), RF-19 (reserva),
// RN-06 (anulación motivada), RN-09 (vigencias y surtido único).
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { q, transaccion } from '../db/database.js';
import { p, DIA } from '../config/parametros.js';
import { ahora, ahoraIso, sumarIso } from '../utils/tiempo.js';
import { cifrar } from '../utils/cifrado.js';
import { base32Encode } from '../utils/totp.js';
import { HttpError, conflicto, malaSolicitud, noEncontrado, prohibido } from '../utils/errores.js';
import { registrar, registrarSiPuede } from './auditoria.js';
import { exigirRelacion, alergiasActivas, detallesReceta } from './clinico.js';
import { verificarSegundoFactor } from './autenticacion.js';
import { intentarReserva, cancelarReserva } from './farmacia.js';
import { notificarPaciente } from './notificaciones.js';

/** Folio único: RX-AAAAMMDD-XXXXXXXXXX (50 bits aleatorios + verificación de unicidad en BD). */
export function generarFolio() {
  const fecha = ahoraIso().slice(0, 10).replace(/-/g, '');
  for (let i = 0; i < 5; i++) {
    const folio = `RX-${fecha}-${base32Encode(crypto.randomBytes(7)).slice(0, 10)}`;
    if (!q.get('SELECT id FROM recetas WHERE folio = ?', folio)) return folio;
  }
  throw new Error('No se pudo generar un folio único');
}

/**
 * RF-18: compara los componentes activos de los medicamentos con las alergias del expediente.
 * Devuelve { severas: [], advertencias: [] }.
 */
export function compararAlergias(pacienteId, medicamentoIds) {
  const exp = q.get('SELECT * FROM expedientes WHERE paciente_id = ?', pacienteId);
  const alergias = alergiasActivas(exp.id);
  const porComponente = new Map(alergias.map((a) => [a.componente_id, a]));
  const severas = [];
  const advertencias = [];
  for (const id of medicamentoIds) {
    const m = q.get('SELECT m.id, m.nombre, m.componente_id, c.nombre AS componente FROM medicamentos m JOIN componentes_activos c ON c.id = m.componente_id WHERE m.id = ?', id);
    if (!m) throw malaSolicitud(`Medicamento ${id} inexistente en el catálogo`);
    const a = porComponente.get(m.componente_id);
    if (!a) continue;
    const hallazgo = { medicamento: m.nombre, componente: m.componente, severidad: a.severidad };
    (a.severidad === 'SEVERA' ? severas : advertencias).push(hallazgo);
  }
  return {
    alergiasRegistradas: Boolean(exp.sin_alergias_conocidas) || alergias.length > 0,
    sinAlergiasConocidas: Boolean(exp.sin_alergias_conocidas),
    severas,
    advertencias,
  };
}

function validarItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw malaSolicitud('La receta debe tener al menos un medicamento');
  for (const [i, it] of items.entries()) {
    if (!it.medicamentoId || !it.dosis?.trim() || !it.frecuencia?.trim() || !it.duracion?.trim()) {
      throw malaSolicitud(`Medicamento ${i + 1}: dosis, frecuencia y duración son obligatorias`);
    }
    if (!Number.isInteger(Number(it.cantidad)) || Number(it.cantidad) <= 0) throw malaSolicitud(`Medicamento ${i + 1}: cantidad inválida`);
  }
}

function consultaParaReceta(usuario, consultaId) {
  if (usuario.rol !== 'MEDICO') throw prohibido('Solo el médico emite recetas');
  const c = q.get('SELECT co.*, ci.paciente_id, ci.estado AS cita_estado, ci.medico_id AS cita_medico FROM consultas co JOIN citas ci ON ci.id = co.cita_id WHERE co.id = ?', consultaId);
  if (!c) throw noEncontrado('Consulta inexistente');
  exigirRelacion(usuario, c.paciente_id, 'receta');
  return c;
}

export function validarAlergiasReceta(usuario, consultaId, items) {
  const c = consultaParaReceta(usuario, consultaId);
  return compararAlergias(c.paciente_id, (items || []).map((i) => Number(i.medicamentoId)));
}

export async function emitirReceta(usuario, consultaId, { items, codigo2fa, justificacionAlergia }) {
  const c = consultaParaReceta(usuario, consultaId);
  if (c.cita_estado !== 'EN_CONSULTA' || c.firmada) throw conflicto('La receta se emite durante la consulta (cita En consulta y nota sin firmar)');
  if (q.get('SELECT id FROM recetas WHERE consulta_id = ? AND anulada = 0', consultaId)) throw conflicto('La consulta ya tiene una receta vigente; anúlela para emitir otra');
  validarItems(items);

  // RF-15: no se emite sin alergias registradas o marca "sin alergias conocidas"
  const comparacion = compararAlergias(c.paciente_id, items.map((i) => Number(i.medicamentoId)));
  if (!comparacion.alergiasRegistradas) {
    throw new HttpError(422, 'Registre las alergias del paciente o marque "sin alergias conocidas" antes de recetar (RF-15)', { codigo: 'ALERGIAS_SIN_REGISTRAR' });
  }

  // RN-01: verificación adicional 2FA
  verificarSegundoFactor(usuario, codigo2fa, 'EMITIR_RECETA');

  // RF-18: alergia severa bloquea; leve/moderada exige justificación
  if (comparacion.severas.length) {
    registrar({
      usuarioId: usuario.id, rol: usuario.rol, accion: 'RECETA_BLOQUEADA_ALERGIA', recurso: 'receta', idRegistro: consultaId,
      pacienteId: c.paciente_id, resultado: 'BLOQUEADO', detalle: { severas: comparacion.severas },
    });
    throw new HttpError(422, `Receta bloqueada: alergia severa a ${comparacion.severas.map((s) => s.componente).join(', ')}`, { codigo: 'ALERGIA_SEVERA', ...comparacion });
  }
  if (comparacion.advertencias.length && !justificacionAlergia?.trim()) {
    throw new HttpError(422, 'Alergia leve o moderada: se requiere una justificación escrita del médico', { codigo: 'REQUIERE_JUSTIFICACION', ...comparacion });
  }

  const recetaId = transaccion(() => {
    const folio = generarFolio();
    const t = ahoraIso();
    const r = q.run(
      `INSERT INTO recetas (folio, consulta_id, medico_id, paciente_id, fecha_emision, vigente_hasta, justificacion_alergia_enc)
       VALUES (?,?,?,?,?,?,?)`,
      folio, consultaId, usuario.id, c.paciente_id, t, sumarIso(t, p('P-10') * DIA),
      comparacion.advertencias.length ? cifrar(justificacionAlergia.trim()) : null,
    );
    const id = Number(r.lastInsertRowid);
    for (const it of items) {
      q.run('INSERT INTO receta_detalles (receta_id, medicamento_id, dosis, frecuencia, duracion, cantidad) VALUES (?,?,?,?,?,?)',
        id, Number(it.medicamentoId), it.dosis.trim(), it.frecuencia.trim(), it.duracion.trim(), Number(it.cantidad));
    }
    q.run("INSERT INTO reservas_farmacia (receta_id, estado, actualizada_en) VALUES (?, 'PENDIENTE', ?)", id, t);
    registrar({
      usuarioId: usuario.id, rol: usuario.rol, accion: 'RECETA_EMITIDA', recurso: 'receta', idRegistro: id, pacienteId: c.paciente_id,
      detalle: { folio, advertencias: comparacion.advertencias, justificacion: comparacion.advertencias.length ? justificacionAlergia.trim() : undefined },
    });
    return id;
  });

  notificarPaciente(c.paciente_id, { tipo: 'RECETA', asunto: 'Nueva receta electrónica', contenido: 'Su médico emitió una receta. Consúltela con su código QR en el portal.' });
  // RF-19: la reserva se solicita una vez guardada la receta (no bloquea la respuesta)
  intentarReserva(recetaId).catch((e) => console.error('Reserva farmacia:', e.message));
  return obtenerReceta(recetaId);
}

export async function obtenerReceta(recetaId) {
  const r = q.get(
    `SELECT r.*, rf.estado AS reserva_estado, rf.vigente_hasta AS reserva_vigente_hasta, rf.intentos AS reserva_intentos,
            u.nombre_completo AS medico_nombre, u.cedula_profesional, pa.nombre_completo AS paciente_nombre
     FROM recetas r LEFT JOIN reservas_farmacia rf ON rf.receta_id = r.id
     JOIN usuarios u ON u.id = r.medico_id JOIN pacientes pa ON pa.id = r.paciente_id WHERE r.id = ?`, recetaId);
  if (!r) throw noEncontrado('Receta inexistente');
  delete r.justificacion_alergia_enc;
  return {
    ...r,
    surtida: Boolean(r.surtida),
    anulada: Boolean(r.anulada),
    vencida: r.vigente_hasta < ahoraIso(),
    medicamentos: detallesReceta(r.id),
    // RF-17: el QR contiene solo el folio
    qr: await QRCode.toDataURL(r.folio, { errorCorrectionLevel: 'M', margin: 1, width: 220 }),
  };
}

export async function anularReceta(usuario, recetaId, motivo) {
  const r = q.get('SELECT * FROM recetas WHERE id = ?', recetaId);
  if (!r) throw noEncontrado('Receta inexistente');
  if (usuario.rol !== 'MEDICO' || r.medico_id !== usuario.id) throw prohibido('Solo el médico que la emitió puede anularla');
  if (!motivo || String(motivo).trim().length < 5) throw malaSolicitud('El motivo de anulación es obligatorio');
  if (r.anulada) throw conflicto('La receta ya está anulada');
  if (r.surtida) throw conflicto('La receta ya fue surtida');
  transaccion(() => {
    q.run('UPDATE recetas SET anulada = 1, motivo_anulacion = ?, fecha_anulacion = ? WHERE id = ?', String(motivo).trim(), ahoraIso(), recetaId);
    registrar({ usuarioId: usuario.id, rol: usuario.rol, accion: 'RECETA_ANULADA', recurso: 'receta', idRegistro: recetaId, pacienteId: r.paciente_id, detalle: { motivo } });
  });
  await cancelarReserva(recetaId);
  notificarPaciente(r.paciente_id, { tipo: 'RECETA', asunto: 'Receta anulada', contenido: `La receta ${r.folio} fue anulada por su médico. Motivo: ${motivo}` });
  return obtenerReceta(recetaId);
}

/** Reintento manual de reserva (p. ej. tras SIN_STOCK o FALLIDA). RN-09: una receta vencida no se reserva. */
export async function reintentarReserva(usuario, recetaId) {
  const r = q.get('SELECT * FROM recetas WHERE id = ?', recetaId);
  if (!r) throw noEncontrado('Receta inexistente');
  if (r.anulada || r.surtida) throw conflicto('La receta está anulada o ya fue surtida');
  if (r.vigente_hasta < ahoraIso()) throw conflicto('La receta está vencida y no se puede reservar (RN-09)');
  const res = q.get('SELECT * FROM reservas_farmacia WHERE receta_id = ?', recetaId);
  if (!['SIN_STOCK', 'FALLIDA'].includes(res.estado)) throw conflicto(`La reserva está en estado ${res.estado}`);
  q.run("UPDATE reservas_farmacia SET estado = 'PENDIENTE', intentos = 0, proximo_intento = NULL, actualizada_en = ? WHERE id = ?", ahoraIso(), res.id);
  await intentarReserva(recetaId);
  return obtenerReceta(recetaId);
}

/** Webhook de la farmacia: confirmación de surtido (RN-09: solo una vez). */
export function registrarSurtido({ folio, fechaSurtido }) {
  const r = q.get('SELECT * FROM recetas WHERE folio = ?', folio);
  if (!r) throw noEncontrado('Folio inexistente');
  if (r.anulada) throw conflicto('La receta está anulada');
  if (r.surtida) throw conflicto('La receta ya fue surtida (RN-09)');
  if (r.vigente_hasta < ahoraIso()) throw conflicto('La receta está vencida (RN-09)');
  transaccion(() => {
    q.run('UPDATE recetas SET surtida = 1, fecha_surtido = ? WHERE id = ?', fechaSurtido || ahoraIso(), r.id);
    q.run("UPDATE reservas_farmacia SET estado = 'SURTIDA', actualizada_en = ? WHERE receta_id = ?", ahoraIso(), r.id);
    registrarSiPuede({ accion: 'RECETA_SURTIDA', recurso: 'receta', idRegistro: r.id, pacienteId: r.paciente_id, detalle: { folio } });
  });
  return { folio, surtida: true };
}

export function recetasDePaciente(pacienteId) {
  return q.all('SELECT id FROM recetas WHERE paciente_id = ? ORDER BY fecha_emision DESC', pacienteId);
}

