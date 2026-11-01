# Yabla Chat

App de **chat y videollamadas en tiempo real** hecha con Node.js, Express, EJS, SQLite (Turso) y Pusher, con arquitectura MVC. Las llamadas de voz y video usan **WebRTC**: el audio y el video viajan directamente entre los navegadores y el servidor solo hace de intermediario para conectarlos.

## Funcionalidades

**Cuenta**
- **Sin correo electrónico**: registro en un solo paso (nombre, usuario y contraseña de 6+ caracteres) con vista previa en vivo, comprobación del usuario mientras escribes, sugerencias si está ocupado, indicador de seguridad y foto opcional
- Inicio de sesión con **@usuario** y contraseña (desde la landing o `/login`)
- **Cambiar contraseña** desde tu perfil, Ajustes o Ctrl+K: pide la actual, muestra la seguridad de la nueva y puede cerrar la sesión en tus otros dispositivos
- Inicio de sesión desde la landing o desde `/login`, con sesiones guardadas en SQLite
- **Mi perfil** con portada, vista previa y estadísticas: foto (o quitarla), nombre, usuario con comprobación en vivo, info con frases rápidas, teléfono, **cumpleaños** (tus contactos ven el aviso ese día) y **color de perfil** (portada y tu nombre en los grupos)
- **Estado de disponibilidad**: Disponible, Ocupado, Ausente o **No molestar** (silencia los avisos); tus contactos lo ven en tu foto y en tu info
- Código QR personal y enlace para que otros te agreguen (`/u/tu_usuario`)
- Bienvenida para usuarios nuevos: chat de la cuenta oficial "Yabla", pantalla de inicio con primeros pasos y personas que quizá conozcas (botón "Saludar")

**Mensajería en tiempo real**
- Chats individuales y grupos (crear, añadir participantes, salir, administradores)
- Texto con enlaces, **más de 1.100 emojis por categorías** (con buscador y recientes, como WhatsApp), stickers, fotos, documentos y **notas de voz**
- **Grabar video y enviarlo** (como WhatsApp): cámara a pantalla completa, cambiar entre cámara frontal y trasera, hasta **1 minuto** con anillo de progreso, vista previa con comentario y «Repetir». También se envían videos de la galería. Llegan como burbuja con miniatura y duración y se reproducen a pantalla completa. Límite: 16 MB por video (4 MB para fotos y documentos); se graban en MP4 (H.264) cuando el navegador lo permite, para que se vean también en iPhone
- **61 stickers en 4 packs**: «Pura vida» (perezoso, tucán, rana de ojos rojos, cafecito, gallo pinto, volcán…), «Frases ticas» (¡Tuanis!, ¡Qué chiva!, Mae…, ¡Upe!), «Amor» y los clásicos; los nuevos son SVG animados ligeros, con pestaña de recientes
- **Vista previa antes de enviar**: varios archivos a la vez (máx. 10), quitar o añadir, comentario por archivo y previsualización de PDF; las fotos pueden enviarse como documento (calidad original)
- Confirmaciones de lectura con tres estados: enviando, enviado ✓, entregado ✓✓ y leído (✓✓ en color)
- "Escribiendo…", "en línea" y "últ. vez…"
- Responder citando un mensaje, **reacciones**, editar (15 min) y eliminar para todos
- **Reenviar** un mensaje a hasta 5 chats a la vez (con la etiqueta "Reenviado")
- **Acciones rápidas** al pasar el ratón (reaccionar y responder), **reaccionar con cualquier emoji** y **deslizar para responder** en móvil
- **Seleccionar varios mensajes** para copiar, destacar, reenviar o eliminar, y **eliminar para mí o para todos**
- **Mensajes fijados** (hasta 3 por chat) en una barra que se recorre al tocarla, como en Telegram
- **Info. del mensaje**: cuándo se entregó y se leyó, por persona en los grupos
- **@menciones** en grupos con sugerencias al escribir; avisan aunque el chat esté silenciado
- **Mensajes temporales** por chat (24 horas, 7 días o 90 días) y **mensajes programados** (clic derecho o pulsación larga en Enviar)
- **Mensajes destacados** con estrella: lista propia para volver a ellos con un toque
- Separador **"N mensajes sin leer"**: el chat se abre en el primer mensaje nuevo
- **Vista previa de enlaces** (título, descripción e imagen de la página)
- Contadores de no leídos, chats fijados y silenciados, vaciar chat y bloquear contactos
- **Archivar chats** (sección "Archivados") y filtros Todos / No leídos / Grupos / Fijados
- **Borradores** por chat: lo que dejas escrito se conserva al cambiar de chat o recargar
- Búsqueda en la lista y dentro de la conversación, scroll infinito del historial
- Pegar o arrastrar imágenes, sonido y notificaciones del navegador

**Llamadas (WebRTC)**
- Llamadas de voz y videollamadas 1 a 1 con timbre, aceptar o rechazar
- Silenciar el micrófono, apagar la cámara y **compartir pantalla**
- Ocupado, sin respuesta y llamadas perdidas quedan registradas en el chat

**Estados (24 h)**
- Publicar fotos con texto, visor con progreso (mantén pulsado para pausar)
- Ver quién vio tu estado, responder a un estado por chat y eliminarlo

**Billetera**
- Dos saldos de demostración: **dólares ($500) y colones costarricenses (₡250.000)**
- Envío de dinero entre contactos eligiendo la moneda, con concepto, saldo disponible y límite por envío ($1.000 / ₡500.000)
- Cada pago aparece como mensaje en el chat y los saldos se actualizan en vivo; historial con la moneda de cada movimiento

**Conocer (citas, opcional)**
- Pestaña **Conocer**: solo participas si activas tu perfil de citas; al hacer **match** mutuo se abre un chat normal de Yabla (marcado con ♥)
- Perfil de citas en 4 pasos: hasta 6 fotos, fecha de nacimiento (**solo mayores de 18**), género, a quién quieres conocer, qué buscas, provincia, intereses (3–8) y hasta 3 preguntas
- Pila de tarjetas estilo Tinder: arrastrar o botones (✕ paso · ★ súper like · ♥ me gusta · ↺ deshacer el último paso) y teclado (← → ↑, `Ctrl + Z`); toca la foto para ver las demás
- Sellos al arrastrar, pantalla **«¡Es un match!»** en tiempo real para los dos, insignia de likes recibidos y 3 súper likes al día
- **Afinidad** por intereses comunes, distancia aproximada por provincia (nunca la ubicación exacta) y filtros de edad, distancia, solo verificados y solo con intereses en común
- **Rompehielos** en el chat de un match: ideas de primer mensaje, juego **«Esto o aquello»** y **propuesta de cita** (videollamada o lugar) que se acepta en el chat y ofrece programar un recordatorio
- **Seguridad**: normas al activar el perfil, pausar el perfil, deshacer un match (el chat desaparece y nadie puede volver a escribir) y **reportar** (bloquea y deshace el match)
- Verificación con selfie: **es de demostración** (se aprueba automáticamente). En producción hay que conectar un servicio real de verificación facial

**App instalable y notificaciones**
- **Se instala como una app** (PWA) en Android, iPhone y escritorio: icono propio, pantalla completa, accesos rápidos al mantener pulsado el icono («Nuevo chat», «Conocer gente») y página propia cuando no hay conexión
- **Notificaciones push** aunque Yabla esté cerrada: nombre y foto de quien escribe, el mensaje, vibración y sonido del teléfono; los mensajes del mismo chat se agrupan («Karla · 3 mensajes nuevos») y tienen los botones **Marcar como leído** y **Responder**
- Avisos de **llamadas entrantes** con la app en segundo plano
- Solo se envían si no estás mirando Yabla en ningún dispositivo; se respetan los chats silenciados (salvo @menciones) y el modo «No molestar»
- **Privacidad:** «Mostrar el contenido» por dispositivo (si se apaga, la notificación solo dice «Tienes un mensaje nuevo»)
- **Número de no leídos en el icono** de la app y en la pestaña del navegador; al abrir un chat se cierran sus notificaciones
- **Sonidos propios** con la app abierta: mensaje nuevo, mensaje en el chat abierto y mensaje enviado
- En Ajustes → Notificaciones: activar en este dispositivo, mostrar el contenido, sonidos, notificación de prueba e **Instalar Yabla**; al cerrar sesión el dispositivo deja de recibir avisos de esa cuenta

**Interfaz**
- Diseño responsive (escritorio, tablet y móvil con botón "atrás")
- **Temas**: Sistema (automático), Claro, Sepia, Oscuro, Atenuado, Océano y Medianoche (negro puro para OLED), desde el botón "Tema" de la barra lateral o en Ajustes
- **Apariencia** en Ajustes: color de la app (6 colores, combinables con cualquier tema), fondo del chat (5 estilos) y tamaño del texto
- Botón **Salir** en la barra lateral para cerrar sesión
- **Buscador rápido `Ctrl + K`** para saltar a cualquier chat o acción, y atajos de teclado (`Ctrl + /` los muestra todos). En teléfonos y tabletas táctiles no hay atajos ni indicaciones de teclado; el buscador sigue disponible desde «Buscar»

### Notificaciones en el teléfono

| Dispositivo | Cómo funciona |
|---|---|
| **Android** (Chrome, Edge, Samsung Internet) | Funciona con la app cerrada. Se activan en Ajustes → Notificaciones. El sonido es el de notificaciones del teléfono |
| **iPhone / iPad** | Requiere **iOS 16.4 o posterior** y **agregar Yabla a la pantalla de inicio** (Safari → Compartir → «Agregar a inicio»). Desde Safari sin instalar, iOS no permite notificaciones web. La app muestra estas instrucciones |
| **Escritorio** (Chrome, Edge, Firefox, Safari) | Funciona con el navegador abierto (aunque la pestaña esté cerrada en Chrome/Edge si el navegador sigue en segundo plano) |

- Necesitan **HTTPS** (en `localhost` también funcionan para desarrollar). En Vercel ya es HTTPS. Para probar en tu teléfono durante el desarrollo usa un túnel con HTTPS, por ejemplo `npx localtunnel --port 3000` o Cloudflare Tunnel.
- Las ventanas de incógnito de Chrome no admiten notificaciones push.
- Una página web no puede elegir su propio tono para las notificaciones push: suena el del sistema. El sonido propio de Yabla se oye cuando la app está abierta.

## Requisitos

- Node.js 18 o superior
- Un navegador moderno. Las llamadas necesitan **HTTPS** o `localhost`.

## Puesta en marcha

```bash
npm install
npm run seed      # crea usuarios y chats de demostración (opcional)
npm run dev       # servidor con recarga automática en http://localhost:3000
```

En producción usa `npm start`. La configuración se lee de un archivo `.env` (copia [`.env.example`](.env.example)); sin él se usan valores por defecto y una base de datos SQLite local en `data/`.

| Script | Descripción |
|---|---|
| `npm start` | Inicia el servidor |
| `npm run dev` | Inicia con nodemon (reinicia al guardar) |
| `npm run seed` | Crea los datos de demostración si la base está vacía |
| `npm run db:reset` | Borra toda la base de datos y vuelve a crear los datos demo |

### Cuentas de demostración

Tras `npm run seed`, todas usan la contraseña **`demo1234`**:

| Nombre | Usuario |
|---|---|
| Andrés Solano | `andres` |
| Karla Jiménez | `karla` |
| Mauricio Vargas | `mauricio` |
| Daniela Mora | `daniela` |

(También `esteban`, `valeria`, `fernanda`, `mariana`, `diego`, `josepablo`, `sofia` y `kevin`.) Son personas ficticias con nombres comunes en Costa Rica.

Diez de ellas tienen perfil de citas en **Conocer**. Con `andres` verás que Daniela, Valeria y Mariana (súper like) ya le dieron like, y tiene un match con Sofía; `esteban` no tiene perfil, para probar el asistente desde cero.

Para probar el tiempo real y las llamadas, abre dos navegadores (o una ventana normal y otra de incógnito) e inicia sesión con dos cuentas distintas.

## Estructura

```
.
├── api/index.js               # Entrada en Vercel (función serverless con Express)
├── server.js                  # Servidor para desarrollo local (+ tareas periódicas cada 10 s)
├── vercel.json                # Rutas, cabeceras, archivos de la función y cron diario
├── src/
│   ├── app.js                 # Configuración de Express (vistas, estáticos, sesión, rutas)
│   ├── config/                # Variables de entorno, conexión SQLite y sesiones
│   ├── db/                    # schema.sql y seed.js
│   ├── models/                # Acceso a datos: User, Conversation, Message, Story, Transaction, File
│   ├── controllers/           # Lógica de cada ruta (auth, páginas, chats, mensajes, estados, billetera)
│   ├── routes/                # web.js (páginas) y api.js (REST)
│   ├── middleware/            # Autenticación, subida de archivos y errores
│   ├── services/              # Tiempo real (Pusher), presencia, llamadas, tareas periódicas (cron.js) y push
│   └── utils/                 # Validaciones y helpers de vistas
├── views/
│   ├── layouts/main.ejs       # Layout común
│   ├── pages/                 # landing, login, register, chat, error
│   └── partials/chat/         # Piezas del chat: barra, lista, conversación, info, modales, llamadas
├── public/assets/
│   ├── css/                   # base.css (sistema de diseño), register.css, dashboard.css, landing*.css
│   ├── js/                    # common.js, register.js, landing-auth.js…
│   │   ├── chat/              # Módulos ES del chat (ver abajo)
│   │   └── landing/           # Código generado por Framer (no editar)
│   └── images/                # Iconos (sprite SVG), avatares, stickers, estados e iconos de la app (pwa/)
├── public/sw.js               # Service worker: notificaciones push, número del icono y página sin conexión
├── public/manifest.webmanifest # Manifiesto de la app instalable
└── data/                      # Base de datos SQLite local para desarrollo (no se versiona)
```

### Módulos del cliente (`public/assets/js/chat/`)

| Módulo | Responsabilidad |
|---|---|
| `main.js` | Arranque, eventos en tiempo real, clics globales y teclado |
| `state.js` | Estado compartido y bus de eventos |
| `api.js` / `socket.js` | Comunicación con el servidor (`socket.js`: Pusher con la interfaz `on`/`emit`) |
| `sidebar.js` | Lista de chats, pestañas e insignias |
| `conversation.js` | Mensajes, envío, notas de voz, respuestas, reacciones y lectura |
| `info.js` | Panel de información del chat o grupo |
| `stories.js` | Estados de 24 h |
| `calls.js` | Llamadas WebRTC |
| `account.js` | Perfil, ajustes, nuevo chat, grupos, QR y billetera |
| `message-extras.js` | Reenviar mensajes y mensajes destacados |
| `link-preview.js` | Tarjetas de vista previa de enlaces |
| `appearance.js` | Color, fondo del chat y tamaño del texto |
| `shortcuts.js` | Buscador rápido (Ctrl + K) y atajos de teclado |
| `chat-actions.js` | Reacciones, deslizar para responder, selección, eliminar, info del mensaje y fijados |
| `mentions.js` | @menciones en grupos |
| `timed.js` | Mensajes temporales y programados |
| `stickers.js` | Panel de stickers por packs con recientes |
| `push.js` | App instalable y notificaciones push: service worker, suscripción, ajustes, número del icono e instalación |
| `sounds.js` | Sonidos de mensaje recibido, en el chat abierto y enviado (Web Audio) |
| `discover.js` | «Conocer»: pila de tarjetas, match, filtros, panel de matches, rompehielos y reportes |
| `dating-profile.js` | Asistente del perfil de citas |

## API REST

Todas las rutas `/api/*` (salvo la de disponibilidad) requieren sesión y responden en JSON.

| Método y ruta | Descripción |
|---|---|
| `GET /api/bootstrap` | Usuario, conversaciones, estados, bloqueados y mensajes destacados |
| `PATCH /api/me` · `PATCH /api/me/settings` · `GET /api/me/qr` | Perfil, privacidad y QR |
| `PATCH /api/me/password` | Cambiar contraseña (`current`, `next`, `logoutOthers`) |
| `GET /api/users?q=` · `POST /api/users/:id/block` | Buscar y bloquear usuarios |
| `POST /api/conversations` | Abrir chat 1 a 1 (`userId`) o crear grupo (`type=group`) |
| `GET/POST /api/conversations/:id/messages` | Historial paginado y envío (texto, archivo, sticker) |
| `PATCH /api/conversations/:id/settings` · `POST …/clear` | Silenciar, fijar, archivar y vaciar |
| `POST/DELETE /api/conversations/:id/members` | Añadir participantes y salir del grupo |
| `PATCH/DELETE /api/messages/:id` · `POST …/reactions` | Editar, eliminar y reaccionar |
| `POST /api/messages/:id/star` · `GET /api/stars` | Destacar o quitar, y lista de destacados |
| `POST /api/messages/:id/forward` | Reenviar a varios chats (`conversationIds`, máx. 5) |
| `GET /api/link-preview?url=` | Vista previa de un enlace (sin direcciones internas, 4 s y 256 KB máx.) |
| `POST /api/messages/:id/pin` · `GET /api/messages/:id/info` | Fijar/desfijar y entregas y lecturas por persona |
| `POST /api/messages/hide` | Eliminar para mí (`ids`) |
| `PATCH /api/conversations/:id/disappearing` | Mensajes temporales (`seconds`: 0, 86400, 604800 o 7776000) |
| `GET/POST /api/conversations/:id/scheduled` · `DELETE /api/scheduled/:id` · `POST /api/scheduled/:id/send` | Mensajes programados |
| `GET/POST /api/stories` · `POST …/:id/view` · `GET …/:id/viewers` | Estados |
| `GET /api/wallet` · `POST /api/wallet/send` | Billetera |
| `GET /api/push/key` | Clave pública VAPID para suscribir el dispositivo |
| `POST/DELETE /api/push/subscribe` | Activar o desactivar las notificaciones push en este dispositivo |
| `PATCH /api/push/preview` · `POST /api/push/test` | Mostrar el contenido (por dispositivo) y notificación de prueba |
| `POST /api/conversations/:id/read` | Marcar un chat como leído (botón de la notificación) |
| `GET /api/dating/options` | Provincias, intereses, preguntas y motivos de reporte |
| `GET/PUT /api/dating/profile` · `PATCH /api/dating/profile/pause` | Perfil de citas (valida mayoría de edad) y pausarlo |
| `POST /api/dating/photos` · `POST /api/dating/verify` | Subir fotos (hasta 6) y verificación con selfie (demostración) |
| `GET /api/dating/deck?ageMin&ageMax&maxKm&verified&common` | Tarjetas para descubrir (filtros en ambos sentidos) |
| `POST /api/dating/swipe` · `POST /api/dating/undo` | Like, paso o súper like (`toId`, `action`) y deshacer el último paso |
| `GET /api/dating/matches` · `GET /api/dating/likes` · `DELETE /api/dating/matches/:id` | Matches, likes recibidos y deshacer un match |
| `POST /api/dating/report` | Reportar (`userId`, `reason`, `details`): bloquea y deshace el match |
| `POST /api/conversations/:id/this-or-that` · `POST /api/conversations/:id/date` · `POST /api/messages/:id/answer` | «Esto o aquello», propuesta de cita y responderlos |

## Tiempo real (Pusher Channels)

El servidor envía los eventos por [Pusher Channels](https://pusher.com/channels) al canal privado de cada usuario (`private-user-<id>`). Lo que avisa el navegador va por HTTP, porque en Vercel el servidor no mantiene conexiones abiertas. [`socket.js`](public/assets/js/chat/socket.js) conserva la interfaz `socket.on` / `socket.emit` para el resto del cliente.

| Del servidor (Pusher) | Del cliente (HTTP) |
|---|---|
| `message:new`, `message:update` | `POST /api/realtime/typing` (escribiendo) |
| `receipt` (entregado / leído), `typing`, `presence` | `POST /api/realtime/receipt` (`kind`: `delivered` o `read`) |
| `conversation:new`, `conversation:update`, `conversation:removed` | `POST /api/realtime/visibility` (latido cada 30 s con la app a la vista) |
| `story:new`, `story:viewed`, `story:deleted`, `wallet:update`, `user:update`, `star:update`, `message:expired`, `message:hidden` | `POST /api/realtime/hello` (al conectarse: en línea y "entregado") |
| `call:incoming`, `call:accepted`, `call:ended` | `POST /api/calls` · `…/:id/accept` · `…/reject` · `…/end` · `…/timeout` |
| `dating:match`, `dating:like`, `dating:unmatch`, `session:revoked` | |
| `sync`: el evento no cabía en Pusher (10 KB) y el cliente recarga su estado | |

- **Señalización de llamadas:** la oferta, la respuesta y los candidatos ICE van directos entre los dos navegadores como eventos de cliente (`client-signal`) en el canal `presence-call-<id>`.
- **Presencia:** los webhooks de Pusher (`POST /api/realtime/webhook`) marcan a cada usuario como en línea o desconectado, y avisan si alguien cierra la pestaña durante una llamada.

## Despliegue (Vercel + Turso + Pusher)

| Pieza | Servicio | Plan gratuito |
|---|---|---|
| App (Express en una función serverless) | [Vercel](https://vercel.com) | Hobby |
| Base de datos | [Turso](https://turso.tech) | Free |
| Tiempo real | [Pusher Channels](https://pusher.com/channels) | Sandbox: 200.000 mensajes al día y 100 conexiones simultáneas |
| Archivos subidos | [Vercel Blob](https://vercel.com/docs/vercel-blob) | Incluido en Hobby |
| Tareas cada minuto | [cron-job.org](https://cron-job.org) | Gratis |

En local, sin las variables de Turso, la app usa un archivo SQLite en `data/` y guarda los archivos en la base de datos. El código es el mismo en los dos casos.

### 1. Base de datos en Turso

Si ya tienes la base de datos en Turso, **se reutiliza tal cual**: la app añade sola las tablas y columnas nuevas al arrancar. Si es nueva:

1. Crea una base de datos en [turso.tech](https://turso.tech) en *AWS US West (Oregon)*: las funciones de Vercel corren en Portland (`pdx1`, en `vercel.json`), al lado. Si eliges otra región, cambia `regions` en `vercel.json` a la más cercana.
2. Copia la **URL** (`libsql://…turso.io`) y crea un **token** de lectura y escritura sin caducidad.

### 2. Pusher Channels

1. Crea una cuenta en [pusher.com](https://pusher.com) → **Channels** → **Create app** (elige el cluster más cercano, por ejemplo `us2`).
2. En **App Keys** copia `app_id`, `key`, `secret` y `cluster`.
3. En **App Settings** activa **Enable client events** (lo usan las llamadas).
4. Cuando ya tengas la URL de Vercel, en **Webhooks** añade `https://tu-app.vercel.app/api/realtime/webhook` con los eventos **Channel existence** y **Presence**.

### 3. Desplegar en Vercel

1. Sube el repositorio a GitHub e impórtalo en [Vercel](https://vercel.com/new). No hace falta elegir framework: [`vercel.json`](vercel.json) ya lo configura todo.
2. En **Storage** crea un **Blob store** y conéctalo al proyecto. Vercel añade `BLOB_READ_WRITE_TOKEN` automáticamente.
3. En **Settings → Environment Variables** añade las variables de la tabla de abajo y vuelve a desplegar.

### 4. Tareas periódicas

Los mensajes programados, los mensajes temporales, los estados caducados, las sesiones viejas y las llamadas que se quedaron sonando se procesan en `GET /api/cron/tick`. En el plan Hobby, Vercel Cron solo se ejecuta **una vez al día** (está en `vercel.json` como respaldo), así que:

1. En [cron-job.org](https://cron-job.org) crea un trabajo **cada 1 minuto** con la URL `https://tu-app.vercel.app/api/cron/tick`.
2. En **Advanced → Headers** añade `Authorization: Bearer <tu CRON_SECRET>`.

Los mensajes programados salen con hasta un minuto de retraso. Con Vercel Pro puedes cambiar el `schedule` de `vercel.json` a `* * * * *` y prescindir de cron-job.org.

### Variables de entorno

Todas están documentadas en [`.env.example`](.env.example). El archivo `.env` es solo para desarrollo local y no se sube a git.

| Variable | En Vercel | Descripción |
|---|---|---|
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | **obligatorias** | Base de datos de Turso (vacías = SQLite local) |
| `SESSION_SECRET` | **obligatoria** | Firma de la cookie de sesión (mín. 32 caracteres). Si ya la tenías en Render, usa la misma para no cerrar las sesiones abiertas |
| `NODE_ENV` | `production` | Cookies seguras y validaciones estrictas |
| `PUSHER_APP_ID` / `PUSHER_KEY` / `PUSHER_SECRET` / `PUSHER_CLUSTER` | **obligatorias** | Tiempo real |
| `BLOB_READ_WRITE_TOKEN` | automática | La añade Vercel al conectar el Blob store |
| `CRON_SECRET` | **obligatoria** | Clave de `/api/cron/tick` (Vercel Cron la envía sola) |
| `SEED_DEMO` | `true` / `false` | Crea los usuarios demo si la base está vacía |
| `BASE_URL` | opcional | URL pública; Vercel la detecta sola (defínela si usas un dominio propio) |
| `ICE_SERVERS` | opcional | Servidores STUN/TURN para WebRTC |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | opcional | Claves de las notificaciones push. Si no las defines, se generan solas la primera vez y se guardan en la base de datos |
| `VAPID_SUBJECT` | opcional | Contacto del emisor (`mailto:tu@correo.com` o una URL https) |

### Límites

- **Archivos:** fotos y documentos de hasta 4 MB (Vercel no acepta peticiones de más de 4,5 MB). Los videos del chat, de hasta 16 MB, se suben directamente a Vercel Blob desde el navegador. Los archivos antiguos guardados en Turso se siguen viendo en `/uploads/…`.
- **Pusher Sandbox:** 100 conexiones simultáneas (cada pestaña abierta cuenta como una) y 200.000 mensajes al día.
- **Arranque en frío:** la primera petición a una instancia nueva tarda un poco más, porque prepara la conexión con Turso. Aun así es mucho menos que despertar un servidor dormido.
- Pon `SEED_DEMO=false` antes de abrir la app al público.
- Para llamadas entre redes distintas (datos móviles, NAT estrictos) añade un servidor **TURN** en `ICE_SERVERS`.
- **Notificaciones push:** si cambian las claves VAPID (por ejemplo, al borrar la base de datos sin tenerlas en el entorno), cada dispositivo se vuelve a suscribir solo la próxima vez que abra Yabla.

## Tecnologías

- **Backend:** Node.js, Express, EJS + express-ejs-layouts, SQLite / Turso (@libsql/client), express-session, Pusher Channels, Vercel Blob, multer, bcryptjs, qrcode, web-push
- **Frontend:** HTML, CSS y JavaScript moderno (módulos ES) sin frameworks, WebRTC, MediaRecorder, Service Worker, Push API, Web Audio
- Tipografía [Inter](https://fonts.google.com/specimen/Inter) e iconos al estilo de [Lucide](https://lucide.dev/)
- Landing creada con [Framer](https://www.framer.com/)

## Autor

Luis Bossa
