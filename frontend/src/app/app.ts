import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Avisos } from './core/avisos.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    <router-outlet />
    <div class="avisos" role="status" aria-live="polite">
      @for (a of avisos.lista(); track a.id) {
        <div class="aviso mensaje" [class]="a.tipo">
          <span>{{ a.texto }}</span>
          <button type="button" (click)="avisos.cerrar(a.id)" aria-label="Cerrar mensaje">×</button>
        </div>
      }
    </div>
  `,
  styles: `
    .avisos { position: fixed; bottom: 1rem; right: 1rem; left: 1rem; display: flex; flex-direction: column; align-items: flex-end; gap: .5rem; z-index: 100; pointer-events: none; }
    .aviso { pointer-events: auto; display: flex; gap: .75rem; align-items: flex-start; max-width: 420px; box-shadow: 0 4px 16px rgba(0,0,0,.15); background: #fff; }
    .aviso button { background: none; border: 0; font-size: 1.3rem; line-height: 1; cursor: pointer; color: inherit; padding: 0 .2rem; }
  `,
})
export class App {
  protected avisos = inject(Avisos);
}
