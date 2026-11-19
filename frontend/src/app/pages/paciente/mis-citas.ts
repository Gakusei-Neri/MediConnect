import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { Avisos } from '../../core/avisos.service';
import { Cita } from '../../core/modelos';
import { DialogoCancelar } from '../../shared/dialogos';
import { EstadoCitaPipe, FechaPipe, TonoCitaPipe } from '../../shared/pipes';

const MODIFICABLES = ['AGENDADA', 'NOTIFICADA', 'CONFIRMADA'];

/** Mis citas: confirmar (RF-09), reprogramar (RF-06), cancelar (RF-07), entrar a videoconsulta (RF-20). */
@Component({
  selector: 'app-mis-citas',
  imports: [FechaPipe, EstadoCitaPipe, TonoCitaPipe, DialogoCancelar, RouterLink],
  template: `
    <div class="encabezado-pagina">
      <div><h1>Mis citas</h1><p>Puede reprogramar o cancelar hasta 2 h antes. Máximo 2 reprogramaciones por cita.</p></div>
      <a class="btn" routerLink="/paciente/agendar">Agendar cita</a>
    </div>

    <h2>Próximas</h2>
    @if (!proximas().length) { <p class="tarjeta vacio">No tiene citas próximas.</p> }
    <div class="grid grid-2 mb">
      @for (c of proximas(); track c.id) {
        <article class="tarjeta" [class.resaltada]="c.estado === 'NOTIFICADA'" [attr.aria-labelledby]="'c' + c.id">
          <div class="fila entre">
            <h3 [id]="'c' + c.id">{{ c.especialidad_nombre || 'Urgencias' }}</h3>
            <span class="insignia" [class]="c.estado | tonoCita">{{ c.estado | estadoCita }}</span>
          </div>
          <p class="cap">{{ c.fecha_hora | fecha: 'completa': c.zona_horaria }}</p>
          <p class="atenuado">{{ c.medico_nombre }} · {{ c.sede_nombre }} · {{ c.modalidad === 'VIRTUAL' ? '🎥 Videoconsulta' : 'Presencial' }}</p>
          @if (c.estado === 'NOTIFICADA') {
            <p class="mensaje aviso pequeno">Confirme su asistencia o la cita se cancelará automáticamente.</p>
          }
          <div class="fila mt">
            @if (c.estado === 'NOTIFICADA') { <button class="btn" (click)="confirmar(c)">Confirmar asistencia</button> }
            @if (c.modalidad === 'VIRTUAL' && (c.estado === 'CONFIRMADA' || c.estado === 'TELEMEDICINA_CONECTADA' || c.estado === 'EN_CONSULTA')) {
              <button class="btn" (click)="entrarVideo(c)">Entrar a la videoconsulta</button>
            }
            @if (modificable(c)) {
              <button class="btn secundario" [disabled]="c.reprogramaciones >= 2" (click)="reprogramar(c)">Reprogramar</button>
              <button class="btn fantasma" (click)="cancelando.set(c)">Cancelar</button>
            }
          </div>
          @if (modificable(c) && c.reprogramaciones) { <p class="pequeno atenuado mt">Reprogramada {{ c.reprogramaciones }} de 2 veces.</p> }
        </article>
      }
    </div>

    <h2>Historial</h2>
    <div class="tabla-envoltura">
      <table>
        <thead><tr><th>Fecha</th><th>Especialidad</th><th>Médico</th><th>Estado</th></tr></thead>
        <tbody>
          @for (c of pasadas(); track c.id) {
            <tr>
              <td>{{ c.fecha_hora | fecha }}</td><td>{{ c.especialidad_nombre || 'Urgencias' }}</td><td>{{ c.medico_nombre || '—' }}</td>
              <td><span class="insignia" [class]="c.estado | tonoCita">{{ c.estado | estadoCita }}</span>@if (c.motivo_cancelacion) { <span class="pequeno atenuado"> {{ c.motivo_cancelacion }}</span> }</td>
            </tr>
          } @empty { <tr><td colspan="4" class="vacio">Sin citas anteriores</td></tr> }
        </tbody>
      </table>
    </div>

    @if (cancelando(); as c) {
      <app-dialogo-cancelar [descripcion]="(c.especialidad_nombre ?? '') + ' — ' + (c.fecha_hora | fecha: 'completa')" (cerrar)="cancelando.set(null)" (confirmar)="cancelar(c, $event)" />
    }
  `,
  styles: `.cap::first-letter { text-transform: uppercase; }`,
})
export class MisCitas implements OnInit {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private router = inject(Router);
  /** Enlace del correo de confirmación: /paciente/citas?confirmar=ID */
  readonly confirmarId = input<string>(undefined, { alias: 'confirmar' });

  protected citas = signal<Cita[]>([]);
  protected cancelando = signal<Cita | null>(null);
  protected proximas = computed(() => this.citas().filter((c) => MODIFICABLES.includes(c.estado) || ['EN_SALA_ESPERA', 'TELEMEDICINA_CONECTADA', 'EN_CONSULTA'].includes(c.estado)).reverse());
  protected pasadas = computed(() => this.citas().filter((c) => !this.proximas().includes(c)));

  async ngOnInit() {
    await this.cargar();
    const id = Number(this.confirmarId());
    const c = this.citas().find((x) => x.id === id);
    if (c?.estado === 'NOTIFICADA') await this.confirmar(c);
  }

  async cargar() { this.citas.set(await this.api.get('/citas')); }

  modificable(c: Cita) {
    return MODIFICABLES.includes(c.estado) && !c.es_urgencia && new Date(c.fecha_hora).getTime() - Date.now() >= 2 * 3600_000;
  }

  async confirmar(c: Cita) {
    try {
      await this.api.post(`/citas/${c.id}/confirmar`);
      this.avisos.ok('Asistencia confirmada');
      await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  reprogramar(c: Cita) { this.router.navigate(['/paciente/agendar'], { queryParams: { reprogramar: c.id } }); }

  async cancelar(c: Cita, motivoId: number) {
    try {
      await this.api.post(`/citas/${c.id}/cancelar`, { motivoId });
      this.avisos.ok('Cita cancelada; el horario quedó libre');
      this.cancelando.set(null);
      await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  async entrarVideo(c: Cita) {
    try {
      const e = await this.api.get(`/telemedicina/citas/${c.id}/enlace`);
      this.router.navigate(['/videoconsulta', e.token]);
    } catch (e) { this.avisos.error(e); }
  }
}
