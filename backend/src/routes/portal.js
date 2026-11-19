// RF-16: portal del paciente + bandeja de notificaciones de cualquier usuario.
import { Router } from 'express';
import { autenticar, permitir } from '../middleware/auth.js';
import { pacienteDeUsuario } from '../services/acceso.js';
import { resumenPaciente } from '../services/clinico.js';
import { listarCitas } from '../services/citas.js';
import { obtenerReceta, recetasDePaciente } from '../services/recetas.js';
import { registrar } from '../services/auditoria.js';
import { q } from '../db/database.js';

const r = Router();
r.use(autenticar);

r.get('/portal/resumen', permitir('PACIENTE'), async (req, res) => {
  const p = pacienteDeUsuario(req.usuario.id);
  registrar({ usuarioId: req.usuario.id, rol: req.usuario.rol, accion: 'LECTURA_RESUMEN_PROPIO', recurso: 'expediente', pacienteId: p.id });
  const recetas = [];
  for (const { id } of recetasDePaciente(p.id)) recetas.push(await obtenerReceta(id));
  res.json({
    paciente: { id: p.id, nombre: p.nombre_completo, curp: p.curp, fechaNacimiento: p.fecha_nacimiento },
    citas: listarCitas({ pacienteId: p.id, orden: 'desc', limite: 100 }),
    recetas,
    ...resumenPaciente(p.id), // historial: fecha, médico y diagnósticos (sin notas internas)
  });
});

r.get('/notificaciones', (req, res) => {
  res.json(q.all(
    "SELECT id, tipo, canal, asunto, contenido, resultado, es_alterno, fecha_envio, leida FROM notificaciones WHERE usuario_id = ? AND resultado = 'ENVIADA' ORDER BY id DESC LIMIT 100",
    req.usuario.id,
  ));
});

r.post('/notificaciones/leidas', (req, res) => {
  q.run('UPDATE notificaciones SET leida = 1 WHERE usuario_id = ?', req.usuario.id);
  res.status(204).end();
});

export default r;
