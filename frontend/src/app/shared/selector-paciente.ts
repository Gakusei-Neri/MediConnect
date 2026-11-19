import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';

export interface PacienteBusqueda { id: number; nombre_completo: string; curp: string; fecha_nacimiento?: string; correo?: string; telefono?: string }

/** Búsqueda de paciente por CURP o nombre (Recepción). */
@Component({
  selector: 'app-selector-paciente',
  imports: [FormsModule],
  template: `
    <form class="fila" (ngSubmit)="buscar()" role="search" aria-label="Buscar paciente">
      <div class="campo crece">
        <label for="busca-pac">CURP o nombre del paciente</label>
        <input id="busca-pac" name="texto" [(ngModel)]="texto" placeholder="GOLA850312HDFRPN05 o Juan Gómez" />
      </div>
      <button class="btn secundario alinear" type="submit" [disabled]="texto.trim().length < 3">Buscar</button>
    </form>
    @if (resultados().length) {
      <ul class="resultados" aria-label="Resultados">
        @for (p of resultados(); track p.id) {
          <li>
            <button type="button" class="btn fantasma bloque izq" (click)="elegir(p)">
              <span><strong>{{ p.nombre_completo }}</strong> <span class="mono atenuado">{{ p.curp }}</span></span>
            </button>
          </li>
        }
      </ul>
    } @else if (buscado()) { <p class="atenuado mt">Sin resultados. El paciente debe registrarse primero en el portal (RF-01).</p> }
  `,
  styles: `.crece { flex: 1; min-width: 220px; } .alinear { align-self: flex-end; } .resultados { list-style: none; padding: 0; margin: .5rem 0 0; } .izq { justify-content: flex-start; }`,
})
export class SelectorPaciente {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly seleccion = output<PacienteBusqueda>();
  texto = '';
  protected resultados = signal<PacienteBusqueda[]>([]);
  protected buscado = signal(false);

  async buscar() {
    const t = this.texto.trim();
    const esCurp = /^[A-Za-z]{4}\d{6}/.test(t);
    try {
      this.resultados.set(await this.api.get('/pacientes', esCurp ? { curp: t } : { nombre: t }));
      this.buscado.set(true);
    } catch (e) { this.avisos.error(e); }
  }

  elegir(p: PacienteBusqueda) {
    this.seleccion.emit(p);
    this.resultados.set([]);
    this.buscado.set(false);
    this.texto = '';
  }
}
