import { Component, inject, input, OnInit, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Catalogos } from '../core/catalogos.service';
import { Alergia } from '../core/modelos';
import { FechaPipe } from './pipes';

/** RF-15: alergias por componente activo y severidad, o "sin alergias conocidas". */
@Component({
  selector: 'app-panel-alergias',
  imports: [FormsModule, FechaPipe],
  template: `
    <section class="tarjeta" [class.alerta]="tieneSevera()" aria-labelledby="t-alergias">
      <h2 id="t-alergias">⚠️ Alergias</h2>
      @if (alergias().length) {
        <ul class="lista">
          @for (a of alergias(); track a.id) {
            <li class="fila entre">
              <span><strong>{{ a.componente }}</strong> <span class="insignia" [class.error]="a.severidad === 'SEVERA'" [class.aviso]="a.severidad !== 'SEVERA'">{{ a.severidad }}</span>
                <br /><span class="pequeno atenuado">{{ a.registrada_por }} · {{ a.fecha_registro | fecha }}</span></span>
              @if (editable()) { <button class="btn fantasma chico" (click)="baja(a)" [attr.aria-label]="'Dar de baja alergia a ' + a.componente">Baja</button> }
            </li>
          }
        </ul>
      } @else if (sinAlergias()) {
        <p class="mensaje ok">Sin alergias conocidas @if (sinAlergiasFecha()) { <span class="pequeno">(registrado {{ sinAlergiasFecha() | fecha }})</span> }</p>
      } @else {
        <p class="mensaje aviso" role="alert">Alergias no registradas. Debe registrarlas o marcar "sin alergias conocidas" antes de recetar.</p>
      }
      @if (editable()) {
        <form class="formulario mt" (ngSubmit)="agregar()">
          <div class="campo"><label for="al-comp">Componente activo</label>
            <select id="al-comp" name="comp" [(ngModel)]="componenteId" required>
              <option [ngValue]="null" disabled>Seleccione</option>
              @for (c of cat.componentes(); track c.id) { <option [ngValue]="c.id">{{ c.nombre }}</option> }
            </select></div>
          <div class="campo"><label for="al-sev">Severidad</label>
            <select id="al-sev" name="sev" [(ngModel)]="severidad"><option value="LEVE">Leve</option><option value="MODERADA">Moderada</option><option value="SEVERA">Severa</option></select></div>
          <button class="btn secundario" [disabled]="!componenteId">Registrar</button>
        </form>
        @if (!alergias().length && !sinAlergias()) {
          <button class="btn fantasma mt" (click)="marcarSin()">Marcar "sin alergias conocidas"</button>
        }
      }
    </section>
  `,
  styles: `.lista { list-style: none; padding: 0; display: grid; gap: .5rem; margin: 0; }`,
})
export class PanelAlergias implements OnInit {
  private api = inject(Api);
  private avisos = inject(Avisos);
  protected cat = inject(Catalogos);
  readonly pacienteId = input.required<number>();
  readonly alergias = input<Alergia[]>([]);
  readonly sinAlergias = input(false);
  readonly sinAlergiasFecha = input<string | null>(null);
  readonly editable = input(true);
  readonly cambio = output<void>();
  componenteId: number | null = null;
  severidad = 'MODERADA';

  ngOnInit() { this.cat.clinicos(); }
  tieneSevera() { return this.alergias().some((a) => a.severidad === 'SEVERA'); }

  async agregar() {
    try {
      await this.api.post(`/clinico/expedientes/${this.pacienteId()}/alergias`, { componenteId: this.componenteId, severidad: this.severidad });
      this.avisos.ok('Alergia registrada');
      this.componenteId = null;
      this.cambio.emit();
    } catch (e) { this.avisos.error(e); }
  }

  async baja(a: Alergia) {
    if (!confirm(`¿Dar de baja la alergia a ${a.componente}?`)) return;
    try { await this.api.delete(`/clinico/expedientes/${this.pacienteId()}/alergias/${a.id}`); this.cambio.emit(); } catch (e) { this.avisos.error(e); }
  }

  async marcarSin() {
    try { await this.api.put(`/clinico/expedientes/${this.pacienteId()}/sin-alergias`); this.avisos.ok('Marcado sin alergias conocidas'); this.cambio.emit(); } catch (e) { this.avisos.error(e); }
  }
}
