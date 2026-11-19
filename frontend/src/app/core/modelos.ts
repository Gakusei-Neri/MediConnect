export type Rol = 'PACIENTE' | 'RECEPCION' | 'MEDICO' | 'ENFERMERO' | 'SEGURIDAD' | 'ADMINISTRADOR';
export type Modalidad = 'PRESENCIAL' | 'VIRTUAL';
export type EstadoCita =
  | 'AGENDADA' | 'NOTIFICADA' | 'CONFIRMADA' | 'EN_SALA_ESPERA' | 'TELEMEDICINA_CONECTADA' | 'EN_CONSULTA'
  | 'FINALIZADA' | 'CANCELADA_POR_USUARIO' | 'CANCELADA_AUTOMATICA' | 'NO_ASISTIO' | 'DERIVADA_URGENCIAS';

export interface Usuario {
  id: number;
  nombre: string;
  correo: string;
  telefono: string;
  rol: Rol;
  canalPreferido: 'CORREO' | 'SMS';
  sede: { id: number; nombre: string } | null;
  especialidadId: number | null;
  pacienteId: number | null;
}

export interface Sede { id: number; nombre: string; tipo: string; direccion: string; zona_horaria: string }
export interface Especialidad { id: number; nombre: string; duracion_min: number }
export interface Medico { id: number; nombre_completo: string; especialidad_id: number; especialidad_nombre: string }
export interface Motivo { id: number; descripcion: string }
export interface Medicamento { id: number; codigo: string; nombre: string; presentacion: string; componente: string; componente_id: number }
export interface Componente { id: number; nombre: string }
export interface Diagnostico { id: number; codigo: string; descripcion: string }

export interface Cupo {
  id: number; inicio: string; fin: string; modalidad: Modalidad;
  medico_id: number; medico_nombre: string; sede_id: number; sede_nombre: string; zona_horaria: string;
  especialidad_id: number; especialidad_nombre: string;
}

export interface Cita {
  id: number; paciente_id: number; paciente_nombre: string; paciente_curp: string;
  medico_id: number | null; medico_nombre: string | null; sede_id: number; sede_nombre: string; zona_horaria: string;
  especialidad_id: number | null; especialidad_nombre: string | null; cupo_id: number | null;
  fecha_hora: string; fecha_fin: string; modalidad: Modalidad; estado: EstadoCita; es_urgencia: number;
  motivo_urgencia: string | null; reprogramaciones: number; motivo_cancelacion: string | null;
}

export interface Comprobante {
  citaId: number; folio: string; paciente: string; medico: string; especialidad: string; sede: string;
  modalidad: Modalidad; fechaHora: string; fechaHoraLocal: string; estado: EstadoCita;
}

export interface Alergia { id: number; componente_id: number; componente: string; severidad: 'LEVE' | 'MODERADA' | 'SEVERA'; fecha_registro: string; registrada_por: string }

export interface DetalleReceta { id: number; medicamento_id: number; codigo: string; nombre: string; presentacion: string; componente: string; dosis: string; frecuencia: string; duracion: string; cantidad: number }

export interface Receta {
  id: number; folio: string; fecha_emision: string; vigente_hasta: string; surtida: boolean; anulada: boolean; vencida: boolean;
  motivo_anulacion: string | null; reserva_estado: string | null; reserva_vigente_hasta: string | null;
  medico_nombre: string; paciente_nombre: string; cedula_profesional: string | null; medicamentos: DetalleReceta[]; qr: string;
}

export interface Consulta {
  id: number; citaId: number; fecha: string; medico: string; sede: string; motivo: string | null;
  signosVitales: Record<string, number> | null; notasEvolucion?: string | null; firmada: boolean;
  diagnosticos: Diagnostico[];
  addendums: { id: number; autor: string; fecha: string; texto?: string; diagnosticosAgregados: Diagnostico[] }[];
  citaEstado?: EstadoCita; pacienteId?: number; receta?: { id: number; folio: string } | null;
}

export interface Expediente {
  accesoVia: string; esEmergencia: boolean;
  paciente: { id: number; nombre_completo: string; curp: string; fecha_nacimiento: string; edad: number; correo: string; telefono: string };
  expediente: { id: number; fechaCreacion: string; antecedentes: string | null; sinAlergiasConocidas: boolean; sinAlergiasFecha: string | null };
  alergias: Alergia[];
  consultas: Consulta[];
  recetas: (Omit<Receta, 'qr' | 'medico_nombre' | 'paciente_nombre' | 'cedula_profesional' | 'vencida' | 'reserva_vigente_hasta'> & { consulta_id: number })[];
}

export interface Notificacion { id: number; tipo: string; canal: string; asunto: string; contenido: string; fecha_envio: string; leida: number; es_alterno: number }

export const ESTADOS_CITA: Record<EstadoCita, { texto: string; tono: string }> = {
  AGENDADA: { texto: 'Agendada', tono: 'info' },
  NOTIFICADA: { texto: 'Por confirmar', tono: 'aviso' },
  CONFIRMADA: { texto: 'Confirmada', tono: 'ok' },
  EN_SALA_ESPERA: { texto: 'En sala de espera', tono: 'aviso' },
  TELEMEDICINA_CONECTADA: { texto: 'Conectado (video)', tono: 'aviso' },
  EN_CONSULTA: { texto: 'En consulta', tono: 'primario' },
  FINALIZADA: { texto: 'Finalizada', tono: 'neutro' },
  CANCELADA_POR_USUARIO: { texto: 'Cancelada', tono: 'error' },
  CANCELADA_AUTOMATICA: { texto: 'Cancelada (sin confirmar)', tono: 'error' },
  NO_ASISTIO: { texto: 'No asistió', tono: 'error' },
  DERIVADA_URGENCIAS: { texto: 'Derivada a urgencias', tono: 'error' },
};

export const ROLES_TEXTO: Record<Rol, string> = {
  PACIENTE: 'Paciente', RECEPCION: 'Recepción', MEDICO: 'Médico', ENFERMERO: 'Enfermería', SEGURIDAD: 'Seguridad', ADMINISTRADOR: 'Administrador',
};

export const RESERVA_TEXTO: Record<string, { texto: string; tono: string }> = {
  PENDIENTE: { texto: 'Reservando…', tono: 'info' },
  CONFIRMADA: { texto: 'Reservada en farmacia', tono: 'ok' },
  SIN_STOCK: { texto: 'Sin stock', tono: 'aviso' },
  FALLIDA: { texto: 'Reserva fallida', tono: 'error' },
  SURTIDA: { texto: 'Surtida', tono: 'neutro' },
  CANCELADA: { texto: 'Reserva cancelada', tono: 'neutro' },
};

export const SIGNOS_VITALES: { clave: string; etiqueta: string; unidad: string; paso: number }[] = [
  { clave: 'peso', etiqueta: 'Peso', unidad: 'kg', paso: 0.1 },
  { clave: 'talla', etiqueta: 'Talla', unidad: 'cm', paso: 1 },
  { clave: 'presionSistolica', etiqueta: 'Presión sistólica', unidad: 'mmHg', paso: 1 },
  { clave: 'presionDiastolica', etiqueta: 'Presión diastólica', unidad: 'mmHg', paso: 1 },
  { clave: 'frecuenciaCardiaca', etiqueta: 'Frecuencia cardiaca', unidad: 'lpm', paso: 1 },
  { clave: 'frecuenciaRespiratoria', etiqueta: 'Frecuencia respiratoria', unidad: 'rpm', paso: 1 },
  { clave: 'temperatura', etiqueta: 'Temperatura', unidad: '°C', paso: 0.1 },
  { clave: 'saturacionOxigeno', etiqueta: 'Saturación O₂', unidad: '%', paso: 1 },
];
