import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErrorApi } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { Avisos } from '../../core/avisos.service';
import { Catalogos } from '../../core/catalogos.service';
import { Cupo, Medico, Motivo } from '../../core/modelos';
import { EstadoCitaPipe, FechaPipe } from '../../shared/pipes';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

interface Afectada { id: number; fecha_hora: string; estado: string; especialidad_id: number; paciente_nombre: string }
interface Resolucion { citaId: number; accion: 'CANCELAR' | 'REPROGRAMAR'; motivoId: number | null; cupoId: number | null }

/** RF-12: horarios recurrentes, bloqueos y resolución obligatoria de citas afectadas. */
@Component({
  selector: 'app-agenda-medica',
  imports: [FormsModule, FechaPipe, EstadoCitaPipe],
  template: `
    <div class="encabezado-pagina">
      <div><h1>Agenda médica</h1><p>Horarios recurrentes por médico y sede, y bloqueos (vacaciones, ausencias).</p></div>
      <div class="campo">
        <label for="medico">Médico</label>
        <select id="medico" [(ngModel)]="medicoId" (ngModelChange)="cargar()">
          <option [ngValue]="null" disabled>Seleccione</option>
          @for (m of medicos(); track m.id) { <option [ngValue]="m.id">{{ m.nombre_completo }} — {{ m.especialidad_nombre }}</option> }
        </select>
      </div>
    </div>

    @if (medicoId) {
      <div class="grid grid-2">
        <section class="tarjeta">
          <h2>Horarios recurrentes</h2>
          <div class="tabla-envoltura mb">
            <table>
              <thead><tr><th>Día</th><th>Horario</th><th>Sede</th><th>Modalidad</th><th></th></tr></thead>
              <tbody>
                @for (h of horarios(); track h.id) {
                  <tr><td>{{ dias[h.dia_semana] }}</td><td>{{ h.hora_inicio }}–{{ h.hora_fin }}</td><td>{{ h.sede_nombre }}</td><td>{{ h.modalidad }}</td>
                    <td class="acciones"><button class="btn fantasma chico" (click)="desactivar(h)">Quitar</button></td></tr>
                } @empty { <tr><td colspan="5" class="vacio">Sin horarios</td></tr> }
              </tbody>
            </table>
          </div>
          <h3>Agregar horario</h3>
          <form class="formulario" (ngSubmit)="crearHorario()">
            <div class="campo"><label for="dia">Día</label>
              <select id="dia" name="dia" [(ngModel)]="h.diaSemana">@for (d of dias; track $index) { <option [ngValue]="$index">{{ d }}</option> }</select></div>
            <div class="campo"><label for="hi">Inicio</label><input id="hi" name="hi" type="time" [(ngModel)]="h.horaInicio" required /></div>
            <div class="campo"><label for="hf">Fin</label><input id="hf" name="hf" type="time" [(ngModel)]="h.horaFin" required /></div>
            <div class="campo"><label for="hs">Sede</label>
              <select id="hs" name="hs" [(ngModel)]="h.sedeId" [disabled]="esRecepcion()">@for (s of cat.sedes(); track s.id) { <option [ngValue]="s.id">{{ s.nombre }}</option> }</select></div>
            <div class="campo"><label for="hm">Modalidad</label>
              <select id="hm" name="hm" [(ngModel)]="h.modalidad"><option value="PRESENCIAL">Presencial</option><option value="VIRTUAL">Virtual</option></select></div>
            <button class="btn">Agregar</button>
          </form>
          <p class="pequeno atenuado mt">Se generan cupos con la duración de la especialidad para los próximos 90 días.</p>
        </section>

        <section class="tarjeta">
          <h2>Bloqueos</h2>
          <ul class="lista mb">
            @for (b of bloqueos(); track b.id) {
              <li class="fila entre"><span>{{ b.desde | fecha }} → {{ b.hasta | fecha }}<br /><span class="pequeno atenuado">{{ b.motivo }}</span></span>
                <button class="btn fantasma chico" (click)="quitarBloqueo(b.id)">Eliminar</button></li>
            } @empty { <li class="atenuado">Sin bloqueos vigentes</li> }
          </ul>
          <h3>Nuevo bloqueo</h3>
          <form class="formulario" (ngSubmit)="crearBloqueo()">
            <div class="campo"><label for="bd">Desde</label><input id="bd" name="bd" type="datetime-local" [(ngModel)]="b.desde" required /></div>
            <div class="campo"><label for="bh">Hasta</label><input id="bh" name="bh" type="datetime-local" [(ngModel)]="b.hasta" required /></div>
            <div class="campo completo"><label for="bm">Motivo</label><input id="bm" name="bm" [(ngModel)]="b.motivo" required placeholder="Vacaciones, congreso, incapacidad…" /></div>
            <button class="btn" [disabled]="!b.desde || !b.hasta || !b.motivo">Revisar y aplicar</button>
          </form>
        </section>
      </div>
    }

    @if (pendiente(); as p) {
      <div class="fondo-dialogo">
        <div class="dialogo ancho" role="dialog" aria-modal="true" aria-labelledby="t-res">
          <h2 id="t-res">Resolver {{ p.afectadas.length }} cita(s) afectada(s)</h2>
          <p class="atenuado">El cambio no se aplicará hasta que cada cita se reprograme o se cancele. Los pacientes serán notificados.</p>
          <div class="tabla-envoltura">
            <table>
              <thead><tr><th>Cita</th><th>Acción</th><th>Detalle</th></tr></thead>
              <tbody>
                @for (a of p.afectadas; track a.id; let i = $index) {
                  <tr>
                    <td><strong>{{ a.paciente_nombre }}</strong><br /><span class="pequeno">{{ a.fecha_hora | fecha }} · {{ a.estado | estadoCita }}</span></td>
                    <td>
                      <select [attr.aria-label]="'Acción para ' + a.paciente_nombre" [(ngModel)]="resoluciones[i].accion">
                        <option value="CANCELAR">Cancelar</option><option value="REPROGRAMAR">Reprogramar</option>
                      </select>
                    </td>
                    <td>
                      @if (resoluciones[i].accion === 'CANCELAR') {
                        <select [attr.aria-label]="'Motivo para ' + a.paciente_nombre" [(ngModel)]="resoluciones[i].motivoId">
                          @for (m of motivos(); track m.id) { <option [ngValue]="m.id">{{ m.descripcion }}</option> }
                        </select>
                      } @else {
                        <select [attr.aria-label]="'Nuevo horario para ' + a.paciente_nombre" [(ngModel)]="resoluciones[i].cupoId">
                          <option [ngValue]="null" disabled>Elija un horario libre</option>
                          @for (c of cuposLibres(); track c.id) { @if (!usado(c.id, i)) { <option [ngValue]="c.id">{{ c.inicio | fecha }} · {{ c.medico_nombre }}</option> } }
                        </select>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="fila fin mt">
            <button class="btn fantasma" (click)="pendiente.set(null)">Volver</button>
            <button class="btn" [disabled]="!completas()" (click)="aplicar()">Aplicar cambio</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `.lista { list-style: none; padding: 0; display: grid; gap: .5rem; }`,
})
export class AgendaMedica implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  protected cat = inject(Catalogos);
  protected dias = DIAS;
  protected esRecepcion = computed(() => this.auth.rol() === 'RECEPCION');
  protected medicos = signal<Medico[]>([]);
  protected horarios = signal<any[]>([]);
  protected bloqueos = signal<any[]>([]);
  protected motivos = signal<Motivo[]>([]);
  protected cuposLibres = signal<Cupo[]>([]);
  protected pendiente = signal<{ tipo: 'bloqueo' | 'horario'; afectadas: Afectada[]; horarioId?: number } | null>(null);
  resoluciones: Resolucion[] = [];
  medicoId: number | null = null;
  h: any = { diaSemana: 1, horaInicio: '09:00', horaFin: '13:00', sedeId: null, modalidad: 'PRESENCIAL' };
  b: any = { desde: '', hasta: '', motivo: '' };

  async ngOnInit() {
    await this.cat.publicos();
    const sede = this.auth.usuario()?.sede?.id ?? null;
    this.h.sedeId = sede ?? this.cat.sedes()[0]?.id;
    this.medicos.set(await this.cat.medicos({ sedeId: this.esRecepcion() ? sede : null }));
    this.motivos.set(await this.cat.motivosCancelacion());
  }

  async cargar() {
    if (!this.medicoId) return;
    const [h, b] = await Promise.all([
      this.api.get('/agenda/horarios', { medicoId: this.medicoId }),
      this.api.get('/agenda/bloqueos', { medicoId: this.medicoId }),
    ]);
    this.horarios.set(h);
    this.bloqueos.set(b);
  }

  async crearHorario() {
    try {
      const r = await this.api.post('/agenda/horarios', { ...this.h, medicoId: this.medicoId });
      this.avisos.ok(`Horario agregado: ${r.cuposGenerados} cupos generados`);
      await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  private async prepararResolucion(tipo: 'bloqueo' | 'horario', afectadas: Afectada[], horarioId?: number) {
    const motivoAgenda = this.motivos().find((m) => /agenda/i.test(m.descripcion))?.id ?? this.motivos()[0]?.id ?? null;
    this.resoluciones = afectadas.map((a) => ({ citaId: a.id, accion: 'CANCELAR', motivoId: motivoAgenda, cupoId: null }));
    const esp = afectadas[0]?.especialidad_id;
    const libres: Cupo[] = await this.api.get('/agenda/cupos-libres', { especialidadId: esp });
    // Excluye los cupos que el propio cambio dejaría sin efecto
    this.cuposLibres.set(libres.filter((c) => tipo === 'horario' || c.medico_id !== this.medicoId || !this.enRango(c.inicio)));
    this.pendiente.set({ tipo, afectadas, horarioId });
  }

  private enRango(inicio: string) {
    return new Date(inicio) < new Date(this.b.hasta) && new Date(inicio) >= new Date(this.b.desde);
  }

  usado(cupoId: number, indice: number) {
    return this.resoluciones.some((r, i) => i !== indice && r.accion === 'REPROGRAMAR' && r.cupoId === cupoId);
  }

  completas() {
    return this.resoluciones.every((r) => (r.accion === 'CANCELAR' ? !!r.motivoId : !!r.cupoId));
  }

  async crearBloqueo() {
    const cuerpo = { medicoId: this.medicoId, desde: new Date(this.b.desde).toISOString(), hasta: new Date(this.b.hasta).toISOString(), motivo: this.b.motivo };
    try {
      const afectadas: Afectada[] = await this.api.post('/agenda/bloqueos/previsualizar', cuerpo);
      if (afectadas.length) return this.prepararResolucion('bloqueo', afectadas);
      await this.api.post('/agenda/bloqueos', cuerpo);
      this.avisos.ok('Bloqueo aplicado');
      this.b = { desde: '', hasta: '', motivo: '' };
      await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  async desactivar(h: any) {
    try {
      const afectadas: Afectada[] = await this.api.get(`/agenda/horarios/${h.id}/afectadas`);
      if (afectadas.length) return this.prepararResolucion('horario', afectadas, h.id);
      if (!confirm(`¿Quitar el horario del ${DIAS[h.dia_semana]} ${h.hora_inicio}–${h.hora_fin}?`)) return;
      await this.api.post(`/agenda/horarios/${h.id}/desactivar`, { resoluciones: [] });
      this.avisos.ok('Horario eliminado');
      await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  async aplicar() {
    const p = this.pendiente()!;
    const resoluciones = this.resoluciones.map((r) => (r.accion === 'CANCELAR' ? { citaId: r.citaId, accion: r.accion, motivoId: r.motivoId } : { citaId: r.citaId, accion: r.accion, cupoId: r.cupoId }));
    try {
      if (p.tipo === 'bloqueo') {
        await this.api.post('/agenda/bloqueos', { medicoId: this.medicoId, desde: new Date(this.b.desde).toISOString(), hasta: new Date(this.b.hasta).toISOString(), motivo: this.b.motivo, resoluciones });
        this.b = { desde: '', hasta: '', motivo: '' };
      } else {
        await this.api.post(`/agenda/horarios/${p.horarioId}/desactivar`, { resoluciones });
      }
      this.avisos.ok(`Cambio aplicado; ${resoluciones.length} paciente(s) notificados`);
      this.pendiente.set(null);
      await this.cargar();
    } catch (e) {
      if (e instanceof ErrorApi && e.datos?.citasAfectadas) this.avisos.aviso('Aparecieron nuevas citas afectadas; revise de nuevo');
      else this.avisos.error(e);
    }
  }

  async quitarBloqueo(id: number) {
    try { await this.api.delete(`/agenda/bloqueos/${id}`); this.avisos.ok('Bloqueo eliminado'); await this.cargar(); } catch (e) { this.avisos.error(e); }
  }
}
