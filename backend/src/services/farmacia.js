// Integración con el Sistema de Farmacia externo (sección 3.4, RF-19, RES-03).
// Solo viajan los datos mínimos del contrato: folio, código de medicamento, cantidad y vigencia.
import { q } from '../db/database.js';
import { p, HORA } from '../config/parametros.js';
import { env } from '../config/env.js';
import { ahora, ahoraIso, sumarIso } from '../utils/tiempo.js';
import { registrarSiPuede } from './auditoria.js';
import { notificar, notificarPaciente } from './notificaciones.js';

const TIMEOUT_MS = 5000;

async function llamar(metodo, ruta, cuerpo) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${env.farmaciaUrl}${ruta}`, {
      method: metodo,
      headers: { 'content-type': 'application/json', 'x-api-key': env.farmaciaApiKey },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: ctrl.signal,
    });
    const datos = await r.json().catch(() => ({}));
    if (r.status >= 500) throw new Error(`Farmacia respondió ${r.status}`);
    return { status: r.status, datos };
  } finally {
    clearTimeout(t);
  }
}

/** Contrato mínimo (RES-03): sin diagnósticos, alergias ni datos de identidad. */
export function payloadReserva(recetaId) {
  const r = q.get('SELECT folio FROM recetas WHERE id = ?', recetaId);
  const items = q.all(
    'SELECT m.codigo, d.cantidad FROM receta_detalles d JOIN medicamentos m ON m.id = d.medicamento_id WHERE d.receta_id = ?',
    recetaId,
  ).map((i) => ({ codigoMedicamento: i.codigo, cantidad: i.cantidad }));
  return { folio: r.folio, items, vigenciaHasta: sumarIso(ahora(), p('P-11') * HORA) };
}

function avisar(recetaId, asunto, contenido) {
  const r = q.get('SELECT medico_id, paciente_id FROM recetas WHERE id = ?', recetaId);
  notificar(r.medico_id, { tipo: 'RESERVA_FARMACIA', asunto, contenido });
  notificarPaciente(r.paciente_id, { tipo: 'RESERVA_FARMACIA', asunto, contenido });
}

/**
 * Intenta reservar. Estados: CONFIRMADA, SIN_STOCK (con aviso), o reintento según P-17;
 * al agotar los reintentos queda FALLIDA (con aviso). La receta sigue siendo válida.
 */
export async function intentarReserva(recetaId) {
  const receta = q.get('SELECT * FROM recetas WHERE id = ?', recetaId);
  const reserva = q.get('SELECT * FROM reservas_farmacia WHERE receta_id = ?', recetaId);
  if (!receta || !reserva || receta.anulada || reserva.estado !== 'PENDIENTE') return reserva;
  if (receta.vigente_hasta < ahoraIso()) {
    q.run("UPDATE reservas_farmacia SET estado = 'FALLIDA', ultimo_error = 'Receta vencida (RN-09)', actualizada_en = ? WHERE id = ?", ahoraIso(), reserva.id);
    return q.get('SELECT * FROM reservas_farmacia WHERE id = ?', reserva.id);
  }
  const intentos = reserva.intentos + 1;
  const { reintentos, intervaloSeg } = p('P-17');
  try {
    const { status, datos } = await llamar('POST', '/api/reservas', payloadReserva(recetaId));
    if (status === 200 || status === 201) {
      const estado = datos.estado === 'CONFIRMADA' ? 'CONFIRMADA' : 'SIN_STOCK';
      q.run(
        'UPDATE reservas_farmacia SET estado = ?, reserva_externa_id = ?, vigente_hasta = ?, intentos = ?, proximo_intento = NULL, ultimo_error = NULL, actualizada_en = ? WHERE id = ?',
        estado, datos.reservaId ?? null, datos.vigenciaHasta ?? null, intentos, ahoraIso(), reserva.id,
      );
      registrarSiPuede({ accion: 'RESERVA_FARMACIA', recurso: 'receta', idRegistro: recetaId, pacienteId: receta.paciente_id, resultado: estado });
      if (estado === 'SIN_STOCK') {
        avisar(recetaId, 'Receta sin stock en farmacia', `La receta ${receta.folio} sigue siendo válida, pero la farmacia no tiene stock suficiente: ${(datos.sinStock || []).join(', ')}.`);
      }
    } else {
      throw new Error(datos.error || `Farmacia respondió ${status}`);
    }
  } catch (e) {
    const mensaje = e.name === 'AbortError' ? 'Tiempo de espera agotado (5 s)' : e.message;
    if (intentos > reintentos) {
      q.run("UPDATE reservas_farmacia SET estado = 'FALLIDA', intentos = ?, proximo_intento = NULL, ultimo_error = ?, actualizada_en = ? WHERE id = ?", intentos, mensaje, ahoraIso(), reserva.id);
      registrarSiPuede({ accion: 'RESERVA_FARMACIA', recurso: 'receta', idRegistro: recetaId, pacienteId: receta.paciente_id, resultado: 'FALLIDA', detalle: { error: mensaje } });
      avisar(recetaId, 'No se pudo reservar su receta', `La receta ${receta.folio} sigue siendo válida, pero la reserva en farmacia falló tras ${reintentos} reintentos.`);
    } else {
      q.run('UPDATE reservas_farmacia SET intentos = ?, proximo_intento = ?, ultimo_error = ?, actualizada_en = ? WHERE id = ?',
        intentos, sumarIso(ahora(), intervaloSeg * 1000), mensaje, ahoraIso(), reserva.id);
    }
  }
  return q.get('SELECT * FROM reservas_farmacia WHERE id = ?', reserva.id);
}

/** Planificador: reintentos pendientes. */
export async function procesarReintentos() {
  const pendientes = q.all("SELECT receta_id FROM reservas_farmacia WHERE estado = 'PENDIENTE' AND proximo_intento IS NOT NULL AND proximo_intento <= ?", ahoraIso());
  for (const r of pendientes) await intentarReserva(r.receta_id);
  return pendientes.length;
}

export async function cancelarReserva(recetaId) {
  const reserva = q.get('SELECT * FROM reservas_farmacia WHERE receta_id = ?', recetaId);
  if (!reserva) return;
  if (reserva.reserva_externa_id && ['CONFIRMADA', 'SIN_STOCK'].includes(reserva.estado)) {
    try {
      await llamar('DELETE', `/api/reservas/${encodeURIComponent(reserva.reserva_externa_id)}`);
    } catch (e) {
      registrarSiPuede({ accion: 'CANCELAR_RESERVA_FARMACIA', recurso: 'receta', idRegistro: recetaId, resultado: 'FALLO', detalle: { error: e.message } });
    }
  }
  q.run("UPDATE reservas_farmacia SET estado = 'CANCELADA', proximo_intento = NULL, actualizada_en = ? WHERE id = ?", ahoraIso(), reserva.id);
}
