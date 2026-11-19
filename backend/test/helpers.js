// Entorno de prueba aislado: BD en memoria, parámetros en archivo temporal y reloj controlable.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediconnect-test-'));
fs.copyFileSync(new URL('../src/config/parametros.json', import.meta.url), path.join(dir, 'parametros.json'));
process.env.NODE_ENV = 'test';
process.env.DB_FILE = ':memory:';
process.env.PARAMETROS_FILE = path.join(dir, 'parametros.json');
process.env.COLA_AUDITORIA_FILE = path.join(dir, 'cola.jsonl');
process.env.JWT_SECRET = crypto.randomBytes(16).toString('hex');
process.env.DATA_KEY = crypto.randomBytes(32).toString('hex');
process.env.FARMACIA_URL = 'http://127.0.0.1:1'; // farmacia inalcanzable por defecto

const db = await import('../src/db/database.js');
const { hashPassword } = await import('../src/services/autenticacion.js');
const { cifrar } = await import('../src/utils/cifrado.js');
const { generarSecreto } = await import('../src/utils/totp.js');
const tiempo = await import('../src/utils/tiempo.js');

export const { q } = db;
export const MIN = 60_000;
export const HORA = 60 * MIN;

let n = 0;
export function reiniciar() {
  db.cerrar();
  db.abrir(':memory:');
  tiempo._fijarDesfase(0);
  q.run("INSERT INTO sedes (id, nombre, tipo, direccion) VALUES (1, 'Sede A', 'HOSPITAL', 'x'), (2, 'Sede B', 'CLINICA', 'y')");
  q.run("INSERT INTO especialidades (id, nombre, duracion_min) VALUES (1, 'General', 30)");
  q.run("INSERT INTO componentes_activos (id, nombre) VALUES (1, 'Amoxicilina'), (2, 'Ibuprofeno'), (3, 'Paracetamol')");
  q.run("INSERT INTO medicamentos (id, codigo, nombre, presentacion, componente_id) VALUES (1,'MED-1','Amoxicilina','c',1),(2,'MED-2','Ibuprofeno','c',2),(3,'MED-3','Paracetamol','c',3)");
  q.run("INSERT INTO diagnosticos_cat (id, codigo, descripcion) VALUES (1, 'CA02', 'Faringitis')");
  q.run("INSERT INTO motivos_cancelacion (id, descripcion) VALUES (1, 'Otro')");
  q.run("INSERT INTO rangos_fisiologicos VALUES ('temperatura','ADULTO',35,40,'°C')");
}

export function crearUsuario(rol, extra = {}) {
  n++;
  const secreto = ['MEDICO', 'ENFERMERO'].includes(rol) ? generarSecreto() : null;
  const r = q.run(
    `INSERT INTO usuarios (nombre_completo, correo, telefono, password_hash, rol, sede_id, especialidad_id, totp_secret_enc, creado_en)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    `${rol} ${n}`, `u${n}@test.mx`, '5550000000', hashPassword('ContraseñaSegura1'), rol, extra.sedeId ?? (rol === 'PACIENTE' ? null : 1),
    rol === 'MEDICO' ? 1 : null, secreto ? cifrar(secreto) : null, new Date().toISOString(),
  );
  const id = Number(r.lastInsertRowid);
  return { id, rol, sede_id: extra.sedeId ?? (rol === 'PACIENTE' ? null : 1), correo: `u${n}@test.mx`, secreto };
}

export function crearPaciente() {
  const u = crearUsuario('PACIENTE');
  const curp = `GOLA85031${n % 10}HDFRPN0${n % 10}`;
  const pid = Number(q.run('INSERT INTO pacientes (usuario_id, curp, nombre_completo, fecha_nacimiento, acepto_aviso_privacidad, fecha_aviso) VALUES (?,?,?,?,1,?)',
    u.id, curp + n, `Paciente ${n}`, '1985-03-12', new Date().toISOString()).lastInsertRowid);
  const eid = Number(q.run('INSERT INTO expedientes (paciente_id, fecha_creacion) VALUES (?,?)', pid, new Date().toISOString()).lastInsertRowid);
  return { ...u, pacienteId: pid, expedienteId: eid };
}

/** Cupo a `minutos` de ahora (relativo al reloj real + desfase). */
export function crearCupo(medicoId, minutos, { modalidad = 'PRESENCIAL', sedeId = 1, duracion = 30 } = {}) {
  const inicio = new Date(tiempo.ahora().getTime() + minutos * MIN);
  const r = q.run("INSERT INTO cupos (medico_id, sede_id, especialidad_id, inicio, fin, modalidad, estado) VALUES (?,?,1,?,?,?, 'LIBRE')",
    medicoId, sedeId, inicio.toISOString(), new Date(inicio.getTime() + duracion * MIN).toISOString(), modalidad);
  return Number(r.lastInsertRowid);
}

export const avanzar = (ms) => tiempo._fijarDesfase(ms);
