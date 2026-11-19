// Carga de catálogos y datos de PRUEBA (sección 1.3): 2 sedes, 3 especialidades, 10 medicamentos,
// diagnósticos reducidos, usuarios de cada rol, horarios y algunas citas de demostración.
//   npm run seed          → crea la BD si no existe
//   npm run reset         → borra la BD y la vuelve a crear
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, '..');
const archivoEnv = path.join(raiz, '.env');

// 1) Asegura llaves persistentes en .env (RNF-01: fuera del código)
if (!fs.existsSync(archivoEnv)) {
  const ejemplo = fs.readFileSync(path.join(raiz, '.env.example'), 'utf8');
  const contenido = ejemplo
    .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${crypto.randomBytes(32).toString('hex')}`)
    .replace(/^DATA_KEY=.*$/m, `DATA_KEY=${crypto.randomBytes(32).toString('hex')}`);
  fs.writeFileSync(archivoEnv, contenido);
  console.log('Se creó backend/.env con llaves aleatorias.');
}

const { env } = await import('../src/config/env.js');
if (process.argv.includes('--reset')) {
  for (const sufijo of ['', '-wal', '-shm']) fs.rmSync(env.dbFile + sufijo, { force: true });
  fs.rmSync(env.colaAuditoriaFile, { force: true });
  console.log('Base de datos eliminada.');
}

const { abrir, q, transaccion } = await import('../src/db/database.js');
const { hashPassword } = await import('../src/services/autenticacion.js');
const { cifrar } = await import('../src/utils/cifrado.js');
const { registrar } = await import('../src/services/auditoria.js');
const { crearHorario } = await import('../src/services/agenda.js');
const { agendar } = await import('../src/services/citas.js');
const { ahora, ahoraIso } = await import('../src/utils/tiempo.js');

abrir();
if (q.get('SELECT COUNT(*) AS n FROM usuarios').n > 0) {
  console.log('La base ya tiene datos. Use `npm run reset` para reiniciarla.');
  process.exit(0);
}

export const PASSWORD_DEMO = 'MediConnect2026!';
// Secretos TOTP fijos SOLO para la demostración (escanee el otpauth o use `npm run totp -- <correo>`)
export const TOTP_DEMO = {
  'medico.general@mediconnect.test': 'JBSWY3DPEHPK3PXPJBSWY3DP',
  'medico.cardio@mediconnect.test': 'KRSXG5CTMVRXEZLUKRSXG5CT',
  'medico.pediatra@mediconnect.test': 'MFRGGZDFMZTWQ2LKMFRGGZDF',
  'enfermera.norte@mediconnect.test': 'GEZDGNBVGY3TQOJQGEZDGNBV',
  'enfermero.sur@mediconnect.test': 'NBSWY3DPO5XXE3DENBSWY3DP',
};

const t = ahoraIso();
const sistema = { id: null, rol: 'SISTEMA' };

transaccion(() => {
  // ---------- Catálogos ----------
  q.run("INSERT INTO sedes (id, nombre, tipo, direccion, es_prueba) VALUES (1, 'Hospital MediConnect Norte (PRUEBA)', 'HOSPITAL', 'Av. Universidad 1000, CDMX', 1)");
  q.run("INSERT INTO sedes (id, nombre, tipo, direccion, es_prueba) VALUES (2, 'Clínica MediConnect Sur (PRUEBA)', 'CLINICA', 'Calz. de Tlalpan 2500, CDMX', 1)");

  q.run("INSERT INTO especialidades (id, nombre, duracion_min, es_prueba) VALUES (1, 'Medicina General', 20, 1)");
  q.run("INSERT INTO especialidades (id, nombre, duracion_min, es_prueba) VALUES (2, 'Cardiología', 30, 1)");
  q.run("INSERT INTO especialidades (id, nombre, duracion_min, es_prueba) VALUES (3, 'Pediatría', NULL, 1)"); // usa P-15

  const componentes = ['Paracetamol', 'Ibuprofeno', 'Amoxicilina', 'Bencilpenicilina', 'Metformina', 'Losartán', 'Omeprazol', 'Salbutamol', 'Ácido acetilsalicílico', 'Naproxeno'];
  componentes.forEach((c, i) => q.run('INSERT INTO componentes_activos (id, nombre) VALUES (?, ?)', i + 1, c));
  const medicamentos = [
    ['MED-001', 'Paracetamol 500 mg', 'Caja con 20 tabletas', 1],
    ['MED-002', 'Ibuprofeno 400 mg', 'Caja con 20 tabletas', 2],
    ['MED-003', 'Amoxicilina 500 mg', 'Caja con 12 cápsulas', 3],
    ['MED-004', 'Penicilina G benzatínica 1 200 000 UI', 'Frasco ámpula', 4],
    ['MED-005', 'Metformina 850 mg', 'Caja con 30 tabletas', 5],
    ['MED-006', 'Losartán 50 mg', 'Caja con 30 tabletas', 6],
    ['MED-007', 'Omeprazol 20 mg', 'Caja con 14 cápsulas', 7],
    ['MED-008', 'Salbutamol 100 mcg', 'Inhalador 200 dosis', 8],
    ['MED-009', 'Ácido acetilsalicílico 100 mg', 'Caja con 30 tabletas', 9],
    ['MED-010', 'Naproxeno 250 mg (sin stock en simulador)', 'Caja con 30 tabletas', 10],
  ];
  medicamentos.forEach((m, i) => q.run('INSERT INTO medicamentos (id, codigo, nombre, presentacion, componente_id) VALUES (?,?,?,?,?)', i + 1, ...m));

  const diagnosticos = [
    ['BA00', 'Hipertensión esencial'], ['5A11', 'Diabetes mellitus tipo 2'], ['CA40', 'Neumonía'], ['CA23', 'Asma'],
    ['CA02', 'Faringitis aguda'], ['8A80', 'Migraña'], ['DA60', 'Úlcera gástrica'], ['GC08', 'Infección de vías urinarias'],
    ['MD12', 'Tos'], ['6A70', 'Episodio depresivo único'], ['FA20', 'Artritis reumatoide'], ['QA00', 'Examen médico general'],
  ];
  for (const [c, d] of diagnosticos) q.run("INSERT INTO diagnosticos_cat (codigo, descripcion, version) VALUES (?, ?, 'CIE-11 (prueba)')", c, d);

  for (const m of ['Ya no necesito la consulta', 'Conflicto de horario', 'Me siento mejor', 'Problema de transporte', 'Cambio de médico o sede', 'Otro']) {
    q.run('INSERT INTO motivos_cancelacion (descripcion) VALUES (?)', m);
  }
  q.run("INSERT INTO motivos_cancelacion (descripcion) VALUES ('Cambio en la agenda del médico')");

  const rangos = [
    ['peso', 'ADULTO', 25, 300, 'kg'], ['peso', 'NINO', 1, 150, 'kg'],
    ['talla', 'ADULTO', 120, 230, 'cm'], ['talla', 'NINO', 40, 200, 'cm'],
    ['presionSistolica', 'ADULTO', 80, 190, 'mmHg'], ['presionSistolica', 'NINO', 60, 150, 'mmHg'],
    ['presionDiastolica', 'ADULTO', 50, 120, 'mmHg'], ['presionDiastolica', 'NINO', 35, 95, 'mmHg'],
    ['frecuenciaCardiaca', 'ADULTO', 45, 130, 'lpm'], ['frecuenciaCardiaca', 'NINO', 60, 180, 'lpm'],
    ['frecuenciaRespiratoria', 'ADULTO', 10, 30, 'rpm'], ['frecuenciaRespiratoria', 'NINO', 15, 50, 'rpm'],
    ['temperatura', 'ADULTO', 35, 40, '°C'], ['temperatura', 'NINO', 35, 40.5, '°C'],
    ['saturacionOxigeno', 'ADULTO', 88, 100, '%'], ['saturacionOxigeno', 'NINO', 90, 100, '%'],
  ];
  for (const r of rangos) q.run('INSERT INTO rangos_fisiologicos VALUES (?,?,?,?,?)', ...r);

  // ---------- Usuarios ----------
  const pw = hashPassword(PASSWORD_DEMO);
  const usuario = (nombre, correo, rol, extra = {}) => {
    const r = q.run(
      `INSERT INTO usuarios (nombre_completo, correo, telefono, password_hash, rol, canal_preferido, sede_id, especialidad_id, cedula_profesional, totp_secret_enc, creado_en)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      nombre, correo, extra.telefono ?? '5550000000', pw, rol, extra.canal ?? 'CORREO', extra.sede ?? null, extra.especialidad ?? null,
      extra.cedula ?? null, TOTP_DEMO[correo] ? cifrar(TOTP_DEMO[correo]) : null, t,
    );
    return Number(r.lastInsertRowid);
  };
  usuario('Admin del Sistema', 'admin@mediconnect.test', 'ADMINISTRADOR');
  usuario('Ing. Mónica Valdés', 'seguridad@mediconnect.test', 'SEGURIDAD');
  usuario('Carlos Mendoza', 'recepcion.norte@mediconnect.test', 'RECEPCION', { sede: 1 });
  usuario('Laura Ortiz', 'recepcion.sur@mediconnect.test', 'RECEPCION', { sede: 2 });
  const medGeneral = usuario('Dr. Andrés Ríos', 'medico.general@mediconnect.test', 'MEDICO', { sede: 1, especialidad: 1, cedula: '12345678' });
  const medCardio = usuario('Dra. Elena Ruiz', 'medico.cardio@mediconnect.test', 'MEDICO', { sede: 1, especialidad: 2, cedula: '23456789' });
  const medPedia = usuario('Dra. Sofía Navarro', 'medico.pediatra@mediconnect.test', 'MEDICO', { sede: 2, especialidad: 3, cedula: '34567890' });
  usuario('Enf. Patricia León', 'enfermera.norte@mediconnect.test', 'ENFERMERO', { sede: 1, cedula: '45678901' });
  usuario('Enf. Jorge Salas', 'enfermero.sur@mediconnect.test', 'ENFERMERO', { sede: 2, cedula: '56789012' });

  const paciente = (nombre, correo, curp, nacimiento, telefono, canal = 'CORREO') => {
    const uid = usuario(nombre, correo, 'PACIENTE', { telefono, canal });
    const pid = Number(q.run('INSERT INTO pacientes (usuario_id, curp, nombre_completo, fecha_nacimiento, acepto_aviso_privacidad, fecha_aviso) VALUES (?,?,?,?,1,?)', uid, curp, nombre, nacimiento, t).lastInsertRowid);
    const eid = Number(q.run('INSERT INTO expedientes (paciente_id, fecha_creacion) VALUES (?,?)', pid, t).lastInsertRowid);
    return { uid, pid, eid };
  };
  const p1 = paciente('Juan Gómez López', 'juan.gomez@correo.test', 'GOLA850312HDFRPN05', '1985-03-12', '5511111111');
  const p2 = paciente('María Méndez Rosas', 'maria.mendez@correo.test', 'MERS900725MJCNDL08', '1990-07-25', '5522222222', 'SMS');
  paciente('José Pérez Hernández', 'jose.perez@correo.test', 'PEHJ010101HNLRRN03', '2001-01-01', '5533333333');

  // Alergias: Juan → amoxicilina SEVERA e ibuprofeno LEVE; María → sin alergias conocidas; José → sin registrar
  q.run("INSERT INTO alergias (expediente_id, componente_id, severidad, fecha_registro, registrada_por) VALUES (?, 3, 'SEVERA', ?, ?)", p1.eid, t, medGeneral);
  q.run("INSERT INTO alergias (expediente_id, componente_id, severidad, fecha_registro, registrada_por) VALUES (?, 2, 'LEVE', ?, ?)", p1.eid, t, medGeneral);
  q.run('UPDATE expedientes SET sin_alergias_conocidas = 1, sin_alergias_fecha = ?, sin_alergias_usuario_id = ? WHERE id = ?', t, medCardio, p2.eid);
  q.run('UPDATE expedientes SET antecedentes_enc = ? WHERE id = ?', cifrar('Hipertensión diagnosticada en 2019. Apendicectomía en 2005.'), p1.eid);

  registrar({ ...sistema, accion: 'SEED_DATOS_PRUEBA', recurso: 'sistema', detalle: 'Carga inicial de datos de prueba' });

  // ---------- Horarios (lunes a sábado) ----------
  const admin = { id: 1, rol: 'ADMINISTRADOR' };
  for (let dia = 1; dia <= 6; dia++) {
    crearHorario({ medicoId: medGeneral, sedeId: 1, diaSemana: dia, horaInicio: '08:00', horaFin: '14:00', modalidad: 'PRESENCIAL', actor: admin });
    crearHorario({ medicoId: medGeneral, sedeId: 1, diaSemana: dia, horaInicio: '16:00', horaFin: '19:00', modalidad: 'VIRTUAL', actor: admin });
    crearHorario({ medicoId: medCardio, sedeId: 1, diaSemana: dia, horaInicio: '09:00', horaFin: '13:00', modalidad: 'PRESENCIAL', actor: admin });
    crearHorario({ medicoId: medCardio, sedeId: 1, diaSemana: dia, horaInicio: '15:00', horaFin: '18:00', modalidad: 'VIRTUAL', actor: admin });
    crearHorario({ medicoId: medPedia, sedeId: 2, diaSemana: dia, horaInicio: '08:00', horaFin: '15:00', modalidad: 'PRESENCIAL', actor: admin });
  }

  // ---------- Citas de demostración "en vivo" (cupos ad hoc cercanos a la hora actual) ----------
  const ahoraMs = ahora().getTime();
  const redondeo = Math.ceil(ahoraMs / (5 * 60_000)) * 5 * 60_000;
  const cupoDemo = (medico, sede, esp, minutos, modalidad, duracion = 20) => {
    const inicio = new Date(redondeo + minutos * 60_000);
    const r = q.run("INSERT OR IGNORE INTO cupos (medico_id, sede_id, especialidad_id, inicio, fin, modalidad, estado) VALUES (?,?,?,?,?,?, 'LIBRE')",
      medico, sede, esp, inicio.toISOString(), new Date(inicio.getTime() + duracion * 60_000).toISOString(), modalidad);
    return Number(r.lastInsertRowid) || q.get('SELECT id FROM cupos WHERE medico_id = ? AND inicio = ?', medico, inicio.toISOString()).id;
  };
  const recepcion = { id: 3, rol: 'RECEPCION', sede_id: 1 };
  // Juan: presencial con el Dr. Ríos en ~10 min (Confirmada: lista para check-in y consulta)
  agendar({ cupoId: cupoDemo(medGeneral, 1, 1, 10, 'PRESENCIAL'), pacienteId: p1.pid, actor: recepcion });
  // María: videoconsulta con la Dra. Ruiz en ~10 min (Confirmada, con enlace)
  agendar({ cupoId: cupoDemo(medCardio, 1, 2, 10, 'VIRTUAL', 30), pacienteId: p2.pid, actor: { id: p2.uid, rol: 'PACIENTE' } });
  // Juan: cita en 3 días (Agendada) para probar reprogramar/cancelar
  agendar({ cupoId: cupoDemo(medCardio, 1, 2, 3 * 24 * 60, 'PRESENCIAL', 30), pacienteId: p1.pid, actor: { id: p1.uid, rol: 'PACIENTE' } });
});

console.log(`
Datos de PRUEBA cargados en ${env.dbFile}
Contraseña de todos los usuarios demo: ${PASSWORD_DEMO}
  admin@mediconnect.test            ADMINISTRADOR
  seguridad@mediconnect.test        SEGURIDAD
  recepcion.norte@mediconnect.test  RECEPCION (Hospital Norte)
  recepcion.sur@mediconnect.test    RECEPCION (Clínica Sur)
  medico.general@mediconnect.test   MEDICO  (2FA)  Medicina General
  medico.cardio@mediconnect.test    MEDICO  (2FA)  Cardiología
  medico.pediatra@mediconnect.test  MEDICO  (2FA)  Pediatría
  enfermera.norte@mediconnect.test  ENFERMERO (2FA)
  enfermero.sur@mediconnect.test    ENFERMERO (2FA)
  juan.gomez@correo.test            PACIENTE (alergia SEVERA a amoxicilina, LEVE a ibuprofeno)
  maria.mendez@correo.test          PACIENTE (sin alergias conocidas)
  jose.perez@correo.test            PACIENTE (alergias sin registrar)
Código 2FA actual:  npm run totp -- medico.general@mediconnect.test
`);
