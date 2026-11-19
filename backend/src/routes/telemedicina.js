// Servicio de Telemedicina (API): RF-20, RF-21. La señalización WebRTC va por WebSocket (ws/senalizacion.js).
import { Router } from 'express';
import { autenticar, permitir } from '../middleware/auth.js';
import * as tele from '../services/telemedicina.js';
import { transicionar } from '../services/estadosCita.js';
import { desdeReq } from '../services/auditoria.js';
import { transaccion, q } from '../db/database.js';
import { conflicto, entero, prohibido } from '../utils/errores.js';
import { env } from '../config/env.js';

const r = Router();
r.use(autenticar, permitir('PACIENTE', 'MEDICO'));

/** Enlace de una cita (solo para su paciente o su médico). */
r.get('/citas/:id/enlace', (req, res) => {
  const id = entero(req.params.id, 'id');
  const c = q.get('SELECT c.*, p.usuario_id FROM citas c JOIN pacientes p ON p.id = c.paciente_id WHERE c.id = ?', id);
  if (!c || (req.usuario.rol === 'PACIENTE' ? c.usuario_id !== req.usuario.id : c.medico_id !== req.usuario.id)) throw prohibido();
  const e = q.get('SELECT token, valido_desde, valido_hasta, revocado FROM enlaces_video WHERE cita_id = ?', id);
  if (!e || e.revocado) throw conflicto('La cita no tiene un enlace vigente (se genera al quedar Confirmada)');
  res.json({ url: `${env.urlPortal}/videoconsulta/${e.token}`, token: e.token, validoDesde: e.valido_desde, validoHasta: e.valido_hasta });
});

/** Entrar a la sala. Paciente: Confirmada → TelemedicinaConectada. */
r.post('/sala/:token/ingresar', (req, res) => {
  const { cita, participante } = tele.validarEnlace(req.params.token, req.usuario);
  if (participante === 'PACIENTE' && cita.estado === 'CONFIRMADA') {
    transaccion(() => transicionar(cita.id, 'TELEMEDICINA_CONECTADA', 'INGRESAR_VIDEO', { usuarioId: req.usuario.id, rol: req.usuario.rol }));
  }
  desdeReq(req, { accion: 'SALA_VIDEO_INGRESO', recurso: 'cita', idRegistro: cita.id, pacienteId: cita.paciente_id, detalle: { participante } });
  const actual = q.get('SELECT estado FROM citas WHERE id = ?', cita.id);
  res.json({
    citaId: cita.id, pacienteId: cita.paciente_id, participante, estado: actual.estado,
    paciente: cita.paciente_nombre, medico: cita.medico_nombre, fechaHora: cita.fecha_hora,
    iceServers: tele.iceServers(),
  });
});

/** El médico inicia la videollamada: TelemedicinaConectada → EnConsulta. */
r.post('/sala/:token/iniciar', permitir('MEDICO'), (req, res) => {
  const { cita } = tele.validarEnlace(req.params.token, req.usuario);
  transaccion(() => {
    transicionar(cita.id, 'EN_CONSULTA', 'INICIAR_VIDEO', { usuarioId: req.usuario.id, rol: req.usuario.rol });
    desdeReq(req, { accion: 'VIDEOCONSULTA_INICIADA', recurso: 'cita', idRegistro: cita.id, pacienteId: cita.paciente_id });
  });
  res.json({ citaId: cita.id, estado: 'EN_CONSULTA' });
});

export default r;
