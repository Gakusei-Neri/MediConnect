# MediConnect Plus — implementación

Implementación del documento de requisitos [README.md](README.md) (44 requisitos: 23 RF, 9 RNF, 3 RES y 9 RN).

| Capa | Tecnología |
|---|---|
| Backend (servicios de la sección 3.2) | Node.js ≥ 22.5 + Express 5, API REST documentada con OpenAPI (D-01) |
| Base de datos | SQLite con transacciones, mediante el módulo `node:sqlite` integrado en Node (D-02). No necesita compilación nativa |
| Frontend (portal web adaptable a celular) | Angular 22 (componentes standalone, señales, sin zone.js) |
| Videoconsulta | WebRTC entre pares; el servidor solo hace la señalización por WebSocket (D-06) |
| Farmacia, correo y SMS | Simuladores locales (D-08) |

> La sección 3.6 del documento indica React con Vite para el frontend. Por indicación expresa, este proyecto usa **Angular**.

## Puesta en marcha

```bash
npm run instalar          # instala backend y frontend
npm run reset             # crea la BD con datos de PRUEBA (y backend/.env con llaves aleatorias)
npm run backend           # API en http://localhost:3000  (Swagger: /api/docs)  + simulador de farmacia en :4100
npm run frontend          # en otra terminal: portal en http://localhost:4200
```

Contraseña de todos los usuarios demo: `MediConnect2026!`. El personal médico y de enfermería usa 2FA (TOTP). Para obtener el código actual sin aplicación autenticadora:

```bash
npm run totp -- medico.general@mediconnect.test
```

| Usuario | Rol | Para probar |
|---|---|---|
| `juan.gomez@correo.test` | Paciente | Alergia **severa** a amoxicilina y **leve** a ibuprofeno; cita presencial en ~10 min y otra en 3 días |
| `maria.mendez@correo.test` | Paciente | Sin alergias conocidas; videoconsulta en ~10 min |
| `jose.perez@correo.test` | Paciente | Alergias sin registrar (RF-15 bloquea la receta) |
| `recepcion.norte@mediconnect.test` | Recepción (Hospital Norte) | Check-in, agendar, urgencias, agenda médica |
| `medico.general@mediconnect.test` | Médico, Medicina General | Consulta de Juan, receta, alergias |
| `medico.cardio@mediconnect.test` | Médico, Cardiología | Videoconsulta de María |
| `enfermera.norte@mediconnect.test` | Enfermería | Signos vitales y alergias |
| `seguridad@mediconnect.test` | Seguridad | Auditoría, verificación de la cadena y alertas |
| `admin@mediconnect.test` | Administrador | Usuarios, catálogos, parámetros y simulación |

Las citas de demostración se crean alrededor de la hora en que se ejecuta `npm run reset`. Para repetir la demo, ejecútelo otra vez.

### Recorrido sugerido (≈ 5 min)
1. **Recepción** → *Citas del día* → «Registrar llegada» de Juan (pasa a *En sala de espera*).
2. **Médico general** → *Mi agenda* → «Llamar paciente». Capture signos (pruebe temperatura 43 para ver la confirmación de rango) y luego motivo y diagnóstico.
3. En la receta, agregue *Amoxicilina*: la emisión **se bloquea**. Con *Ibuprofeno* se exige justificación. Con *Paracetamol* se pide el código 2FA, se genera el folio y el QR, y la reserva en farmacia pasa a *Reservada*.
4. «Finalizar y firmar». La nota queda inmutable y solo admite *addendum*.
5. Surtido desde la farmacia simulada: `curl -X POST localhost:4100/sim/surtir/<FOLIO>`. El paciente ve la receta como *Surtida*.
6. **María** → *Mis citas* → «Entrar a la videoconsulta». **Dra. Ruiz** → *Mi agenda* → «Videoconsulta» → «Iniciar consulta». La nota se escribe junto al video.
7. **Seguridad** → *Auditoría* → «Verificar integridad», filtros y exportación CSV.

## Estructura

```
backend/
  src/config/parametros.json   P-01..P-18 (RNF-09: se releen al cambiar, sin redesplegar)
  src/db/schema.sql            Esquema, índices únicos (RN-04) y triggers WORM / inmutabilidad (RN-02, RN-06, RN-08, RN-09)
  src/services/                Lógica de negocio por componente (Autenticación, Citas, Clínico, Telemedicina, Notificaciones, Planificador)
  src/routes/                  API REST
  src/ws/senalizacion.js       Señalización WebRTC
  src/simuladores/farmacia.js  Sistema de Farmacia simulado (contrato 3.4)
  test/                        Pruebas de aceptación automatizadas (node:test)
frontend/src/app/
  core/       API, sesión con cierre por inactividad, interceptores y guards por rol
  shared/     Buscador de cupos, diálogos, panel de alergias y 2FA
  pages/      paciente/ recepcion/ clinico/ seguridad/ admin/ comun/
```

## Pruebas

```bash
npm test                              # 32 pruebas de aceptación
npm --prefix backend run coverage     # cobertura (≈ 77 % de líneas; RNF-09 pide ≥ 70 %)
```

Cubren, entre otros: RN-04 (un cupo, una cita), los límites de RN-05 (2 h 01 min se permite, 1 h 59 min se rechaza; la tercera reprogramación se rechaza), RN-03 (transiciones inválidas), RF-08/RF-09 (notificación a 24 h y cancelación automática a 6 h), RF-10 (orden de la lista de espera), RF-12 (un bloqueo con 3 citas no se guarda sin resolverlas), RF-18 (20 casos de alergia severa, 0 folios), RF-17 (10 000 folios sin duplicados), RN-02 (auditoría caída → lectura denegada y emergencia encolada; alteración detectada por la cadena de hashes), RF-02 (bloqueo tras 5 fallos), RN-01 (2FA e inactividad de 15 min), RF-03 (matriz de permisos) y RES-03 (contrato sin datos clínicos).

## Trazabilidad requisito → código

| Requisito | Dónde se implementa |
|---|---|
| RF-01 | `services/autenticacion.js` (`solicitarRegistro`, `confirmarRegistro`), `pages/auth/registro.ts` |
| RF-02, RN-01 | `services/autenticacion.js`, `middleware/auth.js` (sesión + P-07), `utils/totp.js`, `pages/auth/login.ts` |
| RF-03 | `middleware/auth.js` (`permitir`, auditoría de accesos denegados), guards en `core/interceptores.ts` |
| RF-04 a RF-07, RN-04, RN-05 | `services/citas.js`, `shared/buscador-cupos.ts`, `pages/paciente/*`, `pages/recepcion/agendar.ts` |
| RF-08, RF-09, RF-21 (inasistencia) | `services/planificador.js` |
| RF-10 | `services/listaEspera.js` |
| RF-11 | `services/citas.js` (`registrarUrgencia`), `pages/recepcion/urgencias.ts`, `pages/clinico/urgencias.ts` |
| RF-12 | `services/agenda.js`, `pages/recepcion/agenda-medica.ts` |
| RF-13 a RF-16, RF-23, RN-06, RN-07 | `services/clinico.js`, `services/acceso.js`, `pages/clinico/*`, `pages/paciente/recetas.ts` |
| RF-17 a RF-19, RN-09, RES-03 | `services/recetas.js`, `services/farmacia.js`, `routes/farmacia.js`, `simuladores/farmacia.js` |
| RF-20, RF-21, RES-02 | `services/telemedicina.js`, `ws/senalizacion.js`, `pages/comun/videoconsulta.ts` |
| RF-22, RN-02, RN-08 | `services/auditoria.js`, `routes/auditoria.js`, triggers en `schema.sql`, `pages/seguridad/*` |
| RN-03 | `services/estadosCita.js` (tabla de transiciones del diagrama 2.4) |
| RNF-01 | `utils/cifrado.js` (AES-256-GCM para notas, signos, antecedentes, secretos 2FA y datos de registro), `server.js` (TLS 1.3 con `TLS_CERT`/`TLS_KEY`) |
| RNF-05, RNF-06 | `styles.scss` (contraste AA, foco visible, objetivos de 44 px, diseño adaptable), español (México) |
| RNF-08 | `helmet`, límite de tasa, errores sin traza, consultas parametrizadas |
| RNF-09 | `openapi.js` (`/api/docs`), `config/parametros.js`, `pages/admin/parametros.ts` |

## Decisiones y supuestos del desarrollador

Estos puntos no los fija el documento y deben validarse:

- **Relación asistencial del enfermero (RN-07):** los enfermeros no tienen citas asignadas. Se asume que tienen relación con los pacientes que tienen una cita en su sede dentro de la ventana P-18, o una urgencia activa en su sede.
- **Duración del acceso de emergencia (RF-23):** 4 h. Se configura con `HORAS_ACCESO_EMERGENCIA`.
- **Inactividad (P-07):** se aplica a todos los roles, no solo al personal clínico.
- **Reprogramar o cancelar por cambio de agenda (RF-12):** no cuenta para el límite de reprogramaciones del paciente ni está sujeto a P-03.
- **RF-19:** se reintenta cuando la farmacia falla. Cuando responde «sin stock», solo se avisa, y el médico puede reintentar manualmente.
- **Una receta vigente por consulta.** Para emitir otra, primero se anula la anterior (RN-06).
- **Urgencias (RF-11):** el paciente debe estar registrado. El registro temporal de pacientes no identificados (Anexo A, punto 11) queda pendiente.
- **TLS mutuo con la farmacia (RES-03):** en desarrollo se usa una llave compartida (`x-api-key`). Con `TLS_CA` definido, el servidor exige un certificado de cliente válido.
- **Cifrado en reposo:** se cifran por campo los datos clínicos y los secretos. El cifrado del archivo completo de la BD y de los respaldos (RNF-01, RNF-07) corresponde a la infraestructura (disco cifrado o KMS) y no a esta aplicación.
- **Zona horaria:** las sedes de prueba están en `America/Mexico_City`. La interfaz muestra esa hora (D-07).
- **Fuera de esta fase:** app móvil nativa (Anexo A, punto 13), alta disponibilidad (RNF-04), respaldos automáticos con RPO/RTO (RNF-07) y escaneos de vulnerabilidades (RNF-08). Son requisitos de operación e infraestructura.
