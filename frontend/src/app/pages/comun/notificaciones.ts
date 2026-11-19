import { Component, inject, OnInit, signal } from '@angular/core';
import { Api } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { Avisos } from '../../core/avisos.service';
import { Notificacion } from '../../core/modelos';
import { FechaPipe } from '../../shared/pipes';
import { FormsModule } from '@angular/forms';

/** Bandeja de notificaciones (el correo y el SMS están simulados, D-08). */
@Component({
  selector: 'app-notificaciones',
  imports: [FechaPipe, FormsModule],
  template: `
    <div class="encabezado-pagina">
      <div>
        <h1>Notificaciones</h1>
        <p>Copia de los correos y SMS enviados a su cuenta (simulados en este entorno).</p>
      </div>
      <button class="btn secundario" (click)="marcar()" [disabled]="!lista().length">Marcar como leídas</button>
    </div>
    <section class="tarjeta mb">
      <h2>Canal preferido</h2>
      <div class="fila">
        <label class="check"><input type="radio" name="canal" value="CORREO" [(ngModel)]="canal" (change)="guardarCanal()" /> Correo</label>
        <label class="check"><input type="radio" name="canal" value="SMS" [(ngModel)]="canal" (change)="guardarCanal()" /> SMS</label>
        <span class="atenuado pequeno">Si el canal preferido falla, se usa el otro automáticamente.</span>
      </div>
    </section>
    @if (!lista().length) { <p class="tarjeta vacio">No tiene notificaciones.</p> }
    <ul class="lista">
      @for (n of lista(); track n.id) {
        <li class="tarjeta" [class.resaltada]="!n.leida">
          <div class="fila entre">
            <strong>{{ n.asunto }}</strong>
            <span class="pequeno atenuado">{{ n.fecha_envio | fecha }} · {{ n.canal }}@if (n.es_alterno) { (alterno) }</span>
          </div>
          <p class="mb-0">{{ n.contenido }}</p>
        </li>
      }
    </ul>
  `,
  styles: `.lista { list-style: none; padding: 0; display: grid; gap: .6rem; } .mb-0 { margin: .3rem 0 0; word-break: break-word; }`,
})
export class Notificaciones implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  protected lista = signal<Notificacion[]>([]);
  canal = this.auth.usuario()?.canalPreferido ?? 'CORREO';

  async ngOnInit() { this.lista.set(await this.api.get('/notificaciones')); }

  async marcar() {
    await this.api.post('/notificaciones/leidas');
    this.lista.update((l) => l.map((n) => ({ ...n, leida: 1 })));
  }

  async guardarCanal() {
    try {
      this.auth.actualizarUsuario(await this.api.put('/auth/perfil', { canalPreferido: this.canal }));
      this.avisos.ok('Canal preferido actualizado');
    } catch (e) { this.avisos.error(e); }
  }
}
