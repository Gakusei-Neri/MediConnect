-- MediConnect Plus - esquema relacional (D-02). Todas las fechas en UTC ISO-8601 (D-07).
PRAGMA foreign_keys = ON;

-- ---------- Catálogos (1.3) ----------
CREATE TABLE IF NOT EXISTS sedes (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL CHECK (tipo IN ('HOSPITAL','CLINICA')),
  direccion TEXT NOT NULL,
  zona_horaria TEXT NOT NULL DEFAULT 'America/Mexico_City',
  es_prueba INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS especialidades (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  duracion_min INTEGER, -- NULL = P-15
  es_prueba INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS componentes_activos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS medicamentos (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  presentacion TEXT NOT NULL,
  componente_id INTEGER NOT NULL REFERENCES componentes_activos(id)
);

CREATE TABLE IF NOT EXISTS diagnosticos_cat (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  descripcion TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT 'CIE-11'
);

CREATE TABLE IF NOT EXISTS motivos_cancelacion (
  id INTEGER PRIMARY KEY,
  descripcion TEXT NOT NULL UNIQUE,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS rangos_fisiologicos (
  signo TEXT NOT NULL,
  grupo_edad TEXT NOT NULL CHECK (grupo_edad IN ('NINO','ADULTO')),
  minimo REAL NOT NULL,
  maximo REAL NOT NULL,
  unidad TEXT NOT NULL,
  PRIMARY KEY (signo, grupo_edad)
);

-- ---------- Identidad (BD de identidad lógica) ----------
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nombre_completo TEXT NOT NULL,
  correo TEXT NOT NULL UNIQUE COLLATE NOCASE,
  telefono TEXT,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('PACIENTE','RECEPCION','MEDICO','ENFERMERO','SEGURIDAD','ADMINISTRADOR')),
  canal_preferido TEXT NOT NULL DEFAULT 'CORREO' CHECK (canal_preferido IN ('CORREO','SMS')),
  activo INTEGER NOT NULL DEFAULT 1,
  intentos_fallidos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TEXT,
  totp_secret_enc TEXT,           -- cifrado AES-256-GCM (RNF-01)
  sede_id INTEGER REFERENCES sedes(id),
  especialidad_id INTEGER REFERENCES especialidades(id),
  cedula_profesional TEXT,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sesiones (
  id TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  creada_en TEXT NOT NULL,
  ultima_actividad TEXT NOT NULL,
  revocada INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS verificaciones_registro (
  id TEXT PRIMARY KEY,
  destino TEXT NOT NULL,
  codigo_hash TEXT NOT NULL,
  expira_en TEXT NOT NULL,
  datos_enc TEXT NOT NULL,
  usado INTEGER NOT NULL DEFAULT 0,
  intentos INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pacientes (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER UNIQUE REFERENCES usuarios(id),
  curp TEXT NOT NULL UNIQUE,      -- RF-13: no existen dos expedientes con la misma CURP
  nombre_completo TEXT NOT NULL,
  fecha_nacimiento TEXT NOT NULL,
  acepto_aviso_privacidad INTEGER NOT NULL CHECK (acepto_aviso_privacidad = 1),
  fecha_aviso TEXT NOT NULL
);

-- ---------- Agenda y citas ----------
CREATE TABLE IF NOT EXISTS horarios (
  id INTEGER PRIMARY KEY,
  medico_id INTEGER NOT NULL REFERENCES usuarios(id),
  sede_id INTEGER NOT NULL REFERENCES sedes(id),
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6), -- 0 = domingo
  hora_inicio TEXT NOT NULL,      -- HH:MM hora local de la sede
  hora_fin TEXT NOT NULL,
  modalidad TEXT NOT NULL CHECK (modalidad IN ('PRESENCIAL','VIRTUAL')),
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bloqueos_agenda (
  id INTEGER PRIMARY KEY,
  medico_id INTEGER NOT NULL REFERENCES usuarios(id),
  desde TEXT NOT NULL,
  hasta TEXT NOT NULL,
  motivo TEXT NOT NULL,
  creado_por INTEGER REFERENCES usuarios(id),
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cupos (
  id INTEGER PRIMARY KEY,
  medico_id INTEGER NOT NULL REFERENCES usuarios(id),
  sede_id INTEGER NOT NULL REFERENCES sedes(id),
  especialidad_id INTEGER NOT NULL REFERENCES especialidades(id),
  horario_id INTEGER REFERENCES horarios(id),
  inicio TEXT NOT NULL,
  fin TEXT NOT NULL,
  modalidad TEXT NOT NULL CHECK (modalidad IN ('PRESENCIAL','VIRTUAL')),
  estado TEXT NOT NULL DEFAULT 'LIBRE' CHECK (estado IN ('LIBRE','OCUPADO','BLOQUEADO','RETENIDO','ELIMINADO')),
  UNIQUE (medico_id, inicio)
);
CREATE INDEX IF NOT EXISTS ix_cupos_busqueda ON cupos (estado, inicio, especialidad_id, sede_id);

CREATE TABLE IF NOT EXISTS citas (
  id INTEGER PRIMARY KEY,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  medico_id INTEGER REFERENCES usuarios(id),   -- NULL en urgencias hasta que un médico la toma
  sede_id INTEGER NOT NULL REFERENCES sedes(id),
  especialidad_id INTEGER REFERENCES especialidades(id),
  cupo_id INTEGER REFERENCES cupos(id),
  fecha_hora TEXT NOT NULL,
  fecha_fin TEXT NOT NULL,
  modalidad TEXT NOT NULL CHECK (modalidad IN ('PRESENCIAL','VIRTUAL')),
  estado TEXT NOT NULL CHECK (estado IN ('AGENDADA','NOTIFICADA','CONFIRMADA','EN_SALA_ESPERA','TELEMEDICINA_CONECTADA','EN_CONSULTA','FINALIZADA','CANCELADA_POR_USUARIO','CANCELADA_AUTOMATICA','NO_ASISTIO','DERIVADA_URGENCIAS')),
  activa INTEGER GENERATED ALWAYS AS (estado IN ('AGENDADA','NOTIFICADA','CONFIRMADA','EN_SALA_ESPERA','TELEMEDICINA_CONECTADA','EN_CONSULTA')) VIRTUAL,
  es_urgencia INTEGER NOT NULL DEFAULT 0,
  motivo_urgencia TEXT,
  reprogramaciones INTEGER NOT NULL DEFAULT 0,
  motivo_cancelacion_id INTEGER REFERENCES motivos_cancelacion(id),
  notificada_en TEXT,
  confirmada_en TEXT,
  creada_por INTEGER REFERENCES usuarios(id),
  creada_en TEXT NOT NULL,
  actualizada_en TEXT NOT NULL
);
-- RN-04 / D-02: un cupo admite una sola cita activa
CREATE UNIQUE INDEX IF NOT EXISTS ux_cita_activa_cupo ON citas (cupo_id) WHERE cupo_id IS NOT NULL AND activa = 1;
CREATE INDEX IF NOT EXISTS ix_citas_paciente ON citas (paciente_id, estado);
CREATE INDEX IF NOT EXISTS ix_citas_medico ON citas (medico_id, fecha_hora);
CREATE INDEX IF NOT EXISTS ix_citas_estado ON citas (estado, fecha_hora);

CREATE TABLE IF NOT EXISTS historial_estados_cita (
  id INTEGER PRIMARY KEY,
  cita_id INTEGER NOT NULL REFERENCES citas(id),
  de_estado TEXT,
  a_estado TEXT NOT NULL,
  evento TEXT NOT NULL,
  usuario_id INTEGER,
  fecha TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lista_espera (
  id INTEGER PRIMARY KEY,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  especialidad_id INTEGER NOT NULL REFERENCES especialidades(id),
  sede_id INTEGER NOT NULL REFERENCES sedes(id),
  modalidad TEXT NOT NULL CHECK (modalidad IN ('PRESENCIAL','VIRTUAL')),
  medico_id INTEGER REFERENCES usuarios(id),
  fecha_solicitud TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN ('ACTIVA','OFERTADA','ATENDIDA','CANCELADA')),
  cupo_ofertado_id INTEGER REFERENCES cupos(id),
  oferta_vence_en TEXT,
  cupos_rechazados TEXT NOT NULL DEFAULT '[]'
);
-- RF-10: un paciente no puede inscribirse dos veces en la misma combinación
CREATE UNIQUE INDEX IF NOT EXISTS ux_lista_espera ON lista_espera (paciente_id, especialidad_id, sede_id, modalidad, IFNULL(medico_id, 0)) WHERE estado IN ('ACTIVA','OFERTADA');

CREATE TABLE IF NOT EXISTS notificaciones (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  cita_id INTEGER REFERENCES citas(id),
  tipo TEXT NOT NULL,
  canal TEXT NOT NULL,
  destino TEXT NOT NULL,
  asunto TEXT NOT NULL,
  contenido TEXT NOT NULL,
  resultado TEXT NOT NULL CHECK (resultado IN ('ENVIADA','FALLIDA')),
  es_alterno INTEGER NOT NULL DEFAULT 0,
  fecha_envio TEXT NOT NULL,
  leida INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_notif_usuario ON notificaciones (usuario_id, fecha_envio);

CREATE TABLE IF NOT EXISTS enlaces_video (
  id INTEGER PRIMARY KEY,
  cita_id INTEGER NOT NULL UNIQUE REFERENCES citas(id),
  token TEXT NOT NULL UNIQUE,
  valido_desde TEXT NOT NULL,
  valido_hasta TEXT NOT NULL,
  revocado INTEGER NOT NULL DEFAULT 0
);

-- ---------- Clínico ----------
CREATE TABLE IF NOT EXISTS expedientes (
  id INTEGER PRIMARY KEY,
  paciente_id INTEGER NOT NULL UNIQUE REFERENCES pacientes(id),
  fecha_creacion TEXT NOT NULL,
  antecedentes_enc TEXT,
  sin_alergias_conocidas INTEGER NOT NULL DEFAULT 0,
  sin_alergias_fecha TEXT,
  sin_alergias_usuario_id INTEGER REFERENCES usuarios(id),
  ultimo_acto_medico TEXT
);

CREATE TABLE IF NOT EXISTS alergias (
  id INTEGER PRIMARY KEY,
  expediente_id INTEGER NOT NULL REFERENCES expedientes(id),
  componente_id INTEGER NOT NULL REFERENCES componentes_activos(id),
  severidad TEXT NOT NULL CHECK (severidad IN ('LEVE','MODERADA','SEVERA')),
  fecha_registro TEXT NOT NULL,
  registrada_por INTEGER NOT NULL REFERENCES usuarios(id),
  activa INTEGER NOT NULL DEFAULT 1,
  fecha_baja TEXT,
  baja_por INTEGER REFERENCES usuarios(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_alergia_activa ON alergias (expediente_id, componente_id) WHERE activa = 1;

CREATE TABLE IF NOT EXISTS consultas (
  id INTEGER PRIMARY KEY,
  cita_id INTEGER NOT NULL UNIQUE REFERENCES citas(id),
  expediente_id INTEGER NOT NULL REFERENCES expedientes(id),
  medico_id INTEGER REFERENCES usuarios(id),
  motivo_enc TEXT,
  signos_vitales_enc TEXT,
  notas_evolucion_enc TEXT,
  firmada INTEGER NOT NULL DEFAULT 0,
  fecha_firma TEXT,
  creada_en TEXT NOT NULL,
  actualizada_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consulta_diagnosticos (
  consulta_id INTEGER NOT NULL REFERENCES consultas(id),
  diagnostico_id INTEGER NOT NULL REFERENCES diagnosticos_cat(id),
  PRIMARY KEY (consulta_id, diagnostico_id)
);

CREATE TABLE IF NOT EXISTS addendums (
  id INTEGER PRIMARY KEY,
  consulta_id INTEGER NOT NULL REFERENCES consultas(id),
  autor_id INTEGER NOT NULL REFERENCES usuarios(id),
  texto_enc TEXT NOT NULL,
  diagnosticos_agregados TEXT NOT NULL DEFAULT '[]',
  fecha TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recetas (
  id INTEGER PRIMARY KEY,
  folio TEXT NOT NULL UNIQUE,
  consulta_id INTEGER NOT NULL REFERENCES consultas(id),
  medico_id INTEGER NOT NULL REFERENCES usuarios(id),
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  fecha_emision TEXT NOT NULL,
  vigente_hasta TEXT NOT NULL,
  justificacion_alergia_enc TEXT,
  surtida INTEGER NOT NULL DEFAULT 0,
  fecha_surtido TEXT,
  anulada INTEGER NOT NULL DEFAULT 0,
  motivo_anulacion TEXT,
  fecha_anulacion TEXT
);

CREATE TABLE IF NOT EXISTS receta_detalles (
  id INTEGER PRIMARY KEY,
  receta_id INTEGER NOT NULL REFERENCES recetas(id),
  medicamento_id INTEGER NOT NULL REFERENCES medicamentos(id),
  dosis TEXT NOT NULL,
  frecuencia TEXT NOT NULL,
  duracion TEXT NOT NULL,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0)
);

CREATE TABLE IF NOT EXISTS reservas_farmacia (
  id INTEGER PRIMARY KEY,
  receta_id INTEGER NOT NULL UNIQUE REFERENCES recetas(id),
  reserva_externa_id TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('PENDIENTE','CONFIRMADA','SIN_STOCK','FALLIDA','SURTIDA','CANCELADA')),
  vigente_hasta TEXT,
  intentos INTEGER NOT NULL DEFAULT 0,
  proximo_intento TEXT,
  ultimo_error TEXT,
  actualizada_en TEXT NOT NULL
);

-- RN-06: una consulta firmada y sus recetas no se pueden editar ni borrar
CREATE TRIGGER IF NOT EXISTS tr_consulta_firmada_no_update
BEFORE UPDATE ON consultas WHEN OLD.firmada = 1
BEGIN SELECT RAISE(ABORT, 'RN-06: consulta firmada no editable'); END;

CREATE TRIGGER IF NOT EXISTS tr_consulta_no_delete
BEFORE DELETE ON consultas
BEGIN SELECT RAISE(ABORT, 'RN-06/RN-08: las consultas no se borran'); END;

CREATE TRIGGER IF NOT EXISTS tr_receta_no_delete
BEFORE DELETE ON recetas
BEGIN SELECT RAISE(ABORT, 'RN-06: las recetas no se borran'); END;

CREATE TRIGGER IF NOT EXISTS tr_receta_inmutable
BEFORE UPDATE OF folio, consulta_id, medico_id, paciente_id, fecha_emision, vigente_hasta ON recetas
BEGIN SELECT RAISE(ABORT, 'RN-06: receta emitida no editable'); END;

CREATE TRIGGER IF NOT EXISTS tr_receta_detalle_inmutable
BEFORE UPDATE ON receta_detalles
BEGIN SELECT RAISE(ABORT, 'RN-06: receta emitida no editable'); END;

-- RN-09: una receta solo puede surtirse una vez
CREATE TRIGGER IF NOT EXISTS tr_receta_surtido_unico
BEFORE UPDATE OF surtida ON recetas WHEN OLD.surtida = 1
BEGIN SELECT RAISE(ABORT, 'RN-09: la receta ya fue surtida'); END;

-- RN-08: el expediente no se borra físicamente
CREATE TRIGGER IF NOT EXISTS tr_expediente_no_delete
BEFORE DELETE ON expedientes
BEGIN SELECT RAISE(ABORT, 'RN-08: el expediente no se borra dentro del plazo de retención'); END;

CREATE TRIGGER IF NOT EXISTS tr_addendum_inmutable
BEFORE UPDATE ON addendums
BEGIN SELECT RAISE(ABORT, 'RN-06: addendum no editable'); END;

CREATE TABLE IF NOT EXISTS accesos_emergencia (
  id INTEGER PRIMARY KEY,
  medico_id INTEGER NOT NULL REFERENCES usuarios(id),
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  justificacion TEXT NOT NULL CHECK (length(trim(justificacion)) > 0),
  fecha TEXT NOT NULL,
  vence_en TEXT NOT NULL,
  alerta_enviada_en TEXT,
  revisada INTEGER NOT NULL DEFAULT 0
);

-- ---------- Auditoría WORM (RN-02, D-03) ----------
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY,
  fecha_utc TEXT NOT NULL,
  usuario_id INTEGER,
  rol TEXT,
  accion TEXT NOT NULL,
  recurso TEXT,
  id_registro TEXT,
  paciente_id INTEGER,
  resultado TEXT NOT NULL,
  es_emergencia INTEGER NOT NULL DEFAULT 0,
  detalle TEXT,
  ip TEXT,
  hash_anterior TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS ix_aud_fecha ON auditoria (fecha_utc);
CREATE INDEX IF NOT EXISTS ix_aud_usuario ON auditoria (usuario_id, fecha_utc);
CREATE INDEX IF NOT EXISTS ix_aud_paciente ON auditoria (paciente_id, fecha_utc);

CREATE TRIGGER IF NOT EXISTS tr_auditoria_no_update
BEFORE UPDATE ON auditoria
BEGIN SELECT RAISE(ABORT, 'WORM: los registros de auditoría no se pueden modificar'); END;

CREATE TRIGGER IF NOT EXISTS tr_auditoria_no_delete
BEFORE DELETE ON auditoria
BEGIN SELECT RAISE(ABORT, 'WORM: los registros de auditoría no se pueden borrar'); END;
