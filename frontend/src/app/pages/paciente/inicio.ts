import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { Cita } from '../../core/modelos';
import { EstadoCitaPipe, FechaPipe, TonoCitaPipe } from '../../shared/pipes';

@Component({
  selector: 'app-inicio-paciente',
  imports: [RouterLink, FechaPipe, EstadoCitaPipe, TonoCitaPipe],
  template: `
    <div class="encabezado-pagina">
      <div><h1>Hola, {{ nombre() }}</h1><p>Agende, confirme y consulte sus citas, recetas e historial.</p></div>
      <a class="btn" routerLink="/paciente/agendar">Agendar cita</a>
    </div>
    @if (porConfirmar().length) {
      <div class="mensaje aviso mb" role="alert">
        Tiene {{ porConfirmar().length }} cita(s) por confirmar. <a routerLink="/paciente/citas">Confirmar ahora</a>
      </div>
    }
    @if (ofertas().length) {
      <div class="mensaje info mb">Se liberó un horario de su lista de espera. <a routerLink="/paciente/lista-espera">Ver oferta</a></div>
    }
    <div class="grid grid-3">
      <section class="tarjeta resaltada">
        <h2>Próxima cita</h2>
        @if (proxima(); as c) {
          <p class="grande">{{ c.fecha_hora | fecha: 'completa': c.zona_horaria }}</p>
          <p>{{ c.especialidad_nombre }} con {{ c.medico_nombre }}</p>
          <p class="atenuado">{{ c.sede_nombre }} · {{ c.modalidad === 'VIRTUAL' ? 'Videoconsulta' : 'Presencial' }}</p>
          <span class="insignia" [class]="c.estado | tonoCita">{{ c.estado | estadoCita }}</span>
        } @else { <p class="atenuado">No tiene citas próximas.</p> }
      </section>
      <a class="tarjeta acceso" routerLink="/paciente/citas"><h2>Mis citas</h2><p class="atenuado">Confirmar, reprogramar o cancelar.</p></a>
      <a class="tarjeta acceso" routerLink="/paciente/recetas"><h2>Recetas e historial</h2><p class="atenuado">Recetas con QR y estado en farmacia.</p></a>
    </div>
  `,
  styles: `
    .grande { font-size: 1.1rem; font-weight: 600; }
    .grande::first-letter { text-transform: uppercase; }
    .acceso { text-decoration: none; color: inherit; }
    .acceso:hover { border-color: var(--c-primario); }
  `,
})
export class InicioPaciente implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);
  protected citas = signal<Cita[]>([]);
  protected ofertas = signal<any[]>([]);
  protected nombre = computed(() => this.auth.usuario()?.nombre.split(' ')[0]);
  protected activas = computed(() => this.citas().filter((c) => ['AGENDADA', 'NOTIFICADA', 'CONFIRMADA', 'EN_SALA_ESPERA', 'TELEMEDICINA_CONECTADA', 'EN_CONSULTA'].includes(c.estado)));
  protected proxima = computed(() => [...this.activas()].sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora))[0]);
  protected porConfirmar = computed(() => this.citas().filter((c) => c.estado === 'NOTIFICADA'));

  async ngOnInit() {
    const [c, l] = await Promise.all([this.api.get('/citas'), this.api.get('/lista-espera')]);
    this.citas.set(c);
    this.ofertas.set(l.filter((x: any) => x.estado === 'OFERTADA'));
  }
}
