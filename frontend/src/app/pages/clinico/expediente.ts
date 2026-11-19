import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, ErrorApi } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { Avisos } from '../../core/avisos.service';
import { Expediente, SIGNOS_VITALES } from '../../core/modelos';
import { PanelAlergias } from '../../shared/panel-alergias';
import { FechaPipe, ReservaPipe } from '../../shared/pipes';

/** RF-13: expediente clínico único (lectura auditada). Si no hay relación, ofrece RF-23. */
@Component({
  selector: 'app-expediente',
  imports: [FormsModule, RouterLink, PanelAlergias, FechaPipe, ReservaPipe],
  template: `
    @if (sinAcceso()) {
      <div class="tarjeta alerta">
        <h1>Acceso restringido</h1>
        <p>{{ sinAcceso() }}</p>
        @if (esMedico() && sinAcceso()!.includes('relación')) {
          <p>En una emergencia puede abrir el expediente declarando una justificación. El acceso se marcará como emergencia y se avisará a Seguridad.</p>
          <div class="campo"><label for="just">Justificación de emergencia</label><textarea id="just" [(ngModel)]="justificacion"></textarea></div>
          <button class="btn peligro mt" [disabled]="justificacion.trim().length < 10" (click)="emergencia()">Acceder por emergencia</button>
        }
      </div>
    } @else if (e(); as x) {
      @if (x.esEmergencia) { <p class="mensaje error mb" role="alert">🚨 Acceso de emergencia: esta lectura está marcada y Seguridad fue notificada.</p> }
      <div class="encabezado-pagina">
        <div>
          <h1>{{ x.paciente.nombre_completo }}</h1>
          <p><span class="mono">{{ x.paciente.curp }}</span> · {{ x.paciente.edad }} años · Expediente #{{ x.expediente.id }} desde {{ x.expediente.fechaCreacion | fecha: 'dia' }}</p>
        </div>
        <span class="insignia info">Acceso: {{ via[x.accesoVia] || x.accesoVia }}</span>
      </div>

      <div class="grid grid-2 mb">
        <app-panel-alergias [pacienteId]="x.paciente.id" [alergias]="x.alergias" [sinAlergias]="x.expediente.sinAlergiasConocidas"
          [sinAlergiasFecha]="x.expediente.sinAlergiasFecha" (cambio)="cargar()" />
        <section class="tarjeta">
          <h2>Antecedentes</h2>
          @if (editandoAnt()) {
            <textarea aria-label="Antecedentes" [(ngModel)]="antecedentes"></textarea>
            <div class="fila fin mt"><button class="btn fantasma" (click)="editandoAnt.set(false)">Cancelar</button><button class="btn" (click)="guardarAnt()">Guardar</button></div>
          } @else {
            <p class="pre">{{ x.expediente.antecedentes || 'Sin antecedentes registrados.' }}</p>
            @if (esMedico()) { <button class="btn fantasma chico" (click)="antecedentes = x.expediente.antecedentes || ''; editandoAnt.set(true)">Editar</button> }
          }
          <p class="pequeno atenuado mt">Contacto: {{ x.paciente.correo }} · {{ x.paciente.telefono }}</p>
        </section>
      </div>

      <h2>Historial de consultas</h2>
      @for (c of x.consultas; track c.id) {
        <article class="tarjeta mb">
          <div class="fila entre">
            <h3>{{ c.fecha | fecha }} — {{ c.medico }}</h3>
            <span class="fila"><span class="pequeno atenuado">{{ c.sede }}</span>
              @if (c.firmada) { <span class="insignia ok">Firmada</span> } @else { <span class="insignia aviso">En curso</span> }
              <a class="btn chico fantasma" [routerLink]="['/clinico/consulta', c.citaId]">Abrir</a></span>
          </div>
          @if (c.motivo) { <p><strong>Motivo:</strong> {{ c.motivo }}</p> }
          @if (c.diagnosticos.length) {
            <p><strong>Diagnósticos:</strong> @for (d of c.diagnosticos; track d.id) { <span class="insignia primario">{{ d.codigo }} {{ d.descripcion }}</span> }</p>
          }
          @if (c.signosVitales) {
            <p class="pequeno">@for (s of signos; track s.clave) { @if (c.signosVitales[s.clave] != null) { {{ s.etiqueta }}: <strong>{{ c.signosVitales[s.clave] }} {{ s.unidad }}</strong> · } }</p>
          }
          @if (c.notasEvolucion) { <details><summary>Notas de evolución</summary><p class="pre">{{ c.notasEvolucion }}</p></details> }
          @for (a of c.addendums; track a.id) {
            <div class="mensaje info mt pequeno"><strong>Addendum</strong> — {{ a.autor }}, {{ a.fecha | fecha }}<br />{{ a.texto }}
              @for (d of a.diagnosticosAgregados; track d.id) { <span class="insignia primario">+ {{ d.codigo }} {{ d.descripcion }}</span> }</div>
          }
        </article>
      } @empty { <p class="tarjeta vacio">Sin consultas registradas.</p> }

      <h2>Recetas</h2>
      <div class="tabla-envoltura">
        <table>
          <thead><tr><th>Folio</th><th>Emitida</th><th>Medicamentos</th><th>Estado</th></tr></thead>
          <tbody>
            @for (r of x.recetas; track r.id) {
              <tr><td class="mono">{{ r.folio }}</td><td>{{ r.fecha_emision | fecha }}</td>
                <td>@for (m of r.medicamentos; track m.id) { {{ m.nombre }} ×{{ m.cantidad }}<br /> }</td>
                <td>@if (r.anulada) { <span class="insignia error">Anulada</span> } @else { <span class="insignia" [class]="r.reserva_estado | reserva: 'tono'">{{ r.reserva_estado | reserva }}</span> }</td></tr>
            } @empty { <tr><td colspan="4" class="vacio">Sin recetas</td></tr> }
          </tbody>
        </table>
      </div>
    } @else { <p class="atenuado"><span class="cargando"></span> Cargando expediente…</p> }
  `,
  styles: `.pre { white-space: pre-wrap; } details summary { cursor: pointer; font-weight: 600; } .insignia { margin: 0 .25rem .25rem 0; }`,
})
export class ExpedienteClinico implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  readonly pacienteId = input.required<string>();
  protected e = signal<Expediente | null>(null);
  protected sinAcceso = signal<string | null>(null);
  protected editandoAnt = signal(false);
  protected esMedico = computed(() => this.auth.rol() === 'MEDICO');
  protected signos = SIGNOS_VITALES;
  protected via: Record<string, string> = { CITA: 'cita asignada', URGENCIA: 'urgencia activa', EMERGENCIA: 'emergencia' };
  justificacion = '';
  antecedentes = '';

  ngOnInit() { this.cargar(); }

  async cargar() {
    try {
      this.e.set(await this.api.get(`/clinico/expedientes/${this.pacienteId()}`));
      this.sinAcceso.set(null);
    } catch (err) {
      if (err instanceof ErrorApi && (err.status === 403 || err.status === 503)) this.sinAcceso.set(err.message);
      else this.avisos.error(err);
    }
  }

  async emergencia() {
    try {
      this.e.set(await this.api.post(`/clinico/expedientes/${this.pacienteId()}/emergencia`, { justificacion: this.justificacion }));
      this.sinAcceso.set(null);
    } catch (err) { this.avisos.error(err); }
  }

  async guardarAnt() {
    try {
      await this.api.put(`/clinico/expedientes/${this.pacienteId()}/antecedentes`, { antecedentes: this.antecedentes });
      this.editandoAnt.set(false);
      await this.cargar();
    } catch (err) { this.avisos.error(err); }
  }
}
