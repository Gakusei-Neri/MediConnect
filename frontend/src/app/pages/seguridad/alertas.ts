import { Component, inject, OnInit, signal } from '@angular/core';
import { Api } from '../../core/api.service';
import { Avisos } from '../../core/avisos.service';
import { FechaPipe } from '../../shared/pipes';

/** RF-23: alertas de acceso de emergencia para Seguridad. */
@Component({
  selector: 'app-alertas',
  imports: [FechaPipe],
  template: `
    <div class="encabezado-pagina"><div><h1>Alertas de acceso de emergencia</h1><p>Cada acceso sin relación asistencial queda marcado y debe revisarse.</p></div></div>
    <div class="grid">
      @for (a of alertas(); track a.id) {
        <article class="tarjeta" [class.alerta]="!a.revisada">
          <div class="fila entre">
            <h3>{{ a.medico_nombre }} → {{ a.paciente_nombre }}</h3>
            @if (a.revisada) { <span class="insignia ok">Revisada</span> } @else { <button class="btn chico" (click)="revisar(a.id)">Marcar revisada</button> }
          </div>
          <p class="pequeno atenuado">{{ a.fecha | fecha }} · alerta enviada {{ a.alerta_enviada_en | fecha: 'hora' }} · acceso válido hasta {{ a.vence_en | fecha: 'hora' }}</p>
          <p><strong>Justificación:</strong> {{ a.justificacion }}</p>
        </article>
      } @empty { <p class="tarjeta vacio">Sin accesos de emergencia.</p> }
    </div>
  `,
})
export class AlertasEmergencia implements OnInit {
  private api = inject(Api);
  private avisos = inject(Avisos);
  protected alertas = signal<any[]>([]);
  ngOnInit() { this.cargar(); }
  async cargar() { this.alertas.set(await this.api.get('/auditoria/alertas')); }
  async revisar(id: number) {
    try { await this.api.post(`/auditoria/alertas/${id}/revisada`); await this.cargar(); } catch (e) { this.avisos.error(e); }
  }
}
