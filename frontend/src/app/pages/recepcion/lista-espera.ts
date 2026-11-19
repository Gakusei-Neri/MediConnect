import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api.service';
import { Avisos } from '../../core/avisos.service';
import { Catalogos } from '../../core/catalogos.service';
import { PacienteBusqueda, SelectorPaciente } from '../../shared/selector-paciente';
import { FechaPipe } from '../../shared/pipes';

/** RF-10: lista de espera de la sede (Recepción). */
@Component({
  selector: 'app-lista-espera-recepcion',
  imports: [FormsModule, SelectorPaciente, FechaPipe],
  template: `
    <div class="encabezado-pagina"><div><h1>Lista de espera</h1><p>Orden de inscripción de la sede. Las ofertas vencen a las 2 h.</p></div></div>
    <section class="tarjeta mb">
      <h2>Inscribir paciente</h2>
      @if (!paciente()) { <app-selector-paciente (seleccion)="paciente.set($event)" /> }
      @else {
        <form class="formulario" (ngSubmit)="inscribir()">
          <p class="completo"><strong>{{ paciente()!.nombre_completo }}</strong> <button type="button" class="btn fantasma chico" (click)="paciente.set(null)">Cambiar</button></p>
          <div class="campo"><label for="e">Especialidad</label>
            <select id="e" name="e" [(ngModel)]="f.especialidadId">@for (e of cat.especialidades(); track e.id) { <option [ngValue]="e.id">{{ e.nombre }}</option> }</select></div>
          <div class="campo"><label for="s">Sede</label>
            <select id="s" name="s" [(ngModel)]="f.sedeId">@for (s of cat.sedes(); track s.id) { <option [ngValue]="s.id">{{ s.nombre }}</option> }</select></div>
          <div class="campo"><label for="m">Modalidad</label>
            <select id="m" name="m" [(ngModel)]="f.modalidad"><option value="PRESENCIAL">Presencial</option><option value="VIRTUAL">Virtual</option></select></div>
          <button class="btn" [disabled]="!f.especialidadId || !f.sedeId">Inscribir</button>
        </form>
      }
    </section>
    <div class="tabla-envoltura">
      <table>
        <thead><tr><th>#</th><th>Paciente</th><th>Especialidad</th><th>Modalidad</th><th>Inscrito</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          @for (i of lista(); track i.id; let n = $index) {
            <tr>
              <td>{{ n + 1 }}</td><td>{{ i.paciente_nombre }}</td><td>{{ i.especialidad_nombre }}@if (i.medico_nombre) { <br /><span class="pequeno">{{ i.medico_nombre }}</span> }</td>
              <td>{{ i.modalidad }}</td><td>{{ i.fecha_solicitud | fecha }}</td>
              <td>@if (i.estado === 'OFERTADA') { <span class="insignia aviso">Ofertado: {{ i.cupo_inicio | fecha }}</span> } @else { <span class="insignia">En espera</span> }</td>
              <td class="acciones"><button class="btn fantasma chico" (click)="baja(i.id)">Dar de baja</button></td>
            </tr>
          } @empty { <tr><td colspan="7" class="vacio">Nadie en lista de espera</td></tr> }
        </tbody>
      </table>
    </div>
  `,
})
export class ListaEsperaRecepcion implements OnInit {
  private api = inject(Api);
  private avisos = inject(Avisos);
  protected cat = inject(Catalogos);
  protected paciente = signal<PacienteBusqueda | null>(null);
  protected lista = signal<any[]>([]);
  f: any = { especialidadId: null, sedeId: null, modalidad: 'PRESENCIAL' };

  async ngOnInit() { await this.cat.publicos(); await this.cargar(); }
  async cargar() { this.lista.set(await this.api.get('/lista-espera')); }
  async inscribir() {
    try {
      await this.api.post('/lista-espera', { ...this.f, pacienteId: this.paciente()!.id });
      this.avisos.ok('Paciente inscrito');
      this.paciente.set(null);
      await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }
  async baja(id: number) {
    try { await this.api.delete(`/lista-espera/${id}`); await this.cargar(); } catch (e) { this.avisos.error(e); }
  }
}
