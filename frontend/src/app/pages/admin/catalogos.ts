import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api.service';
import { Avisos } from '../../core/avisos.service';
import { Catalogos } from '../../core/catalogos.service';

interface DefCatalogo { clave: string; titulo: string; campos: { k: string; etiqueta: string; tipo?: string }[] }

const CATALOGOS: DefCatalogo[] = [
  { clave: 'sedes', titulo: 'Sedes', campos: [{ k: 'nombre', etiqueta: 'Nombre' }, { k: 'tipo', etiqueta: 'Tipo (HOSPITAL/CLINICA)' }, { k: 'direccion', etiqueta: 'Dirección' }] },
  { clave: 'especialidades', titulo: 'Especialidades', campos: [{ k: 'nombre', etiqueta: 'Nombre' }, { k: 'duracion_min', etiqueta: 'Duración (min)', tipo: 'number' }] },
  { clave: 'componentes', titulo: 'Componentes activos', campos: [{ k: 'nombre', etiqueta: 'Nombre' }] },
  { clave: 'medicamentos', titulo: 'Medicamentos', campos: [{ k: 'codigo', etiqueta: 'Código' }, { k: 'nombre', etiqueta: 'Nombre' }, { k: 'presentacion', etiqueta: 'Presentación' }, { k: 'componente_id', etiqueta: 'ID componente', tipo: 'number' }] },
  { clave: 'diagnosticos', titulo: 'Diagnósticos CIE', campos: [{ k: 'codigo', etiqueta: 'Código' }, { k: 'descripcion', etiqueta: 'Descripción' }, { k: 'version', etiqueta: 'Versión' }] },
  { clave: 'motivos-cancelacion', titulo: 'Motivos de cancelación', campos: [{ k: 'descripcion', etiqueta: 'Descripción' }] },
  { clave: 'rangos-fisiologicos', titulo: 'Rangos fisiológicos', campos: [{ k: 'signo', etiqueta: 'Signo' }, { k: 'grupo_edad', etiqueta: 'Grupo (NINO/ADULTO)' }, { k: 'minimo', etiqueta: 'Mínimo', tipo: 'number' }, { k: 'maximo', etiqueta: 'Máximo', tipo: 'number' }, { k: 'unidad', etiqueta: 'Unidad' }] },
];

/** Catálogos de la sección 1.3. */
@Component({
  selector: 'app-catalogos-admin',
  imports: [FormsModule],
  template: `
    <div class="encabezado-pagina"><div><h1>Catálogos</h1><p>Los datos marcados como prueba deben reemplazarse por los oficiales (Anexo A).</p></div></div>
    <div class="pestanas" role="tablist">
      @for (c of defs; track c.clave) { <button role="tab" [attr.aria-selected]="actual().clave === c.clave" (click)="elegir(c)">{{ c.titulo }}</button> }
    </div>
    <form class="tarjeta formulario mb" (ngSubmit)="agregar()">
      @for (c of actual().campos; track c.k) {
        <div class="campo"><label [for]="'cf-' + c.k">{{ c.etiqueta }}</label><input [id]="'cf-' + c.k" [name]="c.k" [type]="c.tipo || 'text'" [(ngModel)]="nuevo[c.k]" /></div>
      }
      <button class="btn">Agregar</button>
    </form>
    <div class="tabla-envoltura">
      <table>
        <thead><tr>@for (col of columnas(); track col) { <th>{{ col }}</th> }</tr></thead>
        <tbody>@for (f of filas(); track $index) { <tr>@for (col of columnas(); track col) { <td>{{ f[col] }}</td> }</tr> }</tbody>
      </table>
    </div>
  `,
})
export class CatalogosAdmin implements OnInit {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private cat = inject(Catalogos);
  protected defs = CATALOGOS;
  protected actual = signal(CATALOGOS[0]);
  protected filas = signal<any[]>([]);
  protected columnas = computed(() => (this.filas()[0] ? Object.keys(this.filas()[0]) : []));
  nuevo: Record<string, any> = {};

  ngOnInit() { this.cargar(); }
  elegir(c: DefCatalogo) { this.actual.set(c); this.nuevo = {}; this.cargar(); }
  async cargar() { this.filas.set(await this.api.get(`/admin/catalogos/${this.actual().clave}`)); }
  async agregar() {
    try {
      await this.api.post(`/admin/catalogos/${this.actual().clave}`, this.nuevo);
      this.nuevo = {};
      this.cat.invalidar();
      this.avisos.ok('Registro agregado');
      await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }
}
