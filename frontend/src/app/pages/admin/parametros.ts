import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { KeyValuePipe } from '@angular/common';
import { Api } from '../../core/api.service';
import { Avisos } from '../../core/avisos.service';

/** RNF-09: los parámetros P-01..P-18 se cambian sin recompilar ni redesplegar. */
@Component({
  selector: 'app-parametros',
  imports: [FormsModule, KeyValuePipe],
  template: `
    <div class="encabezado-pagina"><div><h1>Parámetros configurables</h1><p>Sección 1.2. Los valores «Supuesto» deben validarse con el cliente.</p></div></div>
    <div class="tabla-envoltura mb">
      <table>
        <thead><tr><th>ID</th><th>Parámetro</th><th>Valor</th><th>Origen</th><th></th></tr></thead>
        <tbody>
          @for (p of params() | keyvalue; track p.key) {
            <tr>
              <td class="mono">{{ p.key }}</td>
              <td>{{ p.value.descripcion }}</td>
              <td>
                @if (esObjeto(p.value.valor)) {
                  <div class="fila">@for (k of claves(p.value.valor); track k) {
                    <label class="pequeno">{{ k }} <input type="number" min="0" class="corto" [(ngModel)]="edicion[p.key][k]" /></label>
                  }</div>
                } @else {
                  <input type="number" min="0" class="corto" [attr.aria-label]="'Valor de ' + p.key" [(ngModel)]="edicion[p.key]" />
                }
              </td>
              <td><span class="insignia" [class.aviso]="p.value.origen.startsWith('Supuesto')">{{ p.value.origen }}</span></td>
              <td><button class="btn chico secundario" (click)="guardar(p.key)">Guardar</button></td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <section class="tarjeta">
      <h2>Simulación para pruebas de aceptación</h2>
      <p class="atenuado pequeno">Disponible solo fuera de producción.</p>
      <div class="fila">
        <label class="check"><input type="checkbox" [(ngModel)]="auditoriaCaida" (change)="simular({ auditoriaCaida })" /> Simular caída de la auditoría (RN-02)</label>
        <button class="btn secundario chico" (click)="simular({ fallaCanal: { canal: 'CORREO', fallar: true } })">Forzar falla de correo</button>
        <button class="btn secundario chico" (click)="simular({ fallaCanal: { canal: 'CORREO', fallar: false } })">Restaurar correo</button>
        <button class="btn chico" (click)="simular({ ejecutarPlanificador: true })">Ejecutar planificador ahora</button>
      </div>
      @if (ciclo()) { <pre class="pequeno mt">{{ ciclo() }}</pre> }
    </section>
  `,
  styles: `.corto { width: 110px; min-height: 36px; } pre { background: var(--c-superficie-2); padding: .5rem; border-radius: 6px; }`,
})
export class Parametros implements OnInit {
  private api = inject(Api);
  private avisos = inject(Avisos);
  protected params = signal<Record<string, { descripcion: string; valor: any; origen: string }>>({});
  protected ciclo = signal('');
  edicion: Record<string, any> = {};
  auditoriaCaida = false;

  async ngOnInit() {
    await this.cargar();
    const s = await this.api.get('/admin/simulacion');
    this.auditoriaCaida = !s.auditoriaDisponible;
  }

  async cargar() {
    const p = await this.api.get('/admin/parametros');
    this.params.set(p);
    this.edicion = Object.fromEntries(Object.entries(p).map(([k, v]: any) => [k, structuredClone(v.valor)]));
  }

  esObjeto(v: unknown) { return typeof v === 'object' && v !== null; }
  claves(v: object) { return Object.keys(v); }

  async guardar(id: string) {
    const v = this.edicion[id];
    const valor = this.esObjeto(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)])) : Number(v);
    try {
      await this.api.put(`/admin/parametros/${id}`, { valor });
      this.avisos.ok(`${id} actualizado; aplica de inmediato`);
      await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  async simular(cuerpo: any) {
    try {
      const r = await this.api.post('/admin/simulacion', cuerpo);
      this.auditoriaCaida = !r.auditoriaDisponible;
      if (r.ciclo) this.ciclo.set(JSON.stringify(r.ciclo, null, 2));
      this.avisos.info(r.auditoriaDisponible ? 'Auditoría disponible' : 'Auditoría simulada como caída: las lecturas de expediente se niegan');
    } catch (e) { this.avisos.error(e); }
  }
}
