// Pruebas HTTP: autenticación (RF-02), 2FA (RN-01), matriz de permisos (RF-03) e inactividad (P-07).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { reiniciar, crearUsuario, crearPaciente, avanzar, q, MIN } from './helpers.js';

const { crearApp } = await import('../src/app.js');
const { totp, verificarTotp, generarSecreto } = await import('../src/utils/totp.js');

let servidor, base;
before(async () => {
  servidor = crearApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
});
after(() => servidor.close());
beforeEach(() => reiniciar());

const pedir = async (metodo, ruta, { token, cuerpo } = {}) => {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, datos: await r.json().catch(() => null) };
};

async function sesion(usuario) {
  const r = await pedir('POST', '/auth/login', { cuerpo: { correo: usuario.correo, password: 'ContraseñaSegura1' } });
  if (r.datos.requiere2fa) {
    const r2 = await pedir('POST', '/auth/2fa', { cuerpo: { tokenTemporal: r.datos.tokenTemporal, codigo: totp(usuario.secreto) } });
    return r2.datos.token;
  }
  return r.datos.token;
}

test('TOTP (RFC 6238) verifica códigos válidos e inválidos', () => {
  const s = generarSecreto();
  assert.equal(verificarTotp(s, totp(s)), true);
  assert.equal(verificarTotp(s, '123456') && totp(s) !== '123456', false);
});

test('RF-02: 5 fallos consecutivos bloquean la cuenta y se auditan', async () => {
  const u = crearUsuario('RECEPCION');
  for (let i = 0; i < 5; i++) assert.equal((await pedir('POST', '/auth/login', { cuerpo: { correo: u.correo, password: 'incorrecta' } })).status, 401);
  const r = await pedir('POST', '/auth/login', { cuerpo: { correo: u.correo, password: 'ContraseñaSegura1' } });
  assert.equal(r.status, 423);
  assert.ok(q.get("SELECT id FROM auditoria WHERE accion = 'CUENTA_BLOQUEADA'"));
  assert.ok(q.get('SELECT password_hash FROM usuarios WHERE id = ?', u.id).password_hash.startsWith('$2'));
});

test('RN-01: el personal clínico sin código 2FA válido no accede', async () => {
  const m = crearUsuario('MEDICO');
  const r = await pedir('POST', '/auth/login', { cuerpo: { correo: m.correo, password: 'ContraseñaSegura1' } });
  assert.equal(r.datos.requiere2fa, true);
  assert.equal(r.datos.token, undefined);
  const r2 = await pedir('POST', '/auth/2fa', { cuerpo: { tokenTemporal: r.datos.tokenTemporal, codigo: '000000' } });
  assert.equal(r2.status, 401);
});

test('RN-01: la sesión se cierra tras P-07 de inactividad', async () => {
  const token = await sesion(crearUsuario('RECEPCION'));
  assert.equal((await pedir('GET', '/auth/yo', { token })).status, 200);
  avanzar(16 * MIN);
  const r = await pedir('GET', '/auth/yo', { token });
  assert.equal(r.status, 401);
  assert.equal(r.datos.codigo, 'INACTIVIDAD');
});

test('RF-03: matriz de permisos (muestra por rol) devuelve 403 y audita', async () => {
  const roles = ['PACIENTE', 'RECEPCION', 'MEDICO', 'ENFERMERO', 'SEGURIDAD', 'ADMINISTRADOR'];
  const tokens = {};
  for (const rol of roles) tokens[rol] = await sesion(rol === 'PACIENTE' ? crearPaciente() : crearUsuario(rol));
  const casos = [
    // [método, ruta, roles permitidos]
    ['GET', '/disponibilidad', ['PACIENTE', 'RECEPCION']],
    ['GET', '/auditoria', ['SEGURIDAD']],
    ['GET', '/admin/usuarios', ['ADMINISTRADOR']],
    ['GET', '/agenda/horarios', ['RECEPCION', 'ADMINISTRADOR']],
    ['GET', '/urgencias/cola', ['RECEPCION', 'MEDICO', 'ENFERMERO']],
  ];
  for (const [metodo, ruta, permitidos] of casos) {
    for (const rol of roles) {
      const r = await pedir(metodo, ruta, { token: tokens[rol] });
      if (permitidos.includes(rol)) assert.notEqual(r.status, 403, `${rol} ${ruta}`);
      else assert.equal(r.status, 403, `${rol} ${ruta}`);
    }
  }
  // Ningún rol que no sea clínico abre expedientes; el Administrador nunca ve datos clínicos
  for (const rol of ['PACIENTE', 'RECEPCION', 'SEGURIDAD', 'ADMINISTRADOR']) {
    assert.equal((await pedir('GET', '/clinico/expedientes/1', { token: tokens[rol] })).status, 403);
  }
  assert.ok(q.get("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'ACCESO_DENEGADO'").n >= 10);
});

test('RF-22: modificar o borrar auditoría se rechaza y queda auditado', async () => {
  const token = await sesion(crearUsuario('SEGURIDAD'));
  assert.equal((await pedir('DELETE', '/auditoria/1', { token })).status, 405);
  assert.ok(q.get("SELECT id FROM auditoria WHERE accion = 'INTENTO_ALTERAR_AUDITORIA'"));
});

test('RF-01: registro con código; CURP duplicada se rechaza; sin aviso de privacidad no se crea', async () => {
  const datos = { nombreCompleto: 'Ana Prueba', curp: 'MERS900725MJCNDL08', fechaNacimiento: '1990-07-25', correo: 'ana@test.mx', telefono: '5512345678', password: 'ContraseñaSegura1', aceptaAvisoPrivacidad: true };
  assert.equal((await pedir('POST', '/auth/registro/solicitar', { cuerpo: { ...datos, aceptaAvisoPrivacidad: false } })).status, 400);
  const s = await pedir('POST', '/auth/registro/solicitar', { cuerpo: datos });
  assert.equal(s.status, 201);
  assert.equal((await pedir('POST', '/auth/registro/verificar', { cuerpo: { verificacionId: s.datos.verificacionId, codigo: '999999' === s.datos.codigoDev ? '000000' : '999999' } })).status, 400);
  const v = await pedir('POST', '/auth/registro/verificar', { cuerpo: { verificacionId: s.datos.verificacionId, codigo: s.datos.codigoDev } });
  assert.equal(v.status, 201);
  assert.equal(q.get('SELECT COUNT(*) AS n FROM expedientes').n, 1);
  assert.equal((await pedir('POST', '/auth/registro/solicitar', { cuerpo: { ...datos, correo: 'otra@test.mx' } })).status, 409);
});

test('RNF-09: OpenAPI publicado', async () => {
  const r = await fetch(`${base}/openapi.json`);
  const doc = await r.json();
  assert.equal(doc.openapi, '3.0.3');
  assert.ok(Object.keys(doc.paths).length > 50);
});
