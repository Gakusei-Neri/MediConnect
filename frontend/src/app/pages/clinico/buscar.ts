import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../../core/api.service';
import { Avisos } from '../../core/avisos.service';

/** Búsqueda por CURP exacta; sin relación asistencial ofrece el acceso de emergencia (RF-23). */
@Component({
  selector: 'app-buscar-paciente',
  imports: [FormsModule],
  template: `
    <div class="encabezado-pagina"><div><h1>Buscar paciente</h1><p>Solo puede abrir expedientes de pacientes con los que tiene relación asistencial (RN-07).</p></div></div>
    <section class="tarjeta">
      <form class="fila" (ngSubmit)="buscar()">
        <div class="campo crece"><label for="curp">CURP exacta</label><input id="curp" name="curp" maxlength="18" [(ngModel)]="curp" (ngModelChange)="curp = $event.toUpperCase()" /></div>
        <button class="btn alinear" [disabled]="curp.length !== 18">Buscar</button>
      </form>
      @if (resultado(); as r) {
        <div class="mt">
          @if (!r.encontrado) { <p class="atenuado">No existe un paciente con esa CURP.</p> }
          @else {
            <div class="fila entre">
              <span><strong>{{ r.nombre }}</strong> <span class="mono atenuado">{{ curp }}</span></span>
              @if (r.permitido) { <button class="btn" (click)="abrir()">Abrir expediente</button> }
            </div>
            @if (!r.permitido) {
              <div class="tarjeta alerta mt">
                <h3>Sin relación asistencial</h3>
                <p>Solo en una emergencia puede abrir este expediente. El acceso quedará marcado como emergencia y Seguridad recibirá una alerta.</p>
                <div class="campo">
                  <label for="just">Justificación (obligatoria)</label>
                  <textarea id="just" [(ngModel)]="justificacion" placeholder="Describa la emergencia clínica"></textarea>
                </div>
                <button class="btn peligro mt" [disabled]="justificacion.trim().length < 10" (click)="emergencia()">Acceder por emergencia</button>
              </div>
            }
          }
        </div>
      }
    </section>
  `,
  styles: `.crece { flex: 1; } .alinear { align-self: flex-end; }`,
})
export class BuscarPaciente {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private router = inject(Router);
  curp = '';
  justificacion = '';
  protected resultado = signal<{ encontrado: boolean; id?: number; nombre?: string; permitido?: boolean } | null>(null);

  async buscar() {
    try {
      const l = await this.api.get('/pacientes', { curp: this.curp });
      if (!l.length) return this.resultado.set({ encontrado: false });
      const rel = await this.api.get(`/clinico/relacion/${l[0].id}`);
      this.resultado.set({ encontrado: true, id: l[0].id, nombre: l[0].nombre_completo, permitido: rel.permitido });
    } catch (e) { this.avisos.error(e); }
  }

  abrir() { this.router.navigate(['/clinico/expediente', this.resultado()!.id]); }

  async emergencia() {
    try {
      await this.api.post(`/clinico/expedientes/${this.resultado()!.id}/emergencia`, { justificacion: this.justificacion });
      this.avisos.aviso('Acceso de emergencia registrado y notificado a Seguridad');
      this.abrir();
    } catch (e) { this.avisos.error(e); }
  }
}
