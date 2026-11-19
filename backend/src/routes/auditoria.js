// RF-22: consulta y exportación de auditoría (solo lectura, rol Seguridad). RN-02: WORM.
import { Router } from 'express';
import { autenticar, permitir } from '../middleware/auth.js';
import { verificarCadena, desdeReqSiPuede } from '../services/auditoria.js';
import { q } from '../db/database.js';
import { entero, HttpError } from '../utils/errores.js';
import { ahoraIso } from '../utils/tiempo.js';

const r = Router();
r.use(autenticar);

function filtrar(query) {
  const cond = [];
  const params = [];
  if (query.usuarioId) { cond.push('a.usuario_id = ?'); params.push(Number(query.usuarioId)); }
  if (query.pacienteId) { cond.push('a.paciente_id = ?'); params.push(Number(query.pacienteId)); }
  if (query.accion) { cond.push('a.accion = ?'); params.push(String(query.accion)); }
  if (query.resultado) { cond.push('a.resultado = ?'); params.push(String(query.resultado)); }
  if (query.emergencia === 'true') cond.push('a.es_emergencia = 1');
  if (query.desde) { cond.push('a.fecha_utc >= ?'); params.push(new Date(query.desde).toISOString()); }
  if (query.hasta) { cond.push('a.fecha_utc <= ?'); params.push(new Date(query.hasta).toISOString()); }
  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}

const SELECT = `SELECT a.*, u.nombre_completo AS usuario_nombre, p.nombre_completo AS paciente_nombre
  FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id LEFT JOIN pacientes p ON p.id = a.paciente_id`;

r.get('/auditoria', permitir('SEGURIDAD'), (req, res) => {
  const { where, params } = filtrar(req.query);
  const limite = Math.min(Number(req.query.limite) || 100, 1000);
  const pagina = Math.max(Number(req.query.pagina) || 1, 1);
  const total = q.get(`SELECT COUNT(*) AS n FROM auditoria a ${where}`, ...params).n;
  const filas = q.all(`${SELECT} ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`, ...params, limite, (pagina - 1) * limite);
  desdeReqSiPuede(req, { accion: 'CONSULTA_AUDITORIA', recurso: 'auditoria', detalle: req.query });
  res.json({ total, pagina, limite, registros: filas });
});

r.get('/auditoria/acciones', permitir('SEGURIDAD'), (_req, res) => res.json(q.all('SELECT DISTINCT accion FROM auditoria ORDER BY accion').map((x) => x.accion)));

r.get('/auditoria/exportar', permitir('SEGURIDAD'), (req, res) => {
  const { where, params } = filtrar(req.query);
  const filas = q.all(`${SELECT} ${where} ORDER BY a.id`, ...params);
  const cols = ['id', 'fecha_utc', 'usuario_id', 'usuario_nombre', 'rol', 'accion', 'recurso', 'id_registro', 'paciente_id', 'resultado', 'es_emergencia', 'detalle', 'ip', 'hash_anterior', 'hash'];
  const esc = (v) => (v === null || v === undefined ? '' : `"${String(v).replace(/"/g, '""')}"`);
  const csv = [cols.join(','), ...filas.map((f) => cols.map((c) => esc(f[c])).join(','))].join('\n');
  desdeReqSiPuede(req, { accion: 'EXPORTAR_AUDITORIA', recurso: 'auditoria', detalle: { registros: filas.length, filtros: req.query } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="auditoria-${ahoraIso().slice(0, 10)}.csv"`);
  res.send('﻿' + csv);
});

r.get('/auditoria/verificar', permitir('SEGURIDAD'), (req, res) => {
  const resultado = verificarCadena();
  desdeReqSiPuede(req, { accion: 'VERIFICAR_CADENA_AUDITORIA', recurso: 'auditoria', resultado: resultado.integra ? 'EXITO' : 'ALTERADA' });
  res.json(resultado);
});

// Cualquier intento de modificar o borrar se rechaza y queda auditado (RF-22, RN-02)
const rechazar = (req, _res) => {
  desdeReqSiPuede(req, { accion: 'INTENTO_ALTERAR_AUDITORIA', recurso: 'auditoria', idRegistro: req.params.id, resultado: 'RECHAZADO', detalle: { metodo: req.method } });
  throw new HttpError(405, 'Los registros de auditoría son de solo lectura (WORM)');
};
r.put('/auditoria/:id', rechazar);
r.patch('/auditoria/:id', rechazar);
r.delete('/auditoria/:id', rechazar);

// Alertas de accesos de emergencia (RF-23)
r.get('/auditoria/alertas', permitir('SEGURIDAD'), (_req, res) => {
  res.json(q.all(
    `SELECT a.*, u.nombre_completo AS medico_nombre, p.nombre_completo AS paciente_nombre FROM accesos_emergencia a
     JOIN usuarios u ON u.id = a.medico_id JOIN pacientes p ON p.id = a.paciente_id ORDER BY a.id DESC LIMIT 200`));
});

r.post('/auditoria/alertas/:id/revisada', permitir('SEGURIDAD'), (req, res) => {
  const id = entero(req.params.id, 'id');
  q.run('UPDATE accesos_emergencia SET revisada = 1 WHERE id = ?', id);
  desdeReqSiPuede(req, { accion: 'ALERTA_EMERGENCIA_REVISADA', recurso: 'acceso_emergencia', idRegistro: id });
  res.status(204).end();
});

export default r;
