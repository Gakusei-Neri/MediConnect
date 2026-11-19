// Servicio de Notificaciones (D-08: correo y SMS simulados).
// RF-08: si el canal principal falla, se usa el alterno. Cada envío queda registrado.
import { q } from '../db/database.js';
import { ahoraIso } from '../utils/tiempo.js';
import { env } from '../config/env.js';

let fallasForzadas = new Set(); // para pruebas: canales que deben fallar

export function forzarFallaCanal(canal, fallar = true) {
  if (fallar) fallasForzadas.add(canal);
  else fallasForzadas.delete(canal);
}

function enviarPorCanal(canal, destino) {
  // Simulador: un canal "falla" si se forzó, si no hay destino o por probabilidad configurada.
  if (!destino) return false;
  if (fallasForzadas.has(canal)) return false;
  if (env.simFallaCanal > 0 && Math.random() < env.simFallaCanal) return false;
  return true;
}

function registrarEnvio({ usuario, citaId, tipo, canal, asunto, contenido, ok, esAlterno }) {
  const destino = canal === 'CORREO' ? usuario.correo : usuario.telefono;
  q.run(
    `INSERT INTO notificaciones (usuario_id, cita_id, tipo, canal, destino, asunto, contenido, resultado, es_alterno, fecha_envio)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    usuario.id, citaId ?? null, tipo, canal, destino ?? '(sin destino)', asunto, contenido, ok ? 'ENVIADA' : 'FALLIDA', esAlterno ? 1 : 0, ahoraIso(),
  );
  if (ok && !env.esPrueba) console.log(`[notificación ${canal}] → ${destino}: ${asunto}`);
}

/**
 * Envía una notificación a un usuario por su canal preferido; si falla, por el alterno.
 * Devuelve el canal que tuvo éxito o null.
 */
export function notificar(usuarioId, { tipo, asunto, contenido, citaId = null }) {
  const usuario = q.get('SELECT id, correo, telefono, canal_preferido FROM usuarios WHERE id = ?', usuarioId);
  if (!usuario) return null;
  const principal = usuario.canal_preferido;
  const alterno = principal === 'CORREO' ? 'SMS' : 'CORREO';
  const ok1 = enviarPorCanal(principal, principal === 'CORREO' ? usuario.correo : usuario.telefono);
  registrarEnvio({ usuario, citaId, tipo, canal: principal, asunto, contenido, ok: ok1, esAlterno: false });
  if (ok1) return principal;
  const ok2 = enviarPorCanal(alterno, alterno === 'CORREO' ? usuario.correo : usuario.telefono);
  registrarEnvio({ usuario, citaId, tipo, canal: alterno, asunto, contenido, ok: ok2, esAlterno: true });
  return ok2 ? alterno : null;
}

export function notificarPaciente(pacienteId, datos) {
  const p = q.get('SELECT usuario_id FROM pacientes WHERE id = ?', pacienteId);
  return p?.usuario_id ? notificar(p.usuario_id, datos) : null;
}

export function notificarRol(rol, datos) {
  for (const u of q.all('SELECT id FROM usuarios WHERE rol = ? AND activo = 1', rol)) notificar(u.id, datos);
}
