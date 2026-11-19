import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api.service';
import { Avisos } from '../../core/avisos.service';
import { Catalogos } from '../../core/catalogos.service';
import { ROLES_TEXTO, Rol } from '../../core/modelos';

/** Administración de usuarios y roles (RF-03). El 2FA se genera para el personal clínico (RN-01). */
@Component({
  selector: 'app-usuarios',
  imports: [FormsModule],
  template: `
    <div class="encabezado-pagina">
      <div><h1>Usuarios y roles</h1><p>Los pacientes se registran desde el portal. El Administrador no tiene acceso a datos clínicos.</p></div>
      <div class="fila">
        <div class="campo"><label for="fr">Rol</label>
          <select id="fr" [(ngModel)]="filtroRol" (change)="cargar()"><option value="">Todos</option>@for (r of roles; track r) { <option [value]="r">{{ rolesTexto[r] }}</option> }</select></div>
        <button class="btn alinear" (click)="nuevo.set(true)">Nuevo usuario</button>
      </div>
    </div>
    <div class="tabla-envoltura">
      <table>
        <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Sede / Especialidad</th><th>2FA</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          @for (u of usuarios(); track u.id) {
            <tr>
              <td>{{ u.nombre_completo }}</td><td>{{ u.correo }}</td><td>{{ rolesTexto[u.rol] }}</td>
              <td>{{ u.sede_nombre || '—' }}@if (u.especialidad_nombre) { <br /><span class="pequeno">{{ u.especialidad_nombre }}</span> }</td>
              <td>{{ u.tiene_2fa ? '✓' : '—' }}</td>
              <td>@if (!u.activo) { <span class="insignia error">Inactivo</span> } @else if (u.bloqueado_hasta && u.bloqueado_hasta > ahora) { <span class="insignia aviso">Bloqueado</span> } @else { <span class="insignia ok">Activo</span> }</td>
              <td class="acciones">
                @if (u.bloqueado_hasta && u.bloqueado_hasta > ahora) { <button class="btn chico fantasma" (click)="desbloquear(u.id)">Desbloquear</button> }
                @if (u.rol !== 'PACIENTE' && u.rol !== 'RECEPCION') { <button class="btn chico fantasma" (click)="regenerar2fa(u)">Nuevo 2FA</button> }
                <button class="btn chico fantasma" (click)="alternar(u)">{{ u.activo ? 'Desactivar' : 'Activar' }}</button>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    @if (nuevo()) {
      <div class="fondo-dialogo">
        <form class="dialogo" role="dialog" aria-modal="true" aria-labelledby="t-nuevo" (ngSubmit)="crear()">
          <h2 id="t-nuevo">Nuevo usuario del personal</h2>
          <div class="formulario">
            <div class="campo completo"><label for="n">Nombre completo</label><input id="n" name="n" required [(ngModel)]="d.nombreCompleto" /></div>
            <div class="campo"><label for="c">Correo</label><input id="c" name="c" type="email" required [(ngModel)]="d.correo" /></div>
            <div class="campo"><label for="t">Teléfono</label><input id="t" name="t" [(ngModel)]="d.telefono" /></div>
            <div class="campo"><label for="r">Rol</label>
              <select id="r" name="r" [(ngModel)]="d.rol">@for (r of rolesPersonal; track r) { <option [value]="r">{{ rolesTexto[r] }}</option> }</select></div>
            @if (['RECEPCION', 'MEDICO', 'ENFERMERO'].includes(d.rol)) {
              <div class="campo"><label for="s">Sede</label>
                <select id="s" name="s" [(ngModel)]="d.sedeId">@for (s of cat.sedes(); track s.id) { <option [ngValue]="s.id">{{ s.nombre }}</option> }</select></div>
            }
            @if (d.rol === 'MEDICO') {
              <div class="campo"><label for="e">Especialidad</label>
                <select id="e" name="e" [(ngModel)]="d.especialidadId">@for (e of cat.especialidades(); track e.id) { <option [ngValue]="e.id">{{ e.nombre }}</option> }</select></div>
            }
            @if (d.rol === 'MEDICO' || d.rol === 'ENFERMERO') {
              <div class="campo"><label for="ced">Cédula profesional</label><input id="ced" name="ced" [(ngModel)]="d.cedulaProfesional" /></div>
            }
            <div class="campo"><label for="pw">Contraseña inicial</label><input id="pw" name="pw" type="password" minlength="10" required [(ngModel)]="d.password" /></div>
          </div>
          <div class="fila fin mt"><button type="button" class="btn fantasma" (click)="nuevo.set(false)">Cancelar</button><button class="btn">Crear</button></div>
        </form>
      </div>
    }

    @if (qr(); as q) {
      <div class="fondo-dialogo" (click)="qr.set(null)">
        <div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="t-qr" (click)="$event.stopPropagation()">
          <h2 id="t-qr">Segundo factor (2FA)</h2>
          <p>Entregue este código de forma segura al usuario para registrarlo en su aplicación autenticadora. No se volverá a mostrar.</p>
          <img [src]="q.qr" alt="Código QR del segundo factor" width="220" height="220" />
          <p class="mono">{{ q.secreto }}</p>
          <div class="fila fin"><button class="btn" (click)="qr.set(null)">Listo</button></div>
        </div>
      </div>
    }
  `,
  styles: `.alinear { align-self: flex-end; }`,
})
export class Usuarios implements OnInit {
  private api = inject(Api);
  private avisos = inject(Avisos);
  protected cat = inject(Catalogos);
  protected roles: Rol[] = ['PACIENTE', 'RECEPCION', 'MEDICO', 'ENFERMERO', 'SEGURIDAD', 'ADMINISTRADOR'];
  protected rolesPersonal: Rol[] = ['RECEPCION', 'MEDICO', 'ENFERMERO', 'SEGURIDAD', 'ADMINISTRADOR'];
  protected rolesTexto = ROLES_TEXTO as Record<string, string>;
  protected usuarios = signal<any[]>([]);
  protected nuevo = signal(false);
  protected qr = signal<{ qr: string; secreto: string } | null>(null);
  protected ahora = new Date().toISOString();
  filtroRol = '';
  d: any = this.vacio();

  vacio() { return { nombreCompleto: '', correo: '', telefono: '', rol: 'RECEPCION', sedeId: 1, especialidadId: 1, cedulaProfesional: '', password: '' }; }

  async ngOnInit() { await this.cat.publicos(); await this.cargar(); }
  async cargar() { this.usuarios.set(await this.api.get('/admin/usuarios', { rol: this.filtroRol })); }

  async crear() {
    try {
      const r = await this.api.post('/admin/usuarios', this.d);
      this.nuevo.set(false);
      this.d = this.vacio();
      this.avisos.ok('Usuario creado');
      if (r.segundoFactor) this.qr.set(r.segundoFactor);
      await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  async alternar(u: any) {
    try { await this.api.put(`/admin/usuarios/${u.id}`, { activo: !u.activo }); await this.cargar(); } catch (e) { this.avisos.error(e); }
  }
  async desbloquear(id: number) {
    try { await this.api.post(`/admin/usuarios/${id}/desbloquear`); await this.cargar(); } catch (e) { this.avisos.error(e); }
  }
  async regenerar2fa(u: any) {
    if (!confirm(`¿Generar un nuevo segundo factor para ${u.nombre_completo}? El anterior dejará de funcionar.`)) return;
    try { this.qr.set(await this.api.post(`/admin/usuarios/${u.id}/2fa`)); await this.cargar(); } catch (e) { this.avisos.error(e); }
  }
}
