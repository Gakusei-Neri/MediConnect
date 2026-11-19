// Servicio Clínico: RF-13, RF-14, RF-15, RF-16, RF-23; RN-02, RN-06, RN-07.
import { q, transaccion } from '../db/database.js';
import { HORA } from '../config/parametros.js';
import { ahoraIso, sumarIso, edadEnAnios } from '../utils/tiempo.js';
import { cifrar, descifrar, descifrarJson } from '../utils/cifrado.js';
import { conflicto, malaSolicitud, noEncontrado, prohibido, HttpError } from '../utils/errores.js';
import { registrar, registrarSiPuede } from './auditoria.js';
import { relacionAsistencial, HORAS_ACCESO_EMERGENCIA } from './acceso.js';
import { transicionar } from './estadosCita.js';
import { notificarRol } from './notificaciones.js';
import { verificarSegundoFactor } from './autenticacion.js';
import { revocarEnlace } from './telemedicina.js';

export const SIGNOS = ['peso', 'talla', 'presionSistolica', 'presionDiastolica', 'frecuenciaCardiaca', 'frecuenciaRespiratoria', 'temperatura', 'saturacionOxigeno'];

/** RN-07: verifica relación asistencial; si no hay, audita y lanza 403. */
export function exigirRelacion(usuario, pacienteId, recurso = 'expediente') {
  const rel = relacionAsistencial(usuario, pacienteId);
  if (!rel.permitido) {
    registrarSiPuede({ usuarioId: usuario.id, rol: usuario.rol, accion: 'ACCESO_DENEGADO', recurso, pacienteId, resultado: 'PROHIBIDO', detalle: { motivo: 'Sin relación asistencial (RN-07)' } });
    throw prohibido('Sin relación asistencial con el paciente (RN-07)');
  }
  return rel;
}

function expedienteDePaciente(pacienteId) {
  const e = q.get('SELECT * FROM expedientes WHERE paciente_id = ?', pacienteId);
  if (!e) throw noEncontrado('Expediente inexistente');
  return e;
}

export function alergiasActivas(expedienteId) {
  return q.all(
    `SELECT a.id, a.componente_id, c.nombre AS componente, a.severidad, a.fecha_registro, u.nombre_completo AS registrada_por
     FROM alergias a JOIN componentes_activos c ON c.id = a.componente_id JOIN usuarios u ON u.id = a.registrada_por
     WHERE a.expediente_id = ? AND a.activa = 1 ORDER BY c.nombre`, expedienteId);
}

function diagnosticosDe(consultaId) {
  return q.all(
    'SELECT d.id, d.codigo, d.descripcion FROM consulta_diagnosticos cd JOIN diagnosticos_cat d ON d.id = cd.diagnostico_id WHERE cd.consulta_id = ? ORDER BY d.codigo',
    consultaId,
  );
}

function consultaCompleta(c, { incluirNotas = true } = {}) {
  const addendums = q.all(
    'SELECT a.id, a.texto_enc, a.diagnosticos_agregados, a.fecha, u.nombre_completo AS autor FROM addendums a JOIN usuarios u ON u.id = a.autor_id WHERE a.consulta_id = ? ORDER BY a.fecha',
    c.id,
  ).map((a) => ({
    id: a.id, autor: a.autor, fecha: a.fecha, texto: incluirNotas ? descifrar(a.texto_enc) : undefined,
    diagnosticosAgregados: JSON.parse(a.diagnosticos_agregados).map((id) => q.get('SELECT id, codigo, descripcion FROM diagnosticos_cat WHERE id = ?', id)),
  }));
  return {
    id: c.id,
    citaId: c.cita_id,
    fecha: c.fecha_firma || c.creada_en,
    medico: c.medico_nombre,
    sede: c.sede_nombre,
    motivo: descifrar(c.motivo_enc),
    signosVitales: descifrarJson(c.signos_vitales_enc),
    notasEvolucion: incluirNotas ? descifrar(c.notas_evolucion_enc) : undefined,
    firmada: Boolean(c.firmada),
    diagnosticos: diagnosticosDe(c.id),
    addendums,
  };
}

const SELECT_CONSULTAS = `
  SELECT co.*, u.nombre_completo AS medico_nombre, s.nombre AS sede_nombre
  FROM consultas co JOIN citas ci ON ci.id = co.cita_id JOIN sedes s ON s.id = ci.sede_id
  LEFT JOIN usuarios u ON u.id = co.medico_id`;

/**
 * RF-13: abre el expediente único. Auditoría síncrona (RN-02): si no se puede auditar, se niega,
 * salvo acceso de emergencia (la entrada se encola).
 */
export function abrirExpediente(usuario, pacienteId) {
  const rel = exigirRelacion(usuario, pacienteId);
  const exp = expedienteDePaciente(pacienteId);
  registrar(
    { usuarioId: usuario.id, rol: usuario.rol, accion: 'LECTURA_EXPEDIENTE', recurso: 'expediente', idRegistro: exp.id, pacienteId, esEmergencia: rel.esEmergencia, detalle: { via: rel.motivo } },
    { emergencia: rel.esEmergencia },
  );
  const paciente = q.get('SELECT id, nombre_completo, curp, fecha_nacimiento FROM pacientes WHERE id = ?', pacienteId);
  const contacto = q.get('SELECT u.correo, u.telefono FROM usuarios u JOIN pacientes p ON p.usuario_id = u.id WHERE p.id = ?', pacienteId);
  const consultas = q.all(`${SELECT_CONSULTAS} WHERE co.expediente_id = ? ORDER BY co.creada_en DESC`, exp.id).map((c) => consultaCompleta(c));
  const recetas = q.all(
    `SELECT r.id, r.folio, r.fecha_emision, r.vigente_hasta, r.surtida, r.anulada, r.motivo_anulacion, r.consulta_id, rf.estado AS reserva_estado
     FROM recetas r LEFT JOIN reservas_farmacia rf ON rf.receta_id = r.id WHERE r.paciente_id = ? ORDER BY r.fecha_emision DESC`, pacienteId);
  for (const r of recetas) r.medicamentos = detallesReceta(r.id);
  return {
    accesoVia: rel.motivo,
    esEmergencia: Boolean(rel.esEmergencia),
    paciente: { ...paciente, edad: edadEnAnios(paciente.fecha_nacimiento), ...contacto },
    expediente: {
      id: exp.id,
      fechaCreacion: exp.fecha_creacion,
      antecedentes: descifrar(exp.antecedentes_enc),
      sinAlergiasConocidas: Boolean(exp.sin_alergias_conocidas),
      sinAlergiasFecha: exp.sin_alergias_fecha,
    },
    alergias: alergiasActivas(exp.id),
    consultas,
    recetas,
  };
}

export function detallesReceta(recetaId) {
  return q.all(
    `SELECT d.id, d.medicamento_id, m.codigo, m.nombre, m.presentacion, c.nombre AS componente, d.dosis, d.frecuencia, d.duracion, d.cantidad
     FROM receta_detalles d JOIN medicamentos m ON m.id = d.medicamento_id JOIN componentes_activos c ON c.id = m.componente_id
     WHERE d.receta_id = ?`, recetaId);
}

/** RF-23: acceso de emergencia sin relación asistencial, con justificación obligatoria y alerta a Seguridad. */
export function accesoEmergencia(usuario, pacienteId, justificacion) {
  if (usuario.rol !== 'MEDICO') throw prohibido('Solo un médico puede declarar un acceso de emergencia');
  if (!justificacion || String(justificacion).trim().length < 10) throw malaSolicitud('La justificación es obligatoria (mínimo 10 caracteres)');
  if (!q.get('SELECT id FROM pacientes WHERE id = ?', pacienteId)) throw noEncontrado('Paciente inexistente');
  const t = ahoraIso();
  const r = q.run(
    'INSERT INTO accesos_emergencia (medico_id, paciente_id, justificacion, fecha, vence_en) VALUES (?,?,?,?,?)',
    usuario.id, pacienteId, String(justificacion).trim(), t, sumarIso(t, HORAS_ACCESO_EMERGENCIA * HORA),
  );
  const id = Number(r.lastInsertRowid);
  registrar(
    { usuarioId: usuario.id, rol: usuario.rol, accion: 'ACCESO_EMERGENCIA', recurso: 'expediente', idRegistro: id, pacienteId, esEmergencia: true, detalle: { justificacion: String(justificacion).trim() } },
    { emergencia: true },
  );
  enviarAlertaEmergencia(id);
  return abrirExpediente(usuario, pacienteId);
}

export function enviarAlertaEmergencia(accesoId) {
  const a = q.get(
    `SELECT a.*, u.nombre_completo AS medico, p.nombre_completo AS paciente FROM accesos_emergencia a
     JOIN usuarios u ON u.id = a.medico_id JOIN pacientes p ON p.id = a.paciente_id WHERE a.id = ?`, accesoId);
  if (!a || a.alerta_enviada_en) return;
  notificarRol('SEGURIDAD', {
    tipo: 'ALERTA_EMERGENCIA',
    asunto: 'Alerta: acceso de emergencia a expediente',
    contenido: `El médico ${a.medico} accedió por emergencia al expediente de ${a.paciente} (${a.fecha}). Justificación: ${a.justificacion}`,
  });
  q.run('UPDATE accesos_emergencia SET alerta_enviada_en = ? WHERE id = ?', ahoraIso(), accesoId);
}

// ---------------- RF-15: alergias ----------------
export function agregarAlergia(usuario, pacienteId, { componenteId, severidad }) {
  exigirRelacion(usuario, pacienteId);
  if (!['LEVE', 'MODERADA', 'SEVERA'].includes(severidad)) throw malaSolicitud('Severidad inválida');
  if (!q.get('SELECT id FROM componentes_activos WHERE id = ?', componenteId)) throw malaSolicitud('Componente activo inexistente en el catálogo');
  const exp = expedienteDePaciente(pacienteId);
  return transaccion(() => {
    let r;
    try {
      r = q.run(
        'INSERT INTO alergias (expediente_id, componente_id, severidad, fecha_registro, registrada_por) VALUES (?,?,?,?,?)',
        exp.id, componenteId, severidad, ahoraIso(), usuario.id,
      );
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw conflicto('La alergia a ese componente ya está registrada');
      throw e;
    }
    // Registrar una alergia anula la marca "sin alergias conocidas"
    q.run('UPDATE expedientes SET sin_alergias_conocidas = 0 WHERE id = ?', exp.id);
    registrar({ usuarioId: usuario.id, rol: usuario.rol, accion: 'ALERGIA_ALTA', recurso: 'alergia', idRegistro: r.lastInsertRowid, pacienteId, detalle: { componenteId, severidad } });
    return alergiasActivas(exp.id);
  });
}

export function bajaAlergia(usuario, pacienteId, alergiaId) {
  exigirRelacion(usuario, pacienteId);
  const exp = expedienteDePaciente(pacienteId);
  return transaccion(() => {
    const r = q.run('UPDATE alergias SET activa = 0, fecha_baja = ?, baja_por = ? WHERE id = ? AND expediente_id = ? AND activa = 1', ahoraIso(), usuario.id, alergiaId, exp.id);
    if (!r.changes) throw noEncontrado('Alergia inexistente');
    registrar({ usuarioId: usuario.id, rol: usuario.rol, accion: 'ALERGIA_BAJA', recurso: 'alergia', idRegistro: alergiaId, pacienteId });
    return alergiasActivas(exp.id);
  });
}

export function marcarSinAlergias(usuario, pacienteId) {
  exigirRelacion(usuario, pacienteId);
  const exp = expedienteDePaciente(pacienteId);
  if (alergiasActivas(exp.id).length) throw conflicto('El paciente tiene alergias activas registradas');
  transaccion(() => {
    q.run('UPDATE expedientes SET sin_alergias_conocidas = 1, sin_alergias_fecha = ?, sin_alergias_usuario_id = ? WHERE id = ?', ahoraIso(), usuario.id, exp.id);
    registrar({ usuarioId: usuario.id, rol: usuario.rol, accion: 'SIN_ALERGIAS_CONOCIDAS', recurso: 'expediente', idRegistro: exp.id, pacienteId });
  });
  return { sinAlergiasConocidas: true };
}

export function actualizarAntecedentes(usuario, pacienteId, antecedentes) {
  if (usuario.rol !== 'MEDICO') throw prohibido();
  exigirRelacion(usuario, pacienteId);
  const exp = expedienteDePaciente(pacienteId);
  transaccion(() => {
    q.run('UPDATE expedientes SET antecedentes_enc = ? WHERE id = ?', cifrar(String(antecedentes ?? '')), exp.id);
    registrar({ usuarioId: usuario.id, rol: usuario.rol, accion: 'ANTECEDENTES_ACTUALIZADOS', recurso: 'expediente', idRegistro: exp.id, pacienteId });
  });
}

// ---------------- RF-14: consulta ----------------
const ESTADOS_CONSULTA = ['EN_SALA_ESPERA', 'TELEMEDICINA_CONECTADA', 'EN_CONSULTA'];

function citaParaConsulta(usuario, citaId) {
  const cita = q.get('SELECT * FROM citas WHERE id = ?', citaId);
  if (!cita) throw noEncontrado('Cita inexistente');
  exigirRelacion(usuario, cita.paciente_id, 'consulta');
  return cita;
}

/** Obtiene (o crea en borrador) la consulta de una cita. */
export function obtenerConsulta(usuario, citaId) {
  const cita = citaParaConsulta(usuario, citaId);
  let c = q.get(`${SELECT_CONSULTAS} WHERE co.cita_id = ?`, citaId);
  if (!c) {
    if (!ESTADOS_CONSULTA.includes(cita.estado)) throw conflicto(`La cita está en estado ${cita.estado}; no admite consulta`);
    const exp = expedienteDePaciente(cita.paciente_id);
    const t = ahoraIso();
    q.run('INSERT INTO consultas (cita_id, expediente_id, medico_id, creada_en, actualizada_en) VALUES (?,?,?,?,?)', citaId, exp.id, cita.medico_id, t, t);
    c = q.get(`${SELECT_CONSULTAS} WHERE co.cita_id = ?`, citaId);
  }
  registrar({ usuarioId: usuario.id, rol: usuario.rol, accion: 'LECTURA_CONSULTA', recurso: 'consulta', idRegistro: c.id, pacienteId: cita.paciente_id });
  const receta = q.get('SELECT id, folio, anulada FROM recetas WHERE consulta_id = ? AND anulada = 0', c.id);
  return { ...consultaCompleta(c), citaEstado: cita.estado, pacienteId: cita.paciente_id, receta };
}

function grupoEdad(pacienteId) {
  const p = q.get('SELECT fecha_nacimiento FROM pacientes WHERE id = ?', pacienteId);
  return edadEnAnios(p.fecha_nacimiento) < 18 ? 'NINO' : 'ADULTO';
}

/** Valida signos vitales contra el catálogo de rangos fisiológicos. Devuelve los fuera de rango. */
export function validarSignos(signos, pacienteId) {
  const grupo = grupoEdad(pacienteId);
  const fuera = [];
  for (const [signo, valor] of Object.entries(signos || {})) {
    if (!SIGNOS.includes(signo)) throw malaSolicitud(`Signo vital desconocido: ${signo}`);
    if (valor === null || valor === '' || valor === undefined) continue;
    if (typeof valor !== 'number' || Number.isNaN(valor)) throw malaSolicitud(`Valor inválido para ${signo}`);
    const rango = q.get('SELECT * FROM rangos_fisiologicos WHERE signo = ? AND grupo_edad = ?', signo, grupo);
    if (rango && (valor < rango.minimo || valor > rango.maximo)) fuera.push({ signo, valor, minimo: rango.minimo, maximo: rango.maximo, unidad: rango.unidad });
  }
  return fuera;
}

/**
 * Guarda el borrador de la consulta. Médicos y enfermeros capturan signos vitales;
 * solo el médico captura motivo, notas y diagnósticos.
 */
export function guardarConsulta(usuario, citaId, datos) {
  const cita = citaParaConsulta(usuario, citaId);
  const c = q.get('SELECT * FROM consultas WHERE cita_id = ?', citaId);
  if (!c) throw noEncontrado('Abra primero la consulta');
  if (c.firmada) throw conflicto('La consulta está firmada y no se puede editar (RN-06); use un addendum');
  const esMedico = usuario.rol === 'MEDICO';
  if (!esMedico && (datos.motivo !== undefined || datos.notasEvolucion !== undefined || datos.diagnosticos !== undefined)) {
    throw prohibido('Solo el médico captura motivo, notas y diagnósticos');
  }
  const cambios = {};
  if (datos.signosVitales !== undefined) {
    const previos = descifrarJson(c.signos_vitales_enc) || {};
    const nuevos = { ...previos, ...datos.signosVitales };
    const fuera = validarSignos(datos.signosVitales, cita.paciente_id);
    if (fuera.length && !datos.confirmarFueraDeRango) {
      throw new HttpError(422, 'Hay signos vitales fuera del rango fisiológico; confirme explícitamente', { codigo: 'FUERA_DE_RANGO', fueraDeRango: fuera });
    }
    cambios.signos_vitales_enc = cifrar(nuevos);
  }
  if (datos.motivo !== undefined) cambios.motivo_enc = cifrar(String(datos.motivo));
  if (datos.notasEvolucion !== undefined) cambios.notas_evolucion_enc = cifrar(String(datos.notasEvolucion));
  return transaccion(() => {
    const cols = Object.keys(cambios);
    if (cols.length) {
      q.run(`UPDATE consultas SET ${cols.map((k) => `${k} = ?`).join(', ')}, actualizada_en = ? WHERE id = ?`, ...cols.map((k) => cambios[k]), ahoraIso(), c.id);
    }
    if (datos.diagnosticos !== undefined) {
      const ids = [...new Set((datos.diagnosticos || []).map(Number))];
      for (const id of ids) if (!q.get('SELECT id FROM diagnosticos_cat WHERE id = ?', id)) throw malaSolicitud(`Diagnóstico ${id} inexistente en el catálogo`);
      q.run('DELETE FROM consulta_diagnosticos WHERE consulta_id = ?', c.id);
      for (const id of ids) q.run('INSERT INTO consulta_diagnosticos (consulta_id, diagnostico_id) VALUES (?,?)', c.id, id);
    }
    registrar({ usuarioId: usuario.id, rol: usuario.rol, accion: 'ESCRITURA_CONSULTA', recurso: 'consulta', idRegistro: c.id, pacienteId: cita.paciente_id, detalle: { campos: [...Object.keys(datos)] } });
    return obtenerConsulta(usuario, citaId);
  });
}

/** Finaliza: exige motivo y al menos un diagnóstico; firma la nota (RN-06) y la cita pasa a Finalizada. */
export function finalizarConsulta(usuario, citaId) {
  if (usuario.rol !== 'MEDICO') throw prohibido();
  const cita = citaParaConsulta(usuario, citaId);
  if (cita.medico_id !== usuario.id) throw prohibido('La consulta la finaliza el médico a cargo');
  const c = q.get('SELECT * FROM consultas WHERE cita_id = ?', citaId);
  if (!c) throw noEncontrado('Consulta inexistente');
  if (c.firmada) throw conflicto('La consulta ya está firmada');
  if (!descifrar(c.motivo_enc)?.trim()) throw malaSolicitud('No se puede finalizar sin motivo de consulta');
  if (!diagnosticosDe(c.id).length) throw malaSolicitud('No se puede finalizar sin al menos un diagnóstico');
  transaccion(() => {
    const t = ahoraIso();
    q.run('UPDATE consultas SET firmada = 1, fecha_firma = ?, actualizada_en = ? WHERE id = ?', t, t, c.id);
    q.run('UPDATE expedientes SET ultimo_acto_medico = ? WHERE id = ?', t, c.expediente_id);
    transicionar(citaId, 'FINALIZADA', 'FINALIZAR', { usuarioId: usuario.id, rol: usuario.rol });
    registrar({ usuarioId: usuario.id, rol: usuario.rol, accion: 'CONSULTA_FIRMADA', recurso: 'consulta', idRegistro: c.id, pacienteId: cita.paciente_id });
  });
  revocarEnlace(citaId);
  return obtenerConsulta(usuario, citaId);
}

/** RN-06: corrección mediante addendum; modificar diagnósticos exige verificación 2FA (RN-01). */
export function agregarAddendum(usuario, consultaId, { texto, diagnosticos = [], codigo2fa }) {
  if (usuario.rol !== 'MEDICO') throw prohibido();
  const c = q.get('SELECT * FROM consultas WHERE id = ?', consultaId);
  if (!c) throw noEncontrado('Consulta inexistente');
  const cita = q.get('SELECT paciente_id FROM citas WHERE id = ?', c.cita_id);
  exigirRelacion(usuario, cita.paciente_id, 'consulta');
  if (!c.firmada) throw conflicto('La consulta aún no está firmada; edítela directamente');
  if (!texto || !String(texto).trim()) throw malaSolicitud('El texto del addendum es obligatorio');
  const ids = [...new Set((diagnosticos || []).map(Number))];
  if (ids.length) verificarSegundoFactor(usuario, codigo2fa, 'MODIFICAR_DIAGNOSTICO');
  for (const id of ids) if (!q.get('SELECT id FROM diagnosticos_cat WHERE id = ?', id)) throw malaSolicitud(`Diagnóstico ${id} inexistente`);
  transaccion(() => {
    const r = q.run(
      'INSERT INTO addendums (consulta_id, autor_id, texto_enc, diagnosticos_agregados, fecha) VALUES (?,?,?,?,?)',
      consultaId, usuario.id, cifrar(String(texto).trim()), JSON.stringify(ids), ahoraIso(),
    );
    registrar({ usuarioId: usuario.id, rol: usuario.rol, accion: 'ADDENDUM', recurso: 'consulta', idRegistro: consultaId, pacienteId: cita.paciente_id, detalle: { addendumId: Number(r.lastInsertRowid), diagnosticos: ids } });
  });
  return consultaCompleta(q.get(`${SELECT_CONSULTAS} WHERE co.id = ?`, consultaId));
}

// ---------------- RF-16: portal del paciente ----------------
export function resumenPaciente(pacienteId) {
  const exp = expedienteDePaciente(pacienteId);
  const historial = q.all(`${SELECT_CONSULTAS} WHERE co.expediente_id = ? AND co.firmada = 1 ORDER BY co.fecha_firma DESC`, exp.id)
    .map((c) => ({ fecha: c.fecha_firma, medico: c.medico_nombre, sede: c.sede_nombre, diagnosticos: diagnosticosDe(c.id) }));
  return { historial, alergias: alergiasActivas(exp.id).map(({ componente, severidad }) => ({ componente, severidad })) };
}
