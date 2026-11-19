// D-05: segundo factor TOTP (RFC 6238), compatible con aplicaciones autenticadoras estándar.
import crypto from 'node:crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, valor = 0, salida = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
}

export function base32Decode(texto) {
  const limpio = texto.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0, valor = 0;
  const salida = [];
  for (const ch of limpio) {
    const idx = ALFABETO.indexOf(ch);
    if (idx < 0) throw new Error('Secreto base32 inválido');
    valor = (valor << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      salida.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(salida);
}

export const generarSecreto = () => base32Encode(crypto.randomBytes(20));

export function hotp(secreto, contador, digitos = 6) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(contador));
  const hmac = crypto.createHmac('sha1', base32Decode(secreto)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const codigo = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digitos;
  return String(codigo).padStart(digitos, '0');
}

export function totp(secreto, momento = Date.now(), paso = 30) {
  return hotp(secreto, Math.floor(momento / 1000 / paso));
}

/** Verifica con tolerancia de ±1 paso (30 s) por desfase de reloj. */
export function verificarTotp(secreto, codigo, momento = Date.now()) {
  if (!secreto || !/^\d{6}$/.test(String(codigo ?? ''))) return false;
  for (const delta of [-1, 0, 1]) {
    const esperado = totp(secreto, momento + delta * 30_000);
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(String(codigo)))) return true;
  }
  return false;
}

export const uriOtpAuth = (secreto, cuenta, emisor = 'MediConnect Plus') =>
  `otpauth://totp/${encodeURIComponent(emisor)}:${encodeURIComponent(cuenta)}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=30`;
