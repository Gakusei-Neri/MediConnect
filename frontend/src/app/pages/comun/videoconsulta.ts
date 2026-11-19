import { Component, ElementRef, inject, input, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { Avisos } from '../../core/avisos.service';
import { EstadoCitaPipe, FechaPipe } from '../../shared/pipes';
import { ConsultaMedica } from '../clinico/consulta';

/**
 * RF-20/RF-21: videoconsulta. RES-02 / D-06: WebRTC entre pares (cifrado DTLS-SRTP de extremo a extremo);
 * el servidor solo reenvía la señalización. No se graba ni se almacena audio o video.
 */
@Component({
  selector: 'app-videoconsulta',
  imports: [FechaPipe, EstadoCitaPipe, ConsultaMedica],
  template: `
    <div class="sala" [class.con-panel]="sala()?.participante === 'MEDICO'">
      <section class="video-zona" aria-label="Videollamada">
        <header class="barra">
          <div>
            <strong>Videoconsulta</strong>
            @if (sala(); as s) { <span class="atenuado-claro"> · {{ s.participante === 'MEDICO' ? s.paciente : s.medico }} · {{ s.fechaHora | fecha: 'hora' }}</span> }
          </div>
          <span class="insignia" [class.ok]="conectado()" [class.aviso]="!conectado()">{{ estadoTexto() }}</span>
        </header>
        @if (error()) {
          <div class="mensaje error m">{{ error() }} <button class="btn chico" (click)="salir()">Volver</button></div>
        } @else {
          <div class="videos">
            <video #remoto class="remoto" autoplay playsinline aria-label="Video del otro participante"></video>
            <video #local class="local" autoplay playsinline muted aria-label="Su cámara"></video>
            @if (!conectado()) { <p class="espera">Esperando a que {{ sala()?.participante === 'MEDICO' ? 'el paciente' : 'el médico' }} se conecte…</p> }
          </div>
          <div class="controles">
            <button class="btn secundario" (click)="alternarAudio()" [attr.aria-pressed]="!audio()">{{ audio() ? '🎙️ Silenciar' : '🔇 Activar micrófono' }}</button>
            <button class="btn secundario" (click)="alternarVideo()" [attr.aria-pressed]="!video()">{{ video() ? '📷 Apagar cámara' : '🚫 Encender cámara' }}</button>
            @if (sala()?.participante === 'MEDICO' && estadoCita() === 'TELEMEDICINA_CONECTADA') {
              <button class="btn" (click)="iniciarConsulta()">Iniciar consulta</button>
            }
            <button class="btn peligro" (click)="colgar()">Colgar</button>
          </div>
          <p class="nota">🔒 Cifrado de extremo a extremo. La llamada no se graba. Estado de la cita: {{ estadoCita() | estadoCita }}</p>
        }
      </section>
      @if (sala()?.participante === 'MEDICO' && consultaLista()) {
        <aside class="panel"><app-consulta [citaId]="'' + sala()!.citaId" /></aside>
      }
    </div>
  `,
  styles: `
    :host { display: block; background: #0f1d26; min-height: 100vh; }
    .sala { display: grid; grid-template-columns: 1fr; min-height: 100vh; }
    .sala.con-panel { grid-template-columns: minmax(360px, 1fr) minmax(420px, 1.1fr); }
    @media (max-width: 1000px) { .sala.con-panel { grid-template-columns: 1fr; } }
    .video-zona { display: flex; flex-direction: column; color: #fff; padding: .75rem; gap: .75rem; }
    .barra { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
    .atenuado-claro { color: #b9cbd6; }
    .videos { position: relative; flex: 1; min-height: 320px; background: #000; border-radius: 12px; overflow: hidden; }
    .remoto { width: 100%; height: 100%; object-fit: cover; position: absolute; inset: 0; }
    .local { position: absolute; right: .75rem; bottom: .75rem; width: 28%; max-width: 220px; border-radius: 8px; border: 2px solid #fff; background: #222; }
    .espera { position: absolute; inset: 0; display: grid; place-items: center; color: #d7e4ec; margin: 0; text-align: center; padding: 1rem; }
    .controles { display: flex; flex-wrap: wrap; gap: .5rem; justify-content: center; }
    .controles .secundario { background: #fff; }
    .nota { text-align: center; color: #b9cbd6; font-size: .85rem; margin: 0; }
    .panel { background: var(--c-fondo); overflow: auto; max-height: 100vh; padding: 1rem; }
    .m { margin: 1rem; }
  `,
})
export class Videoconsulta implements OnInit, OnDestroy {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  private router = inject(Router);
  readonly token = input.required<string>();
  private local = viewChild<ElementRef<HTMLVideoElement>>('local');
  private remoto = viewChild<ElementRef<HTMLVideoElement>>('remoto');

  protected sala = signal<any>(null);
  protected estadoCita = signal<string>('');
  protected conectado = signal(false);
  protected estadoTexto = signal('Conectando…');
  protected error = signal('');
  protected audio = signal(true);
  protected video = signal(true);
  protected consultaLista = signal(false);

  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private medios: MediaStream | null = null;
  private pendientesIce: RTCIceCandidateInit[] = [];

  async ngOnInit() {
    try {
      const s = await this.api.post(`/telemedicina/sala/${this.token()}/ingresar`);
      this.sala.set(s);
      this.estadoCita.set(s.estado);
      this.consultaLista.set(s.estado === 'EN_CONSULTA');
    } catch (e) {
      this.error.set((e as Error).message);
      return;
    }
    try {
      this.medios = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.local()!.nativeElement.srcObject = this.medios;
    } catch {
      this.avisos.aviso('No se pudo acceder a la cámara o el micrófono; puede continuar sin ellos');
      this.medios = new MediaStream();
    }
    this.conectarSenalizacion();
  }

  ngOnDestroy() { this.cerrar(false); }

  private conectarSenalizacion() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws/senalizacion?sala=${encodeURIComponent(this.token())}`, ['mediconnect', `jwt.${this.auth.token()}`]);
    this.ws.onopen = () => this.estadoTexto.set('En sala');
    this.ws.onclose = () => { if (!this.error()) this.estadoTexto.set('Desconectado'); };
    this.ws.onerror = () => this.error.set('No se pudo conectar a la sala (¿enlace fuera de su ventana de validez?)');
    this.ws.onmessage = (ev) => this.alRecibir(JSON.parse(ev.data));
  }

  private enviar(tipo: string, datos?: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ tipo, datos }));
  }

  private nuevaConexion() {
    this.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: this.sala()?.iceServers ?? [] });
    for (const t of this.medios?.getTracks() ?? []) pc.addTrack(t, this.medios!);
    pc.onicecandidate = (e) => e.candidate && this.enviar('ice', e.candidate.toJSON());
    pc.ontrack = (e) => { this.remoto()!.nativeElement.srcObject = e.streams[0]; };
    pc.onconnectionstatechange = () => {
      const ok = pc.connectionState === 'connected';
      this.conectado.set(ok);
      this.estadoTexto.set(ok ? 'Conectado' : pc.connectionState === 'failed' ? 'Conexión fallida' : 'Conectando…');
    };
    this.pendientesIce = [];
    this.pc = pc;
    return pc;
  }

  private async ofertar() {
    const pc = this.nuevaConexion();
    const oferta = await pc.createOffer();
    await pc.setLocalDescription(oferta);
    this.enviar('oferta', oferta);
  }

  private async alRecibir(m: { tipo: string; datos?: any; otroPresente?: boolean }) {
    const soyMedico = this.sala()?.participante === 'MEDICO';
    switch (m.tipo) {
      case 'bienvenida':
        if (soyMedico && m.otroPresente) await this.ofertar();
        break;
      case 'presente':
        if (soyMedico) await this.ofertar();
        else this.refrescarEstado();
        break;
      case 'oferta': {
        const pc = this.nuevaConexion();
        await pc.setRemoteDescription(m.datos);
        for (const c of this.pendientesIce) await pc.addIceCandidate(c);
        const resp = await pc.createAnswer();
        await pc.setLocalDescription(resp);
        this.enviar('respuesta', resp);
        this.refrescarEstado();
        break;
      }
      case 'respuesta':
        await this.pc?.setRemoteDescription(m.datos);
        for (const c of this.pendientesIce) await this.pc?.addIceCandidate(c);
        this.pendientesIce = [];
        break;
      case 'ice':
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(m.datos).catch(() => undefined);
        else this.pendientesIce.push(m.datos);
        break;
      case 'listo':
        this.refrescarEstado();
        break;
      case 'colgar':
      case 'ausente':
        this.conectado.set(false);
        this.estadoTexto.set('El otro participante salió');
        this.pc?.close();
        this.pc = null;
        this.refrescarEstado();
        break;
    }
  }

  private async refrescarEstado() {
    try {
      const s = await this.api.post(`/telemedicina/sala/${this.token()}/ingresar`);
      this.estadoCita.set(s.estado);
      if (s.estado === 'EN_CONSULTA') this.consultaLista.set(true);
    } catch { /* la cita pudo terminar */ }
  }

  async iniciarConsulta() {
    try {
      const r = await this.api.post(`/telemedicina/sala/${this.token()}/iniciar`);
      this.estadoCita.set(r.estado);
      this.consultaLista.set(true);
      this.enviar('listo');
    } catch (e) { this.avisos.error(e); }
  }

  alternarAudio() {
    this.audio.update((v) => !v);
    this.medios?.getAudioTracks().forEach((t) => (t.enabled = this.audio()));
  }
  alternarVideo() {
    this.video.update((v) => !v);
    this.medios?.getVideoTracks().forEach((t) => (t.enabled = this.video()));
  }

  colgar() {
    this.cerrar(true);
    this.salir();
  }

  private cerrar(avisar: boolean) {
    if (avisar) this.enviar('colgar');
    this.ws?.close();
    this.pc?.close();
    this.medios?.getTracks().forEach((t) => t.stop());
    this.ws = null;
    this.pc = null;
  }

  salir() { this.router.navigateByUrl(this.auth.rol() === 'MEDICO' ? '/clinico' : '/paciente/citas'); }
}
