import { Pipe, PipeTransform } from '@angular/core';
import { ESTADOS_CITA, EstadoCita, RESERVA_TEXTO } from '../core/modelos';

const ZONA = 'America/Mexico_City';

/** D-07: las fechas llegan en UTC y se muestran en la hora local de la sede. */
@Pipe({ name: 'fecha' })
export class FechaPipe implements PipeTransform {
  transform(valor: string | null | undefined, formato: 'completa' | 'corta' | 'hora' | 'dia' = 'corta', zona = ZONA): string {
    if (!valor) return '—';
    const d = new Date(valor);
    const opciones: Intl.DateTimeFormatOptions =
      formato === 'completa' ? { dateStyle: 'full', timeStyle: 'short' }
        : formato === 'hora' ? { timeStyle: 'short' }
          : formato === 'dia' ? { weekday: 'short', day: 'numeric', month: 'short' }
            : { dateStyle: 'medium', timeStyle: 'short' };
    return new Intl.DateTimeFormat('es-MX', { timeZone: zona || ZONA, ...opciones }).format(d);
  }
}

@Pipe({ name: 'estadoCita' })
export class EstadoCitaPipe implements PipeTransform {
  transform(e: EstadoCita | string): string {
    return ESTADOS_CITA[e as EstadoCita]?.texto ?? e;
  }
}

@Pipe({ name: 'tonoCita' })
export class TonoCitaPipe implements PipeTransform {
  transform(e: EstadoCita | string): string {
    return ESTADOS_CITA[e as EstadoCita]?.tono ?? 'neutro';
  }
}

@Pipe({ name: 'reserva' })
export class ReservaPipe implements PipeTransform {
  transform(e: string | null, campo: 'texto' | 'tono' = 'texto'): string {
    if (!e) return campo === 'texto' ? 'Sin reserva' : 'neutro';
    return RESERVA_TEXTO[e]?.[campo] ?? e;
  }
}

/** Fecha local de hoy (YYYY-MM-DD) en la zona de la sede. */
export function hoyLocal(zona = ZONA): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(new Date());
}

export const PIPES = [FechaPipe, EstadoCitaPipe, TonoCitaPipe, ReservaPipe];
