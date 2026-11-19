// RF-12: horarios recurrentes por médico y sede, duración por especialidad (P-15) y bloqueos.
// Si un cambio afecta citas existentes, se listan y deben resolverse antes de aplicar el cambio.
import { q, transaccion, getDb } from '../db/database.js';
import { p, MIN, DIA } from '../config/parametros.js';
import { ahora, ahoraIso, localAUtc, fechaLocal } from '../utils/tiempo.js';
import { conflicto, malaSolicitud, noEncontrado, prohibido } from '../utils/errores.js';
import { registrar } from './auditoria.js';
import { cancelar, reprogramar } from './citas.js';

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const aMin = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

export function duracionEspecialidad(especialidadId) {
  const e = q.get('SELECT duracion_min FROM especialidades WHERE id = ?', especialidadId);
  return e?.duracion_min || p('P-15');
}

function verificarAlcanceSede(actor, sedeId) {
  if (actor.rol === 'RECEPCION' && actor.sede_id !== Number(sedeId)) throw prohibido('Recepción solo gestiona la agenda de su sede');
}

export function listarHorarios({ medicoId, sedeId } = {}) {
  const cond = ['h.activo = 1'];
  const params = [];
  if (medicoId) { cond.push('h.medico_id = ?'); params.push(medicoId); }
  if (sedeId) { cond.push('h.sede_id = ?'); params.push(sedeId); }
  return q.all(
    `SELECT h.*, u.nombre_completo AS medico_nombre, s.nombre AS sede_nombre FROM horarios h
     JOIN usuarios u ON u.id = h.medico_id JOIN sedes s ON s.id = h.sede_id
     WHERE ${cond.join(' AND ')} ORDER BY h.medico_id, h.dia_semana, h.hora_inicio`, ...params);
}

/** Genera cupos para un horario dentro del horizonte P-16 (idempotente). */
export function generarCuposHorario(horarioId) {
  const h = q.get('SELECT h.*, s.zona_horaria, u.especialidad_id FROM horarios h JOIN sedes s ON s.id = h.sede_id JOIN usuarios u ON u.id = h.medico_id WHERE h.id = ?', horarioId);
  if (!h || !h.activo) return 0;
  const duracion = duracionEspecialidad(h.especialidad_id);
  const inicioMin = aMin(h.hora_inicio);
  const finMin = aMin(h.hora_fin);
  const hoy = ahora();
  const horizonte = p('P-16');
  const insertar = getInsert();
  let creados = 0;
  for (let d = 0; d <= horizonte; d++) {
    const { fecha, diaSemana } = fechaLocal(new Date(hoy.getTime() + d * DIA), h.zona_horaria);
    if (diaSemana !== h.dia_semana) continue;
    for (let m = inicioMin; m + duracion <= finMin; m += duracion) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const inicio = localAUtc(fecha, `${hh}:${mm}`, h.zona_horaria);
      if (inicio <= hoy) continue;
      const fin = new Date(inicio.getTime() + duracion * MIN);
      const bloqueado = q.get('SELECT id FROM bloqueos_agenda WHERE medico_id = ? AND desde < ? AND hasta > ?', h.medico_id, fin.toISOString(), inicio.toISOString());
      const r = insertar.run(h.medico_id, h.sede_id, h.especialidad_id, h.id, inicio.toISOString(), fin.toISOString(), h.modalidad, bloqueado ? 'BLOQUEADO' : 'LIBRE');
      creados += r.changes;
    }
  }
  return creados;
}

const getInsert = () => getDb().prepare(
  'INSERT OR IGNORE INTO cupos (medico_id, sede_id, especialidad_id, horario_id, inicio, fin, modalidad, estado) VALUES (?,?,?,?,?,?,?,?)',
);

/** Planificador: extiende los cupos de todos los horarios activos hasta el horizonte. */
export function generarCuposTodos() {
  let total = 0;
  for (const h of q.all('SELECT id FROM horarios WHERE activo = 1')) total += generarCuposHorario(h.id);
  return total;
}

export function crearHorario({ medicoId, sedeId, diaSemana, horaInicio, horaFin, modalidad, actor }) {
  verificarAlcanceSede(actor, sedeId);
  if (!HORA_RE.test(horaInicio) || !HORA_RE.test(horaFin) || aMin(horaInicio) >= aMin(horaFin)) throw malaSolicitud('Horas inválidas (HH:MM, inicio < fin)');
  if (!(Number.isInteger(Number(diaSemana)) && diaSemana >= 0 && diaSemana <= 6)) throw malaSolicitud('Día de la semana inválido (0-6)');
  if (!['PRESENCIAL', 'VIRTUAL'].includes(modalidad)) throw malaSolicitud('Modalidad inválida');
  const medico = q.get("SELECT id, especialidad_id FROM usuarios WHERE id = ? AND rol = 'MEDICO' AND activo = 1", medicoId);
  if (!medico) throw noEncontrado('Médico inexistente');
  if (!medico.especialidad_id) throw malaSolicitud('El médico no tiene especialidad asignada');
  // Sin traslapes con otros horarios del mismo médico ese día (en cualquier sede)
  const traslape = q.all('SELECT * FROM horarios WHERE medico_id = ? AND dia_semana = ? AND activo = 1', medicoId, diaSemana)
    .find((h) => aMin(h.hora_inicio) < aMin(horaFin) && aMin(h.hora_fin) > aMin(horaInicio));
  if (traslape) throw conflicto('El horario se traslapa con otro horario del médico', { horarioId: traslape.id });
  return transaccion(() => {
    const r = q.run(
      'INSERT INTO horarios (medico_id, sede_id, dia_semana, hora_inicio, hora_fin, modalidad) VALUES (?,?,?,?,?,?)',
      medicoId, sedeId, diaSemana, horaInicio, horaFin, modalidad,
    );
    const id = Number(r.lastInsertRowid);
    const cupos = generarCuposHorario(id);
    registrar({ usuarioId: actor.id, rol: actor.rol, accion: 'HORARIO_CREADO', recurso: 'horario', idRegistro: id, detalle: { cupos } });
    return { id, cuposGenerados: cupos };
  });
}

/** Citas activas futuras ligadas a cupos afectados. */
function citasAfectadas(where, ...params) {
  return q.all(
    `SELECT c.id, c.fecha_hora, c.estado, c.modalidad, c.especialidad_id, pa.nombre_completo AS paciente_nombre, c.paciente_id
     FROM citas c JOIN cupos cu ON cu.id = c.cupo_id JOIN pacientes pa ON pa.id = c.paciente_id
     WHERE c.activa = 1 AND c.fecha_hora > ? AND ${where} ORDER BY c.fecha_hora`,
    ahoraIso(), ...params,
  );
}

/**
 * Aplica las resoluciones: cada cita afectada debe tener { citaId, accion: 'CANCELAR'|'REPROGRAMAR', cupoId?, motivoId? }.
 * Si falta alguna, lanza 409 con la lista de citas a resolver.
 */
function resolverAfectadas(afectadas, resoluciones = [], actor, cuposAfectados) {
  const porId = new Map((resoluciones || []).map((r) => [Number(r.citaId), r]));
  const pendientes = afectadas.filter((c) => !porId.has(c.id));
  if (pendientes.length) {
    throw conflicto('El cambio afecta citas existentes: reprograme o cancele cada una antes de aplicarlo (RF-12)', { citasAfectadas: afectadas });
  }
  for (const c of afectadas) {
    const r = porId.get(c.id);
    if (r.accion === 'CANCELAR') {
      cancelar({ citaId: c.id, motivoId: r.motivoId, actor, porAgenda: true });
    } else if (r.accion === 'REPROGRAMAR') {
      if (cuposAfectados.has(Number(r.cupoId))) throw malaSolicitud(`El nuevo horario de la cita ${c.id} también queda afectado`);
      reprogramar({ citaId: c.id, cupoId: Number(r.cupoId), actor, porAgenda: true });
    } else {
      throw malaSolicitud(`Acción inválida para la cita ${c.id}`);
    }
  }
}

export function crearBloqueo({ medicoId, desde, hasta, motivo, resoluciones, actor }) {
  if (!desde || !hasta || new Date(desde) >= new Date(hasta)) throw malaSolicitud('Rango de fechas inválido');
  if (!motivo) throw malaSolicitud('El motivo es obligatorio');
  const desdeIso = new Date(desde).toISOString();
  const hastaIso = new Date(hasta).toISOString();
  const medico = q.get("SELECT id FROM usuarios WHERE id = ? AND rol = 'MEDICO'", medicoId);
  if (!medico) throw noEncontrado('Médico inexistente');
  if (actor.rol === 'RECEPCION') {
    const enSede = q.get('SELECT id FROM horarios WHERE medico_id = ? AND sede_id = ? AND activo = 1', medicoId, actor.sede_id);
    if (!enSede) throw prohibido('El médico no atiende en su sede');
  }
  const afectadas = citasAfectadas('cu.medico_id = ? AND cu.inicio < ? AND cu.fin > ?', medicoId, hastaIso, desdeIso);
  const cuposAfectados = new Set(q.all('SELECT id FROM cupos WHERE medico_id = ? AND inicio < ? AND fin > ?', medicoId, hastaIso, desdeIso).map((c) => c.id));
  return transaccion(() => {
    resolverAfectadas(afectadas, resoluciones, actor, cuposAfectados);
    const r = q.run(
      'INSERT INTO bloqueos_agenda (medico_id, desde, hasta, motivo, creado_por, creado_en) VALUES (?,?,?,?,?,?)',
      medicoId, desdeIso, hastaIso, motivo, actor.id, ahoraIso(),
    );
    // Cupos en el rango quedan bloqueados (incluye los retenidos para lista de espera)
    const retenidos = q.all("SELECT id FROM cupos WHERE medico_id = ? AND inicio < ? AND fin > ? AND estado = 'RETENIDO'", medicoId, hastaIso, desdeIso);
    for (const c of retenidos) {
      q.run("UPDATE lista_espera SET estado = 'ACTIVA', cupo_ofertado_id = NULL, oferta_vence_en = NULL WHERE cupo_ofertado_id = ? AND estado = 'OFERTADA'", c.id);
    }
    q.run("UPDATE cupos SET estado = 'BLOQUEADO' WHERE medico_id = ? AND inicio < ? AND fin > ? AND estado IN ('LIBRE','RETENIDO')", medicoId, hastaIso, desdeIso);
    registrar({ usuarioId: actor.id, rol: actor.rol, accion: 'BLOQUEO_CREADO', recurso: 'bloqueo', idRegistro: r.lastInsertRowid, detalle: { medicoId, desde: desdeIso, hasta: hastaIso, citasResueltas: afectadas.length } });
    return { id: Number(r.lastInsertRowid), citasResueltas: afectadas.length };
  });
}

export function eliminarBloqueo({ bloqueoId, actor }) {
  const b = q.get('SELECT * FROM bloqueos_agenda WHERE id = ?', bloqueoId);
  if (!b) throw noEncontrado('Bloqueo inexistente');
  transaccion(() => {
    q.run('DELETE FROM bloqueos_agenda WHERE id = ?', bloqueoId);
    // Los cupos que ya no estén cubiertos por otro bloqueo vuelven a estar libres
    for (const c of q.all("SELECT * FROM cupos WHERE medico_id = ? AND inicio < ? AND fin > ? AND estado = 'BLOQUEADO'", b.medico_id, b.hasta, b.desde)) {
      const otro = q.get('SELECT id FROM bloqueos_agenda WHERE medico_id = ? AND desde < ? AND hasta > ?', b.medico_id, c.fin, c.inicio);
      if (!otro) q.run("UPDATE cupos SET estado = 'LIBRE' WHERE id = ?", c.id);
    }
    registrar({ usuarioId: actor.id, rol: actor.rol, accion: 'BLOQUEO_ELIMINADO', recurso: 'bloqueo', idRegistro: bloqueoId });
  });
}

export function listarBloqueos({ medicoId, sedeId } = {}) {
  const cond = ['b.hasta > ?'];
  const params = [ahoraIso()];
  if (medicoId) { cond.push('b.medico_id = ?'); params.push(medicoId); }
  if (sedeId) { cond.push('b.medico_id IN (SELECT medico_id FROM horarios WHERE sede_id = ? AND activo = 1)'); params.push(sedeId); }
  return q.all(
    `SELECT b.*, u.nombre_completo AS medico_nombre FROM bloqueos_agenda b JOIN usuarios u ON u.id = b.medico_id
     WHERE ${cond.join(' AND ')} ORDER BY b.desde`, ...params);
}

export function desactivarHorario({ horarioId, resoluciones, actor }) {
  const h = q.get('SELECT * FROM horarios WHERE id = ? AND activo = 1', horarioId);
  if (!h) throw noEncontrado('Horario inexistente');
  verificarAlcanceSede(actor, h.sede_id);
  const afectadas = citasAfectadas('cu.horario_id = ?', horarioId);
  const cuposAfectados = new Set(q.all('SELECT id FROM cupos WHERE horario_id = ?', horarioId).map((c) => c.id));
  return transaccion(() => {
    resolverAfectadas(afectadas, resoluciones, actor, cuposAfectados);
    q.run('UPDATE horarios SET activo = 0 WHERE id = ?', horarioId);
    for (const c of q.all("SELECT id FROM cupos WHERE horario_id = ? AND estado = 'RETENIDO'", horarioId)) {
      q.run("UPDATE lista_espera SET estado = 'ACTIVA', cupo_ofertado_id = NULL, oferta_vence_en = NULL WHERE cupo_ofertado_id = ? AND estado = 'OFERTADA'", c.id);
    }
    q.run("UPDATE cupos SET estado = 'ELIMINADO' WHERE horario_id = ? AND inicio > ? AND estado IN ('LIBRE','BLOQUEADO','RETENIDO')", horarioId, ahoraIso());
    registrar({ usuarioId: actor.id, rol: actor.rol, accion: 'HORARIO_DESACTIVADO', recurso: 'horario', idRegistro: horarioId, detalle: { citasResueltas: afectadas.length } });
    return { citasResueltas: afectadas.length };
  });
}

/** Vista previa de citas afectadas (para que la UI pida resolverlas). */
export function previsualizarBloqueo({ medicoId, desde, hasta }) {
  return citasAfectadas('cu.medico_id = ? AND cu.inicio < ? AND cu.fin > ?', medicoId, new Date(hasta).toISOString(), new Date(desde).toISOString());
}

export function previsualizarDesactivacion(horarioId) {
  return citasAfectadas('cu.horario_id = ?', horarioId);
}
