import { Injectable, signal } from '@angular/core';

export interface Aviso { id: number; tipo: 'ok' | 'error' | 'info' | 'aviso'; texto: string }

/** Mensajes emergentes (toasts) anunciados a lectores de pantalla (aria-live). */
@Injectable({ providedIn: 'root' })
export class Avisos {
  readonly lista = signal<Aviso[]>([]);
  private n = 0;

  private agregar(tipo: Aviso['tipo'], texto: string, ms = 5000) {
    const id = ++this.n;
    this.lista.update((l) => [...l, { id, tipo, texto }]);
    setTimeout(() => this.cerrar(id), ms);
  }
  ok(t: string) { this.agregar('ok', t); }
  info(t: string) { this.agregar('info', t); }
  aviso(t: string) { this.agregar('aviso', t, 7000); }
  error(t: string | unknown) {
    this.agregar('error', typeof t === 'string' ? t : (t as Error)?.message || 'Ocurrió un error', 8000);
  }
  cerrar(id: number) { this.lista.update((l) => l.filter((a) => a.id !== id)); }
}
