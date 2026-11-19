// D-06 / RES-02: señalización WebRTC. El servidor solo reenvía SDP e ICE entre los dos
// participantes autenticados de la cita; el audio y video viajan cifrados (DTLS-SRTP) entre pares
// y nunca pasan por el servidor ni se graban.
import { WebSocketServer } from 'ws';
import { usuarioDesdeToken } from '../middleware/auth.js';
import { validarEnlace } from '../services/telemedicina.js';

const salas = new Map(); // token -> Map(participante -> ws)
const TIPOS = new Set(['oferta', 'respuesta', 'ice', 'colgar', 'listo']);

export function adjuntarSenalizacion(servidor) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    // Se responde con el subprotocolo de la aplicación (nunca se refleja el token)
    handleProtocols: (protocolos) => (protocolos.has('mediconnect') ? 'mediconnect' : false),
  });

  servidor.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws/senalizacion') return socket.destroy();
    let contexto;
    try {
      // El JWT viaja en el subprotocolo para no exponerlo en la URL
      const protos = String(req.headers['sec-websocket-protocol'] || '').split(',').map((s) => s.trim());
      const jwt = protos.find((p) => p.startsWith('jwt.'))?.slice(4);
      const usuario = usuarioDesdeToken(jwt);
      const sala = url.searchParams.get('sala');
      const { participante, cita } = validarEnlace(sala, usuario);
      contexto = { usuario, sala, participante, citaId: cita.id };
    } catch {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, contexto));
  });

  wss.on('connection', (ws, ctx) => {
    if (!salas.has(ctx.sala)) salas.set(ctx.sala, new Map());
    const sala = salas.get(ctx.sala);
    sala.get(ctx.participante)?.close(4000, 'Reemplazado por una nueva conexión');
    sala.set(ctx.participante, ws);
    const otro = () => sala.get(ctx.participante === 'PACIENTE' ? 'MEDICO' : 'PACIENTE');
    const enviar = (destino, msg) => destino?.readyState === 1 && destino.send(JSON.stringify(msg));

    enviar(ws, { tipo: 'bienvenida', participante: ctx.participante, otroPresente: Boolean(otro()) });
    enviar(otro(), { tipo: 'presente', participante: ctx.participante });

    ws.on('message', (datos) => {
      let msg;
      try { msg = JSON.parse(String(datos)); } catch { return; }
      if (!TIPOS.has(msg?.tipo)) return;
      enviar(otro(), { tipo: msg.tipo, datos: msg.datos, de: ctx.participante });
    });

    ws.on('close', () => {
      if (sala.get(ctx.participante) === ws) sala.delete(ctx.participante);
      enviar(otro(), { tipo: 'ausente', participante: ctx.participante });
      if (!sala.size) salas.delete(ctx.sala);
    });
  });

  return wss;
}
