// Servicio de Citas: RF-04 a RF-07, RF-09, RF-11; RN-03, RN-04, RN-05.
import { q, transaccion } from '../db/database.js';
import { p, MIN, DIA } from '../config/parametros.js';
import { ahora, ahoraIso, formatoLocal } from '../utils/tiempo.js';
import { HttpError, conflicto, malaSolicitud, noEncontrado, prohibido } from '../utils/errores.js';
import { transicionar, registrarEstadoInicial, esActiva } from './estadosCita.js';
import { registrar } from './auditoria.js';
import { notificarPaciente } from './notificaciones.js';
import { generarEnlace, revocarEnlace } from './telemedicina.js';
import { ofrecerCupo } from './listaEspera.js';

const SELECT_CITA = `
  SELECT c.*, pa.nombre_completo AS paciente_nombre, pa.curp AS paciente_curp, pa.usuario_id AS paciente_usuario_id,
         u.nombre_completo AS medico_nombre, s.nombre AS sede_nombre, s.zona_horaria, e.nombre AS especialidad_nombre,
         m.descripcion AS motivo_cancelacion
  FROM citas c
  JOIN pacientes pa ON pa.id = c.paciente_id
  LEFT JOIN usuarios u ON u.id = c.medico_id
  JOIN sedes s ON s.id = c.sede_id
  LEFT JOIN especialidades e ON e.id = c.especialidad_id
  LEFT JOIN motivos_cancelacion m ON m.id = c.motivo_cancelacion_id`;

export const obtenerCita = (id) => q.get(`${SELECT_CITA} WHERE c.id = ?`, id);

export function listarCitas(filtros = {}) {
  const cond = [];
  const params = [];
  const agregar = (sql, v) => { cond.push(sql); params.push(v); };
  if (filtros.pacienteId) agregar('c.paciente_id = ?', filtros.pacienteId);
  if (filtros.medicoId) agregar('c.medico_id = ?', filtros.medicoId);
  if (filtros.sedeId) agregar('c.sede_id = ?', filtros.sedeId);
  if (filtros.estado) agregar('c.estado = ?', filtros.estado);
  if (filtros.desde) agregar('c.fecha_hora >= ?', filtros.desde);
  if (filtros.hasta) agregar('c.fecha_hora < ?', filtros.hasta);
  if (filtros.soloActivas) cond.push('c.activa = 1');
  if (filtros.esUrgencia !== undefined) agregar('c.es_urgencia = ?', filtros.esUrgencia ? 1 : 0);
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  return q.all(`${SELECT_CITA} ${where} ORDER BY c.fecha_hora ${filtros.orden === 'desc' ? 'DESC' : 'ASC'} LIMIT ${Number(filtros.limite) || 500}`, ...params);
}

// ---------------- RF-04: disponibilidad ----------------
export function buscarDisponibilidad({ especialidadId, sedeId, medicoId, fecha, modalidad, limite = 200 } = {}) {
  const cond = ["cu.estado = 'LIBRE'", 'cu.inicio > ?', 'cu.inicio <= ?'];
  const params = [ahoraIso(), new Date(ahora().getTime() + p('P-16') * DIA).toISOString()];
  if (especialidadId) { cond.push('cu.especialidad_id = ?'); params.push(Number(especialidadId)); }
  if (sedeId) { cond.push('cu.sede_id = ?'); params.push(Number(sedeId)); }
  if (medicoId) { cond.push('cu.medico_id = ?'); params.push(Number(medicoId)); }
  if (modalidad) { cond.push('cu.modalidad = ?'); params.push(modalidad); }
  if (fecha) {
    // fecha local YYYY-MM-DD: se filtra con margen y luego por la fecha local de la sede
    cond.push('cu.inicio >= ? AND cu.inicio < ?');
    params.push(new Date(`${fecha}T00:00:00Z`).toISOString(), new Date(new Date(`${fecha}T00:00:00Z`).getTime() + 2 * DIA).toISOString());
  }
  let filas = q.all(
    `SELECT cu.id, cu.inicio, cu.fin, cu.modalidad, cu.medico_id, u.nombre_completo AS medico_nombre,
            cu.sede_id, s.nombre AS sede_nombre, s.zona_horaria, cu.especialidad_id, e.nombre AS especialidad_nombre
     FROM cupos cu JOIN usuarios u ON u.id = cu.medico_id AND u.activo = 1
     JOIN sedes s ON s.id = cu.sede_id JOIN especialidades e ON e.id = cu.especialidad_id
     WHERE ${cond.join(' AND ')} ORDER BY cu.inicio LIMIT ${fecha ? 1000 : Number(limite)}`,
    ...params,
  );
  if (fecha) {
    filas = filas.filter((f) => new Intl.DateTimeFormat('en-CA', { timeZone: f.zona_horaria }).format(new Date(f.inicio)) === fecha).slice(0, limite);
  }
  return filas;
}

function alternativas(cupo, excluirId) {
  return buscarDisponibilidad({ especialidadId: cupo.especialidad_id, sedeId: cupo.sede_id, modalidad: cupo.modalidad, limite: 6 })
    .filter((c) => c.id !== excluirId)
    .slice(0, 5);
}

/** RN-05: Agendada si hay P-01 o más de anticipación; si no, nace Confirmada. */
function estadoInicialPorAnticipacion(inicio) {
  return new Date(inicio).getTime() - ahora().getTime() >= p('P-01') * MIN ? 'AGENDADA' : 'CONFIRMADA';
}

/** RN-04: un paciente no puede tener dos citas activas que se traslapen. */
function verificarTraslape(pacienteId, inicio, fin, excluirCitaId = 0) {
  const t = q.get(
    'SELECT id FROM citas WHERE paciente_id = ? AND activa = 1 AND id != ? AND fecha_hora < ? AND fecha_fin > ? LIMIT 1',
    pacienteId, excluirCitaId, fin, inicio,
  );
  if (t) throw conflicto('Ya tiene otra cita activa que se traslapa con ese horario (RN-04)', { citaId: t.id });
}

/** Ocupa un cupo de forma atómica. Devuelve el cupo o lanza 409 con alternativas. */
function ocuparCupo(cupoId, { pacienteIdOferta = null } = {}) {
  const cupo = q.get('SELECT * FROM cupos WHERE id = ?', cupoId);
  if (!cupo) throw noEncontrado('Cupo inexistente');
  const horizonte = ahora().getTime() + p('P-16') * DIA;
  if (new Date(cupo.inicio) <= ahora() || new Date(cupo.inicio).getTime() > horizonte) {
    throw conflicto('Horario no disponible', { alternativas: alternativas(cupo, cupo.id) });
  }
  let ok;
  if (pacienteIdOferta) {
    // El cupo retenido para una oferta de lista de espera solo lo puede tomar el inscrito ofertado
    const oferta = q.get("SELECT id FROM lista_espera WHERE cupo_ofertado_id = ? AND paciente_id = ? AND estado = 'OFERTADA'", cupoId, pacienteIdOferta);
    ok = oferta && q.run("UPDATE cupos SET estado = 'OCUPADO' WHERE id = ? AND estado = 'RETENIDO'", cupoId).changes === 1;
  } else {
    ok = q.run("UPDATE cupos SET estado = 'OCUPADO' WHERE id = ? AND estado = 'LIBRE'", cupoId).changes === 1;
  }
  if (!ok) throw conflicto('Horario no disponible', { alternativas: alternativas(cupo, cupo.id) });
  return cupo;
}

/**
 * Libera un cupo (RF-07, RF-09, RF-06). Si es futuro y hay lista de espera compatible,
 * se retiene y se oferta (RF-10); si no, queda LIBRE y aparece en RF-04.
 */
export function liberarCupo(cupoId) {
  if (!cupoId) return;
  const cupo = q.get('SELECT * FROM cupos WHERE id = ?', cupoId);
  if (!cupo || cupo.estado === 'BLOQUEADO' || cupo.estado === 'ELIMINADO') return;
  q.run("UPDATE cupos SET estado = 'LIBRE' WHERE id = ?", cupoId);
  if (new Date(cupo.inicio) > ahora()) ofrecerCupo(cupoId);
}

function comprobante(cita) {
  return {
    citaId: cita.id,
    folio: `CITA-${String(cita.id).padStart(8, '0')}`,
    paciente: cita.paciente_nombre,
    medico: cita.medico_nombre,
    especialidad: cita.especialidad_nombre,
    sede: cita.sede_nombre,
    modalidad: cita.modalidad,
    fechaHora: cita.fecha_hora,
    fechaHoraLocal: formatoLocal(cita.fecha_hora, cita.zona_horaria),
    estado: cita.estado,
  };
}

function enviarComprobante(cita, titulo) {
  const c = comprobante(cita);
  notificarPaciente(cita.paciente_id, {
    tipo: 'COMPROBANTE', citaId: cita.id, asunto: titulo,
    contenido: `${titulo}: ${c.folio} - ${c.especialidad} con ${c.medico} en ${c.sede} (${c.modalidad}) el ${c.fechaHoraLocal}. Estado: ${c.estado}.`,
  });
  return c;
}

// ---------------- RF-05: agendar ----------------
export function agendar({ cupoId, pacienteId, actor, desdeOferta = false }) {
  const resultado = transaccion(() => {
    const paciente = q.get('SELECT id FROM pacientes WHERE id = ?', pacienteId);
    if (!paciente) throw noEncontrado('Paciente inexistente');
    const cupoPrevio = q.get('SELECT * FROM cupos WHERE id = ?', cupoId);
    if (!cupoPrevio) throw noEncontrado('Cupo inexistente');
    verificarTraslape(pacienteId, cupoPrevio.inicio, cupoPrevio.fin);
    const cupo = ocuparCupo(cupoId, { pacienteIdOferta: desdeOferta ? pacienteId : null });
    const estado = estadoInicialPorAnticipacion(cupo.inicio);
    const t = ahoraIso();
    let r;
    try {
      r = q.run(
        `INSERT INTO citas (paciente_id, medico_id, sede_id, especialidad_id, cupo_id, fecha_hora, fecha_fin, modalidad, estado, confirmada_en, creada_por, creada_en, actualizada_en)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        pacienteId, cupo.medico_id, cupo.sede_id, cupo.especialidad_id, cupo.id, cupo.inicio, cupo.fin, cupo.modalidad,
        estado, estado === 'CONFIRMADA' ? t : null, actor.id, t, t,
      );
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw conflicto('Horario no disponible', { alternativas: alternativas(cupo, cupo.id) });
      throw e;
    }
    const citaId = Number(r.lastInsertRowid);
    registrarEstadoInicial(citaId, estado, 'CREAR', actor.id);
    registrar({ usuarioId: actor.id, rol: actor.rol, accion: 'CITA_CREADA', recurso: 'cita', idRegistro: citaId, pacienteId, detalle: { cupoId, estado } });
    return citaId;
  });
  const cita = obtenerCita(resultado);
  if (cita.estado === 'CONFIRMADA' && cita.modalidad === 'VIRTUAL') generarEnlace(cita.id);
  return enviarComprobante(cita, 'Comprobante de cita');
}

/** RN-05: límite de anticipación P-03 para cancelar o reprogramar. */
function verificarAnticipacion(cita) {
  const restanteMs = new Date(cita.fecha_hora).getTime() - ahora().getTime();
  if (restanteMs < p('P-03') * MIN) {
    throw conflicto(`Solo se puede cancelar o reprogramar con al menos ${p('P-03') / 60} h de anticipación (RN-05)`);
  }
}

// ---------------- RF-06: reprogramar ----------------
export function reprogramar({ citaId, cupoId, actor, porAgenda = false }) {
  transaccion(() => {
    const cita = q.get('SELECT * FROM citas WHERE id = ?', citaId);
    if (!cita) throw noEncontrado('Cita inexistente');
    if (!['AGENDADA', 'NOTIFICADA', 'CONFIRMADA'].includes(cita.estado)) throw conflicto(`No se puede reprogramar una cita en estado ${cita.estado}`);
    if (cita.es_urgencia) throw conflicto('Las urgencias no se reprograman');
    if (!porAgenda) {
      verificarAnticipacion(cita);
      if (cita.reprogramaciones >= p('P-04')) throw conflicto(`La cita ya alcanzó el máximo de ${p('P-04')} reprogramaciones (RN-05)`);
    }
    const nuevo = q.get('SELECT * FROM cupos WHERE id = ?', cupoId);
    if (!nuevo) throw noEncontrado('Cupo inexistente');
    if (nuevo.especialidad_id !== cita.especialidad_id) throw malaSolicitud('El nuevo horario debe ser de la misma especialidad');
    verificarTraslape(cita.paciente_id, nuevo.inicio, nuevo.fin, cita.id);
    ocuparCupo(cupoId); // si falla, la transacción revierte y la cita original queda intacta
    const cupoAnterior = cita.cupo_id;
    const estado = estadoInicialPorAnticipacion(nuevo.inicio);
    // Se suelta el cupo anterior antes de ligar el nuevo (índice único de cita activa por cupo)
    transicionar(citaId, estado, 'REPROGRAMAR', {
      usuarioId: actor.id, rol: actor.rol,
      extra: {
        cupo_id: nuevo.id, medico_id: nuevo.medico_id, sede_id: nuevo.sede_id, fecha_hora: nuevo.inicio, fecha_fin: nuevo.fin,
        modalidad: nuevo.modalidad, reprogramaciones: cita.reprogramaciones + (porAgenda ? 0 : 1),
        notificada_en: null, confirmada_en: estado === 'CONFIRMADA' ? ahoraIso() : null,
      },
    });
    revocarEnlace(citaId);
    liberarCupo(cupoAnterior);
    registrar({
      usuarioId: actor.id, rol: actor.rol, accion: 'CITA_REPROGRAMADA', recurso: 'cita', idRegistro: citaId, pacienteId: cita.paciente_id,
      detalle: { de: cita.fecha_hora, a: nuevo.inicio, porAgenda },
    });
  });
  const cita = obtenerCita(citaId);
  if (cita.estado === 'CONFIRMADA' && cita.modalidad === 'VIRTUAL') generarEnlace(cita.id);
  return enviarComprobante(cita, 'Nuevo comprobante de cita (reprogramada)');
}

// ---------------- RF-07: cancelar ----------------
export function cancelar({ citaId, motivoId, actor, porAgenda = false }) {
  transaccion(() => {
    const cita = q.get('SELECT * FROM citas WHERE id = ?', citaId);
    if (!cita) throw noEncontrado('Cita inexistente');
    const motivo = q.get('SELECT id FROM motivos_cancelacion WHERE id = ? AND activo = 1', motivoId);
    if (!motivo) throw malaSolicitud('Indique un motivo de cancelación del catálogo');
    if (!['AGENDADA', 'NOTIFICADA', 'CONFIRMADA'].includes(cita.estado)) throw conflicto(`No se puede cancelar una cita en estado ${cita.estado}`);
    if (!porAgenda) verificarAnticipacion(cita);
    transicionar(citaId, 'CANCELADA_POR_USUARIO', 'CANCELAR', { usuarioId: actor.id, rol: actor.rol, extra: { motivo_cancelacion_id: motivoId } });
    revocarEnlace(citaId);
    liberarCupo(cita.cupo_id);
    registrar({ usuarioId: actor.id, rol: actor.rol, accion: 'CITA_CANCELADA', recurso: 'cita', idRegistro: citaId, pacienteId: cita.paciente_id, detalle: { motivoId, porAgenda } });
  });
  const cita = obtenerCita(citaId);
  notificarPaciente(cita.paciente_id, {
    tipo: 'CANCELACION', citaId, asunto: 'Cita cancelada',
    contenido: `Su cita de ${cita.especialidad_nombre} del ${formatoLocal(cita.fecha_hora, cita.zona_horaria)} fue cancelada. Motivo: ${cita.motivo_cancelacion}.`,
  });
  return comprobante(cita);
}

// ---------------- RF-09: confirmar asistencia ----------------
export function confirmar({ citaId, actor }) {
  transaccion(() => {
    transicionar(citaId, 'CONFIRMADA', 'CONFIRMAR', { usuarioId: actor.id, rol: actor.rol, extra: { confirmada_en: ahoraIso() } });
    const cita = q.get('SELECT paciente_id FROM citas WHERE id = ?', citaId);
    registrar({ usuarioId: actor.id, rol: actor.rol, accion: 'CITA_CONFIRMADA', recurso: 'cita', idRegistro: citaId, pacienteId: cita.paciente_id });
  });
  const cita = obtenerCita(citaId);
  if (cita.modalidad === 'VIRTUAL') generarEnlace(citaId);
  return comprobante(cita);
}

// ---------------- Check-in, llamado, derivación ----------------
export function checkIn({ citaId, actor }) {
  const cita = q.get('SELECT * FROM citas WHERE id = ?', citaId);
  if (!cita) throw noEncontrado('Cita inexistente');
  if (cita.modalidad !== 'PRESENCIAL') throw conflicto('El check-in solo aplica a citas presenciales');
  if (actor.rol === 'RECEPCION' && actor.sede_id && actor.sede_id !== cita.sede_id) throw prohibido('La cita es de otra sede');
  transaccion(() => {
    transicionar(citaId, 'EN_SALA_ESPERA', 'CHECK_IN', { usuarioId: actor.id, rol: actor.rol });
    registrar({ usuarioId: actor.id, rol: actor.rol, accion: 'CITA_CHECK_IN', recurso: 'cita', idRegistro: citaId, pacienteId: cita.paciente_id });
  });
  return obtenerCita(citaId);
}

export function llamarPaciente({ citaId, actor }) {
  const cita = q.get('SELECT * FROM citas WHERE id = ?', citaId);
  if (!cita) throw noEncontrado('Cita inexistente');
  if (cita.es_urgencia) {
    if (cita.sede_id !== actor.sede_id) throw prohibido('La urgencia es de otra sede');
  } else if (cita.medico_id !== actor.id) {
    throw prohibido('La cita está asignada a otro médico');
  }
  transaccion(() => {
    transicionar(citaId, 'EN_CONSULTA', 'LLAMAR_PACIENTE', { usuarioId: actor.id, rol: actor.rol, extra: { medico_id: actor.id } });
    registrar({ usuarioId: actor.id, rol: actor.rol, accion: 'CITA_EN_CONSULTA', recurso: 'cita', idRegistro: citaId, pacienteId: cita.paciente_id });
  });
  return obtenerCita(citaId);
}

export function derivarUrgencias({ citaId, actor }) {
  const cita = q.get('SELECT * FROM citas WHERE id = ?', citaId);
  if (!cita) throw noEncontrado('Cita inexistente');
  if (cita.medico_id !== actor.id) throw prohibido('La cita está asignada a otro médico');
  transaccion(() => {
    transicionar(citaId, 'DERIVADA_URGENCIAS', 'DERIVAR_URGENCIAS', { usuarioId: actor.id, rol: actor.rol });
    registrar({ usuarioId: actor.id, rol: actor.rol, accion: 'CITA_DERIVADA_URGENCIAS', recurso: 'cita', idRegistro: citaId, pacienteId: cita.paciente_id });
  });
  return obtenerCita(citaId);
}

// ---------------- RF-11: urgencias sin turno ----------------
export function registrarUrgencia({ pacienteId, sedeId, especialidadId = null, motivo, actor }) {
  if (!motivo || !String(motivo).trim()) throw malaSolicitud('El motivo de llegada es obligatorio');
  if (actor.sede_id && actor.sede_id !== Number(sedeId)) throw prohibido('Solo puede registrar urgencias en su sede');
  const paciente = q.get('SELECT id FROM pacientes WHERE id = ?', pacienteId);
  if (!paciente) throw noEncontrado('Paciente inexistente');
  const existente = q.get('SELECT id FROM citas WHERE paciente_id = ? AND es_urgencia = 1 AND activa = 1', pacienteId);
  if (existente) throw conflicto('El paciente ya tiene una urgencia activa', { citaId: existente.id });
  const id = transaccion(() => {
    const t = ahoraIso();
    const r = q.run(
      `INSERT INTO citas (paciente_id, medico_id, sede_id, especialidad_id, cupo_id, fecha_hora, fecha_fin, modalidad, estado, es_urgencia, motivo_urgencia, creada_por, creada_en, actualizada_en)
       VALUES (?, NULL, ?, ?, NULL, ?, ?, 'PRESENCIAL', 'EN_SALA_ESPERA', 1, ?, ?, ?, ?)`,
      pacienteId, sedeId, especialidadId, t, t, String(motivo).trim(), actor.id, t, t,
    );
    const citaId = Number(r.lastInsertRowid);
    registrarEstadoInicial(citaId, 'EN_SALA_ESPERA', 'REGISTRAR_URGENCIA', actor.id);
    registrar({ usuarioId: actor.id, rol: actor.rol, accion: 'URGENCIA_REGISTRADA', recurso: 'cita', idRegistro: citaId, pacienteId });
    return citaId;
  });
  return obtenerCita(id);
}

export function colaUrgencias(sedeId) {
  return q.all(
    `SELECT c.id, c.fecha_hora, c.estado, c.motivo_urgencia, c.medico_id, pa.id AS paciente_id, pa.nombre_completo AS paciente_nombre,
            u.nombre_completo AS medico_nombre, e.nombre AS especialidad_nombre
     FROM citas c JOIN pacientes pa ON pa.id = c.paciente_id LEFT JOIN usuarios u ON u.id = c.medico_id
     LEFT JOIN especialidades e ON e.id = c.especialidad_id
     WHERE c.es_urgencia = 1 AND c.activa = 1 AND c.sede_id = ? ORDER BY c.fecha_hora`,
    sedeId,
  );
}

export { esActiva, HttpError };
