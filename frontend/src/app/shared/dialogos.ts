import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Catalogos } from '../core/catalogos.service';
import { Comprobante, Cupo, Motivo } from '../core/modelos';
import { FechaPipe } from './pipes';

/** RF-07: cancelar con motivo del catálogo. */
@Component({
  selector: 'app-dialogo-cancelar',
  imports: [FormsModule],
  template: `
    <div class="fondo-dialogo" (click)="cerrar.emit()">
      <div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="t-cancelar" (click)="$event.stopPropagation()">
        <h2 id="t-cancelar">Cancelar cita</h2>
        <p>{{ descripcion() }}</p>
        <div class="campo">
          <label for="motivo">Motivo de cancelación</label>
          <select id="motivo" [(ngModel)]="motivoId" autofocus>
            <option [ngValue]="null" disabled>Seleccione un motivo</option>
            @for (m of motivos(); track m.id) { <option [ngValue]="m.id">{{ m.descripcion }}</option> }
          </select>
        </div>
        <div class="fila fin mt">
          <button class="btn fantasma" (click)="cerrar.emit()">Volver</button>
          <button class="btn peligro" [disabled]="!motivoId" (click)="confirmar.emit(motivoId!)">Cancelar cita</button>
        </div>
      </div>
    </div>
  `,
})
export class DialogoCancelar implements OnInit {
  private cat = inject(Catalogos);
  readonly descripcion = input('');
  readonly confirmar = output<number>();
  readonly cerrar = output<void>();
  protected motivos = signal<Motivo[]>([]);
  motivoId: number | null = null;
  async ngOnInit() { this.motivos.set(await this.cat.motivosCancelacion()); }
}

/** Confirmación de cupo antes de agendar. */
@Component({
  selector: 'app-dialogo-confirmar-cupo',
  imports: [FechaPipe],
  template: `
    <div class="fondo-dialogo" (click)="cerrar.emit()">
      <div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="t-cupo" (click)="$event.stopPropagation()">
        <h2 id="t-cupo">{{ titulo() }}</h2>
        @if (paciente()) { <p><strong>Paciente:</strong> {{ paciente() }}</p> }
        <dl class="datos">
          <dt>Fecha y hora</dt><dd>{{ cupo().inicio | fecha: 'completa': cupo().zona_horaria }}</dd>
          <dt>Médico</dt><dd>{{ cupo().medico_nombre }}</dd>
          <dt>Especialidad</dt><dd>{{ cupo().especialidad_nombre }}</dd>
          <dt>Sede</dt><dd>{{ cupo().sede_nombre }}</dd>
          <dt>Modalidad</dt><dd>{{ cupo().modalidad === 'VIRTUAL' ? 'Virtual (videoconsulta)' : 'Presencial' }}</dd>
        </dl>
        <div class="fila fin mt">
          <button class="btn fantasma" (click)="cerrar.emit()" [disabled]="ocupado()">Volver</button>
          <button class="btn" (click)="confirmar.emit()" [disabled]="ocupado()">
            @if (ocupado()) { <span class="cargando" aria-hidden="true"></span> } Confirmar
          </button>
        </div>
      </div>
    </div>
  `,
  styles: `.datos { display: grid; grid-template-columns: auto 1fr; gap: .3rem 1rem; } dt { font-weight: 600; color: var(--c-texto-2); } dd { margin: 0; text-transform: none; }`,
})
export class DialogoConfirmarCupo {
  readonly cupo = input.required<Cupo>();
  readonly titulo = input('Confirmar cita');
  readonly paciente = input<string | null>(null);
  readonly ocupado = input(false);
  readonly confirmar = output<void>();
  readonly cerrar = output<void>();
}

/** Comprobante de cita (RF-05). */
@Component({
  selector: 'app-comprobante',
  template: `
    <section class="tarjeta resaltada" aria-live="polite">
      <div class="fila entre">
        <h2>✅ {{ titulo() }}</h2>
        <span class="mono">{{ c().folio }}</span>
      </div>
      <p><strong>{{ c().especialidad }}</strong> con {{ c().medico }}</p>
      <p>{{ c().fechaHoraLocal }} · {{ c().sede }} · {{ c().modalidad === 'VIRTUAL' ? 'Videoconsulta' : 'Presencial' }}</p>
      <p class="atenuado pequeno">
        Estado: {{ c().estado === 'CONFIRMADA' ? 'Confirmada' : 'Agendada (le pediremos confirmar 24 h antes)' }}.
        El comprobante también se envió por su canal preferido.
      </p>
      <ng-content />
    </section>
  `,
})
export class ComprobanteCita {
  readonly c = input.required<Comprobante>();
  readonly titulo = input('Cita agendada');
}
