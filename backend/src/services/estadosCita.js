// RN-03: una cita solo cambia de estado siguiendo el diagrama de estados (sección 2.4).
// Toda transición no dibujada es inválida y se rechaza y audita.
import { q } from '../db/database.js';
import { ahoraIso } from '../utils/tiempo.js';
import { HttpError } from '../utils/errores.js';
import { registrarSiPuede } from './auditoria.js';

export const ESTADOS = {
  AGENDADA: 'AGENDADA',
  NOTIFICADA: 'NOTIFICADA',
  CONFIRMADA: 'CONFIRMADA',
  EN_SALA_ESPERA: 'EN_SALA_ESPERA',
  TELEMEDICINA_CONECTADA: 'TELEMEDICINA_CONECTADA',
  EN_CONSULTA: 'EN_CONSULTA',
  FINALIZADA: 'FINALIZADA',
  CANCELADA_POR_USUARIO: 'CANCELADA_POR_USUARIO',
  CANCELADA_AUTOMATICA: 'CANCELADA_AUTOMATICA',
  NO_ASISTIO: 'NO_ASISTIO',
  DERIVADA_URGENCIAS: 'DERIVADA_URGENCIAS',
};

export const ACTIVOS = ['AGENDADA', 'NOTIFICADA', 'CONFIRMADA', 'EN_SALA_ESPERA', 'TELEMEDICINA_CONECTADA', 'EN_CONSULTA'];
export const esActiva = (estado) => ACTIVOS.includes(estado);

// Estados iniciales permitidos ([*] --> X)
export const INICIALES = ['AGENDADA', 'CONFIRMADA', 'EN_SALA_ESPERA'];

// Transiciones válidas: de -> { a: [eventos] }
export const TRANSICIONES = {
  AGENDADA: {
    NOTIFICADA: ['NOTIFICAR'],
    CANCELADA_POR_USUARIO: ['CANCELAR'],
    AGENDADA: ['REPROGRAMAR'],
    CONFIRMADA: ['REPROGRAMAR'],
  },
  NOTIFICADA: {
    CONFIRMADA: ['CONFIRMAR', 'REPROGRAMAR'],
    CANCELADA_AUTOMATICA: ['VENCER_CONFIRMACION'],
    CANCELADA_POR_USUARIO: ['CANCELAR'],
    AGENDADA: ['REPROGRAMAR'],
  },
  CONFIRMADA: {
    CANCELADA_POR_USUARIO: ['CANCELAR'],
    AGENDADA: ['REPROGRAMAR'],
    CONFIRMADA: ['REPROGRAMAR'],
    EN_SALA_ESPERA: ['CHECK_IN'],
    TELEMEDICINA_CONECTADA: ['INGRESAR_VIDEO'],
    NO_ASISTIO: ['MARCAR_INASISTENCIA'],
  },
  EN_SALA_ESPERA: { EN_CONSULTA: ['LLAMAR_PACIENTE'] },
  TELEMEDICINA_CONECTADA: { EN_CONSULTA: ['INICIAR_VIDEO'] },
  EN_CONSULTA: {
    FINALIZADA: ['FINALIZAR'],
    DERIVADA_URGENCIAS: ['DERIVAR_URGENCIAS'],
  },
  FINALIZADA: {},
  CANCELADA_POR_USUARIO: {},
  CANCELADA_AUTOMATICA: {},
  NO_ASISTIO: {},
  DERIVADA_URGENCIAS: {},
};

export function esTransicionValida(de, a, evento) {
  return Boolean(TRANSICIONES[de]?.[a]?.includes(evento));
}

/**
 * Cambia el estado de una cita validando RN-03. Debe llamarse dentro de una transacción
 * cuando acompaña otros cambios. `extra` permite actualizar columnas adicionales.
 */
export function transicionar(citaId, a, evento, { usuarioId = null, rol = null, extra = {} } = {}) {
  const cita = q.get('SELECT id, estado, paciente_id FROM citas WHERE id = ?', citaId);
  if (!cita) throw new HttpError(404, 'Cita no encontrada');
  if (!esTransicionValida(cita.estado, a, evento)) {
    registrarSiPuede({
      usuarioId, rol, accion: 'TRANSICION_INVALIDA', recurso: 'cita', idRegistro: citaId,
      pacienteId: cita.paciente_id, resultado: 'RECHAZADO', detalle: { de: cita.estado, a, evento },
    });
    throw new HttpError(409, `Transición inválida (RN-03): ${cita.estado} → ${a}`, { de: cita.estado, a, evento });
  }
  const ahora = ahoraIso();
  const columnas = Object.keys(extra);
  const set = ['estado = ?', 'actualizada_en = ?', ...columnas.map((c) => `${c} = ?`)].join(', ');
  q.run(`UPDATE citas SET ${set} WHERE id = ?`, a, ahora, ...columnas.map((c) => extra[c]), citaId);
  q.run(
    'INSERT INTO historial_estados_cita (cita_id, de_estado, a_estado, evento, usuario_id, fecha) VALUES (?,?,?,?,?,?)',
    citaId, cita.estado, a, evento, usuarioId, ahora,
  );
  return { de: cita.estado, a };
}

export function registrarEstadoInicial(citaId, estado, evento, usuarioId) {
  if (!INICIALES.includes(estado)) throw new HttpError(409, `Estado inicial inválido: ${estado}`);
  q.run(
    'INSERT INTO historial_estados_cita (cita_id, de_estado, a_estado, evento, usuario_id, fecha) VALUES (?,?,?,?,?,?)',
    citaId, null, estado, evento, usuarioId, ahoraIso(),
  );
}
