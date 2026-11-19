// Servicio de Autenticación: RF-01, RF-02, RN-01.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { q, transaccion } from '../db/database.js';
import { p, MIN } from '../config/parametros.js';
import { env } from '../config/env.js';
import { ahora, ahoraIso, sumarIso } from '../utils/tiempo.js';
import { cifrar, descifrar, descifrarJson, sha256, tokenAleatorio } from '../utils/cifrado.js';
import { verificarTotp, generarSecreto } from '../utils/totp.js';
import { HttpError, conflicto, malaSolicitud, noAutenticado, prohibido } from '../utils/errores.js';
import { registrar, registrarSiPuede } from './auditoria.js';
import { crearSesion, firmarTemporal, verificarToken, ROLES_CLINICOS } from '../middleware/auth.js';

export const CURP_RE = /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HMX](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEL_RE = /^\+?\d{10,15}$/;
export const PASSWORD_MIN = 10;

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);

export function validarPassword(pw) {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) throw malaSolicitud(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`);
}

export function datosPublicosUsuario(u) {
  const paciente = u.rol === 'PACIENTE' ? q.get('SELECT id FROM pacientes WHERE usuario_id = ?', u.id) : null;
  const sede = u.sede_id ? q.get('SELECT id, nombre FROM sedes WHERE id = ?', u.sede_id) : null;
  return {
    id: u.id, nombre: u.nombre_completo, correo: u.correo, telefono: u.telefono, rol: u.rol,
    canalPreferido: u.canal_preferido, sede, especialidadId: u.especialidad_id, pacienteId: paciente?.id ?? null,
  };
}

// ---------------- RF-01: registro de paciente ----------------
export function solicitarRegistro(datos) {
  const { nombreCompleto, curp, fechaNacimiento, correo, telefono, password, canalVerificacion = 'CORREO', aceptaAvisoPrivacidad, canalPreferido } = datos;
  if (!aceptaAvisoPrivacidad) throw malaSolicitud('Debe aceptar el aviso de privacidad (RES-01)');
  if (!nombreCompleto?.trim()) throw malaSolicitud('Nombre obligatorio');
  const curpN = String(curp || '').toUpperCase().trim();
  if (!CURP_RE.test(curpN)) throw malaSolicitud('CURP inválida');
  if (!fechaNacimiento || Number.isNaN(Date.parse(fechaNacimiento)) || new Date(fechaNacimiento) > ahora()) throw malaSolicitud('Fecha de nacimiento inválida');
  if (!CORREO_RE.test(correo || '')) throw malaSolicitud('Correo inválido');
  if (!TEL_RE.test(telefono || '')) throw malaSolicitud('Teléfono inválido (10 a 15 dígitos)');
  validarPassword(password);
  if (q.get('SELECT id FROM pacientes WHERE curp = ?', curpN)) throw conflicto('La CURP ya está registrada; inicie sesión o recupere su cuenta');
  if (q.get('SELECT id FROM usuarios WHERE correo = ?', correo)) throw conflicto('El correo ya está registrado');

  const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const id = tokenAleatorio(16);
  const destino = canalVerificacion === 'SMS' ? telefono : correo;
  q.run(
    'INSERT INTO verificaciones_registro (id, destino, codigo_hash, expira_en, datos_enc) VALUES (?,?,?,?,?)',
    id, destino, sha256(`${id}:${codigo}`), sumarIso(ahora(), p('P-14') * MIN),
    cifrar({ nombreCompleto: nombreCompleto.trim(), curp: curpN, fechaNacimiento, correo: correo.trim(), telefono, passwordHash: hashPassword(password), canalPreferido: canalPreferido === 'SMS' ? 'SMS' : 'CORREO' }),
  );
  if (!env.esPrueba) console.log(`[verificación ${canalVerificacion}] → ${destino}: código ${codigo}`);
  return { verificacionId: id, destino, expiraEnMin: p('P-14'), ...(env.esProduccion ? {} : { codigoDev: codigo }) };
}

export function confirmarRegistro({ verificacionId, codigo }) {
  const v = q.get('SELECT * FROM verificaciones_registro WHERE id = ?', verificacionId);
  if (!v || v.usado) throw malaSolicitud('Verificación inexistente o ya utilizada');
  if (v.expira_en < ahoraIso()) throw malaSolicitud('El código venció; solicite uno nuevo');
  if (v.intentos >= 5) throw malaSolicitud('Demasiados intentos; solicite un código nuevo');
  if (sha256(`${verificacionId}:${codigo}`) !== v.codigo_hash) {
    q.run('UPDATE verificaciones_registro SET intentos = intentos + 1 WHERE id = ?', verificacionId);
    throw malaSolicitud('Código incorrecto');
  }
  const d = descifrarJson(v.datos_enc);
  return transaccion(() => {
    if (q.get('SELECT id FROM pacientes WHERE curp = ?', d.curp)) throw conflicto('La CURP ya está registrada');
    if (q.get('SELECT id FROM usuarios WHERE correo = ?', d.correo)) throw conflicto('El correo ya está registrado');
    const t = ahoraIso();
    const u = q.run(
      "INSERT INTO usuarios (nombre_completo, correo, telefono, password_hash, rol, canal_preferido, creado_en) VALUES (?,?,?,?, 'PACIENTE', ?, ?)",
      d.nombreCompleto, d.correo, d.telefono, d.passwordHash, d.canalPreferido, t,
    );
    const usuarioId = Number(u.lastInsertRowid);
    const pa = q.run(
      'INSERT INTO pacientes (usuario_id, curp, nombre_completo, fecha_nacimiento, acepto_aviso_privacidad, fecha_aviso) VALUES (?,?,?,?,1,?)',
      usuarioId, d.curp, d.nombreCompleto, d.fechaNacimiento, t,
    );
    const pacienteId = Number(pa.lastInsertRowid);
    q.run('INSERT INTO expedientes (paciente_id, fecha_creacion) VALUES (?,?)', pacienteId, t);
    q.run('UPDATE verificaciones_registro SET usado = 1 WHERE id = ?', verificacionId);
    registrar({ usuarioId, rol: 'PACIENTE', accion: 'REGISTRO_PACIENTE', recurso: 'paciente', idRegistro: pacienteId, pacienteId });
    return { usuarioId, pacienteId };
  });
}

// ---------------- RF-02: inicio de sesión ----------------
function registrarFallo(u, req, motivo) {
  const { intentos, bloqueoMin } = p('P-08');
  const fallos = u.intentos_fallidos + 1;
  if (fallos >= intentos) {
    q.run('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = ? WHERE id = ?', sumarIso(ahora(), bloqueoMin * MIN), u.id);
    registrarSiPuede({ usuarioId: u.id, rol: u.rol, accion: 'CUENTA_BLOQUEADA', recurso: 'usuario', idRegistro: u.id, resultado: 'BLOQUEADO', ip: req?.ip, detalle: { bloqueoMin } });
  } else {
    q.run('UPDATE usuarios SET intentos_fallidos = ? WHERE id = ?', fallos, u.id);
  }
  registrarSiPuede({ usuarioId: u.id, rol: u.rol, accion: 'LOGIN_FALLIDO', recurso: 'sesion', resultado: 'FALLO', ip: req?.ip, detalle: { motivo } });
}

function exigirNoBloqueado(u) {
  if (u.bloqueado_hasta && u.bloqueado_hasta > ahoraIso()) {
    throw new HttpError(423, 'Cuenta bloqueada temporalmente por intentos fallidos', { bloqueadoHasta: u.bloqueado_hasta });
  }
}

export function login({ correo, password }, req) {
  const u = q.get('SELECT * FROM usuarios WHERE correo = ?', String(correo || '').trim());
  if (!u || !u.activo) {
    registrarSiPuede({ accion: 'LOGIN_FALLIDO', recurso: 'sesion', resultado: 'FALLO', ip: req?.ip, detalle: { correo: String(correo || '').slice(0, 100) } });
    throw noAutenticado('Credenciales incorrectas');
  }
  exigirNoBloqueado(u);
  if (!bcrypt.compareSync(String(password || ''), u.password_hash)) {
    registrarFallo(u, req, 'PASSWORD');
    throw noAutenticado('Credenciales incorrectas');
  }
  // RN-01: el personal médico y de enfermería requiere el segundo factor
  if (ROLES_CLINICOS.includes(u.rol)) {
    if (!u.totp_secret_enc) throw prohibido('Su cuenta no tiene configurado el segundo factor; contacte al administrador');
    return { requiere2fa: true, tokenTemporal: firmarTemporal({ sub: u.id, tipo: 'pre2fa' }) };
  }
  return completarLogin(u, req);
}

function completarLogin(u, req) {
  q.run('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?', u.id);
  const token = crearSesion(u);
  registrar({ usuarioId: u.id, rol: u.rol, accion: 'LOGIN', recurso: 'sesion', ip: req?.ip });
  return { token, usuario: datosPublicosUsuario(u), inactividadMin: p('P-07') };
}

export function loginSegundoFactor({ tokenTemporal, codigo }, req) {
  const d = verificarToken(tokenTemporal, 'pre2fa');
  if (!d) throw noAutenticado('El paso de verificación expiró; inicie sesión de nuevo');
  const u = q.get('SELECT * FROM usuarios WHERE id = ?', d.sub);
  if (!u || !u.activo) throw noAutenticado();
  exigirNoBloqueado(u);
  if (!verificarTotp(descifrar(u.totp_secret_enc), codigo)) {
    registrarFallo(u, req, '2FA');
    throw noAutenticado('Código de verificación incorrecto');
  }
  return completarLogin(u, req);
}

/** RN-01: verificación adicional antes de acciones críticas (emitir receta, modificar diagnóstico). */
export function verificarSegundoFactor(usuario, codigo, accion) {
  const u = q.get('SELECT totp_secret_enc FROM usuarios WHERE id = ?', usuario.id);
  const ok = u?.totp_secret_enc && verificarTotp(descifrar(u.totp_secret_enc), codigo);
  if (!ok) {
    registrarSiPuede({ usuarioId: usuario.id, rol: usuario.rol, accion: 'VERIFICACION_2FA_FALLIDA', recurso: accion, resultado: 'RECHAZADO' });
    throw new HttpError(401, 'Verificación adicional 2FA inválida (RN-01)', { codigo: 'VERIFICACION_2FA' });
  }
}

export function cerrarSesion(usuario) {
  q.run('UPDATE sesiones SET revocada = 1 WHERE id = ?', usuario.sesionId);
  registrarSiPuede({ usuarioId: usuario.id, rol: usuario.rol, accion: 'LOGOUT', recurso: 'sesion' });
}

export function nuevoSecretoTotp() {
  const secreto = generarSecreto();
  return { secreto, secretoEnc: cifrar(secreto) };
}
