import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { autenticar } from '../middleware/auth.js';
import { limitarIntentos } from '../middleware/seguridad.js';
import * as auth from '../services/autenticacion.js';
import { q } from '../db/database.js';
import { requerir } from '../utils/errores.js';
import { p } from '../config/parametros.js';

const r = Router();

// RF-01
r.post('/registro/solicitar', limitarIntentos(10), (req, res) => {
  res.status(201).json(auth.solicitarRegistro(req.body || {}));
});

r.post('/registro/verificar', limitarIntentos(20), (req, res) => {
  requerir(req.body, ['verificacionId', 'codigo']);
  res.status(201).json(auth.confirmarRegistro(req.body));
});

// RF-02
r.post('/login', limitarIntentos(30), (req, res) => {
  requerir(req.body, ['correo', 'password']);
  res.json(auth.login(req.body, req));
});

r.post('/2fa', limitarIntentos(30), (req, res) => {
  requerir(req.body, ['tokenTemporal', 'codigo']);
  res.json(auth.loginSegundoFactor(req.body, req));
});

r.post('/logout', autenticar, (req, res) => {
  auth.cerrarSesion(req.usuario);
  res.status(204).end();
});

r.get('/yo', autenticar, (req, res) => {
  const u = q.get('SELECT * FROM usuarios WHERE id = ?', req.usuario.id);
  res.json({ usuario: auth.datosPublicosUsuario(u), inactividadMin: p('P-07') });
});

/** Mantiene viva la sesión (la UI la llama ante actividad del usuario). */
r.post('/actividad', autenticar, (_req, res) => res.status(204).end());

r.put('/perfil', autenticar, (req, res) => {
  const { canalPreferido, telefono } = req.body || {};
  if (canalPreferido && ['CORREO', 'SMS'].includes(canalPreferido)) q.run('UPDATE usuarios SET canal_preferido = ? WHERE id = ?', canalPreferido, req.usuario.id);
  if (telefono && /^\+?\d{10,15}$/.test(telefono)) q.run('UPDATE usuarios SET telefono = ? WHERE id = ?', telefono, req.usuario.id);
  const u = q.get('SELECT * FROM usuarios WHERE id = ?', req.usuario.id);
  res.json(auth.datosPublicosUsuario(u));
});

r.put('/password', autenticar, (req, res) => {
  requerir(req.body, ['actual', 'nueva']);
  const u = q.get('SELECT * FROM usuarios WHERE id = ?', req.usuario.id);
  if (!bcrypt.compareSync(String(req.body.actual), u.password_hash)) return res.status(400).json({ error: 'La contraseña actual es incorrecta' });
  auth.validarPassword(req.body.nueva);
  q.run('UPDATE usuarios SET password_hash = ? WHERE id = ?', auth.hashPassword(req.body.nueva), u.id);
  res.status(204).end();
});

export default r;
