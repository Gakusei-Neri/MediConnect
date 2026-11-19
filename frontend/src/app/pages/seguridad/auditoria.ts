import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api.service';
import { Avisos } from '../../core/avisos.service';
import { FechaPipe } from '../../shared/pipes';

/** RF-22: consulta y exportación de auditoría en solo lectura; verificación de la cadena WORM (RN-02). */
@Component({
  selector: 'app-auditoria',
  imports: [FormsModule, FechaPipe],
  template: `
    <div class="encabezado-pagina">
      <div><h1>Auditoría</h1><p>Registros inmutables (WORM) con hashes encadenados. Solo lectura.</p></div>
      <div class="fila">
        <button class="btn secundario" (click)="verificar()">Verificar integridad</button>
        <button class="btn" (click)="exportar()">Exportar CSV</button>
      </div>
    </div>
    @if (integridad(); as i) {
      <p class="mensaje mb" [class.ok]="i.integra" [class.error]="!i.integra" role="status">
        @if (i.integra) { ✅ Cadena íntegra: {{ i.total }} registros verificados. } @else { ⛔ Cadena alterada a partir del registro #{{ i.registroAlterado }}. }
      </p>
    }
    <form class="tarjeta formulario mb" (ngSubmit)="pagina = 1; buscar()">
      <div class="campo"><label for="u">ID de usuario</label><input id="u" name="u" type="number" [(ngModel)]="f.usuarioId" /></div>
      <div class="campo"><label for="p">ID de paciente</label><input id="p" name="p" type="number" [(ngModel)]="f.pacienteId" /></div>
      <div class="campo"><label for="a">Acción</label>
        <select id="a" name="a" [(ngModel)]="f.accion"><option value="">Todas</option>@for (a of acciones(); track a) { <option [value]="a">{{ a }}</option> }</select></div>
      <div class="campo"><label for="d">Desde</label><input id="d" name="d" type="date" [(ngModel)]="f.desde" /></div>
      <div class="campo"><label for="h">Hasta</label><input id="h" name="h" type="date" [(ngModel)]="f.hasta" /></div>
      <label class="check"><input type="checkbox" name="em" [(ngModel)]="f.emergencia" /> Solo emergencias</label>
      <button class="btn">Filtrar</button>
    </form>
    <p class="atenuado pequeno">{{ total() }} registros · página {{ pagina }} · respuesta en {{ ms() }} ms</p>
    <div class="tabla-envoltura">
      <table>
        <thead><tr><th>#</th><th>Fecha (local)</th><th>Usuario</th><th>Acción</th><th>Recurso</th><th>Paciente</th><th>Resultado</th><th>Detalle</th></tr></thead>
        <tbody>
          @for (r of registros(); track r.id) {
            <tr [class.emergencia]="r.es_emergencia">
              <td>{{ r.id }}</td><td class="nw">{{ r.fecha_utc | fecha }}</td>
              <td>{{ r.usuario_nombre || (r.rol === 'SISTEMA' ? 'Sistema' : '—') }}<br /><span class="pequeno atenuado">{{ r.rol }}</span></td>
              <td><span class="mono">{{ r.accion }}</span>@if (r.es_emergencia) { <span class="insignia error">EMERGENCIA</span> }</td>
              <td>{{ r.recurso }} {{ r.id_registro }}</td><td>{{ r.paciente_nombre || '' }}</td>
              <td><span class="insignia" [class.ok]="r.resultado === 'EXITO'" [class.error]="r.resultado !== 'EXITO'">{{ r.resultado }}</span></td>
              <td class="pequeno detalle">{{ r.detalle }}</td>
            </tr>
          } @empty { <tr><td colspan="8" class="vacio">Sin registros</td></tr> }
        </tbody>
      </table>
    </div>
    <div class="fila fin mt">
      <button class="btn secundario chico" [disabled]="pagina === 1" (click)="pagina = pagina - 1; buscar()">Anterior</button>
      <button class="btn secundario chico" [disabled]="pagina * 100 >= total()" (click)="pagina = pagina + 1; buscar()">Siguiente</button>
    </div>
  `,
  styles: `.nw { white-space: nowrap; } .detalle { max-width: 280px; word-break: break-word; } tr.emergencia td { background: var(--c-error-suave); }`,
})
export class Auditoria implements OnInit {
  private api = inject(Api);
  private avisos = inject(Avisos);
  f: any = { usuarioId: null, pacienteId: null, accion: '', desde: '', hasta: '', emergencia: false };
  pagina = 1;
  protected registros = signal<any[]>([]);
  protected total = signal(0);
  protected ms = signal(0);
  protected acciones = signal<string[]>([]);
  protected integridad = signal<{ integra: boolean; total: number; registroAlterado?: number } | null>(null);

  async ngOnInit() {
    this.acciones.set(await this.api.get('/auditoria/acciones'));
    await this.buscar();
  }

  private params() {
    return {
      ...this.f,
      emergencia: this.f.emergencia ? 'true' : '',
      desde: this.f.desde ? new Date(`${this.f.desde}T00:00:00-06:00`).toISOString() : '',
      hasta: this.f.hasta ? new Date(`${this.f.hasta}T23:59:59-06:00`).toISOString() : '',
    };
  }

  async buscar() {
    const t = performance.now();
    try {
      const r = await this.api.get('/auditoria', { ...this.params(), pagina: this.pagina, limite: 100 });
      this.registros.set(r.registros);
      this.total.set(r.total);
      this.ms.set(Math.round(performance.now() - t));
    } catch (e) { this.avisos.error(e); }
  }

  async verificar() {
    try { this.integridad.set(await this.api.get('/auditoria/verificar')); } catch (e) { this.avisos.error(e); }
  }

  async exportar() {
    try {
      const blob = await this.api.descargar('/auditoria/exportar', this.params());
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { this.avisos.error(e); }
  }
}
