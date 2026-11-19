import { Component, inject, OnInit, signal } from '@angular/core';
import { Api } from '../../core/api.service';
import { Diagnostico, Receta } from '../../core/modelos';
import { FechaPipe, ReservaPipe } from '../../shared/pipes';

interface Resumen {
  recetas: Receta[];
  historial: { fecha: string; medico: string; sede: string; diagnosticos: Diagnostico[] }[];
  alergias: { componente: string; severidad: string }[];
}

/** RF-16: recetas con QR y estado de la reserva, y resumen del historial (sin notas internas). */
@Component({
  selector: 'app-mis-recetas',
  imports: [FechaPipe, ReservaPipe],
  template: `
    <div class="encabezado-pagina"><div><h1>Recetas e historial</h1><p>Presente el código QR en la farmacia para surtir su receta.</p></div></div>
    @if (r(); as d) {
      <div class="pestanas" role="tablist">
        <button role="tab" [attr.aria-selected]="tab() === 'recetas'" (click)="tab.set('recetas')">Recetas ({{ d.recetas.length }})</button>
        <button role="tab" [attr.aria-selected]="tab() === 'historial'" (click)="tab.set('historial')">Historial</button>
      </div>

      @if (tab() === 'recetas') {
        @if (!d.recetas.length) { <p class="tarjeta vacio">Aún no tiene recetas.</p> }
        <div class="grid grid-2">
          @for (x of d.recetas; track x.id) {
            <article class="tarjeta receta" [class.anulada]="x.anulada">
              <div class="fila entre">
                <h3 class="mono">{{ x.folio }}</h3>
                @if (x.anulada) { <span class="insignia error">Anulada</span> }
                @else if (x.vencida && !x.surtida) { <span class="insignia neutro">Vencida</span> }
                @else { <span class="insignia" [class]="x.reserva_estado | reserva: 'tono'">{{ x.reserva_estado | reserva }}</span> }
              </div>
              <div class="cuerpo">
                <img [src]="x.qr" [alt]="'Código QR de la receta ' + x.folio" width="150" height="150" />
                <div>
                  <p class="pequeno atenuado">Emitida {{ x.fecha_emision | fecha }} por {{ x.medico_nombre }}<br />Vigente hasta {{ x.vigente_hasta | fecha }}</p>
                  <ul>
                    @for (m of x.medicamentos; track m.id) {
                      <li><strong>{{ m.nombre }}</strong> ×{{ m.cantidad }}<br /><span class="pequeno">{{ m.dosis }}, {{ m.frecuencia }}, {{ m.duracion }}</span></li>
                    }
                  </ul>
                  @if (x.reserva_estado === 'CONFIRMADA' && x.reserva_vigente_hasta) { <p class="pequeno">Reserva válida hasta {{ x.reserva_vigente_hasta | fecha }}</p> }
                  @if (x.reserva_estado === 'SIN_STOCK' || x.reserva_estado === 'FALLIDA') { <p class="pequeno mensaje aviso">La receta sigue siendo válida aunque no se pudo reservar.</p> }
                  @if (x.anulada) { <p class="pequeno">Motivo: {{ x.motivo_anulacion }}</p> }
                </div>
              </div>
            </article>
          }
        </div>
      } @else {
        @if (d.alergias.length) {
          <p class="mensaje aviso mb"><strong>Alergias registradas:</strong> @for (a of d.alergias; track a.componente) { {{ a.componente }} ({{ a.severidad.toLowerCase() }}){{ $last ? '' : ', ' }} }</p>
        }
        <div class="tabla-envoltura">
          <table>
            <thead><tr><th>Fecha</th><th>Médico</th><th>Sede</th><th>Diagnósticos</th></tr></thead>
            <tbody>
              @for (h of d.historial; track h.fecha) {
                <tr><td>{{ h.fecha | fecha }}</td><td>{{ h.medico }}</td><td>{{ h.sede }}</td>
                  <td>@for (dx of h.diagnosticos; track dx.id) { <span class="mono">{{ dx.codigo }}</span> {{ dx.descripcion }}<br /> }</td></tr>
              } @empty { <tr><td colspan="4" class="vacio">Sin consultas registradas</td></tr> }
            </tbody>
          </table>
        </div>
      }
    }
  `,
  styles: `
    .cuerpo { display: flex; gap: 1rem; flex-wrap: wrap; }
    .cuerpo ul { padding-left: 1.1rem; margin: .3rem 0; }
    .receta.anulada img { opacity: .3; }
  `,
})
export class MisRecetas implements OnInit {
  private api = inject(Api);
  protected r = signal<Resumen | null>(null);
  protected tab = signal<'recetas' | 'historial'>('recetas');
  async ngOnInit() { this.r.set(await this.api.get('/portal/resumen')); }
}
