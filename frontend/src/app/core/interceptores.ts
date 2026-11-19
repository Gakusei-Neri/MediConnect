import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { Auth } from './auth.service';
import { Rol } from './modelos';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const token = auth.token();
  const peticion = token && req.url.startsWith('/api') ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(peticion).pipe(
    catchError((e: HttpErrorResponse) => {
      // Un 401 en una ruta autenticada cierra la sesión (inactividad, sesión revocada…)
      if (e.status === 401 && token && !req.url.includes('/auth/') && e.error?.codigo !== 'VERIFICACION_2FA') {
        auth.sesionExpirada(e.error?.error || 'Su sesión expiró');
      }
      return throwError(() => e);
    }),
  );
};

export const requiereSesion: CanActivateFn = () => {
  const auth = inject(Auth);
  return auth.autenticado() ? true : inject(Router).parseUrl('/login');
};

export const requiereRol = (...roles: Rol[]): CanActivateFn => () => {
  const auth = inject(Auth);
  if (!auth.autenticado()) return inject(Router).parseUrl('/login');
  return roles.includes(auth.rol()!) ? true : inject(Router).parseUrl(auth.inicio());
};

export const soloInvitado: CanActivateFn = () => {
  const auth = inject(Auth);
  return auth.autenticado() ? inject(Router).parseUrl(auth.inicio()) : true;
};
