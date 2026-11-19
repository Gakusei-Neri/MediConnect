// Administrador: usuarios, roles, catálogos y parámetros (RF-03, RNF-09). Nunca ve datos clínicos.
import { Router } from 'express';
import QRCode from 'qrcode';
import { autenticar, permitir, ROLES, ROLES_CLINICOS } from '../middleware/auth.js';
import { hashPassword, validarPassword, nuevoSecretoTotp } from '../services/autenticacion.js';
import { desdeReq, simularCaidaAuditoria, auditoriaDisponible } from '../services/auditoria.js';
import { forzarFallaCanal } from '../services/notificaciones.js';
import { ejecutarCiclo } from '../services/planificador.js';
import * as parametros from '../config/parametros.js';
import { q, transaccion } from '../db/database.js';
import { conflicto, entero, malaSolicitud, noEncontrado, requerir } from '../utils/errores.js';
import { ahoraIso } from '../utils/tiempo.js';
import { uriOtpAuth } from '../utils/totp.js';
import { env } from '../config/env.js';

const r = Router();
r.use(autenticar, permitir('ADMINISTRADOR'));

// ---------- Usuarios ----------
r.get('/usuarios', (req, res) => {
  const cond = [];
  const params = [];
  if (req.query.rol) { cond.push('u.rol = ?'); params.push(req.query.rol); }
  res.json(q.all(
    `SELECT u.id, u.nombre_completo, u.correo, u.telefono, u.rol, u.activo, u.sede_id, s.nombre AS sede_nombre, u.especialidad_id,
            e.nombre AS especialidad_nombre, u.cedula_profesional, u.bloqueado_hasta, (u.totp_secret_enc IS NOT NULL) AS tiene_2fa, u.creado_en
     FROM usuarios u LEFT JOIN sedes s ON s.id = u.sede_id LEFT JOIN especialidades e ON e.id = u.especialidad_id
     ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY u.rol, u.nombre_completo`, ...params));
});

async function datos2fa(secreto, correo) {
  const uri = uriOtpAuth(secreto, correo);
  return { secreto, otpauth: uri, qr: await QRCode.toDataURL(uri) };
}

function validarPersonal(b) {
  if (!ROLES.includes(b.rol)) throw malaSolicitud('Rol inválido');
  if (b.rol === 'PACIENTE') throw malaSolicitud('Los pacientes se registran desde el portal (RF-01)');
  if (['RECEPCION', 'MEDICO', 'ENFERMERO'].includes(b.rol) && !b.sedeId) throw malaSolicitud('El personal de recepción y clínico requiere sede');
  if (b.rol === 'MEDICO' && !b.especialidadId) throw malaSolicitud('El médico requiere especialidad');
}

r.post('/usuarios', async (req, res) => {
  const b = req.body || {};
  requerir(b, ['nombreCompleto', 'correo', 'password', 'rol']);
  validarPersonal(b);
  validarPassword(b.password);
  if (q.get('SELECT id FROM usuarios WHERE correo = ?', b.correo)) throw conflicto('El correo ya está registrado');
  const totp = ROLES_CLINICOS.includes(b.rol) ? nuevoSecretoTotp() : null;
  const id = transaccion(() => {
    const x = q.run(
      `INSERT INTO usuarios (nombre_completo, correo, telefono, password_hash, rol, sede_id, especialidad_id, cedula_profesional, totp_secret_enc, creado_en)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      b.nombreCompleto, b.correo, b.telefono || null, hashPassword(b.password), b.rol, b.sedeId || null,
      b.rol === 'MEDICO' ? b.especialidadId : null, b.cedulaProfesional || null, totp?.secretoEnc ?? null, ahoraIso(),
    );
    desdeReq(req, { accion: 'USUARIO_CREADO', recurso: 'usuario', idRegistro: x.lastInsertRowid, detalle: { rol: b.rol } });
    return Number(x.lastInsertRowid);
  });
  res.status(201).json({ id, segundoFactor: totp ? await datos2fa(totp.secreto, b.correo) : null });
});

r.put('/usuarios/:id', (req, res) => {
  const id = entero(req.params.id, 'id');
  const u = q.get('SELECT * FROM usuarios WHERE id = ?', id);
  if (!u) throw noEncontrado('Usuario inexistente');
  const b = req.body || {};
  const nuevoRol = b.rol ?? u.rol;
  if (u.rol === 'PACIENTE' && nuevoRol !== 'PACIENTE') throw malaSolicitud('Una cuenta de paciente no puede cambiar de rol');
  if (nuevoRol !== 'PACIENTE') validarPersonal({ rol: nuevoRol, sedeId: b.sedeId ?? u.sede_id, especialidadId: b.especialidadId ?? u.especialidad_id });
  transaccion(() => {
    q.run(
      'UPDATE usuarios SET nombre_completo = ?, telefono = ?, rol = ?, sede_id = ?, especialidad_id = ?, cedula_profesional = ?, activo = ? WHERE id = ?',
      b.nombreCompleto ?? u.nombre_completo, b.telefono ?? u.telefono, nuevoRol, b.sedeId ?? u.sede_id,
      nuevoRol === 'MEDICO' ? (b.especialidadId ?? u.especialidad_id) : null, b.cedulaProfesional ?? u.cedula_profesional,
      b.activo === undefined ? u.activo : (b.activo ? 1 : 0), id,
    );
    if (b.activo === false) q.run('UPDATE sesiones SET revocada = 1 WHERE usuario_id = ?', id);
    desdeReq(req, { accion: 'USUARIO_MODIFICADO', recurso: 'usuario', idRegistro: id, detalle: { ...b, password: undefined } });
  });
  res.status(204).end();
});

r.post('/usuarios/:id/desbloquear', (req, res) => {
  const id = entero(req.params.id, 'id');
  q.run('UPDATE usuarios SET bloqueado_hasta = NULL, intentos_fallidos = 0 WHERE id = ?', id);
  desdeReq(req, { accion: 'USUARIO_DESBLOQUEADO', recurso: 'usuario', idRegistro: id });
  res.status(204).end();
});

r.post('/usuarios/:id/password', (req, res) => {
  const id = entero(req.params.id, 'id');
  requerir(req.body, ['password']);
  validarPassword(req.body.password);
  q.run('UPDATE usuarios SET password_hash = ? WHERE id = ?', hashPassword(req.body.password), id);
  q.run('UPDATE sesiones SET revocada = 1 WHERE usuario_id = ?', id);
  desdeReq(req, { accion: 'PASSWORD_RESTABLECIDA', recurso: 'usuario', idRegistro: id });
  res.status(204).end();
});

r.post('/usuarios/:id/2fa', async (req, res) => {
  const id = entero(req.params.id, 'id');
  const u = q.get('SELECT correo, rol FROM usuarios WHERE id = ?', id);
  if (!u) throw noEncontrado('Usuario inexistente');
  if (u.rol === 'PACIENTE' || u.rol === 'RECEPCION') throw malaSolicitud('El 2FA no aplica a pacientes ni a recepción (RN-01)');
  const totp = nuevoSecretoTotp();
  q.run('UPDATE usuarios SET totp_secret_enc = ? WHERE id = ?', totp.secretoEnc, id);
  q.run('UPDATE sesiones SET revocada = 1 WHERE usuario_id = ?', id);
  desdeReq(req, { accion: '2FA_REGENERADO', recurso: 'usuario', idRegistro: id });
  res.json(await datos2fa(totp.secreto, u.correo));
});

// ---------- Catálogos ----------
const CATALOGOS = {
  sedes: { tabla: 'sedes', campos: ['nombre', 'tipo', 'direccion', 'zona_horaria'] },
  especialidades: { tabla: 'especialidades', campos: ['nombre', 'duracion_min'] },
  componentes: { tabla: 'componentes_activos', campos: ['nombre'] },
  medicamentos: { tabla: 'medicamentos', campos: ['codigo', 'nombre', 'presentacion', 'componente_id'] },
  diagnosticos: { tabla: 'diagnosticos_cat', campos: ['codigo', 'descripcion', 'version'] },
  'motivos-cancelacion': { tabla: 'motivos_cancelacion', campos: ['descripcion', 'activo'] },
  'rangos-fisiologicos': { tabla: 'rangos_fisiologicos', campos: ['signo', 'grupo_edad', 'minimo', 'maximo', 'unidad'], sinId: true },
};

r.get('/catalogos/:cat', (req, res) => {
  const c = CATALOGOS[req.params.cat];
  if (!c) throw noEncontrado('Catálogo inexistente');
  res.json(q.all(`SELECT * FROM ${c.tabla} ORDER BY 1`));
});

r.post('/catalogos/:cat', (req, res) => {
  const c = CATALOGOS[req.params.cat];
  if (!c) throw noEncontrado('Catálogo inexistente');
  const valores = c.campos.filter((k) => req.body?.[k] !== undefined);
  if (!valores.length) throw malaSolicitud('Sin datos');
  try {
    const x = q.run(
      `INSERT ${c.sinId ? 'OR REPLACE' : ''} INTO ${c.tabla} (${valores.join(',')}) VALUES (${valores.map(() => '?').join(',')})`,
      ...valores.map((k) => req.body[k]),
    );
    desdeReq(req, { accion: 'CATALOGO_ALTA', recurso: req.params.cat, idRegistro: x.lastInsertRowid, detalle: req.body });
    res.status(201).json({ id: Number(x.lastInsertRowid) });
  } catch (e) {
    throw malaSolicitud(`No se pudo guardar: ${e.message}`);
  }
});

r.put('/catalogos/:cat/:id', (req, res) => {
  const c = CATALOGOS[req.params.cat];
  if (!c || c.sinId) throw noEncontrado('Catálogo inexistente');
  const valores = c.campos.filter((k) => req.body?.[k] !== undefined);
  if (!valores.length) throw malaSolicitud('Sin datos');
  try {
    q.run(`UPDATE ${c.tabla} SET ${valores.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...valores.map((k) => req.body[k]), entero(req.params.id, 'id'));
  } catch (e) {
    throw malaSolicitud(`No se pudo guardar: ${e.message}`);
  }
  desdeReq(req, { accion: 'CATALOGO_CAMBIO', recurso: req.params.cat, idRegistro: req.params.id, detalle: req.body });
  res.status(204).end();
});

// ---------- Parámetros (RNF-09: cambian sin recompilar ni redesplegar) ----------
r.get('/parametros', (_req, res) => res.json(parametros.todos()));

r.put('/parametros/:id', (req, res) => {
  const previo = parametros.todos()[req.params.id];
  let actualizado;
  try {
    actualizado = parametros.actualizar(req.params.id, req.body?.valor);
  } catch (e) {
    throw malaSolicitud(e.message);
  }
  desdeReq(req, { accion: 'PARAMETRO_CAMBIADO', recurso: 'parametro', idRegistro: req.params.id, detalle: { de: previo?.valor, a: req.body?.valor } });
  res.json(actualizado);
});

// ---------- Simulación (solo fuera de producción; para pruebas de aceptación) ----------
r.get('/simulacion', (_req, res) => res.json({ auditoriaDisponible: auditoriaDisponible(), produccion: env.esProduccion }));

r.post('/simulacion', async (req, res) => {
  if (env.esProduccion) throw malaSolicitud('No disponible en producción');
  const b = req.body || {};
  if (b.auditoriaCaida !== undefined) simularCaidaAuditoria(b.auditoriaCaida);
  if (b.fallaCanal) forzarFallaCanal(b.fallaCanal.canal, b.fallaCanal.fallar);
  const ciclo = b.ejecutarPlanificador ? await ejecutarCiclo() : undefined;
  res.json({ auditoriaDisponible: auditoriaDisponible(), ciclo });
});

export default r;
