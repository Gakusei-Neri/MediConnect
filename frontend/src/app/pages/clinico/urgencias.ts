import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { Avisos } from '../../core/avisos.service';
import { EstadoCitaPipe, FechaPipe, TonoCitaPipe } from '../../shared/pipes';

/** RF-11: cola de urgencias de la sede para el personal clínico. */
@Component({
  selector: 'app-urgencias-clinico',
  imports: [RouterLink, FechaPipe, EstadoCitaPipe, TonoCitaPipe],
  template: `
    <div class="encabezado-pagina"><div><h1>Cola de urgencias</h1><p>{{ sede() }} · se actualiza cada 5 s.</p></div></div>
    <ol class="cola">
      @for (u of cola(); track u.id; let i = $index) {
        <li class="tarjeta fila entre">
          <div>
            <strong>{{ i + 1 }}. {{ u.paciente_nombre }}</strong> <span class="insignia" [class]="u.estado | tonoCita">{{ u.estado | estadoCita }}</span>
            <p class="pequeno">{{ u.motivo_urgencia }} · llegó {{ u.fecha_hora | fecha: 'hora' }}@if (u.especialidad_nombre) { · {{ u.especialidad_nombre }} }@if (u.medico_nombre) { · {{ u.medico_nombre }} }</p>
          </div>
          <div class="fila">
            @if (esMedico() && u.estado === 'EN_SALA_ESPERA') { <button class="btn" (click)="atender(u.id)">Atender</button> }
            @if (u.estado === 'EN_CONSULTA' || !esMedico()) { <a class="btn secundario" [routerLink]="['/clinico/consulta', u.id]">Consulta</a> }
            <a class="btn fantasma" [routerLink]="['/clinico/expediente', u.paciente_id]">Expediente</a>
          </div>
        </li>
      } @empty { <p class="tarjeta vacio">No hay pacientes en la cola.</p> }
    </ol>
  `,
  styles: `.cola { list-style: none; padding: 0; display: grid; gap: .6rem; }`,
})
export class UrgenciasClinico implements OnInit, OnDestroy {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  private router = inject(Router);
  protected esMedico = computed(() => this.auth.rol() === 'MEDICO');
  protected sede = computed(() => this.auth.usuario()?.sede?.nombre ?? '');
  protected cola = signal<any[]>([]);
  private t: any;

  ngOnInit() { this.cargar(); this.t = setInterval(() => this.cargar(), 5000); }
  ngOnDestroy() { clearInterval(this.t); }
  async cargar() { this.cola.set(await this.api.get('/urgencias/cola')); }

  async atender(id: number) {
    try {
      await this.api.post(`/citas/${id}/llamar`);
      this.router.navigate(['/clinico/consulta', id]);
    } catch (e) { this.avisos.error(e); }
  }
}
