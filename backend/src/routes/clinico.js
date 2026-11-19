// Servicio Clínico (API): RF-13 a RF-15, RF-17 a RF-19, RF-23.
import { Router } from 'express';
import { autenticar, permitir } from '../middleware/auth.js';
import * as clinico from '../services/clinico.js';
import * as recetas from '../services/recetas.js';
import { relacionAsistencial } from '../services/acceso.js';
import { entero, requerir, prohibido } from '../utils/errores.js';
import { q } from '../db/database.js';

const r = Router();
r.use(autenticar);

const clinicos = permitir('MEDICO', 'ENFERMERO');
const medico = permitir('MEDICO');

// RF-13 / RNF-03
r.get('/expedientes/:pacienteId', clinicos, (req, res) => {
  res.json(clinico.abrirExpediente(req.usuario, entero(req.params.pacienteId, 'pacienteId')));
});

// RF-23
r.post('/expedientes/:pacienteId/emergencia', medico, (req, res) => {
  requerir(req.body, ['justificacion']);
  res.json(clinico.accesoEmergencia(req.usuario, entero(req.params.pacienteId, 'pacienteId'), req.body.justificacion));
});

r.put('/expedientes/:pacienteId/antecedentes', medico, (req, res) => {
  clinico.actualizarAntecedentes(req.usuario, entero(req.params.pacienteId, 'pacienteId'), req.body?.antecedentes);
  res.status(204).end();
});

// RF-15
r.post('/expedientes/:pacienteId/alergias', clinicos, (req, res) => {
  requerir(req.body, ['componenteId', 'severidad']);
  res.status(201).json(clinico.agregarAlergia(req.usuario, entero(req.params.pacienteId, 'pacienteId'), { componenteId: Number(req.body.componenteId), severidad: req.body.severidad }));
});

r.delete('/expedientes/:pacienteId/alergias/:alergiaId', clinicos, (req, res) => {
  res.json(clinico.bajaAlergia(req.usuario, entero(req.params.pacienteId, 'pacienteId'), entero(req.params.alergiaId, 'alergiaId')));
});

r.put('/expedientes/:pacienteId/sin-alergias', clinicos, (req, res) => {
  res.json(clinico.marcarSinAlergias(req.usuario, entero(req.params.pacienteId, 'pacienteId')));
});

/** ¿Tengo relación asistencial con este paciente? (para que la UI ofrezca el acceso de emergencia) */
r.get('/relacion/:pacienteId', clinicos, (req, res) => {
  const rel = relacionAsistencial(req.usuario, entero(req.params.pacienteId, 'pacienteId'));
  res.json({ permitido: rel.permitido, motivo: rel.motivo });
});

// RF-14
r.get('/citas/:citaId/consulta', clinicos, (req, res) => {
  res.json(clinico.obtenerConsulta(req.usuario, entero(req.params.citaId, 'citaId')));
});

r.put('/citas/:citaId/consulta', clinicos, (req, res) => {
  res.json(clinico.guardarConsulta(req.usuario, entero(req.params.citaId, 'citaId'), req.body || {}));
});

r.post('/citas/:citaId/consulta/finalizar', medico, (req, res) => {
  res.json(clinico.finalizarConsulta(req.usuario, entero(req.params.citaId, 'citaId')));
});

r.post('/consultas/:consultaId/addendum', medico, (req, res) => {
  requerir(req.body, ['texto']);
  res.status(201).json(clinico.agregarAddendum(req.usuario, entero(req.params.consultaId, 'consultaId'), req.body));
});

// RF-18 (validación previa) y RF-17 (emisión)
r.post('/consultas/:consultaId/recetas/validar', medico, (req, res) => {
  res.json(recetas.validarAlergiasReceta(req.usuario, entero(req.params.consultaId, 'consultaId'), req.body?.items));
});

r.post('/consultas/:consultaId/recetas', medico, async (req, res) => {
  res.status(201).json(await recetas.emitirReceta(req.usuario, entero(req.params.consultaId, 'consultaId'), req.body || {}));
});

/** Ver una receta: el paciente dueño, o personal clínico con relación asistencial. */
r.get('/recetas/:id', permitir('PACIENTE', 'MEDICO', 'ENFERMERO'), async (req, res) => {
  const id = entero(req.params.id, 'id');
  const base = q.get('SELECT r.paciente_id, p.usuario_id FROM recetas r JOIN pacientes p ON p.id = r.paciente_id WHERE r.id = ?', id);
  if (!base) return res.status(404).json({ error: 'Receta inexistente' });
  const u = req.usuario;
  const ok = u.rol === 'PACIENTE' ? base.usuario_id === u.id : relacionAsistencial(u, base.paciente_id).permitido;
  if (!ok) throw prohibido();
  res.json(await recetas.obtenerReceta(id));
});

// RN-06
r.post('/recetas/:id/anular', medico, async (req, res) => {
  requerir(req.body, ['motivo']);
  res.json(await recetas.anularReceta(req.usuario, entero(req.params.id, 'id'), req.body.motivo));
});

// RF-19 reintento manual
r.post('/recetas/:id/reservar', medico, async (req, res) => {
  res.json(await recetas.reintentarReserva(req.usuario, entero(req.params.id, 'id')));
});

export default r;
