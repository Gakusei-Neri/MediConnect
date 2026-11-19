import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api.service';
import { Avisos } from '../../core/avisos.service';
import { Catalogos } from '../../core/catalogos.service';
import { Medico } from '../../core/modelos';
import { FechaPipe } from '../../shared/pipes';

/** RF-10: lista de espera (paciente). */
@Component({
  selector: 'app-lista-espera-paciente',
  imports: [FormsModule, FechaPipe],
  template: `
    <div class="encabezado-pagina"><div><h1>Lista de espera</h1><p>Le avisaremos cuando se libere un horario compatible. Tendrá 2 h para aceptarlo.</p></div></div>
    <div class="grid grid-2">
      <section class="tarjeta">
        <h2>Inscribirme</h2>
        <form class="formulario" (ngSubmit)="inscribir()">
          <div class="campo">
            <label for="le-esp">Especialidad</label>
            <select id="le-esp" name="esp" required [(ngModel)]="f.especialidadId" (ngModelChange)="medicosDe()">
              @for (e of cat.especialidades(); track e.id) { <option [ngValue]="e.id">{{ e.nombre }}</option> }
            </select>
          </div>
          <div class="campo">
            <label for="le-sede">Sede</label>
            <select id="le-sede" name="sede" required [(ngModel)]="f.sedeId">
              @for (s of cat.sedes(); track s.id) { <option [ngValue]="s.id">{{ s.nombre }}</option> }
            </select>
          </div>
          <div class="campo">
            <label for="le-mod">Modalidad</label>
            <select id="le-mod" name="mod" [(ngModel)]="f.modalidad"><option value="PRESENCIAL">Presencial</option><option value="VIRTUAL">Virtual</option></select>
          </div>
          <div class="campo">
            <label for="le-med">Médico (opcional)</label>
            <select id="le-med" name="med" [(ngModel)]="f.medicoId">
              <option [ngValue]="null">Cualquiera</option>
              @for (m of medicos(); track m.id) { <option [ngValue]="m.id">{{ m.nombre_completo }}</option> }
            </select>
          </div>
          <button class="btn completo" [disabled]="!f.especialidadId || !f.sedeId">Inscribirme</button>
        </form>
      </section>
      <section class="pila">
        <h2>Mis inscripciones</h2>
        @for (i of lista(); track i.id) {
          <article class="tarjeta" [class.resaltada]="i.estado === 'OFERTADA'">
            <div class="fila entre"><strong>{{ i.especialidad_nombre }}</strong><span class="insignia" [class.aviso]="i.estado === 'OFERTADA'">{{ i.estado === 'OFERTADA' ? 'Horario ofrecido' : 'En espera' }}</span></div>
            <p class="pequeno atenuado">{{ i.sede_nombre }} · {{ i.modalidad === 'VIRTUAL' ? 'Virtual' : 'Presencial' }}@if (i.medico_nombre) { · {{ i.medico_nombre }} } · desde {{ i.fecha_solicitud | fecha }}</p>
            @if (i.estado === 'OFERTADA') {
              <p class="mensaje aviso">Horario disponible: <strong>{{ i.cupo_inicio | fecha: 'completa' }}</strong>. Acepte antes de {{ i.oferta_vence_en | fecha: 'hora' }}.</p>
              <div class="fila mt"><button class="btn" (click)="aceptar(i.id)">Aceptar horario</button><button class="btn secundario" (click)="rechazar(i.id)">Rechazar</button></div>
            } @else {
              <button class="btn fantasma chico" (click)="baja(i.id)">Darme de baja</button>
            }
          </article>
        } @empty { <p class="tarjeta vacio">No está inscrito en ninguna lista.</p> }
      </section>
    </div>
  `,
})
export class ListaEsperaPaciente implements OnInit {
  private api = inject(Api);
  private avisos = inject(Avisos);
  protected cat = inject(Catalogos);
  protected lista = signal<any[]>([]);
  protected medicos = signal<Medico[]>([]);
  f: any = { especialidadId: null, sedeId: null, modalidad: 'PRESENCIAL', medicoId: null };

  async ngOnInit() {
    await this.cat.publicos();
    await this.cargar();
  }
  async cargar() { this.lista.set(await this.api.get('/lista-espera')); }
  async medicosDe() { this.medicos.set(await this.cat.medicos({ especialidadId: this.f.especialidadId })); }

  private async accion(fn: () => Promise<any>, ok: string) {
    try { await fn(); this.avisos.ok(ok); await this.cargar(); } catch (e) { this.avisos.error(e); }
  }
  inscribir() { return this.accion(() => this.api.post('/lista-espera', this.f), 'Inscripción registrada'); }
  aceptar(id: number) { return this.accion(() => this.api.post(`/lista-espera/${id}/aceptar`), 'Cita agendada con el horario ofrecido'); }
  rechazar(id: number) { return this.accion(() => this.api.post(`/lista-espera/${id}/rechazar`), 'Oferta rechazada'); }
  baja(id: number) { return this.accion(() => this.api.delete(`/lista-espera/${id}`), 'Se dio de baja de la lista'); }
}
