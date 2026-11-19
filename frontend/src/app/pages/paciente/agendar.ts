import { Component, inject, input, OnInit, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, ErrorApi } from '../../core/api.service';
import { Avisos } from '../../core/avisos.service';
import { Cita, Comprobante, Cupo } from '../../core/modelos';
import { BuscadorCupos } from '../../shared/buscador-cupos';
import { ComprobanteCita, DialogoConfirmarCupo } from '../../shared/dialogos';
import { FechaPipe } from '../../shared/pipes';

/** RF-05 (agendar) y RF-06 (reprogramar, con ?reprogramar=ID). */
@Component({
  selector: 'app-agendar-paciente',
  imports: [BuscadorCupos, DialogoConfirmarCupo, ComprobanteCita, RouterLink, FechaPipe],
  template: `
    <div class="encabezado-pagina">
      <div>
        <h1>{{ citaOriginal() ? 'Reprogramar cita' : 'Agendar cita' }}</h1>
        @if (citaOriginal(); as c) {
          <p>Cita actual: {{ c.especialidad_nombre }} con {{ c.medico_nombre }}, {{ c.fecha_hora | fecha: 'completa' }}. Elija un nuevo horario de la misma especialidad.</p>
        } @else {
          <p>Elija especialidad, sede y fecha; después seleccione un horario libre.</p>
        }
      </div>
    </div>

    @if (comprobante(); as c) {
      <app-comprobante [c]="c" [titulo]="citaOriginal() ? 'Cita reprogramada' : 'Cita agendada'">
        <div class="fila">
          <a class="btn" routerLink="/paciente/citas">Ver mis citas</a>
          <button class="btn secundario" (click)="comprobante.set(null)">Agendar otra</button>
        </div>
      </app-comprobante>
    } @else {
      @if (alternativas().length) {
        <div class="mensaje aviso mb" role="alert">
          <strong>Ese horario ya no está disponible.</strong> Alternativas cercanas:
          <div class="cupos mt">
            @for (a of alternativas(); track a.id) {
              <button class="cupo" (click)="cupo.set(a)"><span class="hora">{{ a.inicio | fecha: 'corta' }}</span><span class="det">{{ a.medico_nombre }}</span></button>
            }
          </div>
        </div>
      }
      <section class="tarjeta">
        @if (listo()) {
          <app-buscador-cupos [especialidadFija]="citaOriginal()?.especialidad_id ?? null" (seleccion)="cupo.set($event)"
            textoSinCupos="Puede inscribirse en la lista de espera para recibir un aviso cuando se libere un horario." />
        }
        <p class="mt pequeno"><a routerLink="/paciente/lista-espera">¿No encuentra horario? Inscríbase en la lista de espera</a></p>
      </section>
    }

    @if (cupo(); as c) {
      <app-dialogo-confirmar-cupo [cupo]="c" [ocupado]="ocupado()" [titulo]="citaOriginal() ? 'Confirmar nuevo horario' : 'Confirmar cita'"
        (cerrar)="cupo.set(null)" (confirmar)="confirmar(c)" />
    }
  `,
})
export class AgendarPaciente implements OnInit {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private router = inject(Router);
  readonly reprogramar = input<string>();
  private buscador = viewChild(BuscadorCupos);

  protected citaOriginal = signal<Cita | null>(null);
  protected cupo = signal<Cupo | null>(null);
  protected comprobante = signal<Comprobante | null>(null);
  protected alternativas = signal<Cupo[]>([]);
  protected ocupado = signal(false);
  protected listo = signal(false);

  async ngOnInit() {
    if (this.reprogramar()) {
      try { this.citaOriginal.set(await this.api.get(`/citas/${this.reprogramar()}`)); } catch (e) { this.avisos.error(e); }
    }
    this.listo.set(true);
  }

  async confirmar(c: Cupo) {
    this.ocupado.set(true);
    this.alternativas.set([]);
    try {
      const r = this.citaOriginal()
        ? await this.api.post(`/citas/${this.citaOriginal()!.id}/reprogramar`, { cupoId: c.id })
        : await this.api.post('/citas', { cupoId: c.id });
      this.comprobante.set(r);
      this.cupo.set(null);
    } catch (e) {
      this.cupo.set(null);
      if (e instanceof ErrorApi && e.datos?.alternativas) {
        this.alternativas.set(e.datos.alternativas);
        this.buscador()?.quitar(c.id);
      } else {
        this.avisos.error(e);
      }
    } finally {
      this.ocupado.set(false);
    }
  }
}
