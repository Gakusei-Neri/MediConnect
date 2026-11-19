import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { reiniciar, crearUsuario, crearPaciente, crearCupo, q } from './helpers.js';

const citas = await import('../src/services/citas.js');
const clinico = await import('../src/services/clinico.js');
const recetas = await import('../src/services/recetas.js');
const auditoria = await import('../src/services/auditoria.js');
const { totp } = await import('../src/utils/totp.js');
const { descifrar } = await import('../src/utils/cifrado.js');

let medico, recepcion, paciente, citaId;

beforeEach(() => {
  reiniciar();
  auditoria.simularCaidaAuditoria(false);
  medico = crearUsuario('MEDICO');
  recepcion = crearUsuario('RECEPCION');
  paciente = crearPaciente();
  citaId = citas.agendar({ cupoId: crearCupo(medico.id, 5), pacienteId: paciente.pacienteId, actor: recepcion }).citaId;
  citas.checkIn({ citaId, actor: recepcion });
  citas.llamarPaciente({ citaId, actor: medico });
});

const item = (medicamentoId) => ({ medicamentoId, dosis: '1', frecuencia: 'c/8h', duracion: '3 días', cantidad: 1 });

test('RN-07: un médico sin cita ni urgencia con el paciente recibe 403 y se audita', () => {
  const otro = crearUsuario('MEDICO', { sedeId: 2 });
  assert.throws(() => clinico.abrirExpediente(otro, paciente.pacienteId), (e) => e.status === 403);
  assert.ok(q.get("SELECT id FROM auditoria WHERE accion = 'ACCESO_DENEGADO' AND usuario_id = ?", otro.id));
});

test('RN-02: con la auditoría caída la lectura normal se deniega; la de emergencia se permite y se encola', () => {
  auditoria.simularCaidaAuditoria(true);
  assert.throws(() => clinico.abrirExpediente(medico, paciente.pacienteId), (e) => e.status === 503);
  const otro = crearUsuario('MEDICO', { sedeId: 2 });
  const exp = clinico.accesoEmergencia(otro, paciente.pacienteId, 'Paciente inconsciente en urgencias');
  assert.equal(exp.esEmergencia, true);
  auditoria.simularCaidaAuditoria(false);
  assert.ok(auditoria.vaciarCola() >= 2);
  assert.ok(q.get("SELECT id FROM auditoria WHERE accion = 'ACCESO_EMERGENCIA' AND es_emergencia = 1"));
});

test('RF-23: sin justificación no se concede el acceso; con ella se alerta a Seguridad', () => {
  crearUsuario('SEGURIDAD');
  const otro = crearUsuario('MEDICO', { sedeId: 2 });
  assert.throws(() => clinico.accesoEmergencia(otro, paciente.pacienteId, ''), (e) => e.status === 400);
  clinico.accesoEmergencia(otro, paciente.pacienteId, 'Paro cardiorrespiratorio');
  assert.ok(q.get("SELECT id FROM notificaciones WHERE tipo = 'ALERTA_EMERGENCIA'"));
});

test('RN-02: los registros WORM no se pueden modificar y la alteración se detecta por la cadena de hashes', () => {
  clinico.abrirExpediente(medico, paciente.pacienteId);
  assert.throws(() => q.run("UPDATE auditoria SET accion = 'X' WHERE id = 1"), /WORM/);
  assert.throws(() => q.run('DELETE FROM auditoria WHERE id = 1'), /WORM/);
  assert.equal(auditoria.verificarCadena().integra, true);
  q.run('DROP TRIGGER tr_auditoria_no_update'); // simula un atacante con acceso directo
  q.run("UPDATE auditoria SET resultado = 'ALTERADO' WHERE id = 1");
  assert.equal(auditoria.verificarCadena().integra, false);
});

test('RNF-01: las notas clínicas se guardan cifradas en reposo', () => {
  clinico.obtenerConsulta(medico, citaId);
  clinico.guardarConsulta(medico, citaId, { motivo: 'Fiebre', notasEvolucion: 'Texto confidencial' });
  const fila = q.get('SELECT notas_evolucion_enc FROM consultas WHERE cita_id = ?', citaId);
  assert.ok(!fila.notas_evolucion_enc.includes('confidencial'));
  assert.equal(descifrar(fila.notas_evolucion_enc), 'Texto confidencial');
});

test('RF-14: no se finaliza sin motivo y diagnóstico; signo fuera de rango pide confirmación; firmada no se edita (RN-06)', () => {
  clinico.obtenerConsulta(medico, citaId);
  assert.throws(() => clinico.finalizarConsulta(medico, citaId), /motivo/);
  clinico.guardarConsulta(medico, citaId, { motivo: 'Fiebre' });
  assert.throws(() => clinico.finalizarConsulta(medico, citaId), /diagnóstico/);
  assert.throws(() => clinico.guardarConsulta(medico, citaId, { signosVitales: { temperatura: 43 } }), (e) => e.status === 422);
  clinico.guardarConsulta(medico, citaId, { signosVitales: { temperatura: 43 }, confirmarFueraDeRango: true, diagnosticos: [1] });
  const fin = clinico.finalizarConsulta(medico, citaId);
  assert.equal(fin.firmada, true);
  assert.equal(q.get('SELECT estado FROM citas WHERE id = ?', citaId).estado, 'FINALIZADA');
  assert.throws(() => clinico.guardarConsulta(medico, citaId, { notasEvolucion: 'cambio' }), /firmada/);
  assert.throws(() => q.run('UPDATE consultas SET notas_evolucion_enc = NULL WHERE cita_id = ?', citaId), /RN-06/);
});

test('RF-15: sin alergias registradas ni marca, no se emite receta', async () => {
  const consulta = clinico.obtenerConsulta(medico, citaId);
  await assert.rejects(recetas.emitirReceta(medico, consulta.id, { items: [item(3)], codigo2fa: totp(medico.secreto) }), (e) => e.extra?.codigo === 'ALERGIAS_SIN_REGISTRAR');
});

test('RF-18: alergia severa bloquea (sin folio); leve exige justificación; RF-17 exige 2FA', async () => {
  clinico.agregarAlergia(medico, paciente.pacienteId, { componenteId: 1, severidad: 'SEVERA' });
  clinico.agregarAlergia(medico, paciente.pacienteId, { componenteId: 2, severidad: 'LEVE' });
  const consulta = clinico.obtenerConsulta(medico, citaId);
  for (let i = 0; i < 20; i++) {
    await assert.rejects(recetas.emitirReceta(medico, consulta.id, { items: [item(1)], codigo2fa: totp(medico.secreto) }), (e) => e.extra?.codigo === 'ALERGIA_SEVERA');
  }
  assert.equal(q.get('SELECT COUNT(*) AS n FROM recetas').n, 0);
  await assert.rejects(recetas.emitirReceta(medico, consulta.id, { items: [item(2)], codigo2fa: totp(medico.secreto) }), (e) => e.extra?.codigo === 'REQUIERE_JUSTIFICACION');
  await assert.rejects(recetas.emitirReceta(medico, consulta.id, { items: [item(3)], codigo2fa: '000000' }), (e) => e.extra?.codigo === 'VERIFICACION_2FA');
  const r = await recetas.emitirReceta(medico, consulta.id, { items: [item(2)], codigo2fa: totp(medico.secreto), justificacionAlergia: 'Beneficio mayor que el riesgo; vigilancia' });
  assert.match(r.folio, /^RX-\d{8}-[A-Z2-7]{10}$/);
  assert.ok(r.qr.startsWith('data:image/png;base64,'));
});

test('RF-17: 0 folios duplicados en 10 000 folios generados', () => {
  const folios = new Set();
  for (let i = 0; i < 10_000; i++) folios.add(recetas.generarFolio());
  assert.equal(folios.size, 10_000);
});

test('RES-03: el contrato con la farmacia no lleva datos clínicos', async () => {
  q.run('UPDATE expedientes SET sin_alergias_conocidas = 1 WHERE id = ?', paciente.expedienteId);
  const consulta = clinico.obtenerConsulta(medico, citaId);
  const r = await recetas.emitirReceta(medico, consulta.id, { items: [item(3)], codigo2fa: totp(medico.secreto) });
  const { payloadReserva } = await import('../src/services/farmacia.js');
  const payload = payloadReserva(r.id);
  assert.deepEqual(Object.keys(payload).sort(), ['folio', 'items', 'vigenciaHasta']);
  assert.deepEqual(Object.keys(payload.items[0]).sort(), ['cantidad', 'codigoMedicamento']);
});

test('RN-09: una receta solo se surte una vez', async () => {
  q.run('UPDATE expedientes SET sin_alergias_conocidas = 1 WHERE id = ?', paciente.expedienteId);
  const consulta = clinico.obtenerConsulta(medico, citaId);
  const r = await recetas.emitirReceta(medico, consulta.id, { items: [item(3)], codigo2fa: totp(medico.secreto) });
  recetas.registrarSurtido({ folio: r.folio });
  assert.throws(() => recetas.registrarSurtido({ folio: r.folio }), /ya fue surtida/);
});
