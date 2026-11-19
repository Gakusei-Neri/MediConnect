// RF-02 / RF-03 / RN-01: autenticación por JWT ligada a una sesión de servidor,
// cierre por inactividad (P-07) y autorización por rol con auditoría de accesos denegados.
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { p, MIN } from '../config/parametros.js';
import { q } from '../db/database.js';
import { ahora, ahoraIso } from '../utils/tiempo.js';
import { noAutenticado, prohibido } from '../utils/errores.js';
import { desdeReqSiPuede } from '../services/auditoria.js';
import { tokenAleatorio } from '../utils/cifrado.js';

export const ROLES = ['PACIENTE', 'RECEPCION', 'MEDICO', 'ENFERMERO', 'SEGURIDAD', 'ADMINISTRADOR'];
export const ROLES_CLINICOS = ['MEDICO', 'ENFERMERO'];

export function crearSesion(usuario) {
  const id = tokenAleatorio(24);
  const t = ahoraIso();
  q.run('INSERT INTO sesiones (id, usuario_id, creada_en, ultima_actividad) VALUES (?,?,?,?)', id, usuario.id, t, t);
  const token = jwt.sign({ sid: id, sub: usuario.id, rol: usuario.rol, tipo: 'sesion' }, env.jwtSecret, { expiresIn: '12h' });
  return token;
}

export function firmarTemporal(payload, expiresIn = '5m') {
  return jwt.sign(payload, env.jwtSecret, { expiresIn });
}

export function verificarToken(token, tipo) {
  try {
    const d = jwt.verify(token, env.jwtSecret);
    if (tipo && d.tipo !== tipo) return null;
    return d;
  } catch {
    return null;
  }
}

/** Valida token + sesión + inactividad. Devuelve el usuario o lanza 401. */
export function usuarioDesdeToken(token, { tocar = true } = {}) {
  const datos = verificarToken(token, 'sesion');
  if (!datos) throw noAutenticado('Sesión inválida o expirada');
  const sesion = q.get('SELECT * FROM sesiones WHERE id = ?', datos.sid);
  if (!sesion || sesion.revocada) throw noAutenticado('Sesión cerrada');
  const inactivoMs = ahora().getTime() - new Date(sesion.ultima_actividad).getTime();
  if (inactivoMs > p('P-07') * MIN) {
    q.run('UPDATE sesiones SET revocada = 1 WHERE id = ?', sesion.id);
    throw noAutenticado('Sesión cerrada por inactividad (RN-01)', { codigo: 'INACTIVIDAD' });
  }
  const usuario = q.get(
    'SELECT id, nombre_completo, correo, telefono, rol, canal_preferido, activo, sede_id, especialidad_id FROM usuarios WHERE id = ?',
    sesion.usuario_id,
  );
  if (!usuario || !usuario.activo) throw noAutenticado('Usuario inactivo');
  if (tocar) q.run('UPDATE sesiones SET ultima_actividad = ? WHERE id = ?', ahoraIso(), sesion.id);
  return { ...usuario, sesionId: sesion.id };
}

export function autenticar(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(noAutenticado());
  try {
    req.usuario = usuarioDesdeToken(token);
    next();
  } catch (e) {
    next(e);
  }
}

/** RF-03: restringe por rol; los accesos no permitidos devuelven 403 y se auditan. */
export function permitir(...roles) {
  return (req, _res, next) => {
    if (req.usuario && roles.includes(req.usuario.rol)) return next();
    desdeReqSiPuede(req, {
      accion: 'ACCESO_DENEGADO', recurso: `${req.method} ${req.baseUrl}${req.route?.path ?? ''}`,
      resultado: 'PROHIBIDO', detalle: { requeridos: roles },
    });
    next(prohibido());
  };
}

/** Lanza 403 auditado (para verificaciones de pertenencia dentro de los handlers). */
export function denegar(req, recurso, idRegistro, motivo, pacienteId) {
  desdeReqSiPuede(req, { accion: 'ACCESO_DENEGADO', recurso, idRegistro, pacienteId, resultado: 'PROHIBIDO', detalle: { motivo } });
  return prohibido();
}
