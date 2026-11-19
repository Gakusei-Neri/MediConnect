// Utilidad de DESARROLLO: muestra el código TOTP actual de un usuario demo
// (equivale a la aplicación autenticadora). Uso: npm run totp -- medico.general@mediconnect.test
const { abrir, q } = await import('../src/db/database.js');
const { descifrar } = await import('../src/utils/cifrado.js');
const { totp } = await import('../src/utils/totp.js');

abrir();
const correo = process.argv[2];
const filas = correo
  ? q.all('SELECT correo, totp_secret_enc FROM usuarios WHERE correo = ? AND totp_secret_enc IS NOT NULL', correo)
  : q.all('SELECT correo, totp_secret_enc FROM usuarios WHERE totp_secret_enc IS NOT NULL');
if (!filas.length) {
  console.error('No hay usuarios con 2FA' + (correo ? ` para ${correo}` : ''));
  process.exit(1);
}
const restante = 30 - (Math.floor(Date.now() / 1000) % 30);
for (const f of filas) console.log(`${f.correo.padEnd(36)} ${totp(descifrar(f.totp_secret_enc))}`);
console.log(`(válido ~${restante} s más)`);
