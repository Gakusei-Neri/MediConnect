import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Catalogos } from '../core/catalogos.service';
import { Cupo, Medico } from '../core/modelos';
import { FechaPipe } from './pipes';

/** RF-04: consulta de disponibilidad combinando filtros; solo cupos libres futuros. */
@Component({
  selector: 'app-buscador-cupos',
  imports: [FormsModule, FechaPipe],
  template: `
    <form class="formulario" (ngSubmit)="buscar()" aria-label="Filtros de disponibilidad">
      <div class="campo">
        <label for="esp">Especialidad</label>
        <select id="esp" name="esp" [(ngModel)]="f.especialidadId" (ngModelChange)="cargarMedicos()" [disabled]="!!especialidadFija()">
          <option [ngValue]="null">Todas</option>
          @for (e of cat.especialidades(); track e.id) { <option [ngValue]="e.id">{{ e.nombre }}</option> }
        </select>
      </div>
      <div class="campo">
        <label for="sede">Sede</label>
        <select id="sede" name="sede" [(ngModel)]="f.sedeId" (ngModelChange)="cargarMedicos()">
          <option [ngValue]="null">Todas</option>
          @for (s of cat.sedes(); track s.id) { <option [ngValue]="s.id">{{ s.nombre }}</option> }
        </select>
      </div>
      <div class="campo">
        <label for="med">Médico</label>
        <select id="med" name="med" [(ngModel)]="f.medicoId">
          <option [ngValue]="null">Cualquiera</option>
          @for (m of medicos(); track m.id) { <option [ngValue]="m.id">{{ m.nombre_completo }}</option> }
        </select>
      </div>
      <div class="campo">
        <label for="fecha">Fecha</label>
        <input id="fecha" name="fecha" type="date" [(ngModel)]="f.fecha" [min]="hoy" />
      </div>
      <div class="campo">
        <label for="mod">Modalidad</label>
        <select id="mod" name="mod" [(ngModel)]="f.modalidad">
          <option [ngValue]="null">Presencial o virtual</option>
          <option value="PRESENCIAL">Presencial</option>
          <option value="VIRTUAL">Virtual (videoconsulta)</option>
        </select>
      </div>
      <button class="btn" type="submit" [disabled]="cargando()">
        @if (cargando()) { <span class="cargando" aria-hidden="true"></span> } Buscar
      </button>
    </form>

    <div class="mt" aria-live="polite">
      @if (buscado() && !cupos().length) {
        <p class="tarjeta vacio">No hay horarios libres con esos filtros. {{ textoSinCupos() }}</p>
      }
      @for (dia of porDia(); track dia.clave) {
        <section class="dia">
          <h3>{{ dia.titulo }}</h3>
          <div class="cupos" role="list">
            @for (c of dia.cupos; track c.id) {
              <button type="button" role="listitem" class="cupo" [attr.aria-pressed]="seleccionado()?.id === c.id" (click)="elegir(c)"
                [attr.aria-label]="(c.inicio | fecha: 'completa': c.zona_horaria) + ', ' + c.medico_nombre + ', ' + c.sede_nombre + ', ' + (c.modalidad === 'VIRTUAL' ? 'virtual' : 'presencial')">
                <span class="hora">{{ c.inicio | fecha: 'hora': c.zona_horaria }} {{ c.modalidad === 'VIRTUAL' ? '🎥' : '' }}</span>
                <span class="det">{{ c.medico_nombre }}</span><br />
                <span class="det">{{ c.especialidad_nombre }} · {{ c.sede_nombre.replace(' (PRUEBA)', '') }}</span>
              </button>
            }
          </div>
        </section>
      }
    </div>
  `,
  styles: `.dia { margin-bottom: 1rem; } .dia h3 { text-transform: capitalize; color: var(--c-texto-2); font-size: .95rem; }`,
})
export class BuscadorCupos implements OnInit {
  protected cat = inject(Catalogos);
  private api = inject(Api);
  readonly especialidadFija = input<number | null>(null);
  readonly textoSinCupos = input('');
  readonly seleccion = output<Cupo>();

  protected hoy = new Date().toISOString().slice(0, 10);
  f: { especialidadId: number | null; sedeId: number | null; medicoId: number | null; fecha: string; modalidad: string | null } =
    { especialidadId: null, sedeId: null, medicoId: null, fecha: '', modalidad: null };
  protected medicos = signal<Medico[]>([]);
  protected cupos = signal<Cupo[]>([]);
  protected cargando = signal(false);
  protected buscado = signal(false);
  protected seleccionado = signal<Cupo | null>(null);

  protected porDia = computed(() => {
    const grupos = new Map<string, { clave: string; titulo: string; cupos: Cupo[] }>();
    const fmt = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', weekday: 'long', day: 'numeric', month: 'long' });
    const clave = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' });
    for (const c of this.cupos()) {
      const k = clave.format(new Date(c.inicio));
      if (!grupos.has(k)) grupos.set(k, { clave: k, titulo: fmt.format(new Date(c.inicio)), cupos: [] });
      grupos.get(k)!.cupos.push(c);
    }
    return [...grupos.values()];
  });

  async ngOnInit() {
    await this.cat.publicos();
    if (this.especialidadFija()) this.f.especialidadId = this.especialidadFija();
    await this.cargarMedicos();
    await this.buscar();
  }

  async cargarMedicos() {
    this.medicos.set(await this.cat.medicos({ especialidadId: this.f.especialidadId, sedeId: this.f.sedeId }));
    if (this.f.medicoId && !this.medicos().some((m) => m.id === this.f.medicoId)) this.f.medicoId = null;
  }

  async buscar() {
    this.cargando.set(true);
    this.seleccionado.set(null);
    try {
      this.cupos.set(await this.api.get('/disponibilidad', this.f));
      this.buscado.set(true);
    } finally {
      this.cargando.set(false);
    }
  }

  elegir(c: Cupo) {
    this.seleccionado.set(c);
    this.seleccion.emit(c);
  }

  quitar(id: number) {
    this.cupos.update((l) => l.filter((c) => c.id !== id));
    this.seleccionado.set(null);
  }
}
