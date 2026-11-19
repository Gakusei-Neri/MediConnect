// RF-03 / RN-07: relación asistencial y acceso de emergencia (RF-23).
import { q } from '../db/database.js';
import { p, HORA } from '../config/parametros.js';
import { ahora, ahoraIso } from '../utils/tiempo.js';

// Supuesto del desarrollador: un acceso de emergencia concede lectura durante 4 h.
export const HORAS_ACCESO_EMERGENCIA = Number(process.env.HORAS_ACCESO_EMERGENCIA || 4);

/**
 * Relación asistencial (Glosario + RN-07):
 *  - Médico: una cita asignada a él con ese paciente dentro de la ventana P-18
 *    (24 h antes a 24 h después de la hora de la cita), no cancelada.
 *  - Enfermero: una cita del paciente en su sede dentro de la ventana P-18
 *    (supuesto: el enfermero no tiene citas asignadas; se asocia por sede).
 *  - Ambos: una urgencia activa del paciente en su sede.
 * Devuelve { permitido, motivo }.
 */
export function relacionAsistencial(usuario, pacienteId) {
  if (!['MEDICO', 'ENFERMERO'].includes(usuario.rol)) return { permitido: false, motivo: 'ROL' };
  const { antes, despues } = p('P-18');
  const t = ahora().getTime();
  // Ventana: ahora ∈ [fecha_hora - antes, fecha_hora + despues]  ⇔  fecha_hora ∈ [ahora - despues, ahora + antes]
  const desde = new Date(t - despues * HORA).toISOString();
  const hasta = new Date(t + antes * HORA).toISOString();
  const excluidos = "('CANCELADA_POR_USUARIO','CANCELADA_AUTOMATICA')";

  const cita = usuario.rol === 'MEDICO'
    ? q.get(
      `SELECT id FROM citas WHERE paciente_id = ? AND medico_id = ? AND estado NOT IN ${excluidos}
       AND fecha_hora BETWEEN ? AND ? LIMIT 1`, pacienteId, usuario.id, desde, hasta)
    : q.get(
      `SELECT id FROM citas WHERE paciente_id = ? AND sede_id = ? AND estado NOT IN ${excluidos}
       AND fecha_hora BETWEEN ? AND ? LIMIT 1`, pacienteId, usuario.sede_id, desde, hasta);
  if (cita) return { permitido: true, motivo: 'CITA', citaId: cita.id };

  const urgencia = q.get(
    'SELECT id FROM citas WHERE paciente_id = ? AND es_urgencia = 1 AND activa = 1 AND sede_id = ? LIMIT 1',
    pacienteId, usuario.sede_id,
  );
  if (urgencia) return { permitido: true, motivo: 'URGENCIA', citaId: urgencia.id };

  if (usuario.rol === 'MEDICO') {
    const em = q.get(
      'SELECT id FROM accesos_emergencia WHERE medico_id = ? AND paciente_id = ? AND vence_en > ? ORDER BY id DESC LIMIT 1',
      usuario.id, pacienteId, ahoraIso(),
    );
    if (em) return { permitido: true, motivo: 'EMERGENCIA', emergenciaId: em.id, esEmergencia: true };
  }
  return { permitido: false, motivo: 'SIN_RELACION' };
}

export function pacienteDeUsuario(usuarioId) {
  return q.get('SELECT * FROM pacientes WHERE usuario_id = ?', usuarioId);
}
