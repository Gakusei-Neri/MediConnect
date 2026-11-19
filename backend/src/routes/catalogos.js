// Catálogos de solo lectura (1.3). Las altas y cambios están en /api/admin (Administrador).
import { Router } from 'express';
import { q } from '../db/database.js';
import { autenticar } from '../middleware/auth.js';
import { p } from '../config/parametros.js';

const r = Router();

// Sedes y especialidades son públicas (se usan en el registro y la búsqueda)
r.get('/sedes', (_req, res) => res.json(q.all('SELECT * FROM sedes ORDER BY nombre')));
r.get('/especialidades', (_req, res) =>
  res.json(q.all('SELECT id, nombre, COALESCE(duracion_min, ?) AS duracion_min, es_prueba FROM especialidades ORDER BY nombre', p('P-15'))));

r.use(autenticar);

r.get('/medicos', (req, res) => {
  const cond = ["u.rol = 'MEDICO'", 'u.activo = 1'];
  const params = [];
  if (req.query.especialidadId) { cond.push('u.especialidad_id = ?'); params.push(Number(req.query.especialidadId)); }
  if (req.query.sedeId) { cond.push('u.id IN (SELECT medico_id FROM horarios WHERE sede_id = ? AND activo = 1)'); params.push(Number(req.query.sedeId)); }
  res.json(q.all(
    `SELECT u.id, u.nombre_completo, u.especialidad_id, e.nombre AS especialidad_nombre, u.sede_id
     FROM usuarios u LEFT JOIN especialidades e ON e.id = u.especialidad_id WHERE ${cond.join(' AND ')} ORDER BY u.nombre_completo`, ...params));
});

r.get('/medicamentos', (_req, res) =>
  res.json(q.all('SELECT m.*, c.nombre AS componente FROM medicamentos m JOIN componentes_activos c ON c.id = m.componente_id ORDER BY m.nombre')));
r.get('/componentes', (_req, res) => res.json(q.all('SELECT * FROM componentes_activos ORDER BY nombre')));
r.get('/diagnosticos', (req, res) => {
  const t = `%${String(req.query.q || '').trim()}%`;
  res.json(q.all('SELECT * FROM diagnosticos_cat WHERE codigo LIKE ? OR descripcion LIKE ? ORDER BY codigo LIMIT 50', t, t));
});
r.get('/motivos-cancelacion', (_req, res) => res.json(q.all('SELECT * FROM motivos_cancelacion WHERE activo = 1 ORDER BY id')));
r.get('/rangos-fisiologicos', (_req, res) => res.json(q.all('SELECT * FROM rangos_fisiologicos ORDER BY signo, grupo_edad')));

export default r;
