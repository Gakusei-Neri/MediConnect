// Servicio de Citas (API): RF-04 a RF-11.
import { Router } from 'express';
import { autenticar, permitir, denegar } from '../middleware/auth.js';
import * as citas from '../services/citas.js';
import * as listaEspera from '../services/listaEspera.js';
import { relacionAsistencial, pacienteDeUsuario } from '../services/acceso.js';
import { desdeReqSiPuede } from '../services/auditoria.js';
import { q } from '../db/database.js';
import { entero, malaSolicitud, noEncontrado, requerir } from '../utils/errores.js';
import { DIA } from '../config/parametros.js';

const r = Router();
r.use(autenticar);

/** Resuelve el paciente objetivo: el propio (Paciente) o el indicado (Recepción). */
function pacienteObjetivo(req, pacienteIdBody) {
  if (req.usuario.rol === 'PACIENTE') {
    const p = pacienteDeUsuario(req.usuario.id);
    if (!p) throw noEncontrado('Paciente inexistente');
    if (pacienteIdBody && Number(pacienteIdBody) !== p.id) throw denegar(req, 'cita', null, 'Paciente ajeno', Number(pacienteIdBody));
    return p.id;
  }
  if (!pacienteIdBody) throw malaSolicitud('Indique el paciente');
  return entero(pacienteIdBody, 'pacienteId');
}

/** Verifica que el usuario pueda operar sobre la cita (matriz de permisos). */
function citaAutorizada(req, citaId, { operar = false } = {}) {
  const cita = citas.obtenerCita(citaId);
  if (!cita) throw noEncontrado('Cita inexistente');
  const u = req.usuario;
  let ok = false;
  if (u.rol === 'PACIENTE') ok = cita.paciente_usuario_id === u.id;
  else if (u.rol === 'RECEPCION') ok = true;
  else if (!operar && ['MEDICO', 'ENFERMERO'].includes(u.rol)) ok = relacionAsistencial(u, cita.paciente_id).permitido;
  if (!ok) throw denegar(req, 'cita', citaId, 'Cita ajena o sin relación asistencial', cita.paciente_id);
  return cita;
}

// ---------- RF-04 ----------
r.get('/disponibilidad', permitir('PACIENTE', 'RECEPCION'), (req, res) => {
  const { especialidadId, sedeId, medicoId, fecha, modalidad } = req.query;
  if (modalidad && !['PRESENCIAL', 'VIRTUAL'].includes(modalidad)) throw malaSolicitud('Modalidad inválida');
  res.json(citas.buscarDisponibilidad({ especialidadId, sedeId, medicoId, fecha, modalidad }));
});

// ---------- Pacientes (datos administrativos) ----------
r.get('/pacientes', permitir('RECEPCION', 'MEDICO'), (req, res) => {
  const curp = String(req.query.curp || '').toUpperCase().trim();
  const nombre = String(req.query.nombre || '').trim();
  if (req.usuario.rol === 'MEDICO') {
    // Solo búsqueda exacta por CURP (para acceso de emergencia RF-23): id y nombre
    if (!curp) throw malaSolicitud('Indique la CURP');
    const p = q.get('SELECT id, nombre_completo, curp FROM pacientes WHERE curp = ?', curp);
    desdeReqSiPuede(req, { accion: 'BUSQUEDA_PACIENTE', recurso: 'paciente', idRegistro: p?.id, pacienteId: p?.id });
    return res.json(p ? [p] : []);
  }
  if (!curp && nombre.length < 3) throw malaSolicitud('Indique la CURP o al menos 3 letras del nombre');
  const filas = q.all(
    `SELECT p.id, p.nombre_completo, p.curp, p.fecha_nacimiento, u.correo, u.telefono FROM pacientes p LEFT JOIN usuarios u ON u.id = p.usuario_id
     WHERE (? != '' AND p.curp = ?) OR (? != '' AND p.nombre_completo LIKE ?) ORDER BY p.nombre_completo LIMIT 20`,
    curp, curp, nombre, `%${nombre}%`,
  );
  res.json(filas);
});

r.get('/pacientes/:id', permitir('RECEPCION', 'MEDICO', 'ENFERMERO'), (req, res) => {
  const id = entero(req.params.id, 'id');
  if (req.usuario.rol !== 'RECEPCION' && !relacionAsistencial(req.usuario, id).permitido) throw denegar(req, 'paciente', id, 'Sin relación asistencial', id);
  const p = q.get(
    'SELECT p.id, p.nombre_completo, p.curp, p.fecha_nacimiento, u.correo, u.telefono FROM pacientes p LEFT JOIN usuarios u ON u.id = p.usuario_id WHERE p.id = ?', id);
  if (!p) throw noEncontrado('Paciente inexistente');
  const proximas = citas.listarCitas({ pacienteId: id, soloActivas: true });
  res.json({ ...p, citasActivas: proximas });
});

// ---------- Citas ----------
r.get('/citas', permitir('PACIENTE', 'RECEPCION', 'MEDICO', 'ENFERMERO'), (req, res) => {
  const u = req.usuario;
  const { desde, hasta, estado, fecha } = req.query;
  let rango = {};
  if (fecha) {
    const ini = new Date(`${fecha}T00:00:00-06:00`);
    rango = { desde: ini.toISOString(), hasta: new Date(ini.getTime() + DIA).toISOString() };
  } else if (desde || hasta) {
    rango = { desde, hasta };
  }
  if (u.rol === 'PACIENTE') {
    const p = pacienteDeUsuario(u.id);
    return res.json(citas.listarCitas({ pacienteId: p.id, estado, ...rango, orden: 'desc' }));
  }
  if (u.rol === 'MEDICO') return res.json(citas.listarCitas({ medicoId: u.id, estado, ...rango }));
  if (u.rol === 'ENFERMERO') return res.json(citas.listarCitas({ sedeId: u.sede_id, estado, ...rango }));
  // Recepción: su sede por defecto
  const sedeId = req.query.sedeId ? Number(req.query.sedeId) : u.sede_id;
  const pacienteId = req.query.pacienteId ? Number(req.query.pacienteId) : undefined;
  res.json(citas.listarCitas({ sedeId: pacienteId ? undefined : sedeId, pacienteId, estado, ...rango }));
});

r.get('/citas/:id', permitir('PACIENTE', 'RECEPCION', 'MEDICO', 'ENFERMERO'), (req, res) => {
  const cita = citaAutorizada(req, entero(req.params.id, 'id'));
  const historial = q.all('SELECT de_estado, a_estado, evento, fecha FROM historial_estados_cita WHERE cita_id = ? ORDER BY id', cita.id);
  const enlace = q.get('SELECT valido_desde, valido_hasta, revocado FROM enlaces_video WHERE cita_id = ?', cita.id);
  res.json({ ...cita, historial, enlace });
});

// RF-05
r.post('/citas', permitir('PACIENTE', 'RECEPCION'), (req, res) => {
  requerir(req.body, ['cupoId']);
  const pacienteId = pacienteObjetivo(req, req.body.pacienteId);
  const inicio = Date.now();
  const comprobante = citas.agendar({ cupoId: entero(req.body.cupoId, 'cupoId'), pacienteId, actor: req.usuario });
  res.status(201).json({ ...comprobante, tiempoMs: Date.now() - inicio });
});

// RF-06
r.post('/citas/:id/reprogramar', permitir('PACIENTE', 'RECEPCION'), (req, res) => {
  requerir(req.body, ['cupoId']);
  const cita = citaAutorizada(req, entero(req.params.id, 'id'), { operar: true });
  res.json(citas.reprogramar({ citaId: cita.id, cupoId: entero(req.body.cupoId, 'cupoId'), actor: req.usuario }));
});

// RF-07
r.post('/citas/:id/cancelar', permitir('PACIENTE', 'RECEPCION'), (req, res) => {
  requerir(req.body, ['motivoId']);
  const cita = citaAutorizada(req, entero(req.params.id, 'id'), { operar: true });
  res.json(citas.cancelar({ citaId: cita.id, motivoId: entero(req.body.motivoId, 'motivoId'), actor: req.usuario }));
});

// RF-09
r.post('/citas/:id/confirmar', permitir('PACIENTE'), (req, res) => {
  const cita = citaAutorizada(req, entero(req.params.id, 'id'), { operar: true });
  res.json(citas.confirmar({ citaId: cita.id, actor: req.usuario }));
});

r.post('/citas/:id/check-in', permitir('RECEPCION'), (req, res) => {
  res.json(citas.checkIn({ citaId: entero(req.params.id, 'id'), actor: req.usuario }));
});

r.post('/citas/:id/llamar', permitir('MEDICO'), (req, res) => {
  res.json(citas.llamarPaciente({ citaId: entero(req.params.id, 'id'), actor: req.usuario }));
});

r.post('/citas/:id/derivar-urgencias', permitir('MEDICO'), (req, res) => {
  res.json(citas.derivarUrgencias({ citaId: entero(req.params.id, 'id'), actor: req.usuario }));
});

// ---------- RF-11: urgencias sin turno ----------
r.post('/urgencias', permitir('RECEPCION'), (req, res) => {
  requerir(req.body, ['pacienteId', 'motivo']);
  const sedeId = req.body.sedeId ? Number(req.body.sedeId) : req.usuario.sede_id;
  if (!sedeId) throw malaSolicitud('Indique la sede');
  res.status(201).json(citas.registrarUrgencia({
    pacienteId: entero(req.body.pacienteId, 'pacienteId'), sedeId, especialidadId: req.body.especialidadId || null,
    motivo: req.body.motivo, actor: req.usuario,
  }));
});

r.get('/urgencias/cola', permitir('RECEPCION', 'MEDICO', 'ENFERMERO'), (req, res) => {
  const sedeId = req.usuario.rol === 'RECEPCION' && req.query.sedeId ? Number(req.query.sedeId) : req.usuario.sede_id;
  if (!sedeId) throw malaSolicitud('El usuario no tiene sede asignada');
  res.json(citas.colaUrgencias(sedeId));
});

// ---------- RF-10: lista de espera ----------
r.get('/lista-espera', permitir('PACIENTE', 'RECEPCION'), (req, res) => {
  if (req.usuario.rol === 'PACIENTE') return res.json(listaEspera.listar({ pacienteId: pacienteDeUsuario(req.usuario.id).id }));
  res.json(listaEspera.listar({ sedeId: req.query.sedeId ? Number(req.query.sedeId) : req.usuario.sede_id }));
});

r.post('/lista-espera', permitir('PACIENTE', 'RECEPCION'), (req, res) => {
  requerir(req.body, ['especialidadId', 'sedeId', 'modalidad']);
  const pacienteId = pacienteObjetivo(req, req.body.pacienteId);
  res.status(201).json(listaEspera.inscribir({
    pacienteId, especialidadId: entero(req.body.especialidadId, 'especialidadId'), sedeId: entero(req.body.sedeId, 'sedeId'),
    modalidad: req.body.modalidad, medicoId: req.body.medicoId ? entero(req.body.medicoId, 'medicoId') : null, actor: req.usuario,
  }));
});

r.post('/lista-espera/:id/aceptar', permitir('PACIENTE'), (req, res) => {
  const p = pacienteDeUsuario(req.usuario.id);
  res.status(201).json(listaEspera.aceptarOferta({ inscripcionId: entero(req.params.id, 'id'), pacienteId: p.id, actor: req.usuario }));
});

r.post('/lista-espera/:id/rechazar', permitir('PACIENTE'), (req, res) => {
  const p = pacienteDeUsuario(req.usuario.id);
  listaEspera.rechazarOferta({ inscripcionId: entero(req.params.id, 'id'), pacienteId: p.id, actor: req.usuario });
  res.status(204).end();
});

r.delete('/lista-espera/:id', permitir('PACIENTE', 'RECEPCION'), (req, res) => {
  const pacienteId = req.usuario.rol === 'PACIENTE' ? pacienteDeUsuario(req.usuario.id).id : null;
  listaEspera.cancelarInscripcion({ inscripcionId: entero(req.params.id, 'id'), actor: req.usuario, pacienteId });
  res.status(204).end();
});

export default r;
