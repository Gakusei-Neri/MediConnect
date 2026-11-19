import { Routes } from '@angular/router';
import { requiereRol, requiereSesion, soloInvitado } from './core/interceptores';
import { Shell } from './layout/shell';

export const routes: Routes = [
  { path: 'login', canActivate: [soloInvitado], loadComponent: () => import('./pages/auth/login').then((m) => m.Login), title: 'Iniciar sesión · MediConnect Plus' },
  { path: 'registro', canActivate: [soloInvitado], loadComponent: () => import('./pages/auth/registro').then((m) => m.Registro), title: 'Registro · MediConnect Plus' },
  {
    path: 'videoconsulta/:token', canActivate: [requiereRol('PACIENTE', 'MEDICO')],
    loadComponent: () => import('./pages/comun/videoconsulta').then((m) => m.Videoconsulta), title: 'Videoconsulta · MediConnect Plus',
  },
  {
    path: '', component: Shell, canActivate: [requiereSesion],
    children: [
      { path: 'notificaciones', loadComponent: () => import('./pages/comun/notificaciones').then((m) => m.Notificaciones), title: 'Notificaciones' },
      {
        path: 'paciente', canActivate: [requiereRol('PACIENTE')],
        children: [
          { path: '', loadComponent: () => import('./pages/paciente/inicio').then((m) => m.InicioPaciente), title: 'Inicio · Paciente' },
          { path: 'agendar', loadComponent: () => import('./pages/paciente/agendar').then((m) => m.AgendarPaciente), title: 'Agendar cita' },
          { path: 'citas', loadComponent: () => import('./pages/paciente/mis-citas').then((m) => m.MisCitas), title: 'Mis citas' },
          { path: 'recetas', loadComponent: () => import('./pages/paciente/recetas').then((m) => m.MisRecetas), title: 'Recetas e historial' },
          { path: 'lista-espera', loadComponent: () => import('./pages/paciente/lista-espera').then((m) => m.ListaEsperaPaciente), title: 'Lista de espera' },
        ],
      },
      {
        path: 'recepcion', canActivate: [requiereRol('RECEPCION')],
        children: [
          { path: '', loadComponent: () => import('./pages/recepcion/citas-dia').then((m) => m.CitasDia), title: 'Citas del día' },
          { path: 'agendar', loadComponent: () => import('./pages/recepcion/agendar').then((m) => m.AgendarRecepcion), title: 'Agendar · Recepción' },
          { path: 'urgencias', loadComponent: () => import('./pages/recepcion/urgencias').then((m) => m.UrgenciasRecepcion), title: 'Urgencias' },
          { path: 'agenda', loadComponent: () => import('./pages/recepcion/agenda-medica').then((m) => m.AgendaMedica), title: 'Agenda médica' },
          { path: 'lista-espera', loadComponent: () => import('./pages/recepcion/lista-espera').then((m) => m.ListaEsperaRecepcion), title: 'Lista de espera' },
        ],
      },
      {
        path: 'clinico', canActivate: [requiereRol('MEDICO', 'ENFERMERO')],
        children: [
          { path: '', loadComponent: () => import('./pages/clinico/agenda').then((m) => m.AgendaClinica), title: 'Agenda clínica' },
          { path: 'urgencias', loadComponent: () => import('./pages/clinico/urgencias').then((m) => m.UrgenciasClinico), title: 'Cola de urgencias' },
          { path: 'buscar', canActivate: [requiereRol('MEDICO')], loadComponent: () => import('./pages/clinico/buscar').then((m) => m.BuscarPaciente), title: 'Buscar paciente' },
          { path: 'expediente/:pacienteId', loadComponent: () => import('./pages/clinico/expediente').then((m) => m.ExpedienteClinico), title: 'Expediente clínico' },
          { path: 'consulta/:citaId', loadComponent: () => import('./pages/clinico/consulta').then((m) => m.ConsultaMedica), title: 'Consulta' },
        ],
      },
      {
        path: 'seguridad', canActivate: [requiereRol('SEGURIDAD')],
        children: [
          { path: '', loadComponent: () => import('./pages/seguridad/auditoria').then((m) => m.Auditoria), title: 'Auditoría' },
          { path: 'alertas', loadComponent: () => import('./pages/seguridad/alertas').then((m) => m.AlertasEmergencia), title: 'Alertas de emergencia' },
        ],
      },
      {
        path: 'admin', canActivate: [requiereRol('ADMINISTRADOR')],
        children: [
          { path: '', loadComponent: () => import('./pages/admin/usuarios').then((m) => m.Usuarios), title: 'Usuarios' },
          { path: 'agenda', loadComponent: () => import('./pages/recepcion/agenda-medica').then((m) => m.AgendaMedica), title: 'Agenda médica' },
          { path: 'catalogos', loadComponent: () => import('./pages/admin/catalogos').then((m) => m.CatalogosAdmin), title: 'Catálogos' },
          { path: 'parametros', loadComponent: () => import('./pages/admin/parametros').then((m) => m.Parametros), title: 'Parámetros' },
        ],
      },
      { path: '', pathMatch: 'full', loadComponent: () => import('./pages/comun/redireccion').then((m) => m.Redireccion) },
    ],
  },
  { path: '**', redirectTo: '' },
];
