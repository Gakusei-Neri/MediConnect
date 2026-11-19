import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from './api.service';
import { Rol, Usuario } from './modelos';
import { Avisos } from './avisos.service';

const CLAVE = 'mediconnect.sesion';

/** Rutas de inicio por rol. */
export const INICIO_POR_ROL: Record<Rol, string> = {
  PACIENTE: '/paciente',
  RECEPCION: '/recepcion',
  MEDICO: '/clinico',
  ENFERMERO: '/clinico',
  SEGURIDAD: '/seguridad',
  ADMINISTRADOR: '/admin',
};

@Injectable({ providedIn: 'root' })
export class Auth {
  private api = inject(Api);
  private router = inject(Router);
  private avisos = inject(Avisos);

  readonly token = signal<string | null>(null);
  readonly usuario = signal<Usuario | null>(null);
  readonly autenticado = computed(() => !!this.token() && !!this.usuario());
  readonly rol = computed(() => this.usuario()?.rol ?? null);

  private inactividadMin = 15;
  private ultimaActividad = Date.now();
  private ultimoPing = 0;
  private temporizador: any = null;

  constructor() {
    // sessionStorage: la sesión no sobrevive al cierre de la pestaña (datos clínicos)
    try {
      const guardada = sessionStorage.getItem(CLAVE);
      if (guardada) {
        const s = JSON.parse(guardada);
        this.token.set(s.token);
        this.usuario.set(s.usuario);
        this.inactividadMin = s.inactividadMin ?? 15;
        this.vigilarInactividad();
      }
    } catch { /* almacenamiento no disponible */ }
    for (const ev of ['click', 'keydown', 'pointermove', 'scroll', 'touchstart']) {
      window.addEventListener(ev, () => this.registrarActividad(), { passive: true });
    }
  }

  async login(correo: string, password: string): Promise<{ requiere2fa: boolean; tokenTemporal?: string }> {
    const r = await this.api.post('/auth/login', { correo, password });
    if (r.requiere2fa) return { requiere2fa: true, tokenTemporal: r.tokenTemporal };
    this.iniciar(r);
    return { requiere2fa: false };
  }

  async segundoFactor(tokenTemporal: string, codigo: string) {
    this.iniciar(await this.api.post('/auth/2fa', { tokenTemporal, codigo }));
  }

  private iniciar(r: { token: string; usuario: Usuario; inactividadMin: number }) {
    this.token.set(r.token);
    this.usuario.set(r.usuario);
    this.inactividadMin = r.inactividadMin;
    this.ultimaActividad = Date.now();
    try { sessionStorage.setItem(CLAVE, JSON.stringify(r)); } catch { /* */ }
    this.vigilarInactividad();
  }

  actualizarUsuario(u: Usuario) {
    this.usuario.set(u);
    try {
      const s = JSON.parse(sessionStorage.getItem(CLAVE) || '{}');
      sessionStorage.setItem(CLAVE, JSON.stringify({ ...s, usuario: u }));
    } catch { /* */ }
  }

  async logout(motivo?: string) {
    if (this.token()) this.api.post('/auth/logout').catch(() => undefined);
    this.limpiar();
    if (motivo) this.avisos.info(motivo);
    await this.router.navigateByUrl('/login');
  }

  /** Se llama cuando la API responde 401. */
  sesionExpirada(mensaje = 'Su sesión expiró') {
    if (!this.token()) return;
    this.limpiar();
    this.avisos.info(mensaje);
    this.router.navigateByUrl('/login');
  }

  private limpiar() {
    this.token.set(null);
    this.usuario.set(null);
    clearInterval(this.temporizador);
    try { sessionStorage.removeItem(CLAVE); } catch { /* */ }
  }

  inicio(): string {
    const r = this.rol();
    return r ? INICIO_POR_ROL[r] : '/login';
  }

  // RN-01: cierre por inactividad (P-07). La UI cierra sola y el servidor también lo exige.
  private registrarActividad() {
    if (!this.token()) return;
    this.ultimaActividad = Date.now();
    if (Date.now() - this.ultimoPing > 60_000) {
      this.ultimoPing = Date.now();
      this.api.post('/auth/actividad').catch(() => undefined);
    }
  }

  private vigilarInactividad() {
    clearInterval(this.temporizador);
    this.temporizador = setInterval(() => {
      if (this.token() && Date.now() - this.ultimaActividad > this.inactividadMin * 60_000) {
        this.logout(`Sesión cerrada tras ${this.inactividadMin} min de inactividad`);
      }
    }, 15_000);
  }
}
