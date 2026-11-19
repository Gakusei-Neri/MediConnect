import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="acceso">
      <section class="tarjeta panel" aria-labelledby="titulo">
        <div class="marca"><span aria-hidden="true">✚</span> MediConnect <strong>Plus</strong></div>
        @if (!tokenTemporal()) {
          <h1 id="titulo">Iniciar sesión</h1>
          <form (ngSubmit)="entrar()" class="pila">
            <div class="campo">
              <label for="correo">Correo electrónico</label>
              <input id="correo" name="correo" type="email" autocomplete="username" required [(ngModel)]="correo" />
            </div>
            <div class="campo">
              <label for="password">Contraseña</label>
              <input id="password" name="password" type="password" autocomplete="current-password" required minlength="10" [(ngModel)]="password" />
            </div>
            @if (error()) { <p class="mensaje error" role="alert">{{ error() }}</p> }
            <button class="btn bloque" type="submit" [disabled]="cargando() || !correo || !password">
              @if (cargando()) { <span class="cargando" aria-hidden="true"></span> } Entrar
            </button>
          </form>
          <p class="mt atenuado">¿Es paciente nuevo? <a routerLink="/registro">Cree su cuenta</a></p>
        } @else {
          <h1 id="titulo">Verificación en dos pasos</h1>
          <p class="atenuado">Escriba el código de 6 dígitos de su aplicación autenticadora.</p>
          <form (ngSubmit)="verificar()" class="pila">
            <div class="campo">
              <label for="codigo">Código de verificación</label>
              <input id="codigo" name="codigo" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required [(ngModel)]="codigo" class="codigo" />
            </div>
            @if (error()) { <p class="mensaje error" role="alert">{{ error() }}</p> }
            <button class="btn bloque" type="submit" [disabled]="cargando() || codigo.length !== 6">Verificar</button>
            <button class="btn fantasma bloque" type="button" (click)="tokenTemporal.set(null); codigo = ''">Volver</button>
          </form>
        }
      </section>
      <aside class="tarjeta demo">
        <h2>Usuarios de demostración</h2>
        <p class="pequeno atenuado">Contraseña: <code>MediConnect2026!</code>. El código 2FA del personal clínico se obtiene con <code>npm run totp</code> en <code>backend/</code>.</p>
        <ul>
          @for (u of demo; track u.correo) {
            <li><button type="button" class="btn fantasma chico" (click)="usar(u.correo)">{{ u.correo }}</button> <span class="insignia">{{ u.rol }}</span></li>
          }
        </ul>
      </aside>
    </div>
  `,
  styles: `
    .acceso { min-height: 100vh; display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: center; justify-content: center; padding: 1.5rem 1rem; background: linear-gradient(160deg, #e1f2f3, #f4f7f9 60%); }
    .panel { width: 100%; max-width: 420px; padding: 2rem; }
    .marca { font-size: 1.2rem; color: var(--c-primario-osc); margin-bottom: 1.25rem; }
    .codigo { font-size: 1.6rem; letter-spacing: .5rem; text-align: center; }
    .demo { max-width: 420px; width: 100%; }
    .demo ul { list-style: none; padding: 0; margin: 0; display: grid; gap: .1rem; }
    .demo li { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
    .demo .btn { font-weight: 500; font-size: .85rem; padding: .2rem .4rem; }
  `,
})
export class Login {
  private auth = inject(Auth);
  private router = inject(Router);
  correo = '';
  password = '';
  codigo = '';
  protected tokenTemporal = signal<string | null>(null);
  protected cargando = signal(false);
  protected error = signal('');

  protected demo = [
    { correo: 'juan.gomez@correo.test', rol: 'Paciente' },
    { correo: 'maria.mendez@correo.test', rol: 'Paciente' },
    { correo: 'recepcion.norte@mediconnect.test', rol: 'Recepción' },
    { correo: 'medico.general@mediconnect.test', rol: 'Médico' },
    { correo: 'medico.cardio@mediconnect.test', rol: 'Médico' },
    { correo: 'enfermera.norte@mediconnect.test', rol: 'Enfermería' },
    { correo: 'seguridad@mediconnect.test', rol: 'Seguridad' },
    { correo: 'admin@mediconnect.test', rol: 'Admin' },
  ];

  usar(correo: string) {
    this.correo = correo;
    this.password = 'MediConnect2026!';
  }

  async entrar() {
    this.error.set('');
    this.cargando.set(true);
    try {
      const r = await this.auth.login(this.correo.trim(), this.password);
      if (r.requiere2fa) this.tokenTemporal.set(r.tokenTemporal!);
      else await this.router.navigateByUrl(this.auth.inicio());
    } catch (e: any) {
      this.error.set(e.status === 423 ? 'Cuenta bloqueada temporalmente por intentos fallidos. Intente más tarde.' : e.message);
    } finally {
      this.cargando.set(false);
    }
  }

  async verificar() {
    this.error.set('');
    this.cargando.set(true);
    try {
      await this.auth.segundoFactor(this.tokenTemporal()!, this.codigo);
      await this.router.navigateByUrl(this.auth.inicio());
    } catch (e: any) {
      this.error.set(e.message);
      this.codigo = '';
      if (e.status === 401 && /expir/.test(e.message)) this.tokenTemporal.set(null);
    } finally {
      this.cargando.set(false);
    }
  }
}
