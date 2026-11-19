import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { reiniciar, crearUsuario, crearPaciente, crearCupo, q, avanzar, MIN, HORA } from './helpers.js';

const citas = await import('../src/services/citas.js');
const estados = await import('../src/services/estadosCita.js');
const planificador = await import('../src/services/planificador.js');
const listaEspera = await import('../src/services/listaEspera.js');
const agenda = await import('../src/services/agenda.js');

let medico, recepcion;
beforeEach(() => {
  reiniciar();
  medico = crearUsuario('MEDICO');
  recepcion = crearUsuario('RECEPCION');
});

test('RN-05: cita con 24 h o más nace Agendada; con menos nace Confirmada', () => {
  const p = crearPaciente();
  const a = citas.agendar({ cupoId: crearCupo(medico.id, 48 * 60), pacienteId: p.pacienteId, actor: recepcion });
  const b = citas.agendar({ cupoId: crearCupo(medico.id, 10 * 60), pacienteId: crearPaciente().pacienteId, actor: recepcion });
  assert.equal(a.estado, 'AGENDADA');
  assert.equal(b.estado, 'CONFIRMADA');
});

test('RN-04 / RF-05: dos solicitudes por el mismo cupo producen una sola cita', () => {
  const cupo = crearCupo(medico.id, 72 * 60);
  const p1 = crearPaciente();
  const p2 = crearPaciente();
  citas.agendar({ cupoId: cupo, pacienteId: p1.pacienteId, actor: recepcion });
  assert.throws(() => citas.agendar({ cupoId: cupo, pacienteId: p2.pacienteId, actor: recepcion }), (e) => e.status === 409 && /no disponible/.test(e.message));
  assert.equal(q.get('SELECT COUNT(*) AS n FROM citas WHERE cupo_id = ?', cupo).n, 1);
});

test('RN-04: un paciente no puede tener dos citas activas traslapadas', () => {
  const otroMedico = crearUsuario('MEDICO');
  const p = crearPaciente();
  citas.agendar({ cupoId: crearCupo(medico.id, 72 * 60), pacienteId: p.pacienteId, actor: recepcion });
  assert.throws(() => citas.agendar({ cupoId: crearCupo(otroMedico.id, 72 * 60 + 10), pacienteId: p.pacienteId, actor: recepcion }), /traslapa/);
});

test('RF-04: la disponibilidad no muestra cupos ocupados ni pasados', () => {
  const p = crearPaciente();
  const ocupado = crearCupo(medico.id, 30 * 60);
  crearCupo(medico.id, 31 * 60);
  q.run("INSERT INTO cupos (medico_id, sede_id, especialidad_id, inicio, fin, modalidad) VALUES (?, 1, 1, '2000-01-01T00:00:00Z', '2000-01-01T00:30:00Z', 'PRESENCIAL')", medico.id);
  citas.agendar({ cupoId: ocupado, pacienteId: p.pacienteId, actor: recepcion });
  const lista = citas.buscarDisponibilidad({ especialidadId: 1 });
  assert.equal(lista.length, 1);
  assert.ok(lista.every((c) => new Date(c.inicio) > new Date()));
});

test('RN-05: límites de cancelación (2 h 01 min permite, 1 h 59 min rechaza)', () => {
  const p = crearPaciente();
  const c1 = citas.agendar({ cupoId: crearCupo(medico.id, 121), pacienteId: p.pacienteId, actor: recepcion });
  const c2 = citas.agendar({ cupoId: crearCupo(medico.id, 119), pacienteId: crearPaciente().pacienteId, actor: recepcion });
  assert.equal(citas.cancelar({ citaId: c1.citaId, motivoId: 1, actor: recepcion }).estado, 'CANCELADA_POR_USUARIO');
  assert.throws(() => citas.cancelar({ citaId: c2.citaId, motivoId: 1, actor: recepcion }), /anticipación/);
});

test('RF-07: cancelar libera el cupo y vuelve a aparecer en la disponibilidad', () => {
  const p = crearPaciente();
  const cupo = crearCupo(medico.id, 50 * 60);
  const c = citas.agendar({ cupoId: cupo, pacienteId: p.pacienteId, actor: recepcion });
  assert.equal(citas.buscarDisponibilidad({}).length, 0);
  citas.cancelar({ citaId: c.citaId, motivoId: 1, actor: recepcion });
  assert.deepEqual(citas.buscarDisponibilidad({}).map((x) => x.id), [cupo]);
});

test('RF-06 / RN-05: la tercera reprogramación se rechaza; si el cupo nuevo no está libre, la cita queda intacta', () => {
  const p = crearPaciente();
  const c = citas.agendar({ cupoId: crearCupo(medico.id, 72 * 60), pacienteId: p.pacienteId, actor: recepcion });
  citas.reprogramar({ citaId: c.citaId, cupoId: crearCupo(medico.id, 80 * 60), actor: recepcion });
  citas.reprogramar({ citaId: c.citaId, cupoId: crearCupo(medico.id, 90 * 60), actor: recepcion });
  assert.throws(() => citas.reprogramar({ citaId: c.citaId, cupoId: crearCupo(medico.id, 100 * 60), actor: recepcion }), /máximo/);

  const p2 = crearPaciente();
  const c2 = citas.agendar({ cupoId: crearCupo(medico.id, 30 * 60), pacienteId: p2.pacienteId, actor: recepcion });
  const ocupado = crearCupo(medico.id, 40 * 60);
  citas.agendar({ cupoId: ocupado, pacienteId: crearPaciente().pacienteId, actor: recepcion });
  const antes = q.get('SELECT * FROM citas WHERE id = ?', c2.citaId);
  assert.throws(() => citas.reprogramar({ citaId: c2.citaId, cupoId: ocupado, actor: recepcion }), /no disponible/);
  assert.deepEqual(q.get('SELECT * FROM citas WHERE id = ?', c2.citaId), antes);
});

test('RN-03: transiciones inválidas se rechazan y se auditan', () => {
  assert.equal(estados.esTransicionValida('FINALIZADA', 'AGENDADA', 'REPROGRAMAR'), false);
  assert.equal(estados.esTransicionValida('NOTIFICADA', 'CONFIRMADA', 'CONFIRMAR'), true);
  const p = crearPaciente();
  const c = citas.agendar({ cupoId: crearCupo(medico.id, 48 * 60), pacienteId: p.pacienteId, actor: recepcion });
  assert.throws(() => estados.transicionar(c.citaId, 'EN_CONSULTA', 'LLAMAR_PACIENTE'), (e) => e.status === 409);
  assert.ok(q.get("SELECT id FROM auditoria WHERE accion = 'TRANSICION_INVALIDA'"));
});

test('RF-08 / RF-09: notificación a P-01, cancelación automática a P-02 sin confirmar, y Confirmada nunca se cancela', () => {
  const pa = crearPaciente();
  const pb = crearPaciente();
  const a = citas.agendar({ cupoId: crearCupo(medico.id, 30 * 60), pacienteId: pa.pacienteId, actor: recepcion });
  const b = citas.agendar({ cupoId: crearCupo(medico.id, 31 * 60), pacienteId: pb.pacienteId, actor: recepcion });
  avanzar(7 * HORA + 1 * MIN); // a 23 h de la cita a
  assert.equal(planificador.enviarNotificacionesConfirmacion(), 2);
  assert.equal(q.get('SELECT estado FROM citas WHERE id = ?', a.citaId).estado, 'NOTIFICADA');
  assert.ok(q.get("SELECT id FROM notificaciones WHERE cita_id = ? AND tipo = 'CONFIRMACION'", a.citaId));
  citas.confirmar({ citaId: b.citaId, actor: { id: pb.id, rol: 'PACIENTE' } });
  avanzar(13 * HORA + 2 * MIN); // 6 h después de la notificación
  assert.equal(planificador.cancelarNoConfirmadas(), 1);
  assert.equal(q.get('SELECT estado FROM citas WHERE id = ?', a.citaId).estado, 'CANCELADA_AUTOMATICA');
  assert.equal(q.get('SELECT estado FROM citas WHERE id = ?', b.citaId).estado, 'CONFIRMADA');
});

test('RF-21: inasistencia a los 15 min de la hora sin check-in', () => {
  const p = crearPaciente();
  const c = citas.agendar({ cupoId: crearCupo(medico.id, 60), pacienteId: p.pacienteId, actor: recepcion });
  avanzar(74 * MIN);
  assert.equal(planificador.marcarInasistencias(), 0);
  avanzar(76 * MIN);
  assert.equal(planificador.marcarInasistencias(), 1);
  assert.equal(q.get('SELECT estado FROM citas WHERE id = ?', c.citaId).estado, 'NO_ASISTIO');
});

test('RF-10: la oferta respeta el orden de inscripción y pasa al siguiente al vencer', () => {
  const cupo = crearCupo(medico.id, 48 * 60);
  const ocupante = crearPaciente();
  const c = citas.agendar({ cupoId: cupo, pacienteId: ocupante.pacienteId, actor: recepcion });
  const inscritos = [crearPaciente(), crearPaciente(), crearPaciente()];
  for (const p of inscritos) listaEspera.inscribir({ pacienteId: p.pacienteId, especialidadId: 1, sedeId: 1, modalidad: 'PRESENCIAL', actor: recepcion });
  assert.throws(() => listaEspera.inscribir({ pacienteId: inscritos[0].pacienteId, especialidadId: 1, sedeId: 1, modalidad: 'PRESENCIAL', actor: recepcion }), /ya está inscrito/);

  citas.cancelar({ citaId: c.citaId, motivoId: 1, actor: recepcion });
  const oferta = () => q.get("SELECT paciente_id FROM lista_espera WHERE estado = 'OFERTADA'")?.paciente_id;
  assert.equal(oferta(), inscritos[0].pacienteId);
  assert.equal(citas.buscarDisponibilidad({}).length, 0, 'el cupo ofertado no aparece en RF-04');
  avanzar(2 * HORA + MIN);
  listaEspera.procesarOfertasVencidas();
  assert.equal(oferta(), inscritos[1].pacienteId);
  const ins = q.get("SELECT id FROM lista_espera WHERE estado = 'OFERTADA'");
  const comp = listaEspera.aceptarOferta({ inscripcionId: ins.id, pacienteId: inscritos[1].pacienteId, actor: { id: inscritos[1].id, rol: 'PACIENTE' } });
  assert.equal(comp.estado, 'AGENDADA');
});

test('RF-11: la urgencia entra en EnSalaEspera sin consumir cupos', () => {
  const p = crearPaciente();
  crearCupo(medico.id, 60);
  const u = citas.registrarUrgencia({ pacienteId: p.pacienteId, sedeId: 1, motivo: 'Dolor torácico', actor: recepcion });
  assert.equal(u.estado, 'EN_SALA_ESPERA');
  assert.equal(u.cupo_id, null);
  assert.equal(citas.colaUrgencias(1).length, 1);
  assert.equal(citas.buscarDisponibilidad({}).length, 1);
});

test('RF-12: un bloqueo que afecta 3 citas no se guarda hasta resolver cada una', () => {
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(citas.agendar({ cupoId: crearCupo(medico.id, 48 * 60 + i * 30), pacienteId: crearPaciente().pacienteId, actor: recepcion }).citaId);
  const desde = new Date(Date.now() + 47 * HORA).toISOString();
  const hasta = new Date(Date.now() + 50 * HORA).toISOString();
  const admin = crearUsuario('ADMINISTRADOR');
  const err = (() => { try { agenda.crearBloqueo({ medicoId: medico.id, desde, hasta, motivo: 'Vacaciones', actor: admin }); } catch (e) { return e; } })();
  assert.equal(err.status, 409);
  assert.equal(err.extra.citasAfectadas.length, 3);
  assert.equal(q.get('SELECT COUNT(*) AS n FROM bloqueos_agenda').n, 0);
  const libre = crearCupo(medico.id, 60 * 60);
  agenda.crearBloqueo({
    medicoId: medico.id, desde, hasta, motivo: 'Vacaciones', actor: admin,
    resoluciones: [{ citaId: ids[0], accion: 'CANCELAR', motivoId: 1 }, { citaId: ids[1], accion: 'CANCELAR', motivoId: 1 }, { citaId: ids[2], accion: 'REPROGRAMAR', cupoId: libre }],
  });
  assert.equal(q.get('SELECT COUNT(*) AS n FROM bloqueos_agenda').n, 1);
  assert.equal(q.get('SELECT cupo_id FROM citas WHERE id = ?', ids[2]).cupo_id, libre);
});
