// RF-10: lista de espera por especialidad, sede y modalidad (médico opcional).
// Al liberarse un cupo compatible se ofrece por orden de inscripción; el inscrito tiene P-09 para aceptar.
import { q, transaccion } from '../db/database.js';
import { p, MIN } from '../config/parametros.js';
import { ahora, ahoraIso, sumarIso, formatoLocal } from '../utils/tiempo.js';
import { conflicto, noEncontrado, prohibido, malaSolicitud } from '../utils/errores.js';
import { registrar } from './auditoria.js';
import { notificarPaciente } from './notificaciones.js';
import { agendar } from './citas.js';
import { env } from '../config/env.js';

export function inscribir({ pacienteId, especialidadId, sedeId, modalidad, medicoId = null, actor }) {
  if (!['PRESENCIAL', 'VIRTUAL'].includes(modalidad)) throw malaSolicitud('Modalidad inválida');
  try {
    const r = q.run(
      'INSERT INTO lista_espera (paciente_id, especialidad_id, sede_id, modalidad, medico_id, fecha_solicitud) VALUES (?,?,?,?,?,?)',
      pacienteId, especialidadId, sedeId, modalidad, medicoId || null, ahoraIso(),
    );
    registrar({ usuarioId: actor.id, rol: actor.rol, accion: 'LISTA_ESPERA_INSCRITO', recurso: 'lista_espera', idRegistro: r.lastInsertRowid, pacienteId });
    return obtener(Number(r.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw conflicto('El paciente ya está inscrito en esa combinación de lista de espera');
    throw e;
  }
}

export const obtener = (id) => q.get(
  `SELECT le.*, e.nombre AS especialidad_nombre, s.nombre AS sede_nombre, u.nombre_completo AS medico_nombre,
          pa.nombre_completo AS paciente_nombre, cu.inicio AS cupo_inicio
   FROM lista_espera le JOIN especialidades e ON e.id = le.especialidad_id JOIN sedes s ON s.id = le.sede_id
   JOIN pacientes pa ON pa.id = le.paciente_id LEFT JOIN usuarios u ON u.id = le.medico_id
   LEFT JOIN cupos cu ON cu.id = le.cupo_ofertado_id WHERE le.id = ?`, id);

export function listar({ pacienteId, sedeId } = {}) {
  const cond = ["le.estado IN ('ACTIVA','OFERTADA')"];
  const params = [];
  if (pacienteId) { cond.push('le.paciente_id = ?'); params.push(pacienteId); }
  if (sedeId) { cond.push('le.sede_id = ?'); params.push(sedeId); }
  return q.all(
    `SELECT le.*, e.nombre AS especialidad_nombre, s.nombre AS sede_nombre, u.nombre_completo AS medico_nombre,
            pa.nombre_completo AS paciente_nombre, cu.inicio AS cupo_inicio
     FROM lista_espera le JOIN especialidades e ON e.id = le.especialidad_id JOIN sedes s ON s.id = le.sede_id
     JOIN pacientes pa ON pa.id = le.paciente_id LEFT JOIN usuarios u ON u.id = le.medico_id
     LEFT JOIN cupos cu ON cu.id = le.cupo_ofertado_id
     WHERE ${cond.join(' AND ')} ORDER BY le.fecha_solicitud`, ...params);
}

/**
 * Ofrece un cupo recién liberado al primer inscrito compatible. Si lo hay, el cupo queda
 * RETENIDO (no aparece en RF-04). Devuelve la inscripción ofertada o null.
 */
export function ofrecerCupo(cupoId) {
  const cupo = q.get('SELECT * FROM cupos WHERE id = ?', cupoId);
  if (!cupo || new Date(cupo.inicio) <= ahora()) return null;
  const candidatos = q.all(
    `SELECT * FROM lista_espera WHERE estado = 'ACTIVA' AND especialidad_id = ? AND sede_id = ? AND modalidad = ?
     AND (medico_id IS NULL OR medico_id = ?) ORDER BY fecha_solicitud, id`,
    cupo.especialidad_id, cupo.sede_id, cupo.modalidad, cupo.medico_id,
  );
  for (const c of candidatos) {
    if (JSON.parse(c.cupos_rechazados).includes(cupoId)) continue;
    // El inscrito no debe tener otra cita activa traslapada
    const traslape = q.get('SELECT id FROM citas WHERE paciente_id = ? AND activa = 1 AND fecha_hora < ? AND fecha_fin > ?', c.paciente_id, cupo.fin, cupo.inicio);
    if (traslape) continue;
    const vence = sumarIso(ahora(), p('P-09') * MIN);
    q.run("UPDATE cupos SET estado = 'RETENIDO' WHERE id = ?", cupoId);
    q.run("UPDATE lista_espera SET estado = 'OFERTADA', cupo_ofertado_id = ?, oferta_vence_en = ? WHERE id = ?", cupoId, vence, c.id);
    const sede = q.get('SELECT zona_horaria FROM sedes WHERE id = ?', cupo.sede_id);
    notificarPaciente(c.paciente_id, {
      tipo: 'OFERTA_LISTA_ESPERA',
      asunto: 'Se liberó un horario para usted',
      contenido: `Hay un horario disponible el ${formatoLocal(cupo.inicio, sede.zona_horaria)}. Acéptelo antes de ${formatoLocal(vence, sede.zona_horaria)}: ${env.urlPortal}/paciente/lista-espera`,
    });
    return c;
  }
  return null;
}

/** Pasa la oferta al siguiente inscrito; si nadie la toma, el cupo se publica (LIBRE). */
function pasarAlSiguiente(inscripcion) {
  const rechazados = JSON.parse(inscripcion.cupos_rechazados);
  rechazados.push(inscripcion.cupo_ofertado_id);
  q.run(
    "UPDATE lista_espera SET estado = 'ACTIVA', cupo_ofertado_id = NULL, oferta_vence_en = NULL, cupos_rechazados = ? WHERE id = ?",
    JSON.stringify(rechazados), inscripcion.id,
  );
  q.run("UPDATE cupos SET estado = 'LIBRE' WHERE id = ? AND estado = 'RETENIDO'", inscripcion.cupo_ofertado_id);
  ofrecerCupo(inscripcion.cupo_ofertado_id);
}

export function aceptarOferta({ inscripcionId, pacienteId, actor }) {
  const ins = q.get('SELECT * FROM lista_espera WHERE id = ?', inscripcionId);
  if (!ins) throw noEncontrado('Inscripción inexistente');
  if (ins.paciente_id !== pacienteId) throw prohibido();
  if (ins.estado !== 'OFERTADA') throw conflicto('No hay una oferta vigente');
  if (ins.oferta_vence_en < ahoraIso()) throw conflicto('La oferta ya venció');
  return transaccion(() => {
    const comprobante = agendar({ cupoId: ins.cupo_ofertado_id, pacienteId, actor, desdeOferta: true });
    q.run("UPDATE lista_espera SET estado = 'ATENDIDA' WHERE id = ?", ins.id);
    return comprobante;
  });
}

export function rechazarOferta({ inscripcionId, pacienteId, actor }) {
  const ins = q.get('SELECT * FROM lista_espera WHERE id = ?', inscripcionId);
  if (!ins) throw noEncontrado('Inscripción inexistente');
  if (ins.paciente_id !== pacienteId) throw prohibido();
  if (ins.estado !== 'OFERTADA') throw conflicto('No hay una oferta vigente');
  transaccion(() => {
    pasarAlSiguiente(ins);
    registrar({ usuarioId: actor.id, rol: actor.rol, accion: 'OFERTA_RECHAZADA', recurso: 'lista_espera', idRegistro: ins.id, pacienteId });
  });
}

export function cancelarInscripcion({ inscripcionId, actor, pacienteId = null }) {
  const ins = q.get('SELECT * FROM lista_espera WHERE id = ?', inscripcionId);
  if (!ins) throw noEncontrado('Inscripción inexistente');
  if (pacienteId && ins.paciente_id !== pacienteId) throw prohibido();
  transaccion(() => {
    if (ins.estado === 'OFERTADA') pasarAlSiguiente(ins);
    q.run("UPDATE lista_espera SET estado = 'CANCELADA' WHERE id = ?", ins.id);
    registrar({ usuarioId: actor.id, rol: actor.rol, accion: 'LISTA_ESPERA_BAJA', recurso: 'lista_espera', idRegistro: ins.id, pacienteId: ins.paciente_id });
  });
}

/** Planificador: ofertas vencidas pasan al siguiente inscrito. */
export function procesarOfertasVencidas() {
  const vencidas = q.all("SELECT * FROM lista_espera WHERE estado = 'OFERTADA' AND oferta_vence_en <= ?", ahoraIso());
  for (const ins of vencidas) transaccion(() => pasarAlSiguiente(ins));
  return vencidas.length;
}
