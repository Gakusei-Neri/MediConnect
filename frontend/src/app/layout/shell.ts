import { Component, computed, inject, signal, OnDestroy, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from '../core/auth.service';
import { Api } from '../core/api.service';
import { ROLES_TEXTO, Rol } from '../core/modelos';

interface Enlace { ruta: string; texto: string; exacto?: boolean }

const MENU: Record<Rol, Enlace[]> = {
  PACIENTE: [
    { ruta: '/paciente', texto: 'Inicio', exacto: true },
    { ruta: '/paciente/agendar', texto: 'Agendar cita' },
    { ruta: '/paciente/citas', texto: 'Mis citas' },
    { ruta: '/paciente/recetas', texto: 'Recetas e historial' },
    { ruta: '/paciente/lista-espera', texto: 'Lista de espera' },
  ],
  RECEPCION: [
    { ruta: '/recepcion', texto: 'Citas del día', exacto: true },
    { ruta: '/recepcion/agendar', texto: 'Agendar' },
    { ruta: '/recepcion/urgencias', texto: 'Urgencias' },
    { ruta: '/recepcion/agenda', texto: 'Agenda médica' },
    { ruta: '/recepcion/lista-espera', texto: 'Lista de espera' },
  ],
  MEDICO: [
    { ruta: '/clinico', texto: 'Mi agenda', exacto: true },
    { ruta: '/clinico/urgencias', texto: 'Urgencias' },
    { ruta: '/clinico/buscar', texto: 'Buscar paciente' },
  ],
  ENFERMERO: [
    { ruta: '/clinico', texto: 'Citas de la sede', exacto: true },
    { ruta: '/clinico/urgencias', texto: 'Urgencias' },
  ],
  SEGURIDAD: [
    { ruta: '/seguridad', texto: 'Auditoría', exacto: true },
    { ruta: '/seguridad/alertas', texto: 'Alertas de emergencia' },
  ],
  ADMINISTRADOR: [
    { ruta: '/admin', texto: 'Usuarios', exacto: true },
    { ruta: '/admin/agenda', texto: 'Agenda médica' },
    { ruta: '/admin/catalogos', texto: 'Catálogos' },
    { ruta: '/admin/parametros', texto: 'Parámetros' },
  ],
};

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <a class="saltar" href="#principal">Saltar al contenido</a>
    <header class="barra">
      <div class="barra-in">
        <a class="marca" [routerLink]="auth.inicio()" aria-label="MediConnect Plus, inicio">
          <span class="logo" aria-hidden="true">✚</span> MediConnect <strong>Plus</strong>
        </a>
        <button class="btn fantasma menu-btn" (click)="abierto.set(!abierto())" [attr.aria-expanded]="abierto()" aria-controls="nav-principal">
          ☰ <span class="sr-only">Menú</span>
        </button>
        <nav id="nav-principal" [class.abierto]="abierto()" aria-label="Principal">
          @for (e of menu(); track e.ruta) {
            <a [routerLink]="e.ruta" routerLinkActive="activo" [routerLinkActiveOptions]="{ exact: !!e.exacto }" (click)="abierto.set(false)">{{ e.texto }}</a>
          }
        </nav>
        <div class="usuario">
          <a routerLink="/notificaciones" class="campana" [attr.aria-label]="'Notificaciones' + (sinLeer() ? ', ' + sinLeer() + ' sin leer' : '')">
            🔔 @if (sinLeer()) { <span class="contador">{{ sinLeer() }}</span> }
          </a>
          <div class="quien">
            <span class="nombre">{{ auth.usuario()?.nombre }}</span>
            <span class="rol">{{ rolTexto() }}@if (auth.usuario()?.sede) { · {{ auth.usuario()?.sede?.nombre }} }</span>
          </div>
          <button class="btn secundario chico" (click)="auth.logout()">Salir</button>
        </div>
      </div>
    </header>
    <main id="principal" class="contenedor" tabindex="-1">
      <router-outlet />
    </main>
  `,
  styles: `
    .saltar { position: absolute; left: -999px; top: 0; background: #fff; padding: .5rem 1rem; z-index: 100; }
    .saltar:focus { left: .5rem; }
    .barra { background: var(--c-primario-osc); color: #fff; position: sticky; top: 0; z-index: 20; }
    .barra-in { max-width: 1200px; margin: 0 auto; padding: .4rem 1rem; display: flex; align-items: center; gap: 1rem; min-height: 60px; }
    .marca { color: #fff; text-decoration: none; font-size: 1.1rem; display: flex; align-items: center; gap: .4rem; white-space: nowrap; }
    .logo { background: #fff; color: var(--c-primario-osc); border-radius: 6px; width: 28px; height: 28px; display: grid; place-items: center; font-weight: 800; }
    nav { display: flex; gap: .15rem; flex: 1; flex-wrap: wrap; }
    nav a { color: #e3f3f4; text-decoration: none; padding: .55rem .75rem; border-radius: 6px; font-weight: 500; }
    nav a:hover { background: rgba(255,255,255,.12); }
    nav a.activo { background: #fff; color: var(--c-primario-osc); font-weight: 700; }
    .usuario { display: flex; align-items: center; gap: .75rem; }
    .quien { display: flex; flex-direction: column; line-height: 1.2; text-align: right; }
    .nombre { font-weight: 600; font-size: .92rem; }
    .rol { font-size: .78rem; color: #cde7ea; }
    .campana { color: #fff; text-decoration: none; position: relative; font-size: 1.2rem; padding: .4rem; }
    .contador { position: absolute; top: -2px; right: -4px; background: #f0a500; color: #1a2733; border-radius: 999px; font-size: .7rem; font-weight: 800; padding: 0 .35rem; }
    .usuario .btn { color: #fff; border-color: #fff; background: transparent; }
    .menu-btn { display: none; color: #fff; font-size: 1.3rem; }
    @media (max-width: 900px) {
      .barra-in { flex-wrap: wrap; }
      .menu-btn { display: inline-flex; margin-left: auto; }
      nav { display: none; order: 3; flex-basis: 100%; flex-direction: column; padding-bottom: .5rem; }
      nav.abierto { display: flex; }
      .usuario { order: 2; }
      .quien { display: none; }
    }
  `,
})
export class Shell implements OnInit, OnDestroy {
  protected auth = inject(Auth);
  private api = inject(Api);
  protected abierto = signal(false);
  protected sinLeer = signal(0);
  protected menu = computed(() => (this.auth.rol() ? MENU[this.auth.rol()!] : []));
  protected rolTexto = computed(() => (this.auth.rol() ? ROLES_TEXTO[this.auth.rol()!] : ''));
  private intervalo: any;

  ngOnInit() {
    this.contar();
    this.intervalo = setInterval(() => this.contar(), 30_000);
  }
  ngOnDestroy() { clearInterval(this.intervalo); }

  private async contar() {
    if (!this.auth.autenticado()) return;
    try {
      const n = await this.api.get<any[]>('/notificaciones');
      this.sinLeer.set(n.filter((x) => !x.leida).length);
    } catch { /* */ }
  }
}
