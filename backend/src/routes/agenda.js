// RF-12: gestión de agenda médica (Recepción en su sede, Administrador en todas).
import { Router } from 'express';
import { autenticar, permitir } from '../middleware/auth.js';
import * as agenda from '../services/agenda.js';
import { entero, requerir } from '../utils/errores.js';
import { q } from '../db/database.js';
import { buscarDisponibilidad } from '../services/citas.js';

const r = Router();
r.use(autenticar, permitir('RECEPCION', 'ADMINISTRADOR'));

const sedeFiltro = (req) => (req.usuario.rol === 'RECEPCION' ? req.usuario.sede_id : (req.query.sedeId ? Number(req.query.sedeId) : undefined));

r.get('/horarios', (req, res) => {
  res.json(agenda.listarHorarios({ medicoId: req.query.medicoId ? Number(req.query.medicoId) : undefined, sedeId: sedeFiltro(req) }));
});

r.post('/horarios', (req, res) => {
  requerir(req.body, ['medicoId', 'sedeId', 'diaSemana', 'horaInicio', 'horaFin', 'modalidad']);
  res.status(201).json(agenda.crearHorario({ ...req.body, medicoId: entero(req.body.medicoId, 'medicoId'), sedeId: entero(req.body.sedeId, 'sedeId'), diaSemana: Number(req.body.diaSemana), actor: req.usuario }));
});

r.get('/horarios/:id/afectadas', (req, res) => res.json(agenda.previsualizarDesactivacion(entero(req.params.id, 'id'))));

/** Desactivar horario. Cuerpo: { resoluciones: [{ citaId, accion, cupoId?, motivoId? }] } */
r.post('/horarios/:id/desactivar', (req, res) => {
  res.json(agenda.desactivarHorario({ horarioId: entero(req.params.id, 'id'), resoluciones: req.body?.resoluciones, actor: req.usuario }));
});

r.get('/bloqueos', (req, res) => {
  res.json(agenda.listarBloqueos({ medicoId: req.query.medicoId ? Number(req.query.medicoId) : undefined, sedeId: sedeFiltro(req) }));
});

r.post('/bloqueos/previsualizar', (req, res) => {
  requerir(req.body, ['medicoId', 'desde', 'hasta']);
  res.json(agenda.previsualizarBloqueo({ medicoId: entero(req.body.medicoId, 'medicoId'), desde: req.body.desde, hasta: req.body.hasta }));
});

r.post('/bloqueos', (req, res) => {
  requerir(req.body, ['medicoId', 'desde', 'hasta', 'motivo']);
  res.status(201).json(agenda.crearBloqueo({ ...req.body, medicoId: entero(req.body.medicoId, 'medicoId'), actor: req.usuario }));
});

r.delete('/bloqueos/:id', (req, res) => {
  agenda.eliminarBloqueo({ bloqueoId: entero(req.params.id, 'id'), actor: req.usuario });
  res.status(204).end();
});

/** Cupos libres de una especialidad, para reprogramar citas afectadas por un cambio de agenda. */
r.get('/cupos-libres', (req, res) => {
  requerir(req.query, ['especialidadId']);
  res.json(buscarDisponibilidad({ especialidadId: Number(req.query.especialidadId), limite: 300 }));
});

/** Cupos de un médico (todos los estados) para visualizar la agenda. */
r.get('/cupos', (req, res) => {
  requerir(req.query, ['medicoId', 'desde', 'hasta']);
  res.json(q.all(
    `SELECT cu.*, c.id AS cita_id, c.estado AS cita_estado, pa.nombre_completo AS paciente_nombre
     FROM cupos cu LEFT JOIN citas c ON c.cupo_id = cu.id AND c.activa = 1 LEFT JOIN pacientes pa ON pa.id = c.paciente_id
     WHERE cu.medico_id = ? AND cu.inicio >= ? AND cu.inicio < ? AND cu.estado != 'ELIMINADO' ORDER BY cu.inicio`,
    Number(req.query.medicoId), req.query.desde, req.query.hasta));
});

export default r;
