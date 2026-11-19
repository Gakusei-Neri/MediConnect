import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Error de la API con el cuerpo JSON (incluye campos extra como alternativas, citasAfectadas, codigo). */
export class ErrorApi extends Error {
  constructor(public status: number, mensaje: string, public datos: any) {
    super(mensaje);
  }
}

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private base = '/api';

  private async llamar<T>(peticion: Promise<T>): Promise<T> {
    try {
      return await peticion;
    } catch (e) {
      if (e instanceof HttpErrorResponse) {
        const datos = e.error && typeof e.error === 'object' ? e.error : {};
        const msg = datos.error || (e.status === 0 ? 'No hay conexión con el servidor' : `Error ${e.status}`);
        throw new ErrorApi(e.status, msg, datos);
      }
      throw e;
    }
  }

  get<T = any>(ruta: string, params?: Record<string, any>): Promise<T> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return this.llamar(firstValueFrom(this.http.get<T>(this.base + ruta, { params: p })));
  }
  post<T = any>(ruta: string, cuerpo: any = {}): Promise<T> {
    return this.llamar(firstValueFrom(this.http.post<T>(this.base + ruta, cuerpo)));
  }
  put<T = any>(ruta: string, cuerpo: any = {}): Promise<T> {
    return this.llamar(firstValueFrom(this.http.put<T>(this.base + ruta, cuerpo)));
  }
  delete<T = any>(ruta: string): Promise<T> {
    return this.llamar(firstValueFrom(this.http.delete<T>(this.base + ruta)));
  }
  descargar(ruta: string, params?: Record<string, any>): Promise<Blob> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params || {})) if (v) p = p.set(k, String(v));
    return this.llamar(firstValueFrom(this.http.get(this.base + ruta, { params: p, responseType: 'blob' })));
  }
}
