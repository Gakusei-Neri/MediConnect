import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api.service';
import { Avisos } from '../../core/avisos.service';
import { Cita } from '../../core/modelos';
import { DialogoCancelar } from '../../shared/dialogos';
import { EstadoCitaPipe, FechaPipe, TonoCitaPipe, hoyLocal } from '../../shared/pipes';
import { RouterLink } from '@angular/router';

/** Recepción: citas del día de la sede, check-in (Confirmada → EnSalaEspera) y cancelación. */
@Component({
  selector: 'app-citas-dia',
  imports: [FormsModule, FechaPipe, EstadoCitaPipe, TonoCitaPipe, DialogoCancelar, RouterLink],
  template: `
    <div class="encabezado-pagina">
      <div><h1>Citas del día</h1><p>Registre la llegada de los pacientes con cita confirmada.</p></div>
      <div class="fila">
        <div class="campo"><label for="fecha">Fecha</label><input id="fecha" type="date" [(ngModel)]="fecha" (change)="cargar()" /></div>
        <div class="campo"><label for="filtro">Filtrar</label><input id="filtro" [ngModel]="filtro()" (ngModelChange)="filtro.set($event)" placeholder="Paciente o médico" /></div>
        <a class="btn alinear" routerLink="/recepcion/agendar">Agendar cita</a>
      </div>
    </div>
    <div class="tabla-envoltura">
      <table>
        <thead><tr><th>Hora</th><th>Paciente</th><th>Médico / Especialidad</th><th>Modalidad</th><th>Estado</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>
          @for (c of filtradas(); track c.id) {
            <tr>
              <td>{{ c.fecha_hora | fecha: 'hora' }}</td>
              <td><strong>{{ c.paciente_nombre }}</strong><br /><span class="mono pequeno atenuado">{{ c.paciente_curp }}</span></td>
              <td>{{ c.medico_nombre || '—' }}<br /><span class="pequeno atenuado">{{ c.especialidad_nombre || (c.es_urgencia ? 'Urgencia' : '') }}</span></td>
              <td>{{ c.modalidad === 'VIRTUAL' ? '🎥 Virtual' : 'Presencial' }}</td>
              <td><span class="insignia" [class]="c.estado | tonoCita">{{ c.estado | estadoCita }}</span></td>
              <td class="acciones">
                @if (c.estado === 'CONFIRMADA' && c.modalidad === 'PRESENCIAL') { <button class="btn chico" (click)="checkIn(c)">Registrar llegada</button> }
                @if (['AGENDADA', 'NOTIFICADA', 'CONFIRMADA'].includes(c.estado) && !c.es_urgencia) {
                  <button class="btn fantasma chico" (click)="cancelando.set(c)">Cancelar</button>
                }
              </td>
            </tr>
          } @empty { <tr><td colspan="6" class="vacio">No hay citas para esta fecha.</td></tr> }
        </tbody>
      </table>
    </div>
    @if (cancelando(); as c) {
      <app-dialogo-cancelar [descripcion]="c.paciente_nombre + ' — ' + (c.fecha_hora | fecha: 'completa')" (cerrar)="cancelando.set(null)" (confirmar)="cancelar(c, $event)" />
    }
  `,
  styles: `.alinear { align-self: flex-end; }`,
})
export class CitasDia implements OnInit {
  private api = inject(Api);
  private avisos = inject(Avisos);
  fecha = hoyLocal();
  protected filtro = signal('');
  protected citas = signal<Cita[]>([]);
  protected cancelando = signal<Cita | null>(null);
  protected filtradas = computed(() => {
    const t = this.filtro().toLowerCase();
    return this.citas().filter((c) => !t || `${c.paciente_nombre} ${c.medico_nombre} ${c.paciente_curp}`.toLowerCase().includes(t));
  });

  ngOnInit() { this.cargar(); }
  async cargar() { this.citas.set(await this.api.get('/citas', { fecha: this.fecha })); }

  async checkIn(c: Cita) {
    try {
      await this.api.post(`/citas/${c.id}/check-in`);
      this.avisos.ok(`${c.paciente_nombre} está en sala de espera`);
      await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  async cancelar(c: Cita, motivoId: number) {
    try {
      await this.api.post(`/citas/${c.id}/cancelar`, { motivoId });
      this.avisos.ok('Cita cancelada y paciente notificado');
      this.cancelando.set(null);
      await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }
}
