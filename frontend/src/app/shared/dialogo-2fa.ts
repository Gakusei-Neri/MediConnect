import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

/** RN-01: verificación adicional antes de emitir receta o modificar diagnóstico. */
@Component({
  selector: 'app-dialogo-2fa',
  imports: [FormsModule],
  template: `
    <div class="fondo-dialogo">
      <form class="dialogo" role="dialog" aria-modal="true" aria-labelledby="t-2fa" (ngSubmit)="codigo.length === 6 && confirmar.emit(codigo)">
        <h2 id="t-2fa">🔐 Verificación adicional</h2>
        <p>{{ accion() }} requiere confirmar su identidad con el código de su aplicación autenticadora.</p>
        <div class="campo">
          <label for="c2fa">Código de 6 dígitos</label>
          <input id="c2fa" name="c2fa" inputmode="numeric" maxlength="6" autocomplete="one-time-code" [(ngModel)]="codigo" autofocus class="codigo" />
        </div>
        @if (error()) { <p class="mensaje error mt" role="alert">{{ error() }}</p> }
        <div class="fila fin mt">
          <button type="button" class="btn fantasma" (click)="cerrar.emit()" [disabled]="ocupado()">Cancelar</button>
          <button type="submit" class="btn" [disabled]="codigo.length !== 6 || ocupado()">
            @if (ocupado()) { <span class="cargando" aria-hidden="true"></span> } Confirmar
          </button>
        </div>
      </form>
    </div>
  `,
  styles: `.codigo { font-size: 1.5rem; letter-spacing: .4rem; text-align: center; }`,
})
export class Dialogo2fa {
  readonly accion = input('Esta acción');
  readonly error = input('');
  readonly ocupado = input(false);
  readonly confirmar = output<string>();
  readonly cerrar = output<void>();
  codigo = '';
}
