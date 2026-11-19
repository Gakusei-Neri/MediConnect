// D-04: tareas programadas idempotentes (RF-08, RF-09, RF-10, RF-19, RF-21, RF-23, RN-02).
import { q, transaccion } from '../db/database.js';
import { p, MIN } from '../config/parametros.js';
import { ahora, ahoraIso, formatoLocal } from '../utils/tiempo.js';
import { env } from '../config/env.js';
import { transicionar } from './estadosCita.js';
import { notificar } from './notificaciones.js';
import { liberarCupo } from './citas.js';
import { procesarOfertasVencidas } from './listaEspera.js';
import { procesarReintentos } from './farmacia.js';
import { generarCuposTodos } from './agenda.js';
import { revocarEnlace } from './telemedicina.js';
import { registrarSiPuede, vaciarCola } from './auditoria.js';
import { enviarAlertaEmergencia } from './clinico.js';

const SISTEMA = { id: null, rol: 'SISTEMA' };

function citaConDatos(id) {
  return q.get(
    `SELECT c.*, pa.usuario_id, s.zona_horaria, e.nombre AS especialidad FROM citas c JOIN pacientes pa ON pa.id = c.paciente_id
     JOIN sedes s ON s.id = c.sede_id LEFT JOIN especialidades e ON e.id = c.especialidad_id WHERE c.id = ?`, id);
}

/** RF-08: notificación de confirmación P-01 antes de la cita. */
export function enviarNotificacionesConfirmacion() {
  const limite = new Date(ahora().getTime() + p('P-01') * MIN).toISOString();
  const citas = q.all("SELECT id FROM citas WHERE estado = 'AGENDADA' AND fecha_hora <= ? AND fecha_hora > ?", limite, ahoraIso());
  for (const { id } of citas) {
    transaccion(() => {
      transicionar(id, 'NOTIFICADA', 'NOTIFICAR', { usuarioId: SISTEMA.id, rol: SISTEMA.rol, extra: { notificada_en: ahoraIso() } });
      const c = citaConDatos(id);
      if (c.usuario_id) {
        notificar(c.usuario_id, {
          tipo: 'CONFIRMACION', citaId: id, asunto: 'Confirme su cita',
          contenido: `Confirme su cita de ${c.especialidad} del ${formatoLocal(c.fecha_hora, c.zona_horaria)} en las próximas ${p('P-02') / 60} h: ${env.urlPortal}/paciente/citas?confirmar=${id}. Si no confirma, se cancelará automáticamente.`,
        });
      }
    });
  }
  return citas.length;
}

/** RF-09: sin confirmación dentro de P-02 → CanceladaAutomatica, se libera el cupo y se avisa. */
export function cancelarNoConfirmadas() {
  const limite = new Date(ahora().getTime() - p('P-02') * MIN).toISOString();
  const citas = q.all("SELECT id, cupo_id FROM citas WHERE estado = 'NOTIFICADA' AND notificada_en <= ?", limite);
  for (const { id, cupo_id } of citas) {
    transaccion(() => {
      transicionar(id, 'CANCELADA_AUTOMATICA', 'VENCER_CONFIRMACION', { rol: SISTEMA.rol });
      liberarCupo(cupo_id);
      const c = citaConDatos(id);
      registrarSiPuede({ rol: 'SISTEMA', accion: 'CITA_CANCELADA_AUTOMATICA', recurso: 'cita', idRegistro: id, pacienteId: c.paciente_id });
      if (c.usuario_id) {
        notificar(c.usuario_id, {
          tipo: 'CANCELACION_AUTOMATICA', citaId: id, asunto: 'Cita cancelada por falta de confirmación',
          contenido: `Su cita del ${formatoLocal(c.fecha_hora, c.zona_horaria)} se canceló porque no fue confirmada a tiempo. Puede agendar una nueva en el portal.`,
        });
      }
    });
  }
  return citas.length;
}

/** RF-21 / diagrama 2.4: Confirmada sin check-in ni ingreso P-05 después de la hora → NoAsistio. */
export function marcarInasistencias() {
  const limite = new Date(ahora().getTime() - p('P-05') * MIN).toISOString();
  const citas = q.all("SELECT id, paciente_id FROM citas WHERE estado = 'CONFIRMADA' AND fecha_hora <= ?", limite);
  for (const { id, paciente_id } of citas) {
    transaccion(() => {
      transicionar(id, 'NO_ASISTIO', 'MARCAR_INASISTENCIA', { rol: SISTEMA.rol });
      revocarEnlace(id);
      registrarSiPuede({ rol: 'SISTEMA', accion: 'CITA_NO_ASISTIO', recurso: 'cita', idRegistro: id, pacienteId: paciente_id });
    });
  }
  return citas.length;
}

function alertasPendientes() {
  const pend = q.all('SELECT id FROM accesos_emergencia WHERE alerta_enviada_en IS NULL');
  for (const a of pend) enviarAlertaEmergencia(a.id);
  return pend.length;
}

let ultimaGeneracion = 0;
let enCurso = false;

export async function ejecutarCiclo() {
  if (enCurso) return null;
  enCurso = true;
  const r = {};
  const paso = async (nombre, fn) => {
    try { r[nombre] = await fn(); } catch (e) { r[nombre] = `error: ${e.message}`; console.error(`[planificador] ${nombre}:`, e.message); }
  };
  try {
    await paso('notificaciones', enviarNotificacionesConfirmacion);
    await paso('cancelacionesAutomaticas', cancelarNoConfirmadas);
    await paso('inasistencias', marcarInasistencias);
    await paso('ofertasVencidas', procesarOfertasVencidas);
    await paso('reintentosFarmacia', procesarReintentos);
    await paso('alertasEmergencia', alertasPendientes);
    await paso('colaAuditoria', vaciarCola);
    if (Date.now() - ultimaGeneracion > 60 * MIN) {
      await paso('cuposGenerados', generarCuposTodos);
      ultimaGeneracion = Date.now();
    }
  } finally {
    enCurso = false;
  }
  return r;
}

let timer = null;
export function iniciar() {
  if (timer) return;
  timer = setInterval(ejecutarCiclo, env.planificadorSeg * 1000);
  timer.unref?.();
  setTimeout(ejecutarCiclo, 1000).unref?.();
  console.log(`[planificador] cada ${env.planificadorSeg} s`);
}

export function detener() {
  clearInterval(timer);
  timer = null;
}
