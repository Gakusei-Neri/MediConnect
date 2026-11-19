// Servicio de Telemedicina: RF-20 (enlace tokenizado) y RF-21 (sesión de videoconsulta).
// RES-02 / D-06: el servidor solo hace la señalización WebRTC; nunca recibe ni almacena medios.
import { q } from '../db/database.js';
import { p, MIN } from '../config/parametros.js';
import { ahora, sumarIso } from '../utils/tiempo.js';
import { tokenAleatorio } from '../utils/cifrado.js';
import { env } from '../config/env.js';
import { prohibido, noEncontrado, conflicto } from '../utils/errores.js';
import { notificarPaciente, notificar } from './notificaciones.js';

const TERMINALES = ['FINALIZADA', 'CANCELADA_POR_USUARIO', 'CANCELADA_AUTOMATICA', 'NO_ASISTIO', 'DERIVADA_URGENCIAS'];

/** Genera (o regenera) el enlace único de una cita virtual Confirmada. */
export function generarEnlace(citaId) {
  const cita = q.get('SELECT * FROM citas WHERE id = ?', citaId);
  if (!cita || cita.modalidad !== 'VIRTUAL' || cita.estado !== 'CONFIRMADA') return null;
  const { antes, despues } = p('P-06');
  const token = tokenAleatorio(32);
  const desde = sumarIso(cita.fecha_hora, -antes * MIN);
  const hasta = sumarIso(cita.fecha_hora, despues * MIN);
  q.run('DELETE FROM enlaces_video WHERE cita_id = ?', citaId);
  q.run('INSERT INTO enlaces_video (cita_id, token, valido_desde, valido_hasta) VALUES (?,?,?,?)', citaId, token, desde, hasta);
  const url = `${env.urlPortal}/videoconsulta/${token}`;
  const aviso = {
    tipo: 'ENLACE_VIDEOCONSULTA', citaId,
    asunto: 'Enlace de su videoconsulta',
    contenido: `Su videoconsulta está confirmada. Enlace seguro (válido de ${desde} a ${hasta} UTC): ${url}`,
  };
  notificarPaciente(cita.paciente_id, aviso);
  if (cita.medico_id) notificar(cita.medico_id, aviso);
  return { token, url, validoDesde: desde, validoHasta: hasta };
}

export function revocarEnlace(citaId) {
  q.run('UPDATE enlaces_video SET revocado = 1 WHERE cita_id = ?', citaId);
}

/**
 * Valida que el usuario autenticado pueda usar el enlace: debe ser el paciente o el médico
 * de esa cita, estar dentro de la ventana P-06 y la cita no debe haber terminado.
 */
export function validarEnlace(token, usuario) {
  const enlace = q.get('SELECT * FROM enlaces_video WHERE token = ?', token);
  if (!enlace) throw noEncontrado('Enlace inexistente');
  const cita = q.get(
    `SELECT c.*, pa.usuario_id AS paciente_usuario_id, pa.nombre_completo AS paciente_nombre, u.nombre_completo AS medico_nombre
     FROM citas c JOIN pacientes pa ON pa.id = c.paciente_id LEFT JOIN usuarios u ON u.id = c.medico_id WHERE c.id = ?`,
    enlace.cita_id,
  );
  const esPaciente = usuario.rol === 'PACIENTE' && cita.paciente_usuario_id === usuario.id;
  const esMedico = usuario.rol === 'MEDICO' && cita.medico_id === usuario.id;
  if (!esPaciente && !esMedico) throw prohibido('El enlace pertenece a otra cita o usuario');
  if (enlace.revocado || TERMINALES.includes(cita.estado)) throw conflicto('El enlace ya no es válido: la cita terminó o fue cancelada');
  const t = ahora().toISOString();
  if (t < enlace.valido_desde || t > enlace.valido_hasta) {
    throw conflicto('Fuera de la ventana del enlace (P-06)', { validoDesde: enlace.valido_desde, validoHasta: enlace.valido_hasta });
  }
  return { enlace, cita, participante: esPaciente ? 'PACIENTE' : 'MEDICO' };
}

export function iceServers() {
  const urls = (process.env.STUN_URLS || 'stun:stun.l.google.com:19302').split(',').filter(Boolean);
  return urls.length ? [{ urls }] : [];
}
