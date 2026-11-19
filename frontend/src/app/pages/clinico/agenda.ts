import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { Avisos } from '../../core/avisos.service';
import { Cita } from '../../core/modelos';
import { EstadoCitaPipe, FechaPipe, TonoCitaPipe, hoyLocal } from '../../shared/pipes';

/** Agenda del día: el médico ve sus citas; enfermería ve las de su sede. */
@Component({
  selector: 'app-agenda-clinica',
  imports: [FormsModule, RouterLink, FechaPipe, EstadoCitaPipe, TonoCitaPipe],
  template: `
    <div class="encabezado-pagina">
      <div><h1>{{ esMedico() ? 'Mi agenda' : 'Citas de la sede' }}</h1><p>Abra la consulta cuando el paciente esté en sala de espera o conectado por video.</p></div>
      <div class="campo"><label for="f">Fecha</label><input id="f" type="date" [(ngModel)]="fecha" (change)="cargar()" /></div>
    </div>
    @if (urgencias().length) {
      <a class="mensaje aviso mb bloque" routerLink="/clinico/urgencias">🚑 {{ urgencias().length }} paciente(s) en la cola de urgencias de la sede</a>
    }
    <div class="tabla-envoltura">
      <table>
        <thead><tr><th>Hora</th><th>Paciente</th>@if (!esMedico()) { <th>Médico</th> }<th>Modalidad</th><th>Estado</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>
          @for (c of citas(); track c.id) {
            <tr>
              <td>{{ c.fecha_hora | fecha: 'hora' }}</td>
              <td><strong>{{ c.paciente_nombre }}</strong><br /><span class="pequeno atenuado">{{ c.especialidad_nombre }}</span></td>
              @if (!esMedico()) { <td>{{ c.medico_nombre }}</td> }
              <td>{{ c.modalidad === 'VIRTUAL' ? '🎥 Virtual' : 'Presencial' }}</td>
              <td><span class="insignia" [class]="c.estado | tonoCita">{{ c.estado | estadoCita }}</span></td>
              <td class="acciones">
                @if (esMedico() && c.estado === 'EN_SALA_ESPERA') { <button class="btn chico" (click)="llamar(c)">Llamar paciente</button> }
                @if (esMedico() && c.modalidad === 'VIRTUAL' && ['CONFIRMADA', 'TELEMEDICINA_CONECTADA', 'EN_CONSULTA'].includes(c.estado)) {
                  <button class="btn chico secundario" (click)="video(c)">Videoconsulta</button>
                }
                @if (['EN_SALA_ESPERA', 'TELEMEDICINA_CONECTADA', 'EN_CONSULTA', 'FINALIZADA'].includes(c.estado)) {
                  <a class="btn chico fantasma" [routerLink]="['/clinico/consulta', c.id]">{{ c.estado === 'FINALIZADA' ? 'Ver consulta' : 'Consulta' }}</a>
                }
                <a class="btn chico fantasma" [routerLink]="['/clinico/expediente', c.paciente_id]">Expediente</a>
              </td>
            </tr>
          } @empty { <tr><td [attr.colspan]="esMedico() ? 5 : 6" class="vacio">Sin citas para esta fecha</td></tr> }
        </tbody>
      </table>
    </div>
  `,
  styles: `.bloque { display: block; text-decoration: none; }`,
})
export class AgendaClinica implements OnInit, OnDestroy {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  private router = inject(Router);
  protected esMedico = computed(() => this.auth.rol() === 'MEDICO');
  protected citas = signal<Cita[]>([]);
  protected urgencias = signal<any[]>([]);
  fecha = hoyLocal();
  private t: any;

  ngOnInit() {
    this.cargar();
    this.t = setInterval(() => this.cargar(), 15000);
  }
  ngOnDestroy() { clearInterval(this.t); }

  async cargar() {
    const [c, u] = await Promise.all([this.api.get('/citas', { fecha: this.fecha }), this.api.get('/urgencias/cola').catch(() => [])]);
    this.citas.set(c.filter((x: Cita) => !x.es_urgencia));
    this.urgencias.set(u);
  }

  async llamar(c: Cita) {
    try {
      await this.api.post(`/citas/${c.id}/llamar`);
      this.router.navigate(['/clinico/consulta', c.id]);
    } catch (e) { this.avisos.error(e); }
  }

  async video(c: Cita) {
    try {
      const e = await this.api.get(`/telemedicina/citas/${c.id}/enlace`);
      this.router.navigate(['/videoconsulta', e.token]);
    } catch (e) { this.avisos.error(e); }
  }
}
