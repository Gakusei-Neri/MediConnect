import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { Avisos } from '../../core/avisos.service';

/** RF-01: registro de paciente con verificación por código de un solo uso. */
@Component({
  selector: 'app-registro',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="acceso">
      <section class="tarjeta panel" aria-labelledby="titulo">
        <h1 id="titulo">Crear cuenta de paciente</h1>
        @if (!verificacion()) {
          <form (ngSubmit)="solicitar()" class="formulario" #f="ngForm">
            <div class="campo completo">
              <label for="nombre">Nombre completo</label>
              <input id="nombre" name="nombre" required autocomplete="name" [(ngModel)]="d.nombreCompleto" />
            </div>
            <div class="campo">
              <label for="curp">CURP</label>
              <input id="curp" name="curp" required maxlength="18" pattern="[A-Za-z0-9]{18}" [(ngModel)]="d.curp" (ngModelChange)="d.curp = $event.toUpperCase()" aria-describedby="ayuda-curp" />
              <span id="ayuda-curp" class="ayuda">18 caracteres</span>
            </div>
            <div class="campo">
              <label for="nac">Fecha de nacimiento</label>
              <input id="nac" name="nac" type="date" required [(ngModel)]="d.fechaNacimiento" [max]="hoy" />
            </div>
            <div class="campo">
              <label for="correo">Correo electrónico</label>
              <input id="correo" name="correo" type="email" required autocomplete="email" [(ngModel)]="d.correo" />
            </div>
            <div class="campo">
              <label for="tel">Teléfono celular</label>
              <input id="tel" name="tel" type="tel" required inputmode="numeric" pattern="\\+?[0-9]{10,15}" autocomplete="tel" [(ngModel)]="d.telefono" />
            </div>
            <div class="campo">
              <label for="pw">Contraseña</label>
              <input id="pw" name="pw" type="password" required minlength="10" autocomplete="new-password" [(ngModel)]="d.password" aria-describedby="ayuda-pw" />
              <span id="ayuda-pw" class="ayuda">Mínimo 10 caracteres</span>
            </div>
            <div class="campo">
              <label for="pw2">Confirmar contraseña</label>
              <input id="pw2" name="pw2" type="password" required autocomplete="new-password" [(ngModel)]="password2" />
            </div>
            <div class="campo">
              <label for="canal">Enviar código y avisos por</label>
              <select id="canal" name="canal" [(ngModel)]="d.canalVerificacion">
                <option value="CORREO">Correo</option>
                <option value="SMS">SMS</option>
              </select>
            </div>
            <div class="completo aviso-priv">
              <label class="check">
                <input type="checkbox" name="aviso" required [(ngModel)]="d.aceptaAvisoPrivacidad" />
                <span>He leído y acepto el <a href="#" (click)="$event.preventDefault(); verAviso.set(!verAviso())">aviso de privacidad</a> para el tratamiento de mis datos personales y de salud.</span>
              </label>
              @if (verAviso()) {
                <div class="mensaje info mt pequeno">
                  MediConnect Plus trata sus datos de identificación, contacto y salud con la finalidad de brindarle atención médica,
                  agendar citas, emitir recetas y mantener su expediente clínico conforme a la LFPDPPP y a las NOM-004-SSA3 y NOM-024-SSA3.
                  Sus datos clínicos se cifran y cada acceso queda registrado. Puede ejercer sus derechos ARCO en cualquier sede.
                  <em>(Texto provisional pendiente de validación legal.)</em>
                </div>
              }
            </div>
            @if (error()) { <p class="mensaje error completo" role="alert">{{ error() }}</p> }
            <div class="completo fila entre">
              <a routerLink="/login">Ya tengo cuenta</a>
              <button class="btn" type="submit" [disabled]="cargando() || !f.valid || !d.aceptaAvisoPrivacidad">Continuar</button>
            </div>
          </form>
        } @else {
          <p>Enviamos un código de 6 dígitos a <strong>{{ verificacion()!.destino }}</strong>. Vence en {{ verificacion()!.expiraEnMin }} minutos.</p>
          @if (verificacion()!.codigoDev) {
            <p class="mensaje info pequeno">Modo desarrollo: el código es <strong class="mono">{{ verificacion()!.codigoDev }}</strong></p>
          }
          <form (ngSubmit)="verificar()" class="pila">
            <div class="campo">
              <label for="codigo">Código de verificación</label>
              <input id="codigo" name="codigo" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required [(ngModel)]="codigo" />
            </div>
            @if (error()) { <p class="mensaje error" role="alert">{{ error() }}</p> }
            <div class="fila entre">
              <button class="btn fantasma" type="button" (click)="verificacion.set(null)">Corregir datos</button>
              <button class="btn" type="submit" [disabled]="cargando() || codigo.length !== 6">Crear cuenta</button>
            </div>
          </form>
        }
      </section>
    </div>
  `,
  styles: `
    .acceso { min-height: 100vh; display: grid; place-items: center; padding: 1.5rem 1rem; background: linear-gradient(160deg, #e1f2f3, #f4f7f9 60%); }
    .panel { width: 100%; max-width: 720px; padding: 1.75rem; }
  `,
})
export class Registro {
  private api = inject(Api);
  private router = inject(Router);
  private avisos = inject(Avisos);
  protected hoy = new Date().toISOString().slice(0, 10);
  d = { nombreCompleto: '', curp: '', fechaNacimiento: '', correo: '', telefono: '', password: '', canalVerificacion: 'CORREO', canalPreferido: 'CORREO', aceptaAvisoPrivacidad: false };
  password2 = '';
  codigo = '';
  protected verificacion = signal<{ verificacionId: string; destino: string; expiraEnMin: number; codigoDev?: string } | null>(null);
  protected cargando = signal(false);
  protected error = signal('');
  protected verAviso = signal(false);

  async solicitar() {
    this.error.set('');
    if (this.d.password !== this.password2) return this.error.set('Las contraseñas no coinciden');
    this.cargando.set(true);
    try {
      this.verificacion.set(await this.api.post('/auth/registro/solicitar', { ...this.d, canalPreferido: this.d.canalVerificacion }));
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.cargando.set(false);
    }
  }

  async verificar() {
    this.error.set('');
    this.cargando.set(true);
    try {
      await this.api.post('/auth/registro/verificar', { verificacionId: this.verificacion()!.verificacionId, codigo: this.codigo });
      this.avisos.ok('Cuenta creada. Ya puede iniciar sesión.');
      await this.router.navigateByUrl('/login');
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.cargando.set(false);
    }
  }
}
