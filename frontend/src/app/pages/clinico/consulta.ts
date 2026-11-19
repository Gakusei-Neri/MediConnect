import { Component, computed, inject, input, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, ErrorApi } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { Avisos } from '../../core/avisos.service';
import { Catalogos } from '../../core/catalogos.service';
import { Consulta, Diagnostico, Expediente, Receta, SIGNOS_VITALES } from '../../core/modelos';
import { Dialogo2fa } from '../../shared/dialogo-2fa';
import { PanelAlergias } from '../../shared/panel-alergias';
import { EstadoCitaPipe, FechaPipe, ReservaPipe, TonoCitaPipe } from '../../shared/pipes';

interface ItemReceta { medicamentoId: number | null; dosis: string; frecuencia: string; duracion: string; cantidad: number }
interface Hallazgo { medicamento: string; componente: string; severidad: string }

/** RF-14 consulta, RF-17/18 receta, RN-06 firma y addendum, RN-01 verificación 2FA. */
@Component({
  selector: 'app-consulta',
  imports: [FormsModule, RouterLink, PanelAlergias, Dialogo2fa, FechaPipe, EstadoCitaPipe, TonoCitaPipe, ReservaPipe],
  template: `
    @if (error()) { <div class="tarjeta alerta"><h1>No se puede abrir la consulta</h1><p>{{ error() }}</p><a routerLink="/clinico">Volver a la agenda</a></div> }
    @if (c(); as con) {
      <div class="encabezado-pagina">
        <div>
          <h1>Consulta — {{ exp()?.paciente?.nombre_completo }}</h1>
          <p>{{ exp()?.paciente?.edad }} años · <span class="mono">{{ exp()?.paciente?.curp }}</span> · <a [routerLink]="['/clinico/expediente', con.pacienteId]">Ver expediente completo</a></p>
        </div>
        <div class="fila">
          <span class="insignia" [class]="con.citaEstado! | tonoCita">{{ con.citaEstado! | estadoCita }}</span>
          @if (esMedico() && con.citaEstado === 'EN_SALA_ESPERA') { <button class="btn" (click)="llamar()">Llamar paciente</button> }
          @if (esMedico() && con.citaEstado === 'EN_CONSULTA' && !con.firmada) {
            <button class="btn secundario" (click)="derivar()">Derivar a urgencias</button>
            <button class="btn" (click)="finalizar()">Finalizar y firmar</button>
          }
        </div>
      </div>

      @if (con.firmada) { <p class="mensaje ok mb">Consulta finalizada y firmada el {{ con.fecha | fecha }}. Las correcciones se hacen con un addendum (RN-06).</p> }

      <div class="disposicion">
        <div class="pila">
          <!-- Signos vitales (médico y enfermería) -->
          <section class="tarjeta">
            <h2>Signos vitales</h2>
            <div class="signos">
              @for (s of signos; track s.clave) {
                <div class="campo">
                  <label [for]="'sv-' + s.clave">{{ s.etiqueta }} <span class="atenuado">({{ s.unidad }})</span></label>
                  <input [id]="'sv-' + s.clave" type="number" [step]="s.paso" [(ngModel)]="sv[s.clave]" [disabled]="con.firmada" [class.fuera]="fueraClaves().includes(s.clave)" />
                </div>
              }
            </div>
            @if (fuera().length) {
              <div class="mensaje aviso mt" role="alert">
                <strong>Valores fuera del rango fisiológico:</strong>
                <ul>@for (f of fuera(); track f.signo) { <li>{{ etiqueta(f.signo) }}: {{ f.valor }} (rango {{ f.minimo }}–{{ f.maximo }} {{ f.unidad }})</li> }</ul>
                <div class="fila"><button class="btn chico" (click)="guardarSignos(true)">Confirmo que son correctos</button><button class="btn chico fantasma" (click)="fuera.set([])">Corregir</button></div>
              </div>
            }
            @if (!con.firmada) { <div class="fila fin mt"><button class="btn secundario" (click)="guardarSignos(false)">Guardar signos</button></div> }
          </section>

          <!-- Nota médica (solo médico) -->
          @if (esMedico()) {
            <section class="tarjeta">
              <h2>Nota médica</h2>
              <div class="campo"><label for="motivo">Motivo de consulta</label><input id="motivo" [(ngModel)]="motivo" [disabled]="con.firmada" /></div>
              <div class="campo mt"><label for="notas">Notas de evolución</label><textarea id="notas" rows="5" [(ngModel)]="notas" [disabled]="con.firmada"></textarea></div>
              <div class="campo mt">
                <span class="etiqueta">Diagnósticos (CIE)</span>
                <div class="fila">@for (d of diagnosticos(); track d.id) {
                  <span class="insignia primario">{{ d.codigo }} {{ d.descripcion }} @if (!con.firmada) { <button class="x" (click)="quitarDx(d.id)" [attr.aria-label]="'Quitar ' + d.descripcion">×</button> }</span>
                } @empty { <span class="atenuado pequeno">Sin diagnósticos</span> }</div>
                @if (!con.firmada) {
                  <input aria-label="Buscar diagnóstico" placeholder="Buscar por código o descripción…" [(ngModel)]="buscaDx" (ngModelChange)="buscarDx()" />
                  @if (resultadosDx().length) {
                    <ul class="sugerencias">@for (d of resultadosDx(); track d.id) { <li><button class="btn fantasma chico" (click)="agregarDx(d)">{{ d.codigo }} — {{ d.descripcion }}</button></li> }</ul>
                  }
                }
              </div>
              @if (!con.firmada) { <div class="fila fin mt"><button class="btn secundario" (click)="guardarNota()">Guardar nota</button></div> }
            </section>
          } @else if (con.motivo) {
            <section class="tarjeta"><h2>Nota médica</h2><p><strong>Motivo:</strong> {{ con.motivo }}</p></section>
          }

          <!-- Receta -->
          @if (esMedico()) {
            <section class="tarjeta">
              <h2>Receta electrónica</h2>
              @if (receta(); as r) {
                <div class="receta">
                  <img [src]="r.qr" [alt]="'QR de la receta ' + r.folio" width="140" height="140" />
                  <div>
                    <p class="mono"><strong>{{ r.folio }}</strong></p>
                    <p>@if (r.anulada) { <span class="insignia error">Anulada</span> } @else { <span class="insignia" [class]="r.reserva_estado | reserva: 'tono'">{{ r.reserva_estado | reserva }}</span> } <span class="pequeno atenuado">vigente hasta {{ r.vigente_hasta | fecha: 'dia' }}</span></p>
                    <ul>@for (m of r.medicamentos; track m.id) { <li>{{ m.nombre }} ×{{ m.cantidad }} — {{ m.dosis }}, {{ m.frecuencia }}, {{ m.duracion }}</li> }</ul>
                    @if (!r.anulada && !r.surtida) {
                      <div class="fila">
                        @if (r.reserva_estado === 'SIN_STOCK' || r.reserva_estado === 'FALLIDA') { <button class="btn chico secundario" (click)="reintentarReserva(r.id)">Reintentar reserva</button> }
                        <button class="btn chico fantasma" (click)="anular(r.id)">Anular receta</button>
                      </div>
                    }
                  </div>
                </div>
              } @else if (con.citaEstado === 'EN_CONSULTA' && !con.firmada) {
                @for (it of items; track $index; let i = $index) {
                  <div class="item">
                    <div class="campo med"><label [for]="'m' + i">Medicamento</label>
                      <select [id]="'m' + i" [(ngModel)]="it.medicamentoId" (ngModelChange)="hallazgos.set(null)">
                        <option [ngValue]="null" disabled>Seleccione</option>
                        @for (m of cat.medicamentos(); track m.id) { <option [ngValue]="m.id">{{ m.nombre }} ({{ m.componente }})</option> }
                      </select></div>
                    <div class="campo"><label [for]="'d' + i">Dosis</label><input [id]="'d' + i" [(ngModel)]="it.dosis" placeholder="1 tableta" /></div>
                    <div class="campo"><label [for]="'f' + i">Frecuencia</label><input [id]="'f' + i" [(ngModel)]="it.frecuencia" placeholder="cada 8 h" /></div>
                    <div class="campo"><label [for]="'u' + i">Duración</label><input [id]="'u' + i" [(ngModel)]="it.duracion" placeholder="5 días" /></div>
                    <div class="campo cant"><label [for]="'c' + i">Cantidad</label><input [id]="'c' + i" type="number" min="1" [(ngModel)]="it.cantidad" /></div>
                    <button class="btn fantasma chico quitar" (click)="items.splice(i, 1); hallazgos.set(null)" [attr.aria-label]="'Quitar medicamento ' + (i + 1)">✕</button>
                  </div>
                }
                <button class="btn fantasma chico" (click)="items.push(nuevoItem())">+ Agregar medicamento</button>

                @if (hallazgos(); as h) {
                  @if (h.severas.length) {
                    <div class="mensaje error mt" role="alert">
                      <strong>⛔ Receta bloqueada: alergia SEVERA</strong>
                      <ul>@for (s of h.severas; track s.medicamento) { <li>{{ s.medicamento }} contiene <strong>{{ s.componente }}</strong></li> }</ul>
                      Retire esos medicamentos para continuar.
                    </div>
                  }
                  @if (h.advertencias.length && !h.severas.length) {
                    <div class="mensaje aviso mt" role="alert">
                      <strong>Advertencia de alergia leve/moderada:</strong>
                      <ul>@for (s of h.advertencias; track s.medicamento) { <li>{{ s.medicamento }} — {{ s.componente }} ({{ s.severidad.toLowerCase() }})</li> }</ul>
                      <div class="campo"><label for="just">Justificación del médico (obligatoria)</label><textarea id="just" [(ngModel)]="justificacion"></textarea></div>
                    </div>
                  }
                }
                <div class="fila fin mt">
                  <button class="btn" [disabled]="!itemsValidos() || bloqueada()" (click)="prepararReceta()">Emitir receta</button>
                </div>
              } @else {
                <p class="atenuado">La receta se emite durante la consulta (estado «En consulta»).</p>
              }
            </section>
          }

          <!-- Addendum (RN-06) -->
          @if (esMedico() && con.firmada) {
            <section class="tarjeta">
              <h2>Addendum</h2>
              @for (a of con.addendums; track a.id) {
                <div class="mensaje info mb pequeno"><strong>{{ a.autor }}</strong>, {{ a.fecha | fecha }}<br />{{ a.texto }}
                  @for (d of a.diagnosticosAgregados; track d.id) { <span class="insignia primario">+ {{ d.codigo }}</span> }</div>
              }
              <div class="campo"><label for="add">Texto del addendum</label><textarea id="add" [(ngModel)]="addTexto"></textarea></div>
              <div class="campo mt"><label for="add-dx">Agregar diagnóstico (requiere 2FA)</label>
                <select id="add-dx" [(ngModel)]="addDx"><option [ngValue]="null">Ninguno</option>
                  @for (d of todosDx(); track d.id) { <option [ngValue]="d.id">{{ d.codigo }} — {{ d.descripcion }}</option> }</select></div>
              <div class="fila fin mt"><button class="btn" [disabled]="!addTexto.trim()" (click)="addDx ? pedir2fa('addendum') : enviarAddendum()">Agregar addendum</button></div>
            </section>
          }
        </div>

        <aside class="pila">
          @if (exp(); as x) {
            <app-panel-alergias [pacienteId]="x.paciente.id" [alergias]="x.alergias" [sinAlergias]="x.expediente.sinAlergiasConocidas"
              [sinAlergiasFecha]="x.expediente.sinAlergiasFecha" [editable]="!con.firmada" (cambio)="cargarExpediente(); hallazgos.set(null)" />
            <section class="tarjeta">
              <h2>Antecedentes</h2>
              <p class="pequeno pre">{{ x.expediente.antecedentes || 'Sin antecedentes registrados.' }}</p>
              <h3>Consultas previas</h3>
              <ul class="pequeno">@for (p of previas(); track p.id) { <li>{{ p.fecha | fecha: 'dia' }} — @for (d of p.diagnosticos; track d.id) { {{ d.descripcion }} } </li> } @empty { <li class="atenuado">Ninguna</li> }</ul>
            </section>
          }
        </aside>
      </div>
    }

    @if (dialogo2fa()) {
      <app-dialogo-2fa [accion]="dialogo2fa() === 'receta' ? 'Emitir la receta' : 'Modificar un diagnóstico'" [error]="error2fa()" [ocupado]="ocupado()"
        (cerrar)="dialogo2fa.set(null); error2fa.set('')" (confirmar)="dialogo2fa() === 'receta' ? emitirReceta($event) : enviarAddendum($event)" />
    }
  `,
  styles: `
    .disposicion { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); gap: 1rem; align-items: start; }
    @media (max-width: 900px) { .disposicion { grid-template-columns: 1fr; } }
    .signos { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: .75rem; }
    input.fuera { border-color: var(--c-aviso); background: var(--c-aviso-suave); }
    .item { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 80px auto; gap: .5rem; align-items: end; padding: .5rem 0; border-bottom: 1px dashed var(--c-borde); }
    @media (max-width: 700px) { .item { grid-template-columns: 1fr 1fr; } .item .med { grid-column: 1 / -1; } }
    .sugerencias { list-style: none; padding: 0; margin: .25rem 0 0; border: 1px solid var(--c-borde); border-radius: 8px; max-height: 220px; overflow: auto; }
    .x { background: none; border: 0; cursor: pointer; font-weight: 700; color: inherit; padding: 0 .2rem; }
    .insignia { margin: 0 .3rem .3rem 0; }
    .receta { display: flex; gap: 1rem; flex-wrap: wrap; } .receta ul { padding-left: 1rem; }
    .pre { white-space: pre-wrap; }
    .mensaje ul { margin: .3rem 0 .5rem; padding-left: 1.2rem; }
  `,
})
export class ConsultaMedica implements OnInit, OnDestroy {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  private router = inject(Router);
  protected cat = inject(Catalogos);
  readonly citaId = input.required<string>();

  protected signos = SIGNOS_VITALES;
  protected esMedico = computed(() => this.auth.rol() === 'MEDICO');
  protected c = signal<Consulta | null>(null);
  protected exp = signal<Expediente | null>(null);
  protected receta = signal<Receta | null>(null);
  protected error = signal('');
  protected fuera = signal<{ signo: string; valor: number; minimo: number; maximo: number; unidad: string }[]>([]);
  protected fueraClaves = computed(() => this.fuera().map((f) => f.signo));
  protected diagnosticos = signal<Diagnostico[]>([]);
  protected resultadosDx = signal<Diagnostico[]>([]);
  protected todosDx = signal<Diagnostico[]>([]);
  protected hallazgos = signal<{ severas: Hallazgo[]; advertencias: Hallazgo[] } | null>(null);
  protected bloqueada = computed(() => !!this.hallazgos()?.severas.length);
  protected dialogo2fa = signal<'receta' | 'addendum' | null>(null);
  protected error2fa = signal('');
  protected ocupado = signal(false);
  protected previas = computed(() => (this.exp()?.consultas ?? []).filter((x) => x.id !== this.c()?.id && x.firmada).slice(0, 5));

  sv: Record<string, number | null> = {};
  motivo = '';
  notas = '';
  buscaDx = '';
  justificacion = '';
  addTexto = '';
  addDx: number | null = null;
  items: ItemReceta[] = [this.nuevoItem()];
  private sondeo: any;

  nuevoItem(): ItemReceta { return { medicamentoId: null, dosis: '', frecuencia: '', duracion: '', cantidad: 1 }; }
  etiqueta(clave: string) { return SIGNOS_VITALES.find((s) => s.clave === clave)?.etiqueta ?? clave; }

  async ngOnInit() {
    this.cat.clinicos();
    await this.cargar();
  }
  ngOnDestroy() { clearInterval(this.sondeo); }

  async cargar() {
    try {
      const con: Consulta = await this.api.get(`/clinico/citas/${this.citaId()}/consulta`);
      this.c.set(con);
      this.sv = { ...(con.signosVitales || {}) };
      this.motivo = con.motivo || '';
      this.notas = con.notasEvolucion || '';
      this.diagnosticos.set(con.diagnosticos);
      if (con.receta) await this.cargarReceta(con.receta.id);
      else this.receta.set(null);
      await this.cargarExpediente();
      if (con.firmada && this.esMedico()) this.todosDx.set(await this.api.get('/catalogos/diagnosticos'));
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  async cargarExpediente() {
    this.exp.set(await this.api.get(`/clinico/expedientes/${this.c()!.pacienteId}`));
  }

  private async cargarReceta(id: number) {
    this.receta.set(await this.api.get(`/clinico/recetas/${id}`));
    clearInterval(this.sondeo);
    // RF-19: la reserva en farmacia es asíncrona; se consulta hasta que deje de estar pendiente
    if (this.receta()?.reserva_estado === 'PENDIENTE') {
      this.sondeo = setInterval(async () => {
        const r = await this.api.get(`/clinico/recetas/${id}`);
        this.receta.set(r);
        if (r.reserva_estado !== 'PENDIENTE') clearInterval(this.sondeo);
      }, 2000);
    }
  }

  private async guardar(datos: any) {
    const con = await this.api.put(`/clinico/citas/${this.citaId()}/consulta`, datos);
    this.c.set(con);
    return con;
  }

  async guardarSignos(confirmar: boolean) {
    const signosVitales: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.sv)) if (v !== null && v !== undefined && (v as any) !== '') signosVitales[k] = Number(v);
    try {
      await this.guardar({ signosVitales, confirmarFueraDeRango: confirmar });
      this.fuera.set([]);
      this.avisos.ok('Signos vitales guardados');
    } catch (e) {
      if (e instanceof ErrorApi && e.datos?.codigo === 'FUERA_DE_RANGO') this.fuera.set(e.datos.fueraDeRango);
      else this.avisos.error(e);
    }
  }

  async guardarNota() {
    try {
      await this.guardar({ motivo: this.motivo, notasEvolucion: this.notas, diagnosticos: this.diagnosticos().map((d) => d.id) });
      this.avisos.ok('Nota guardada');
    } catch (e) { this.avisos.error(e); }
  }

  private tBusca: any;
  buscarDx() {
    clearTimeout(this.tBusca);
    this.tBusca = setTimeout(async () => {
      this.resultadosDx.set(this.buscaDx.trim() ? await this.api.get('/catalogos/diagnosticos', { q: this.buscaDx }) : []);
    }, 250);
  }
  agregarDx(d: Diagnostico) {
    if (!this.diagnosticos().some((x) => x.id === d.id)) this.diagnosticos.update((l) => [...l, d]);
    this.buscaDx = '';
    this.resultadosDx.set([]);
  }
  quitarDx(id: number) { this.diagnosticos.update((l) => l.filter((d) => d.id !== id)); }

  async llamar() {
    try { await this.api.post(`/citas/${this.citaId()}/llamar`); await this.cargar(); } catch (e) { this.avisos.error(e); }
  }

  async derivar() {
    if (!confirm('¿Derivar al paciente a urgencias? La cita terminará en estado «Derivada a urgencias».')) return;
    try { await this.api.post(`/citas/${this.citaId()}/derivar-urgencias`); this.avisos.aviso('Paciente derivado a urgencias'); await this.cargar(); } catch (e) { this.avisos.error(e); }
  }

  async finalizar() {
    try {
      await this.guardar({ motivo: this.motivo, notasEvolucion: this.notas, diagnosticos: this.diagnosticos().map((d) => d.id) });
      if (!confirm('Al finalizar, la nota queda firmada y ya no podrá editarse. ¿Continuar?')) return;
      await this.api.post(`/clinico/citas/${this.citaId()}/consulta/finalizar`);
      this.avisos.ok('Consulta finalizada y firmada');
      await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  itemsValidos() {
    return this.items.length > 0 && this.items.every((i) => i.medicamentoId && i.dosis.trim() && i.frecuencia.trim() && i.duracion.trim() && i.cantidad > 0);
  }

  /** RF-18: valida alergias antes de pedir la verificación 2FA. */
  async prepararReceta() {
    try {
      const v = await this.api.post(`/clinico/consultas/${this.c()!.id}/recetas/validar`, { items: this.items });
      if (!v.alergiasRegistradas) return this.avisos.aviso('Registre las alergias o marque «sin alergias conocidas» antes de recetar (RF-15)');
      this.hallazgos.set({ severas: v.severas, advertencias: v.advertencias });
      if (v.severas.length) return;
      if (v.advertencias.length && !this.justificacion.trim()) return this.avisos.aviso('Escriba la justificación para continuar');
      this.pedir2fa('receta');
    } catch (e) { this.avisos.error(e); }
  }

  pedir2fa(tipo: 'receta' | 'addendum') { this.error2fa.set(''); this.dialogo2fa.set(tipo); }

  async emitirReceta(codigo2fa: string) {
    this.ocupado.set(true);
    try {
      const r = await this.api.post(`/clinico/consultas/${this.c()!.id}/recetas`, { items: this.items, codigo2fa, justificacionAlergia: this.justificacion || undefined });
      this.dialogo2fa.set(null);
      this.avisos.ok(`Receta ${r.folio} emitida`);
      this.items = [this.nuevoItem()];
      this.justificacion = '';
      this.hallazgos.set(null);
      await this.cargarReceta(r.id);
    } catch (e) {
      if (e instanceof ErrorApi && e.datos?.codigo === 'VERIFICACION_2FA') this.error2fa.set('Código incorrecto o vencido');
      else {
        this.dialogo2fa.set(null);
        if (e instanceof ErrorApi && e.datos?.severas) this.hallazgos.set({ severas: e.datos.severas, advertencias: e.datos.advertencias });
        this.avisos.error(e);
      }
    } finally {
      this.ocupado.set(false);
    }
  }

  async anular(id: number) {
    const motivo = prompt('Motivo de la anulación (obligatorio):');
    if (!motivo || motivo.trim().length < 5) return;
    try { await this.api.post(`/clinico/recetas/${id}/anular`, { motivo }); this.avisos.ok('Receta anulada y reserva cancelada'); await this.cargar(); } catch (e) { this.avisos.error(e); }
  }

  async reintentarReserva(id: number) {
    try { this.receta.set(await this.api.post(`/clinico/recetas/${id}/reservar`)); } catch (e) { this.avisos.error(e); }
  }

  async enviarAddendum(codigo2fa?: string) {
    this.ocupado.set(true);
    try {
      await this.api.post(`/clinico/consultas/${this.c()!.id}/addendum`, { texto: this.addTexto, diagnosticos: this.addDx ? [this.addDx] : [], codigo2fa });
      this.dialogo2fa.set(null);
      this.addTexto = '';
      this.addDx = null;
      this.avisos.ok('Addendum agregado');
      await this.cargar();
    } catch (e) {
      if (e instanceof ErrorApi && e.datos?.codigo === 'VERIFICACION_2FA') this.error2fa.set('Código incorrecto o vencido');
      else { this.dialogo2fa.set(null); this.avisos.error(e); }
    } finally {
      this.ocupado.set(false);
    }
  }
}
