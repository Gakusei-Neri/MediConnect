import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api.service';
import { Avisos } from '../../core/avisos.service';
import { Catalogos } from '../../core/catalogos.service';
import { PacienteBusqueda, SelectorPaciente } from '../../shared/selector-paciente';
import { EstadoCitaPipe, FechaPipe, TonoCitaPipe } from '../../shared/pipes';

/** RF-11: registro de urgencias sin turno (≤ 5 campos) y cola de la sede. */
@Component({
  selector: 'app-urgencias-recepcion',
  imports: [FormsModule, SelectorPaciente, FechaPipe, EstadoCitaPipe, TonoCitaPipe],
  template: `
    <div class="encabezado-pagina"><div><h1>Urgencias sin turno</h1><p>Registro de llegada y cola de la sede. No consume horarios de la agenda.</p></div></div>
    <div class="grid grid-2">
      <section class="tarjeta">
        <h2>Registrar llegada</h2>
        @if (!paciente()) {
          <app-selector-paciente (seleccion)="paciente.set($event)" />
        } @else {
          <form class="pila" (ngSubmit)="registrar()">
            <p><strong>{{ paciente()!.nombre_completo }}</strong> <span class="mono atenuado">{{ paciente()!.curp }}</span>
              <button type="button" class="btn fantasma chico" (click)="paciente.set(null)">Cambiar</button></p>
            <div class="campo">
              <label for="motivo">Motivo de llegada</label>
              <input id="motivo" name="motivo" required [(ngModel)]="motivo" placeholder="Ej. dolor torácico" />
            </div>
            <div class="campo">
              <label for="esp">Especialidad (opcional)</label>
              <select id="esp" name="esp" [(ngModel)]="especialidadId">
                <option [ngValue]="null">Sin especificar</option>
                @for (e of cat.especialidades(); track e.id) { <option [ngValue]="e.id">{{ e.nombre }}</option> }
              </select>
            </div>
            <button class="btn" [disabled]="!motivo.trim()">Registrar urgencia</button>
          </form>
        }
        <p class="pequeno atenuado mt">El triage clínico está fuera del alcance de este sistema.</p>
      </section>
      <section>
        <div class="fila entre"><h2>Cola de urgencias</h2><button class="btn fantasma chico" (click)="cargar()">Actualizar</button></div>
        <ol class="cola">
          @for (u of cola(); track u.id) {
            <li class="tarjeta">
              <div class="fila entre"><strong>{{ u.paciente_nombre }}</strong><span class="insignia" [class]="u.estado | tonoCita">{{ u.estado | estadoCita }}</span></div>
              <p class="pequeno">{{ u.motivo_urgencia }} · llegó {{ u.fecha_hora | fecha: 'hora' }}@if (u.medico_nombre) { · atiende {{ u.medico_nombre }} }</p>
            </li>
          } @empty { <p class="tarjeta vacio">Sin pacientes en espera.</p> }
        </ol>
      </section>
    </div>
  `,
  styles: `.cola { list-style: none; padding: 0; display: grid; gap: .5rem; }`,
})
export class UrgenciasRecepcion implements OnInit, OnDestroy {
  private api = inject(Api);
  private avisos = inject(Avisos);
  protected cat = inject(Catalogos);
  protected paciente = signal<PacienteBusqueda | null>(null);
  protected cola = signal<any[]>([]);
  motivo = '';
  especialidadId: number | null = null;
  private t: any;

  async ngOnInit() {
    await this.cat.publicos();
    await this.cargar();
    this.t = setInterval(() => this.cargar(), 5000);
  }
  ngOnDestroy() { clearInterval(this.t); }
  async cargar() { this.cola.set(await this.api.get('/urgencias/cola')); }

  async registrar() {
    try {
      await this.api.post('/urgencias', { pacienteId: this.paciente()!.id, motivo: this.motivo, especialidadId: this.especialidadId });
      this.avisos.ok('Urgencia registrada; visible en la cola del personal clínico');
      this.paciente.set(null);
      this.motivo = '';
      await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }
}
