import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api.service';
import { Componente, Especialidad, Medicamento, Motivo, Sede } from './modelos';

/** Caché sencilla de catálogos de solo lectura. */
@Injectable({ providedIn: 'root' })
export class Catalogos {
  private api = inject(Api);
  readonly sedes = signal<Sede[]>([]);
  readonly especialidades = signal<Especialidad[]>([]);
  readonly motivos = signal<Motivo[]>([]);
  readonly medicamentos = signal<Medicamento[]>([]);
  readonly componentes = signal<Componente[]>([]);
  private cargados = new Set<string>();

  async publicos() {
    if (this.cargados.has('publicos')) return;
    const [s, e] = await Promise.all([this.api.get('/catalogos/sedes'), this.api.get('/catalogos/especialidades')]);
    this.sedes.set(s);
    this.especialidades.set(e);
    this.cargados.add('publicos');
  }

  async motivosCancelacion() {
    if (!this.cargados.has('motivos')) {
      this.motivos.set(await this.api.get('/catalogos/motivos-cancelacion'));
      this.cargados.add('motivos');
    }
    return this.motivos();
  }

  async clinicos() {
    if (this.cargados.has('clinicos')) return;
    const [m, c] = await Promise.all([this.api.get('/catalogos/medicamentos'), this.api.get('/catalogos/componentes')]);
    this.medicamentos.set(m);
    this.componentes.set(c);
    this.cargados.add('clinicos');
  }

  medicos(filtros: { especialidadId?: number | null; sedeId?: number | null } = {}) {
    return this.api.get('/catalogos/medicos', filtros);
  }

  invalidar() { this.cargados.clear(); }
}
