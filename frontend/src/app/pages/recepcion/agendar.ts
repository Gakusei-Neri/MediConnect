import { Component, inject, signal, viewChild } from '@angular/core';
import { Api, ErrorApi } from '../../core/api.service';
import { Avisos } from '../../core/avisos.service';
import { Cita, Comprobante, Cupo } from '../../core/modelos';
import { BuscadorCupos } from '../../shared/buscador-cupos';
import { ComprobanteCita, DialogoConfirmarCupo } from '../../shared/dialogos';
import { PacienteBusqueda, SelectorPaciente } from '../../shared/selector-paciente';
import { EstadoCitaPipe, FechaPipe, TonoCitaPipe } from '../../shared/pipes';

/** RF-05/RF-06: Recepción agenda o reprograma a nombre de un paciente. */
@Component({
  selector: 'app-agendar-recepcion',
  imports: [SelectorPaciente, BuscadorCupos, DialogoConfirmarCupo, ComprobanteCita, FechaPipe, EstadoCitaPipe, TonoCitaPipe],
  template: `
    <div class="encabezado-pagina"><div><h1>Agendar a nombre de un paciente</h1><p>Busque al paciente y elija un horario libre.</p></div></div>

    <section class="tarjeta mb">
      @if (!paciente()) {
        <app-selector-paciente (seleccion)="elegirPaciente($event)" />
      } @else {
        <div class="fila entre">
          <div><strong>{{ paciente()!.nombre_completo }}</strong> <span class="mono atenuado">{{ paciente()!.curp }}</span><br />
            <span class="pequeno atenuado">{{ paciente()!.correo }} · {{ paciente()!.telefono }}</span></div>
          <button class="btn fantasma" (click)="paciente.set(null); comprobante.set(null); reprogramando.set(null)">Cambiar paciente</button>
        </div>
        @if (activas().length) {
          <h3 class="mt">Citas activas</h3>
          <ul class="lista">
            @for (c of activas(); track c.id) {
              <li class="fila entre">
                <span>{{ c.fecha_hora | fecha: 'completa' }} — {{ c.especialidad_nombre }} con {{ c.medico_nombre }} <span class="insignia" [class]="c.estado | tonoCita">{{ c.estado | estadoCita }}</span></span>
                @if (['AGENDADA', 'NOTIFICADA', 'CONFIRMADA'].includes(c.estado)) {
                  <button class="btn chico secundario" (click)="reprogramando.set(c)" [disabled]="c.reprogramaciones >= 2">Reprogramar</button>
                }
              </li>
            }
          </ul>
        }
      }
    </section>

    @if (paciente()) {
      @if (comprobante(); as c) {
        <app-comprobante [c]="c"><button class="btn secundario" (click)="comprobante.set(null)">Agendar otra cita</button></app-comprobante>
      } @else {
        @if (reprogramando(); as r) {
          <p class="mensaje info mb">Reprogramando la cita del {{ r.fecha_hora | fecha: 'completa' }}. <button class="btn fantasma chico" (click)="reprogramando.set(null)">Cancelar reprogramación</button></p>
        }
        @if (alternativas().length) {
          <p class="mensaje aviso mb" role="alert">Ese horario ya no está disponible; elija otro (se muestran alternativas al inicio de la lista).</p>
        }
        <section class="tarjeta">
          @if (reprogramando(); as r) {
            <app-buscador-cupos [especialidadFija]="r.especialidad_id" (seleccion)="cupo.set($event)" />
          } @else {
            <app-buscador-cupos (seleccion)="cupo.set($event)" />
          }
        </section>
      }
    }

    @if (cupo(); as c) {
      <app-dialogo-confirmar-cupo [cupo]="c" [paciente]="paciente()!.nombre_completo" [ocupado]="ocupado()" (cerrar)="cupo.set(null)" (confirmar)="confirmar(c)" />
    }
  `,
  styles: `.lista { list-style: none; padding: 0; display: grid; gap: .5rem; }`,
})
export class AgendarRecepcion {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private buscador = viewChild(BuscadorCupos);
  protected paciente = signal<PacienteBusqueda | null>(null);
  protected activas = signal<Cita[]>([]);
  protected cupo = signal<Cupo | null>(null);
  protected comprobante = signal<Comprobante | null>(null);
  protected reprogramando = signal<Cita | null>(null);
  protected alternativas = signal<Cupo[]>([]);
  protected ocupado = signal(false);

  async elegirPaciente(p: PacienteBusqueda) {
    this.paciente.set(p);
    await this.cargarActivas();
  }

  private async cargarActivas() {
    const d = await this.api.get(`/pacientes/${this.paciente()!.id}`);
    this.activas.set(d.citasActivas);
  }

  async confirmar(c: Cupo) {
    this.ocupado.set(true);
    this.alternativas.set([]);
    try {
      const r = this.reprogramando()
        ? await this.api.post(`/citas/${this.reprogramando()!.id}/reprogramar`, { cupoId: c.id })
        : await this.api.post('/citas', { cupoId: c.id, pacienteId: this.paciente()!.id });
      this.comprobante.set(r);
      this.reprogramando.set(null);
      await this.cargarActivas();
    } catch (e) {
      if (e instanceof ErrorApi && e.datos?.alternativas) {
        this.alternativas.set(e.datos.alternativas);
        this.buscador()?.quitar(c.id);
      } else this.avisos.error(e);
    } finally {
      this.cupo.set(null);
      this.ocupado.set(false);
    }
  }
}
